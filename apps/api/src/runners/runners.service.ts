import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { R2ArtifactStore } from '@qaforge/agent-sdk';
import { prisma } from '@qaforge/database';
import {
  ArtifactType,
  ExecutionStatus,
  Role,
  normalizePriorityLabel,
  sortCasesByPriority,
} from '@qaforge/shared';
import { buildZipPackage } from '@qaforge/report-engine';
import { z } from 'zod';
import { decrypt, encrypt } from '../common/encryption';
import { parseBody } from '../common/parse-body';
import { OrgsService } from '../orgs/orgs.service';
import {
  cycleName,
  isWaitingLocalRunner,
  readSelection,
  type TcmsSelection,
} from '../phase1/tcms-support';

export const RUNNER_ONLINE_MS = 45_000;
export const LOCAL_WAIT_MS = 120_000;

export type RunnerPrincipal = {
  id: string;
  organizationId: string;
  userId: string;
  name: string;
};

const caseEventSchema = z.object({
  testCaseId: z.string().min(1),
  externalId: z.string().max(120).optional(),
  status: z.enum(['PASSED', 'FAILED']),
  message: z.string().max(8000).nullable().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  spec: z.string().max(200_000).optional(),
  screenshotBase64: z.string().max(2_500_000).optional(),
  videoBase64: z.string().max(8_000_000).optional(),
});

const completeSchema = z.object({
  status: z.enum(['COMPLETED', 'FAILED', 'CANCELLED']),
  errorSummary: z.string().max(8000).nullable().optional(),
  passed: z.number().int().nonnegative().optional(),
  failed: z.number().int().nonnegative().optional(),
  html: z.string().max(2_000_000).optional(),
});

const heartbeatSchema = z.object({
  executionId: z.string().min(1).optional(),
  userAgent: z.string().max(300).optional(),
  hostname: z.string().max(120).optional(),
});

export type LocalJobPayload = {
  executionId: string;
  projectId: string;
  projectName: string;
  runName: string;
  appUrl: string;
  loginUrl?: string;
  username?: string;
  password?: string;
  browser: 'chromium' | 'firefox' | 'webkit';
  headless: boolean;
  cases: Array<{
    id: string;
    externalId: string;
    scenario: string;
    priorityLabel: string;
    steps: string[];
    expected: string;
    testData: Record<string, string>;
  }>;
};

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function apiBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.BETTER_AUTH_URL ||
    'http://localhost:4000'
  ).replace(/\/$/, '');
}

function fromBase64(data?: string): Buffer | null {
  if (!data?.trim()) return null;
  const raw = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
  try {
    const buf = Buffer.from(raw, 'base64');
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

@Injectable()
export class RunnersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RunnersService.name);
  private expireTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly orgs: OrgsService) {}

  onModuleInit() {
    this.expireTimer = setInterval(() => {
      void this.expireWaitingLocalJobs().catch((err) =>
        this.logger.warn(`expire waiting jobs: ${(err as Error).message}`),
      );
    }, 15_000);
  }

  onModuleDestroy() {
    if (this.expireTimer) clearInterval(this.expireTimer);
  }

  isOnline(lastSeenAt: Date | null | undefined) {
    if (!lastSeenAt) return false;
    return Date.now() - lastSeenAt.getTime() < RUNNER_ONLINE_MS;
  }

  async resolveByToken(token: string): Promise<RunnerPrincipal | null> {
    const row = await prisma.localRunner.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      userId: row.userId,
      name: row.name,
    };
  }

  async assertUserRunnerOnline(orgId: string, userId: string) {
    const row = await prisma.localRunner.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId },
      },
    });
    if (!this.isOnline(row?.lastSeenAt)) {
      throw new BadRequestException(
        'Start the local runner on your PC, then retry',
      );
    }
    return row!;
  }

  async createToken(userId: string, orgId: string, name?: string) {
    await this.orgs.requireMembership(userId, orgId, Role.TESTER);
    const token = `qf_live_${randomBytes(24).toString('base64url')}`;
    const tokenHash = hashToken(token);
    const runnerName = name?.trim() || 'Local runner';
    const row = await prisma.localRunner.upsert({
      where: {
        organizationId_userId: { organizationId: orgId, userId },
      },
      create: {
        organizationId: orgId,
        userId,
        name: runnerName,
        tokenHash,
        lastSeenAt: null,
      },
      update: {
        name: runnerName,
        tokenHash,
        lastSeenAt: null,
        userAgent: null,
      },
    });
    const apiUrl = apiBaseUrl();
    return {
      id: row.id,
      name: row.name,
      token,
      apiUrl,
      command: `pnpm --filter @qaforge/worker local-runner --api ${apiUrl} --token ${token}`,
      shownOnce: true,
    };
  }

  async status(userId: string, orgId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);
    await this.expireWaitingLocalJobs();
    const row = await prisma.localRunner.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId },
      },
    });
    const online = this.isOnline(row?.lastSeenAt);
    return {
      hasRunner: Boolean(row),
      online,
      lastSeenAt: row?.lastSeenAt ?? null,
      name: row?.name ?? null,
      onlineWindowMs: RUNNER_ONLINE_MS,
      apiUrl: apiBaseUrl(),
    };
  }

  async heartbeat(runner: RunnerPrincipal, body: unknown) {
    const input = parseBody(heartbeatSchema, body ?? {});
    const userAgent = [input.hostname, input.userAgent]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 300);
    await prisma.localRunner.update({
      where: { id: runner.id },
      data: {
        lastSeenAt: new Date(),
        ...(userAgent ? { userAgent } : {}),
      },
    });
    let cancelled = false;
    if (input.executionId) {
      const execution = await prisma.execution.findFirst({
        where: {
          id: input.executionId,
          project: { organizationId: runner.organizationId },
        },
        select: { status: true },
      });
      cancelled = execution?.status === ExecutionStatus.CANCELLED;
    }
    return { ok: true, cancelled };
  }

  async claimNext(runner: RunnerPrincipal): Promise<{ job: LocalJobPayload | null }> {
    await prisma.localRunner.update({
      where: { id: runner.id },
      data: { lastSeenAt: new Date() },
    });
    await this.expireWaitingLocalJobs();

    const candidates = await prisma.execution.findMany({
      where: {
        status: ExecutionStatus.PENDING,
        runMode: 'MANUAL',
        deletedAt: null,
        project: { organizationId: runner.organizationId },
      },
      include: { project: true },
      orderBy: { createdAt: 'asc' },
      take: 40,
    });

    for (const execution of candidates) {
      const selection = readSelection(execution.selection);
      if (!isWaitingLocalRunner(selection, execution.status)) continue;
      if (selection.runnerUserId && selection.runnerUserId !== runner.userId) {
        continue;
      }

      const claimed = await prisma.execution.updateMany({
        where: { id: execution.id, status: ExecutionStatus.PENDING },
        data: {
          status: ExecutionStatus.RUNNING,
          startedAt: execution.startedAt ?? new Date(),
          errorSummary: null,
        },
      });
      if (claimed.count !== 1) continue;

      const nextSelection: TcmsSelection = {
        ...selection,
        claimedByRunnerId: runner.id,
      };
      await prisma.execution.update({
        where: { id: execution.id },
        data: { selection: nextSelection as never },
      });

      const job = await this.buildJobPayload(
        { ...execution, selection: nextSelection as never },
        nextSelection,
      );
      return { job };
    }

    return { job: null };
  }

  async recordCaseEvent(runner: RunnerPrincipal, executionId: string, body: unknown) {
    const input = parseBody(caseEventSchema, body);
    const execution = await this.requireRunnerJob(runner, executionId);
    if (execution.status === ExecutionStatus.CANCELLED) {
      throw new BadRequestException('Run was stopped');
    }
    const selection = readSelection(execution.selection);
    const caseIds = selection.testCaseIds ?? [];
    if (!caseIds.includes(input.testCaseId)) {
      throw new BadRequestException('Case is not in this cycle');
    }

    const evidenceKeys: string[] = [];
    const shot = fromBase64(input.screenshotBase64);
    if (shot) {
      const key = await this.putBinary({
        executionId,
        type: ArtifactType.SCREENSHOT,
        key: `${executionId}/screenshots/${input.externalId || input.testCaseId}-${input.status.toLowerCase()}.png`,
        body: shot,
        mime: 'image/png',
      });
      evidenceKeys.push(key);
    }
    const video = fromBase64(input.videoBase64);
    if (video) {
      const key = await this.putBinary({
        executionId,
        type: ArtifactType.VIDEO,
        key: `${executionId}/videos/fail-${input.externalId || input.testCaseId}.webm`,
        body: video,
        mime: 'video/webm',
      });
      evidenceKeys.push(key);
    }

    if (input.spec?.trim()) {
      const specPath = `tests/${(input.externalId || input.testCaseId).replace(/[^a-zA-Z0-9._-]/g, '_')}.spec.ts`;
      await prisma.automatedScript.upsert({
        where: {
          projectId_testCaseId: {
            projectId: execution.projectId,
            testCaseId: input.testCaseId,
          },
        },
        create: {
          projectId: execution.projectId,
          testCaseId: input.testCaseId,
          path: specPath,
          source: input.spec,
          language: 'TYPESCRIPT',
          framework: 'PLAYWRIGHT',
          lastRunId: executionId,
          lastStatus: input.status,
        },
        update: {
          path: specPath,
          source: input.spec,
          lastRunId: executionId,
          lastStatus: input.status,
        },
      });
    } else {
      await prisma.automatedScript.updateMany({
        where: { projectId: execution.projectId, testCaseId: input.testCaseId },
        data: { lastRunId: executionId, lastStatus: input.status },
      });
    }

    const existing = await prisma.testResult.findFirst({
      where: { executionId, testCaseId: input.testCaseId },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      await prisma.testResult.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          message: input.message ?? existing.message,
          durationMs: input.durationMs ?? existing.durationMs,
          executedBy: 'AI',
          evidenceKeys: evidenceKeys.length
            ? (evidenceKeys as never)
            : existing.evidenceKeys ?? undefined,
        },
      });
    } else {
      await prisma.testResult.create({
        data: {
          projectId: execution.projectId,
          executionId,
          testCaseId: input.testCaseId,
          status: input.status,
          message: input.message ?? null,
          durationMs: input.durationMs ?? null,
          executedBy: 'AI',
          evidenceKeys: evidenceKeys.length ? (evidenceKeys as never) : undefined,
        },
      });
    }

    return { ok: true };
  }

  async completeJob(runner: RunnerPrincipal, executionId: string, body: unknown) {
    const input = parseBody(completeSchema, body);
    const execution = await this.requireRunnerJob(runner, executionId);
    if (
      execution.status === ExecutionStatus.COMPLETED ||
      execution.status === ExecutionStatus.CANCELLED
    ) {
      return { ok: true, status: execution.status };
    }

    const selection = readSelection(execution.selection);
    const { localCreds: _drop, ...rest } = selection;
    const cleaned: TcmsSelection = { ...rest, claimedByRunnerId: runner.id };

    let htmlKey: string | null = null;
    let zipKey: string | null = null;
    if (input.html?.trim()) {
      const stamp = Date.now();
      htmlKey = await this.putBinary({
        executionId,
        type: ArtifactType.REPORT_HTML,
        key: `${executionId}/automation-reports/${stamp}.html`,
        body: input.html,
        mime: 'text/html',
      });
      const artifacts = await prisma.artifact.findMany({
        where: { executionId },
      });
      const files: Record<string, Buffer | string> = {
        'report.html': input.html,
      };
      for (const art of artifacts) {
        const blob = await prisma.artifactBlob.findUnique({
          where: { storageKey: art.storageKey },
        });
        if (!blob) continue;
        const name = art.storageKey.split('/').slice(1).join('/') || art.storageKey;
        files[name] = Buffer.from(blob.body);
      }
      const zipBuf = await buildZipPackage({ files });
      zipKey = await this.putBinary({
        executionId,
        type: ArtifactType.ZIP_PACKAGE,
        key: `${executionId}/automation-reports/${stamp}.zip`,
        body: zipBuf,
        mime: 'application/zip',
      });
    }

    const passed =
      input.passed ??
      (await prisma.testResult.count({
        where: { executionId, status: 'PASSED' },
      }));
    const failed =
      input.failed ??
      (await prisma.testResult.count({
        where: { executionId, status: 'FAILED' },
      }));

    if (htmlKey || zipKey) {
      await prisma.automationReport.create({
        data: {
          projectId: execution.projectId,
          executionId,
          name: `${cycleName(selection, execution.createdAt)} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
          status: input.status === 'CANCELLED' ? 'CANCELLED' : failed > 0 ? 'FAILED' : 'PASSED',
          passed,
          failed,
          htmlKey,
          zipKey,
        },
      });
    }

    const status =
      input.status === 'CANCELLED'
        ? ExecutionStatus.CANCELLED
        : input.status === 'FAILED'
          ? ExecutionStatus.FAILED
          : ExecutionStatus.COMPLETED;

    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status,
        finishedAt: new Date(),
        errorSummary: input.errorSummary ?? null,
        selection: cleaned as never,
      },
    });

    return { ok: true, status };
  }

  async expireWaitingLocalJobs() {
    const rows = await prisma.execution.findMany({
      where: {
        status: ExecutionStatus.PENDING,
        runMode: 'MANUAL',
        deletedAt: null,
      },
      select: { id: true, selection: true, createdAt: true },
      take: 80,
      orderBy: { createdAt: 'asc' },
    });
    const now = Date.now();
    for (const row of rows) {
      const selection = readSelection(row.selection);
      if (!isWaitingLocalRunner(selection, ExecutionStatus.PENDING)) continue;
      const queued = selection.localQueuedAt
        ? Date.parse(selection.localQueuedAt)
        : row.createdAt.getTime();
      if (!Number.isFinite(queued) || now - queued < LOCAL_WAIT_MS) continue;
      await prisma.execution.updateMany({
        where: { id: row.id, status: ExecutionStatus.PENDING },
        data: {
          status: ExecutionStatus.FAILED,
          finishedAt: new Date(),
          errorSummary: 'Start the local runner on your PC, then retry',
        },
      });
    }
  }

  private async requireRunnerJob(runner: RunnerPrincipal, executionId: string) {
    const execution = await prisma.execution.findFirst({
      where: {
        id: executionId,
        runMode: 'MANUAL',
        project: { organizationId: runner.organizationId },
      },
    });
    if (!execution) throw new NotFoundException('Run not found');
    const selection = readSelection(execution.selection);
    if (selection.runnerTarget !== 'LOCAL') {
      throw new BadRequestException('Not a local runner job');
    }
    if (selection.runnerUserId && selection.runnerUserId !== runner.userId) {
      throw new BadRequestException('This job belongs to another runner');
    }
    return execution;
  }

  private async buildJobPayload(
    execution: {
      id: string;
      projectId: string;
      createdAt: Date;
      selection: unknown;
      project: { id: string; name: string; appUrl: string | null; loginUrl: string | null };
    },
    selection: TcmsSelection,
  ): Promise<LocalJobPayload> {
    const creds = this.decryptLocalCreds(selection.localCreds);
    const caseIds = selection.testCaseIds ?? [];
    const cases = caseIds.length
      ? await prisma.testCase.findMany({
          where: { id: { in: caseIds }, deletedAt: null },
        })
      : [];
    const ordered = sortCasesByPriority(
      cases.map((c) => ({
        ...c,
        priorityLabel: c.priorityLabel ?? normalizePriorityLabel(c.priority),
      })),
    );
    const browser =
      selection.browser === 'firefox' || selection.browser === 'webkit'
        ? selection.browser
        : 'chromium';
    return {
      executionId: execution.id,
      projectId: execution.projectId,
      projectName: execution.project.name,
      runName: cycleName(selection, execution.createdAt),
      appUrl: creds.appUrl || execution.project.appUrl || '',
      loginUrl: creds.loginUrl || execution.project.loginUrl || undefined,
      username: creds.username || undefined,
      password: creds.password || undefined,
      browser,
      headless: (selection.browserMode ?? 'HEADED') !== 'HEADED',
      cases: ordered.map((c) => ({
        id: c.id,
        externalId: c.externalId,
        scenario: c.scenario,
        priorityLabel: c.priorityLabel ?? 'MEDIUM',
        steps: Array.isArray(c.steps) ? c.steps.map(String) : [],
        expected: c.expected,
        testData:
          c.testData && typeof c.testData === 'object'
            ? (c.testData as Record<string, string>)
            : {},
      })),
    };
  }

  encryptLocalCreds(creds: {
    appUrl: string;
    loginUrl?: string;
    username?: string;
    password?: string;
  }) {
    return encrypt(JSON.stringify(creds));
  }

  private decryptLocalCreds(blob?: string) {
    if (!blob) {
      return {
        appUrl: '',
        loginUrl: undefined as string | undefined,
        username: undefined as string | undefined,
        password: undefined as string | undefined,
      };
    }
    try {
      const parsed = JSON.parse(decrypt(blob)) as {
        appUrl?: string;
        loginUrl?: string;
        username?: string;
        password?: string;
      };
      return {
        appUrl: parsed.appUrl ?? '',
        loginUrl: parsed.loginUrl,
        username: parsed.username,
        password: parsed.password,
      };
    } catch {
      return {
        appUrl: '',
        loginUrl: undefined as string | undefined,
        username: undefined as string | undefined,
        password: undefined as string | undefined,
      };
    }
  }

  private async putBinary(opts: {
    executionId: string;
    type: string;
    key: string;
    body: Buffer | string;
    mime: string;
  }) {
    const store = new R2ArtifactStore({
      executionId: opts.executionId,
      fallbackRootDir: `${process.cwd()}/.artifacts`,
    });
    const stored = await store.put(opts.key, opts.body, opts.mime);
    const buf = Buffer.isBuffer(opts.body)
      ? opts.body
      : Buffer.from(opts.body, 'utf8');
    const checksum = createHash('sha256').update(buf).digest('hex');
    await prisma.artifact.create({
      data: {
        executionId: opts.executionId,
        type: opts.type,
        storageKey: stored.key,
        mime: opts.mime,
        size: stored.size,
        checksum,
      },
    });
    await prisma.artifactBlob.upsert({
      where: { storageKey: stored.key },
      create: {
        storageKey: stored.key,
        mime: opts.mime,
        size: buf.length,
        body: buf as never,
      },
      update: {
        mime: opts.mime,
        size: buf.length,
        body: buf as never,
      },
    });
    return stored.key;
  }
}
