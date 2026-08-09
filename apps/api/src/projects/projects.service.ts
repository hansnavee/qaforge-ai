import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { R2ArtifactStore } from '@qaforge/agent-sdk';
import { prisma } from '@qaforge/database';
import {
  Role,
  createProjectSchema,
  createRequirementPasteSchema,
  updateProjectSchema,
} from '@qaforge/shared';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/parse-body';
import type { SessionUser } from '../auth/auth';
import { OrgsService } from '../orgs/orgs.service';
import {
  isAllowedRequirementFile,
  parseRequirementFile,
} from '../phase1/parse-requirement-file';

const MAX_REQUIREMENT_BYTES = 15 * 1024 * 1024;

function mapRequirementDoc(doc: {
  id: string;
  projectId: string;
  storageKey: string;
  mime: string;
  filename: string;
  fileSize: number | null;
  sourceType: string;
  originalContent: string | null;
  parsedText: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: doc.id,
    projectId: doc.projectId,
    fileName: doc.filename,
    fileType: doc.mime,
    fileSize: doc.fileSize,
    sourceType: doc.sourceType,
    originalContent: doc.originalContent,
    storageKey: doc.storageKey,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly orgs: OrgsService,
    private readonly audit: AuditService,
  ) {}

  private async requireProject(
    userId: string,
    orgId: string,
    projectId: string,
    minRole: Role = Role.VIEWER,
  ) {
    await this.orgs.requireMembership(userId, orgId, minRole);
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async create(user: SessionUser, orgId: string, body: unknown) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const input = parseBody(createProjectSchema, body);

    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        name: input.name,
        description: input.description?.trim() || null,
        appUrl: input.appUrl ?? null,
        status: 'DRAFT',
        analysisStatus: 'NOT_STARTED',
        loginUrl: input.loginUrl ?? null,
        framework: input.framework,
        language: input.language,
        environment: input.environment,
        requirementText: null,
      },
    });

    let requirement = null;
    const paste = input.requirementText?.trim();
    if (paste) {
      requirement = await this.createPasteRequirement(project.id, paste);
    }

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'project.create',
      resource: 'project',
      resourceId: project.id,
      metadata: {
        name: project.name,
        appUrl: project.appUrl,
        status: project.status,
        hasRequirement: Boolean(requirement),
      },
    });

    return {
      ...project,
      requirementCount: requirement ? 1 : 0,
      requirements: requirement ? [mapRequirementDoc(requirement)] : [],
    };
  }

  /**
   * Atomic create: project + uploaded file requirement in one request.
   */
  async createWithUpload(
    user: SessionUser,
    orgId: string,
    fields: { name?: string; appUrl?: string; description?: string },
    file: Express.Multer.File | undefined,
  ) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);

    const name = fields.name?.trim() ?? '';
    if (name.length < 2) {
      throw new BadRequestException('Project name must be at least 2 characters');
    }

    let appUrl: string | undefined;
    if (fields.appUrl?.trim()) {
      try {
        appUrl = z.string().url().parse(fields.appUrl.trim());
      } catch {
        throw new BadRequestException('Application URL must be a valid URL');
      }
    }

    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'Upload a PDF, DOCX, or TXT requirement file, or paste requirements as text',
      );
    }

    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        name,
        description: fields.description?.trim() || null,
        appUrl: appUrl ?? null,
        status: 'DRAFT',
        analysisStatus: 'NOT_STARTED',
      },
    });

    try {
      const requirement = await this.createUploadRequirement(project.id, file);
      await this.audit.log({
        organizationId: orgId,
        userId: user.id,
        action: 'project.create',
        resource: 'project',
        resourceId: project.id,
        metadata: {
          name: project.name,
          appUrl: project.appUrl,
          status: project.status,
          hasRequirement: true,
          filename: file.originalname,
        },
      });
      return {
        ...project,
        requirementCount: 1,
        requirements: [mapRequirementDoc(requirement)],
      };
    } catch (err) {
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
      throw err;
    }
  }

  async list(userId: string, orgId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);
    const projects = await prisma.project.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { requirements: true } },
      },
    });
    return projects.map((p) => ({
      id: p.id,
      organizationId: p.organizationId,
      name: p.name,
      description: p.description,
      appUrl: p.appUrl,
      status: p.status,
      analysisStatus: p.analysisStatus,
      analysisCompletedAt: p.analysisCompletedAt,
      staleRequirementCount: p.staleRequirementCount,
      framework: p.framework,
      language: p.language,
      environment: p.environment,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      requirementCount: p._count.requirements,
    }));
  }

  async get(userId: string, orgId: string, projectId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId, deletedAt: null },
      include: {
        requirements: { orderBy: { createdAt: 'desc' } },
        _count: {
          select: {
            requirements: true,
            extractedRequirements: true,
            requirementQuestions: true,
            featureGroups: true,
          },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');

    const staleCount = await prisma.requirement.count({
      where: { projectId, analysisStale: true },
    });

    const { requirements, _count, ...rest } = project;
    return {
      ...rest,
      requirementCount: _count.requirements,
      extractedRequirementCount: _count.extractedRequirements,
      questionCount: _count.requirementQuestions,
      featureGroupCount: _count.featureGroups,
      staleRequirementCount: staleCount,
      requirements: requirements.map(mapRequirementDoc),
      primaryRequirement: requirements[0]
        ? mapRequirementDoc(requirements[0])
        : null,
    };
  }

  async update(
    user: SessionUser,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const input = parseBody(updateProjectSchema, body);
    await this.requireProject(user.id, orgId, projectId, Role.MEMBER);

    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.appUrl !== undefined ? { appUrl: input.appUrl ?? null } : {}),
        ...(input.loginUrl !== undefined
          ? { loginUrl: input.loginUrl ?? null }
          : {}),
        ...(input.framework !== undefined ? { framework: input.framework } : {}),
        ...(input.language !== undefined ? { language: input.language } : {}),
        ...(input.environment !== undefined
          ? { environment: input.environment }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.requirementText !== undefined
          ? { requirementText: input.requirementText }
          : {}),
      },
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'project.update',
      resource: 'project',
      resourceId: project.id,
      metadata: input,
    });

    return this.get(user.id, orgId, projectId);
  }

  async softDelete(user: SessionUser, orgId: string, projectId: string) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    await this.requireProject(user.id, orgId, projectId, Role.MEMBER);

    // Hard delete — cascades requirements, questions, features, relations
    await prisma.$transaction(async (tx) => {
      await tx.project.delete({ where: { id: projectId } });
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'project.delete',
      resource: 'project',
      resourceId: projectId,
    });

    return { ok: true, id: projectId };
  }

  async listRequirements(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    const docs = await prisma.requirementDocument.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map(mapRequirementDoc);
  }

  async addRequirement(
    user: SessionUser,
    orgId: string,
    projectId: string,
    opts: { file?: Express.Multer.File; body?: unknown },
  ) {
    await this.requireProject(user.id, orgId, projectId, Role.MEMBER);

    if (opts.file?.buffer?.length) {
      const doc = await this.createUploadRequirement(projectId, opts.file);
      await this.audit.log({
        organizationId: orgId,
        userId: user.id,
        action: 'requirements.upload',
        resource: 'requirement_document',
        resourceId: doc.id,
        metadata: { filename: opts.file.originalname, projectId },
      });
      return mapRequirementDoc(doc);
    }

    const input = parseBody(createRequirementPasteSchema, opts.body ?? {});
    const doc = await this.createPasteRequirement(
      projectId,
      input.originalContent,
    );
    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'requirements.paste',
      resource: 'requirement_document',
      resourceId: doc.id,
      metadata: { projectId, sourceType: 'PASTE' },
    });
    return mapRequirementDoc(doc);
  }

  private async createPasteRequirement(projectId: string, content: string) {
    const text = content.trim();
    if (!text) {
      throw new BadRequestException('Pasted requirements cannot be empty');
    }
    const storageKey = `projects/${projectId}/requirements/paste-${randomUUID()}.txt`;
    const store = new R2ArtifactStore({
      fallbackRootDir: `${process.cwd()}/.artifacts`,
    });
    await store.put(storageKey, Buffer.from(text, 'utf8'), 'text/plain');

    return prisma.requirementDocument.create({
      data: {
        projectId,
        storageKey,
        mime: 'text/plain',
        filename: 'pasted-requirements.txt',
        fileSize: Buffer.byteLength(text, 'utf8'),
        sourceType: 'PASTE',
        originalContent: text,
        parsedText: text,
      },
    });
  }

  private async createUploadRequirement(
    projectId: string,
    file: Express.Multer.File,
  ) {
    if (file.size > MAX_REQUIREMENT_BYTES || file.buffer.length > MAX_REQUIREMENT_BYTES) {
      throw new BadRequestException(
        'File is too large. Maximum size is 15 MB.',
      );
    }
    if (!isAllowedRequirementFile(file.originalname, file.mimetype)) {
      throw new BadRequestException(
        'Unsupported file type. Upload PDF, DOCX, or TXT.',
      );
    }

    let originalContent = '';
    try {
      originalContent = await parseRequirementFile(
        file.buffer,
        file.originalname,
        file.mimetype,
      );
    } catch (err) {
      throw new BadRequestException(
        `Failed to parse file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const storageKey = `projects/${projectId}/requirements/${randomUUID()}-${file.originalname}`;
    const store = new R2ArtifactStore({
      fallbackRootDir: `${process.cwd()}/.artifacts`,
    });
    await store.put(
      storageKey,
      file.buffer,
      file.mimetype || 'application/octet-stream',
    );

    return prisma.requirementDocument.create({
      data: {
        projectId,
        storageKey,
        mime: file.mimetype || 'application/octet-stream',
        filename: file.originalname,
        fileSize: file.size || file.buffer.length,
        sourceType: 'UPLOAD',
        originalContent: originalContent.trim() || null,
        // Keep parsedText as a non-authoritative mirror for legacy STLC readers
        parsedText: originalContent.trim() || null,
      },
    });
  }
}
