import {
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { prisma } from '@qaforge/database';
import { R2ArtifactStore } from '@qaforge/agent-sdk';
import { ArtifactType, Role } from '@qaforge/shared';
import type { Response } from 'express';
import { Readable } from 'stream';
import { OrgsService } from '../orgs/orgs.service';

@Injectable()
export class ArtifactsService {
  constructor(private readonly orgs: OrgsService) {}

  private store() {
    return new R2ArtifactStore({
      fallbackRootDir: `${process.cwd()}/.artifacts`,
    });
  }

  async list(userId: string, orgId: string, executionId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);

    const execution = await prisma.execution.findFirst({
      where: {
        id: executionId,
        project: { organizationId: orgId },
      },
    });
    if (!execution) throw new NotFoundException('Execution not found');

    return prisma.artifact.findMany({
      where: { executionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getByStorageKey(
    userId: string,
    orgId: string,
    executionId: string,
    storageKey: string,
    res: Response,
  ): Promise<StreamableFile> {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);

    const execution = await prisma.execution.findFirst({
      where: {
        id: executionId,
        project: { organizationId: orgId },
      },
    });
    if (!execution) throw new NotFoundException('Execution not found');

    const artifact = await prisma.artifact.findFirst({
      where: { executionId, storageKey },
    });
    if (!artifact) {
      // Allow direct key access when evidenceKeys point at store without Artifact row
      const allowedPrefix = `${executionId}/`;
      if (!storageKey.startsWith(allowedPrefix) && !storageKey.includes(`/${executionId}/`)) {
        throw new NotFoundException('Artifact not found');
      }
    }

    let buf: Buffer;
    try {
      buf = await this.store().get(storageKey);
    } catch {
      throw new NotFoundException(`Artifact file missing: ${storageKey}`);
    }

    const mime =
      artifact?.mime ||
      (storageKey.endsWith('.webm')
        ? 'video/webm'
        : storageKey.endsWith('.png')
          ? 'image/png'
          : storageKey.endsWith('.jpg') || storageKey.endsWith('.jpeg')
            ? 'image/jpeg'
            : 'application/octet-stream');
    const filename = storageKey.split('/').pop() ?? 'artifact.bin';
    res.set({
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, max-age=60',
    });
    return new StreamableFile(Readable.from(buf));
  }

  async downloadZip(
    userId: string,
    orgId: string,
    executionId: string,
    res: Response,
  ): Promise<StreamableFile> {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);

    const execution = await prisma.execution.findFirst({
      where: {
        id: executionId,
        project: { organizationId: orgId },
      },
    });
    if (!execution) throw new NotFoundException('Execution not found');

    const zip = await prisma.artifact.findFirst({
      where: {
        executionId,
        type: {
          in: [ArtifactType.STLC_FINAL_ZIP, ArtifactType.ZIP_PACKAGE],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!zip) {
      throw new NotFoundException('ZIP artifact not found for this execution');
    }

    let buf: Buffer;
    try {
      buf = await this.store().get(zip.storageKey);
    } catch {
      throw new NotFoundException(
        `ZIP file missing in storage: ${zip.storageKey}`,
      );
    }

    res.set({
      'Content-Type': zip.mime || 'application/zip',
      'Content-Disposition': `attachment; filename="execution-${executionId}.zip"`,
    });
    return new StreamableFile(Readable.from(buf));
  }

  async downloadByType(
    userId: string,
    orgId: string,
    executionId: string,
    type: string,
    res: Response,
  ): Promise<StreamableFile> {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);
    const execution = await prisma.execution.findFirst({
      where: {
        id: executionId,
        project: { organizationId: orgId },
      },
    });
    if (!execution) throw new NotFoundException('Execution not found');

    const row = await prisma.artifact.findFirst({
      where: { executionId, type },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw new NotFoundException(`Artifact type ${type} not found`);

    let buf: Buffer;
    try {
      buf = await this.store().get(row.storageKey);
    } catch {
      throw new NotFoundException(`Artifact file missing: ${row.storageKey}`);
    }

    const ext =
      type === ArtifactType.REPORT_HTML
        ? 'html'
        : type === ArtifactType.REPORT_JUNIT
          ? 'xml'
          : type.includes('ZIP')
            ? 'zip'
            : 'bin';
    res.set({
      'Content-Type':
        row.mime ||
        (ext === 'html'
          ? 'text/html; charset=utf-8'
          : ext === 'xml'
            ? 'application/xml'
            : 'application/octet-stream'),
      'Content-Disposition': `attachment; filename="${type.toLowerCase()}-${executionId}.${ext}"`,
    });
    return new StreamableFile(Readable.from(buf));
  }
}
