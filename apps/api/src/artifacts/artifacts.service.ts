import {
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { resolve } from 'path';
import { prisma } from '@qaforge/database';
import { ArtifactType, Role } from '@qaforge/shared';
import type { Response } from 'express';
import { OrgsService } from '../orgs/orgs.service';

@Injectable()
export class ArtifactsService {
  constructor(private readonly orgs: OrgsService) {}

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

  async downloadZip(
    userId: string,
    orgId: string,
    executionId: string,
    res: Response,
  ): Promise<StreamableFile | { url: string; mock?: boolean }> {
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
        type: ArtifactType.ZIP_PACKAGE,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!zip) {
      throw new NotFoundException('ZIP artifact not found for this execution');
    }

    const key = zip.storageKey;

    // Local .artifacts store
    if (key.startsWith('.artifacts/') || key.startsWith('artifacts/')) {
      const localPath = resolve(process.cwd(), key);
      if (!existsSync(localPath)) {
        throw new NotFoundException(`Local artifact file missing: ${key}`);
      }
      res.set({
        'Content-Type': zip.mime || 'application/zip',
        'Content-Disposition': `attachment; filename="execution-${executionId}.zip"`,
      });
      return new StreamableFile(createReadStream(localPath));
    }

    // Absolute local path under workspace artifacts dir
    const artifactsRoot = resolve(process.cwd(), '.artifacts');
    const maybeLocal = resolve(artifactsRoot, key);
    if (maybeLocal.startsWith(artifactsRoot) && existsSync(maybeLocal)) {
      res.set({
        'Content-Type': zip.mime || 'application/zip',
        'Content-Disposition': `attachment; filename="execution-${executionId}.zip"`,
      });
      return new StreamableFile(createReadStream(maybeLocal));
    }

    // R2 / remote signed URL (graceful degrade)
    const publicBase = process.env.R2_PUBLIC_URL;
    if (publicBase) {
      const url = `${publicBase.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
      return { url };
    }

    if (process.env.R2_ACCOUNT_ID && process.env.R2_BUCKET) {
      // Without full AWS SDK wiring, return a descriptive mock signed URL
      return {
        url: `https://${process.env.R2_BUCKET}.r2.dev/${key}?mockSigned=1`,
        mock: true,
      };
    }

    throw new NotFoundException(
      'Artifact storage backend not configured and local file not found',
    );
  }
}
