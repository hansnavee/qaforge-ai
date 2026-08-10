import {
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { prisma } from '@qaforge/database';
import { R2ArtifactStore } from '@qaforge/agent-sdk';
import { ArtifactType, Role } from '@qaforge/shared';
import {
  buildZipPackage,
  renderHtmlReport,
  renderJunitXml,
  rowsToCsv,
} from '@qaforge/report-engine';
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

  private async rebuildExecutionZip(executionId: string, projectId: string) {
    const [project, cases, bugs, results, evidenceArts] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.testCase.findMany({ where: { executionId } }),
      prisma.bug.findMany({ where: { executionId } }),
      prisma.testResult.findMany({
        where: { executionId },
        include: { testCase: true },
      }),
      prisma.artifact.findMany({
        where: {
          executionId,
          type: { in: [ArtifactType.SCREENSHOT, ArtifactType.VIDEO] },
        },
      }),
    ]);

    const files: Record<string, Buffer | string> = {
      'test-cases.csv': rowsToCsv(
        [
          'id',
          'module',
          'scenario',
          'expected',
          'priority',
          'type',
          'testData',
        ],
        cases.map((c) => ({
          id: c.externalId,
          module: c.module,
          scenario: c.scenario,
          expected: c.expected,
          priority: c.priority,
          type: c.type,
          testData: c.testData ? JSON.stringify(c.testData) : '',
        })),
      ),
      'bugs.csv': rowsToCsv(
        ['id', 'title', 'severity', 'status', 'description'],
        bugs.map((b) => ({
          id: b.id,
          title: b.title,
          severity: b.severity,
          status: b.status,
          description: b.description,
        })),
      ),
      'results.csv': rowsToCsv(
        ['id', 'testCase', 'status', 'message', 'durationMs'],
        results.map((r) => ({
          id: r.id,
          testCase: r.testCase?.externalId ?? '',
          status: r.status,
          message: r.message,
          durationMs: r.durationMs,
        })),
      ),
      'manifest.json': JSON.stringify(
        {
          executionId,
          projectId,
          projectName: project?.name,
          rebuiltOnDownload: true,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    };

    const store = this.store();
    for (const art of evidenceArts) {
      try {
        const body = await store.get(art.storageKey);
        files[`evidence/${art.storageKey.split('/').pop()}`] = body;
      } catch {
        /* skip missing evidence blobs */
      }
    }

    return buildZipPackage({ files });
  }

  private async rebuildReportHtml(
    executionId: string,
    project: { name: string; appUrl: string | null },
    status: string,
    scoresRaw: unknown,
  ) {
    const [results, bugs] = await Promise.all([
      prisma.testResult.findMany({
        where: { executionId },
        include: { testCase: true },
      }),
      prisma.bug.findMany({ where: { executionId } }),
    ]);
    const scores =
      scoresRaw && typeof scoresRaw === 'object'
        ? (scoresRaw as Record<string, number>)
        : {};
    return renderHtmlReport({
      executionId,
      projectName: project.name,
      appUrl: project.appUrl ?? '',
      status,
      scores: {
        functional: scores.functional,
        accessibility: scores.accessibility,
        performance: scores.performance,
        security: scores.security,
        uiux: scores.uiux,
      },
      summary: {
        passed:
          scores.passed ?? results.filter((r) => r.status === 'PASSED').length,
        failed:
          scores.failed ?? results.filter((r) => r.status === 'FAILED').length,
        total: scores.total ?? results.length,
      },
      findings: bugs.map((b) => ({
        category: 'defect',
        severity: b.severity,
        title: b.title,
        description: b.description,
      })),
      testCases: results.map((r) => ({
        id: r.testCase?.externalId ?? r.id,
        title: r.testCase?.scenario ?? r.id,
        status: r.status,
        message: r.message,
        priority: r.testCase?.priority,
      })),
      recommendations: [],
    });
  }

  private async rebuildJunit(
    executionId: string,
    project: { name: string; appUrl: string | null },
    status: string,
    scoresRaw: unknown,
  ) {
    const results = await prisma.testResult.findMany({
      where: { executionId },
      include: { testCase: true },
    });
    const scores =
      scoresRaw && typeof scoresRaw === 'object'
        ? (scoresRaw as Record<string, number>)
        : {};
    return renderJunitXml({
      executionId,
      projectName: project.name,
      appUrl: project.appUrl ?? '',
      status,
      scores: {},
      summary: {
        passed:
          scores.passed ?? results.filter((r) => r.status === 'PASSED').length,
        failed:
          scores.failed ?? results.filter((r) => r.status === 'FAILED').length,
        total: scores.total ?? results.length,
      },
      findings: [],
      testCases: results.map((r) => ({
        id: r.testCase?.externalId ?? r.id,
        title: r.testCase?.scenario ?? r.id,
        status: r.status,
        message: r.message,
      })),
      recommendations: [],
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
      if (
        !storageKey.startsWith(allowedPrefix) &&
        !storageKey.includes(`/${executionId}/`)
      ) {
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

    let buf: Buffer | null = null;
    if (zip) {
      try {
        buf = await this.store().get(zip.storageKey);
      } catch {
        buf = null;
      }
    }

    if (!buf) {
      buf = await this.rebuildExecutionZip(executionId, execution.projectId);
    }

    res.set({
      'Content-Type': 'application/zip',
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
      include: { project: true },
    });
    if (!execution) throw new NotFoundException('Execution not found');

    const row = await prisma.artifact.findFirst({
      where: { executionId, type },
      orderBy: { createdAt: 'desc' },
    });

    let buf: Buffer | null = null;
    if (row) {
      try {
        buf = await this.store().get(row.storageKey);
      } catch {
        buf = null;
      }
    }

    if (!buf && type === ArtifactType.REPORT_HTML) {
      buf = Buffer.from(
        await this.rebuildReportHtml(
          executionId,
          execution.project,
          execution.status,
          execution.scores,
        ),
        'utf8',
      );
    }

    if (!buf && type === ArtifactType.REPORT_JUNIT) {
      buf = Buffer.from(
        await this.rebuildJunit(
          executionId,
          execution.project,
          execution.status,
          execution.scores,
        ),
        'utf8',
      );
    }

    if (!buf && (type === ArtifactType.STLC_FINAL_ZIP || type === ArtifactType.ZIP_PACKAGE)) {
      buf = await this.rebuildExecutionZip(executionId, execution.projectId);
    }

    if (!buf) {
      throw new NotFoundException(
        row
          ? `Artifact file missing: ${row.storageKey}`
          : `Artifact type ${type} not found`,
      );
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
        row?.mime ||
        (ext === 'html'
          ? 'text/html; charset=utf-8'
          : ext === 'xml'
            ? 'application/xml'
            : ext === 'zip'
              ? 'application/zip'
              : 'application/octet-stream'),
      'Content-Disposition': `attachment; filename="${type.toLowerCase()}-${executionId}.${ext}"`,
    });
    return new StreamableFile(Readable.from(buf));
  }
}
