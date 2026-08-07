import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '@qaforge/database';
import { Role, createProjectSchema } from '@qaforge/shared';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/parse-body';
import type { SessionUser } from '../auth/auth';
import { OrgsService } from '../orgs/orgs.service';

const updateProjectSchema = createProjectSchema.partial().extend({
  name: z.string().min(1).optional(),
  appUrl: z.string().url().optional(),
});

@Injectable()
export class ProjectsService {
  constructor(
    private readonly orgs: OrgsService,
    private readonly audit: AuditService,
  ) {}

  async create(user: SessionUser, orgId: string, body: unknown) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const input = parseBody(createProjectSchema, body);

    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        name: input.name,
        appUrl: input.appUrl,
        loginUrl: input.loginUrl,
        framework: input.framework,
        language: input.language,
        environment: input.environment,
        requirementText: input.requirementText,
      },
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'project.create',
      resource: 'project',
      resourceId: project.id,
      metadata: { name: project.name, appUrl: project.appUrl },
    });

    return project;
  }

  async list(userId: string, orgId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);
    return prisma.project.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(userId: string, orgId: string, projectId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async update(user: SessionUser, orgId: string, projectId: string, body: unknown) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const input = parseBody(updateProjectSchema, body);
    await this.get(user.id, orgId, projectId);

    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.appUrl !== undefined ? { appUrl: input.appUrl } : {}),
        ...(input.loginUrl !== undefined ? { loginUrl: input.loginUrl } : {}),
        ...(input.framework !== undefined ? { framework: input.framework } : {}),
        ...(input.language !== undefined ? { language: input.language } : {}),
        ...(input.environment !== undefined ? { environment: input.environment } : {}),
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

    return project;
  }

  async softDelete(user: SessionUser, orgId: string, projectId: string) {
    await this.orgs.requireMembership(user.id, orgId, Role.ADMIN);
    await this.get(user.id, orgId, projectId);

    const project = await prisma.project.update({
      where: { id: projectId },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'project.delete',
      resource: 'project',
      resourceId: project.id,
    });

    return { ok: true, id: project.id };
  }
}
