import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { R2ArtifactStore } from '@qaforge/agent-sdk';
import { prisma } from '@qaforge/database';
import {
  ArtifactType,
  ExecutionStatus,
  Role,
  clarifyExecutionSchema,
} from '@qaforge/shared';
import {
  buildZipPackage,
  rowsToCsv,
  rowsToHtmlTable,
  rowsToSpreadsheetMl,
  type WorksheetRow,
} from '@qaforge/report-engine';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/parse-body';
import type { SessionUser } from '../auth/auth';
import { OrgsService } from '../orgs/orgs.service';
import { QueueService } from '../queue/queue.service';
import {
  isAllowedRequirementFile,
  parseRequirementFile,
} from './parse-requirement-file';

const updateRequirementsSchema = z.object({
  requirementText: z.string().min(1),
});

const STLC_RUN_MODES = ['STLC', 'PHASE1'] as const;

@Injectable()
export class Phase1Service {
  constructor(
    private readonly orgs: OrgsService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  private async resolveOrgId(userId: string, projectId: string) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { organizationId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    await this.orgs.requireMembership(
      userId,
      project.organizationId,
      Role.VIEWER,
    );
    return project.organizationId;
  }

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

  async startCompat(user: SessionUser, projectId: string) {
    const orgId = await this.resolveOrgId(user.id, projectId);
    return this.start(user, orgId, projectId);
  }

  async start(user: SessionUser, orgId: string, projectId: string) {
    const project = await this.requireProject(
      user.id,
      orgId,
      projectId,
      Role.MEMBER,
    );

    const execution = await prisma.execution.create({
      data: {
        projectId: project.id,
        status: ExecutionStatus.QUEUED,
        phase: 'INIT',
        runMode: 'STLC',
        startedAt: new Date(),
      },
    });

    await this.queue.enqueueRunExecution(execution.id, {
      jobId: `stlc-${execution.id}`,
      runMode: 'STLC',
    });

    await this.queue.publishExecutionEvent(execution.id, {
      executionId: execution.id,
      type: 'stlc.queued',
      phase: 'INIT',
      message: 'STLC QA run queued',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'stlc.start',
      resource: 'execution',
      resourceId: execution.id,
      metadata: { projectId, runMode: 'STLC' },
    });

    return execution;
  }

  async uploadRequirementCompat(
    user: SessionUser,
    projectId: string,
    file: Express.Multer.File | undefined,
  ) {
    const orgId = await this.resolveOrgId(user.id, projectId);
    return this.uploadRequirement(user, orgId, projectId, file);
  }

  async uploadRequirement(
    user: SessionUser,
    orgId: string,
    projectId: string,
    file: Express.Multer.File | undefined,
  ) {
    await this.requireProject(user.id, orgId, projectId, Role.MEMBER);
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }
    if (!isAllowedRequirementFile(file.originalname, file.mimetype)) {
      throw new BadRequestException(
        'Unsupported file type. Upload PDF, DOCX, or TXT.',
      );
    }

    let parsedText = '';
    try {
      parsedText = await parseRequirementFile(
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
    await store.put(storageKey, file.buffer, file.mimetype);

    const doc = await prisma.requirementDocument.create({
      data: {
        projectId,
        storageKey,
        mime: file.mimetype || 'application/octet-stream',
        filename: file.originalname,
        parsedText: parsedText.trim() || null,
      },
    });

    // Append parsed text into project requirements so STLC always has inline text
    if (parsedText.trim()) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { requirementText: true },
      });
      const existing = project?.requirementText?.trim() ?? '';
      const block = `# ${file.originalname}\n${parsedText.trim()}`;
      await prisma.project.update({
        where: { id: projectId },
        data: {
          requirementText: existing ? `${existing}\n\n${block}` : block,
        },
      });
    }

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'requirements.upload',
      resource: 'requirement_document',
      resourceId: doc.id,
      metadata: { filename: file.originalname, projectId },
    });

    return doc;
  }

  async listRequirementDocumentsCompat(userId: string, projectId: string) {
    const orgId = await this.resolveOrgId(userId, projectId);
    return this.listRequirementDocuments(userId, orgId, projectId);
  }

  async listRequirementDocuments(
    userId: string,
    orgId: string,
    projectId: string,
  ) {
    await this.requireProject(userId, orgId, projectId);
    return prisma.requirementDocument.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateRequirementsCompat(
    user: SessionUser,
    projectId: string,
    body: unknown,
  ) {
    const orgId = await this.resolveOrgId(user.id, projectId);
    return this.updateRequirements(user, orgId, projectId, body);
  }

  async updateRequirements(
    user: SessionUser,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(user.id, orgId, projectId, Role.MEMBER);
    const input = parseBody(updateRequirementsSchema, body);
    return prisma.project.update({
      where: { id: projectId },
      data: { requirementText: input.requirementText },
    });
  }

  async clarifyCompat(user: SessionUser, projectId: string, body: unknown) {
    const orgId = await this.resolveOrgId(user.id, projectId);
    return this.clarify(user, orgId, projectId, body);
  }

  async clarify(
    user: SessionUser,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(user.id, orgId, projectId, Role.MEMBER);
    const input = parseBody(clarifyExecutionSchema, body);

    const execution = await prisma.execution.findFirst({
      where: {
        projectId,
        runMode: { in: [...STLC_RUN_MODES] },
        status: ExecutionStatus.AWAITING_CLARIFICATION,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!execution) {
      throw new ForbiddenException('No STLC run awaiting clarification');
    }

    await this.queue.publishClarify(execution.id, {
      skip: Boolean(input.skip),
      answers: input.answers ?? {},
    });

    await this.queue.publishExecutionEvent(execution.id, {
      executionId: execution.id,
      type: input.skip
        ? 'execution.clarification_skipped'
        : 'execution.clarification_submitted',
      phase: 'CLARIFICATION',
      message: input.skip
        ? 'User skipped clarification'
        : 'User submitted clarification answers',
      timestamp: new Date().toISOString(),
    });

    return { ok: true, executionId: execution.id };
  }

  async getWorkspaceCompat(userId: string, projectId: string) {
    const orgId = await this.resolveOrgId(userId, projectId);
    return this.getWorkspace(userId, orgId, projectId);
  }

  async getWorkspace(userId: string, orgId: string, projectId: string) {
    const project = await this.requireProject(userId, orgId, projectId);
    const [
      latestExecution,
      snapshot,
      rounds,
      testCases,
      bugs,
      results,
      documents,
    ] = await Promise.all([
      prisma.execution.findFirst({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.projectRequirementSnapshot.findFirst({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.clarificationRound.findMany({
        where: { projectId },
        orderBy: [{ round: 'desc' }],
        take: 5,
      }),
      prisma.testCase.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.bug.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.testResult.findMany({
        where: { projectId },
        include: { testCase: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.requirementDocument.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const openRound = rounds.find((r) => !r.answeredAt && !r.skipped);
    const questionsFromRedis = latestExecution
      ? await this.queue.getClarificationQuestions(latestExecution.id)
      : null;

    const artifactTypes = [
      ArtifactType.TEST_STRATEGY_JSON,
      ArtifactType.TEST_DESIGN_JSON,
      ArtifactType.TEST_DATA_JSON,
      ArtifactType.APPLICATION_MAP,
      ArtifactType.FUNCTIONAL_FINDINGS,
      ArtifactType.API_RESULTS,
      ArtifactType.QUALITY_ANALYSIS_JSON,
      ArtifactType.STLC_FINAL_ZIP,
      ArtifactType.ZIP_PACKAGE,
      ArtifactType.GITHUB_ACTIONS_WORKFLOW,
    ];

    const artifacts = latestExecution
      ? await prisma.artifact.findMany({
          where: {
            executionId: latestExecution.id,
            type: { in: [...artifactTypes] },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const latestByType = new Map<string, (typeof artifacts)[number]>();
    for (const a of artifacts) {
      if (!latestByType.has(a.type)) latestByType.set(a.type, a);
    }

    const strategyArtifact = latestByType.get(ArtifactType.TEST_STRATEGY_JSON);
    let strategy: unknown = null;
    if (strategyArtifact) {
      try {
        const store = new R2ArtifactStore({
          fallbackRootDir: `${process.cwd()}/.artifacts`,
        });
        const buf = await store.get(strategyArtifact.storageKey);
        strategy = JSON.parse(buf.toString('utf8'));
      } catch {
        strategy = null;
      }
    }
    if (!strategy) {
      const strategySnap = await prisma.projectRequirementSnapshot.findFirst({
        where: {
          projectId,
          payload: { path: ['kind'], equals: 'TEST_STRATEGY' },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (
        strategySnap?.payload &&
        typeof strategySnap.payload === 'object' &&
        strategySnap.payload !== null &&
        'strategy' in strategySnap.payload
      ) {
        strategy = (strategySnap.payload as { strategy: unknown }).strategy;
      }
    }

    return {
      project,
      latestExecution,
      requirementsClear: Boolean(snapshot?.clear),
      requirementSnapshot: snapshot,
      requirementDocuments: documents.map((d) => ({
        id: d.id,
        filename: d.filename,
        mime: d.mime,
        createdAt: d.createdAt,
        hasParsedText: Boolean(d.parsedText?.trim()),
      })),
      clarificationRounds: rounds,
      openClarification: openRound
        ? {
            round: openRound.round,
            questions: openRound.questions,
            executionId: openRound.executionId,
          }
        : questionsFromRedis &&
            latestExecution?.status === ExecutionStatus.AWAITING_CLARIFICATION
          ? {
              round: rounds[0]?.round ?? 1,
              questions:
                (questionsFromRedis as { questions?: unknown }).questions ??
                questionsFromRedis,
              executionId: latestExecution.id,
            }
          : null,
      testCases,
      bugs,
      results,
      strategy,
      artifacts: [...latestByType.values()].map((a) => ({
        id: a.id,
        type: a.type,
        storageKey: a.storageKey,
        mime: a.mime,
        size: a.size,
      })),
      counts: {
        testCases: testCases.length,
        bugs: bugs.length,
        results: results.length,
        passed: results.filter((r) => r.status === 'PASSED').length,
        failed: results.filter((r) => r.status === 'FAILED').length,
        documents: documents.length,
      },
    };
  }

  async downloadFinalPackCompat(
    userId: string,
    projectId: string,
    res: Response,
  ) {
    const orgId = await this.resolveOrgId(userId, projectId);
    return this.downloadFinalPack(userId, orgId, projectId, res);
  }

  async downloadFinalPack(
    userId: string,
    orgId: string,
    projectId: string,
    res: Response,
  ) {
    const project = await this.requireProject(userId, orgId, projectId);
    const execution = await prisma.execution.findFirst({
      where: { projectId, runMode: { in: [...STLC_RUN_MODES] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!execution) throw new NotFoundException('No STLC execution found');

    const artifact = await prisma.artifact.findFirst({
      where: {
        executionId: execution.id,
        type: {
          in: [ArtifactType.STLC_FINAL_ZIP, ArtifactType.ZIP_PACKAGE],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    let buf: Buffer | null = null;
    if (artifact) {
      try {
        const store = new R2ArtifactStore({
          fallbackRootDir: `${process.cwd()}/.artifacts`,
        });
        buf = await store.get(artifact.storageKey);
      } catch {
        buf = null;
      }
    }

    if (!buf) {
      const [cases, bugs, results] = await Promise.all([
        prisma.testCase.findMany({ where: { executionId: execution.id } }),
        prisma.bug.findMany({ where: { executionId: execution.id } }),
        prisma.testResult.findMany({
          where: { executionId: execution.id },
          include: { testCase: true },
        }),
      ]);
      if (!cases.length && !bugs.length && !results.length && !artifact) {
        throw new NotFoundException('Final STLC pack not ready');
      }
      buf = await buildZipPackage({
        files: {
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
              executionId: execution.id,
              projectId,
              projectName: project.name,
              appUrl: project.appUrl,
              rebuiltOnDownload: true,
              generatedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
        },
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="stlc-final-${projectId}.zip"`,
    );
    res.send(buf);
  }

  async listTestCasesCompat(userId: string, projectId: string) {
    const orgId = await this.resolveOrgId(userId, projectId);
    return this.listTestCases(userId, orgId, projectId);
  }

  async listTestCases(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    return prisma.testCase.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listBugsCompat(userId: string, projectId: string) {
    const orgId = await this.resolveOrgId(userId, projectId);
    return this.listBugs(userId, orgId, projectId);
  }

  async listBugs(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    return prisma.bug.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listResultsCompat(userId: string, projectId: string) {
    const orgId = await this.resolveOrgId(userId, projectId);
    return this.listResults(userId, orgId, projectId);
  }

  async listResults(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    return prisma.testResult.findMany({
      where: { projectId },
      include: { testCase: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private sendDownload(
    res: Response,
    format: string,
    basename: string,
    headers: string[],
    rows: WorksheetRow[],
  ) {
    const fmt = (format || 'csv').toLowerCase();
    if (fmt === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${basename}.json"`,
      );
      res.send(JSON.stringify(rows, null, 2));
      return;
    }
    if (fmt === 'xlsx' || fmt === 'xls') {
      const body = rowsToSpreadsheetMl(basename, headers, rows);
      res.setHeader('Content-Type', 'application/vnd.ms-excel');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${basename}.xls"`,
      );
      res.send(body);
      return;
    }
    if (fmt === 'html') {
      const body = rowsToHtmlTable(basename, headers, rows);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${basename}.html"`,
      );
      res.send(body);
      return;
    }
    const body = rowsToCsv(headers, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${basename}.csv"`,
    );
    res.send(body);
  }

  async downloadTestCasesCompat(
    userId: string,
    projectId: string,
    format: string,
    res: Response,
  ) {
    const orgId = await this.resolveOrgId(userId, projectId);
    return this.downloadTestCases(userId, orgId, projectId, format, res);
  }

  async downloadTestCases(
    userId: string,
    orgId: string,
    projectId: string,
    format: string,
    res: Response,
  ) {
    const cases = await this.listTestCases(userId, orgId, projectId);
    const headers = [
      'id',
      'module',
      'scenario',
      'preconditions',
      'steps',
      'expected',
      'priority',
      'severity',
      'type',
      'testData',
    ];
    const rows: WorksheetRow[] = cases.map((c) => ({
      id: c.externalId,
      module: c.module,
      scenario: c.scenario,
      preconditions: c.preconditions,
      steps: Array.isArray(c.steps) ? (c.steps as string[]).join(' | ') : '',
      expected: c.expected,
      priority: c.priority,
      severity: c.severity,
      type: c.type,
      testData: c.testData ? JSON.stringify(c.testData) : '',
    }));
    this.sendDownload(res, format, 'test-cases', headers, rows);
  }

  async downloadBugsCompat(
    userId: string,
    projectId: string,
    format: string,
    res: Response,
  ) {
    const orgId = await this.resolveOrgId(userId, projectId);
    return this.downloadBugs(userId, orgId, projectId, format, res);
  }

  async downloadBugs(
    userId: string,
    orgId: string,
    projectId: string,
    format: string,
    res: Response,
  ) {
    const bugs = await this.listBugs(userId, orgId, projectId);
    const headers = [
      'id',
      'title',
      'severity',
      'status',
      'description',
      'stepsToReproduce',
      'evidence',
    ];
    const rows: WorksheetRow[] = bugs.map((b) => ({
      id: b.id,
      title: b.title,
      severity: b.severity,
      status: b.status,
      description: b.description,
      stepsToReproduce: b.stepsToReproduce,
      evidence: Array.isArray(b.evidenceKeys)
        ? (b.evidenceKeys as string[]).join(' | ')
        : '',
    }));
    this.sendDownload(res, format, 'bugs', headers, rows);
  }

  async downloadResultsCompat(
    userId: string,
    projectId: string,
    format: string,
    res: Response,
  ) {
    const orgId = await this.resolveOrgId(userId, projectId);
    return this.downloadResults(userId, orgId, projectId, format, res);
  }

  async downloadResults(
    userId: string,
    orgId: string,
    projectId: string,
    format: string,
    res: Response,
  ) {
    const results = await this.listResults(userId, orgId, projectId);
    const headers = [
      'testCaseId',
      'scenario',
      'status',
      'message',
      'durationMs',
      'evidence',
    ];
    const rows: WorksheetRow[] = results.map((r) => ({
      testCaseId: r.testCase.externalId,
      scenario: r.testCase.scenario,
      status: r.status,
      message: r.message,
      durationMs: r.durationMs,
      evidence: Array.isArray(r.evidenceKeys)
        ? (r.evidenceKeys as string[]).join(' | ')
        : '',
    }));
    this.sendDownload(res, format, 'test-results', headers, rows);
  }
}
