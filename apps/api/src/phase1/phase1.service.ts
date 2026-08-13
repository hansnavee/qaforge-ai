import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { R2ArtifactStore } from '@qaforge/agent-sdk';
import { prisma } from '@qaforge/database';
import {
  ArtifactType,
  ExecutionStatus,
  Role,
  buildPhaseDocState,
  caseFieldWriteSchema,
  caseTemplateWriteSchema,
  clarifyExecutionSchema,
  createTcmsFolderSchema,
  aiExecuteRunSchema,
  aiPromptHistoryCreateSchema,
  createTcmsRunSchema,
  cycleResultCounts,
  deleteTcmsFolderSchema,
  evaluateRequirementsReadiness,
  generateApplySchema,
  aiAgentIntentSchema,
  generateTestCasesSchema,
  credsFromCases,
  extractAppUrlFromText,
  reviewApplicationByFetch,
  proposeTcmsRunSchema,
  importTestCasesSchema,
  isLikelyProductionUrl,
  isUsableAppUrl,
  markPhaseAccepted,
  normalizeCaseStatus,
  normalizePriorityLabel,
  normalizeStoredAppUrl,
  priorityFromLabel,
  readyFromCaseStatus,
  rowsFromCsv,
  rowsFromJson,
  rowsFromSpreadsheetMl,
  sortCasesByPriority,
  suggestExecutionSelection,
  testCaseBulkCreateSchema,
  testCaseBulkDeleteSchema,
  testCaseBulkUpdateSchema,
  testCaseRestoreSchema,
  testCaseReadySchema,
  testCaseStatusSchema,
  testCaseWriteSchema,
  testResultWriteSchema,
  updateTcmsFolderSchema,
  updateTcmsRunSchema,
  upsertPhaseDoc,
  type CaseStatus,
  type DesignTechnique,
  type ImportedCaseRow,
  type StlcPhaseDocsMap,
} from '@qaforge/shared';
import {
  buildTcmsTcrHtml,
  buildTcmsTcrPdf,
  buildTcmsTcrWord,
  buildZipPackage,
  renderHtmlReport,
  rowsToCsv,
  rowsToHtmlTable,
  rowsToSpreadsheetMl,
  type WorksheetRow,
} from '@qaforge/report-engine';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { decrypt, encrypt, hasEncryptionKey } from '../common/encryption';
import { parseBody } from '../common/parse-body';
import type { SessionUser } from '../auth/auth';
import { OrgsService } from '../orgs/orgs.service';
import { QueueService } from '../queue/queue.service';
import { RunnersService } from '../runners/runners.service';
import { PlanUsageService } from '../billing/plan-usage.service';
import { createInternalTcmsProvider } from '../qa-tools/internal-tcms.provider';
import { AiGenerateCasesService } from './ai-generate-cases.service';
import {
  isAllowedRequirementFile,
  parseRequirementFile,
} from './parse-requirement-file';
import {
  buildTcrPayload,
  cycleName,
  descendantFolderIds,
  ensureTcmsFolders,
  isReadyCase,
  isWaitingLocalRunner,
  mapFolderDto,
  publicSelection,
  readSelection,
  summarizeCycle,
  type TcmsSelection,
} from './tcms-support';

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
    private readonly aiGenerate: AiGenerateCasesService,
    private readonly runners: RunnersService,
    private readonly planUsage: PlanUsageService,
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

  /**
   * Prefer an in-flight STLC run (awaiting human / running) over a newer
   * QUEUED duplicate. Worker concurrency is often 1 and blocks on gates, so
   * extra starts otherwise sit forever at INIT.
   */
  private async findActiveStlcExecution(projectId: string) {
    const rows = await prisma.execution.findMany({
      where: {
        projectId,
        runMode: { in: ['STLC', 'PHASE1'] },
        status: {
          notIn: [
            ExecutionStatus.CANCELLED,
            ExecutionStatus.FAILED,
            ExecutionStatus.COMPLETED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const rank = (status: string) => {
      if (status.startsWith('AWAITING_')) return 4;
      if (status === ExecutionStatus.RUNNING) return 3;
      if (
        status === ExecutionStatus.QUEUED ||
        status === ExecutionStatus.PENDING
      ) {
        return 1;
      }
      return 0;
    };

    return (
      [...rows].sort(
        (a, b) =>
          rank(b.status) - rank(a.status) ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      )[0] ?? null
    );
  }

  private stlcStageFromExecutionStatus(status: string): string | null {
    const map: Record<string, string> = {
      AWAITING_PLAN_APPROVAL: 'PLANNING',
      AWAITING_DESIGN_APPROVAL: 'DESIGN',
      AWAITING_ENV_APPROVAL: 'ENVIRONMENT',
      AWAITING_DATA_APPROVAL: 'DATA',
      AWAITING_LOGIN: 'EXECUTION',
      AWAITING_EXECUTION_APPROVAL: 'EXECUTION',
      AWAITING_DEFECT_APPROVAL: 'DEFECTS',
      AWAITING_AUTOMATION_APPROVAL: 'AUTOMATION',
      AWAITING_REPORT_APPROVAL: 'REPORTING',
      AWAITING_QA_SIGNOFF: 'SIGNOFF',
      QUEUED: 'PLANNING',
      PENDING: 'PLANNING',
      RUNNING: 'PLANNING',
    };
    return map[status] ?? null;
  }

  async start(user: SessionUser, orgId: string, projectId: string) {
    const project = await this.requireProject(
      user.id,
      orgId,
      projectId,
      Role.MEMBER,
    );

    const [requirements, openQuestions] = await Promise.all([
      prisma.requirement.findMany({
        where: { projectId },
        select: {
          requirementKey: true,
          title: true,
          reviewStatus: true,
          analysisStale: true,
          businessImpact: true,
        },
      }),
      prisma.requirementQuestion.findMany({
        where: { projectId, status: 'OPEN' },
        select: { priority: true, blocking: true, status: true },
      }),
    ]);

    const readiness = evaluateRequirementsReadiness({
      analysisStatus: project.analysisStatus,
      staleRequirementCount: project.staleRequirementCount,
      requirementsApprovedAt: project.requirementsApprovedAt,
      requirements,
      openQuestions,
    });

    // After Stage 1 Accept, always allow starting Planning. Soft readiness
    // blockers (stale flags, etc.) must not silently block the handoff CTA.
    if (!readiness.approved) {
      throw new BadRequestException({
        message: 'Approve Step 2 requirements before starting Test Planning',
        blockers: ['Requirements not approved', ...readiness.blockers],
        counts: readiness.counts,
      });
    }

    // Resume the active run instead of queueing another INIT job.
    const existing = await this.findActiveStlcExecution(projectId);
    if (existing) {
      // Drop duplicate QUEUED starts that can never run while a gate is held.
      await prisma.execution.updateMany({
        where: {
          projectId,
          runMode: { in: ['STLC', 'PHASE1'] },
          status: {
            in: [ExecutionStatus.QUEUED, ExecutionStatus.PENDING],
          },
          id: { not: existing.id },
        },
        data: {
          status: ExecutionStatus.CANCELLED,
          finishedAt: new Date(),
          errorSummary:
            'Cancelled — another STLC run is already in progress for this project',
        },
      });

      // Legacy runs paused at plan approval: Start Planning continues into design.
      if (existing.status === ExecutionStatus.AWAITING_PLAN_APPROVAL) {
        const projectRow = await prisma.project.findUnique({
          where: { id: projectId },
          select: { stlcPhaseDocs: true },
        });
        const docs = markPhaseAccepted(
          (projectRow?.stlcPhaseDocs ?? {}) as StlcPhaseDocsMap,
          'PLANNING',
        );
        await prisma.project.update({
          where: { id: projectId },
          data: {
            stlcPhaseDocs: docs as never,
            testPlanApprovedAt: new Date(),
            testPlanApprovedBy: user.id,
            stlcStage: 'DESIGN',
          },
        });
        const continued = await prisma.execution.update({
          where: { id: existing.id },
          data: {
            status: ExecutionStatus.RUNNING,
            phase: 'TEST_DESIGN',
          },
        });
        await this.queue.publishContinue(existing.id);
        await this.queue.publishExecutionEvent(existing.id, {
          executionId: existing.id,
          type: 'stlc.plan_approved',
          phase: 'TEST_DESIGN',
          message:
            'Continuing into Test Design (strategy + cases from Start Planning)',
          timestamp: new Date().toISOString(),
        });
        return continued;
      }

      if (
        existing.status === ExecutionStatus.QUEUED ||
        existing.status === ExecutionStatus.PENDING
      ) {
        await this.queue.enqueueRunExecution(existing.id, {
          jobId: `stlc-retry-${existing.id}-${Date.now()}`,
          runMode: 'STLC',
        });
      }

      const stage = this.stlcStageFromExecutionStatus(existing.status);
      if (stage) {
        await prisma.project.update({
          where: { id: projectId },
          data: { stlcStage: stage },
        });
      }

      await this.queue.publishExecutionEvent(existing.id, {
        executionId: existing.id,
        type: 'stlc.resume_existing',
        phase: existing.phase,
        message: `Continuing existing STLC run (${existing.status}) instead of starting a new one`,
        timestamp: new Date().toISOString(),
      });

      return existing;
    }

    const execution = await prisma.execution.create({
      data: {
        projectId: project.id,
        status: ExecutionStatus.QUEUED,
        phase: 'INIT',
        runMode: 'STLC',
        cycleNumber: 1,
        startedAt: new Date(),
      },
    });

    await prisma.project.update({
      where: { id: project.id },
      data: {
        stlcStage: 'PLANNING',
        currentCycle: 1,
        testPlanApprovedAt: null,
        testPlanApprovedBy: null,
        testDesignApprovedAt: null,
        testDesignApprovedBy: null,
        testDataApprovedAt: null,
        testDataApprovedBy: null,
        testExecutionApprovedAt: null,
        testExecutionApprovedBy: null,
        defectsApprovedAt: null,
        defectsApprovedBy: null,
        regressionApprovedAt: null,
        regressionApprovedBy: null,
        automationApprovedAt: null,
        automationApprovedBy: null,
        reportApprovedAt: null,
        reportApprovedBy: null,
        qaSignedOffAt: null,
        qaSignedOffBy: null,
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
      message: 'STLC Test Planning queued from approved requirements',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'stlc.start',
      resource: 'execution',
      resourceId: execution.id,
      metadata: {
        projectId,
        runMode: 'STLC',
        source: 'step2-reviewed',
        analysisId: project.analysisId,
      },
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

    const original = parsedText.trim() || null;
    const doc = await prisma.requirementDocument.create({
      data: {
        projectId,
        storageKey,
        mime: file.mimetype || 'application/octet-stream',
        filename: file.originalname,
        fileSize: file.size || file.buffer.length,
        sourceType: 'UPLOAD',
        originalContent: original,
        parsedText: original,
      },
    });

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
        where: { projectId, deletedAt: null },
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
        sourceType: d.sourceType,
        fileSize: d.fileSize,
        hasParsedText: Boolean(
          (d.originalContent ?? d.parsedText)?.trim(),
        ),
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
      const [cases, bugs, results, evidenceArts] = await Promise.all([
        prisma.testCase.findMany({ where: { executionId: execution.id } }),
        prisma.bug.findMany({ where: { executionId: execution.id } }),
        prisma.testResult.findMany({
          where: { executionId: execution.id },
          include: { testCase: true },
        }),
        prisma.artifact.findMany({
          where: {
            executionId: execution.id,
            type: { in: [ArtifactType.SCREENSHOT, ArtifactType.VIDEO] },
          },
        }),
      ]);
      if (
        !cases.length &&
        !bugs.length &&
        !results.length &&
        !evidenceArts.length &&
        !artifact
      ) {
        throw new NotFoundException('Final STLC pack not ready');
      }

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
      };

      if (evidenceArts.length) {
        const store = new R2ArtifactStore({
          fallbackRootDir: `${process.cwd()}/.artifacts`,
        });
        for (const art of evidenceArts) {
          try {
            let body: Buffer;
            try {
              body = await store.get(art.storageKey);
            } catch {
              const blob = await prisma.artifactBlob.findUnique({
                where: { storageKey: art.storageKey },
              });
              if (!blob) continue;
              body = Buffer.from(blob.body);
            }
            const name = `evidence/${art.storageKey.split('/').pop()}`;
            files[name] = body;
          } catch {
            /* skip missing */
          }
        }
      }

      buf = await buildZipPackage({ files });
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

  private async latestStlcExecutionId(projectId: string) {
    const latest = await prisma.execution.findFirst({
      where: { projectId, runMode: { in: [...STLC_RUN_MODES] } },
      orderBy: [{ cycleNumber: 'desc' }, { createdAt: 'desc' }],
      select: { id: true },
    });
    return latest?.id ?? null;
  }

  private statusFields(input: {
    caseStatus?: CaseStatus;
    readyForExecution?: boolean;
  }) {
    const caseStatus = normalizeCaseStatus(
      input.caseStatus,
      input.readyForExecution,
    );
    return {
      caseStatus,
      readyForExecution: readyFromCaseStatus(caseStatus),
    };
  }

  private async decorateCases<
    T extends {
      featureKey: string | null;
      requirementKey: string | null;
      readyForExecution: boolean;
      caseStatus?: string | null;
      folderId?: string | null;
      module?: string | null;
    },
  >(projectId: string, cases: T[]) {
    const [features, requirements, folders] = await Promise.all([
      prisma.featureGroup.findMany({
        where: { projectId },
        select: { featureKey: true, name: true },
      }),
      prisma.requirement.findMany({
        where: { projectId },
        select: { requirementKey: true, title: true },
      }),
      prisma.tcmsFolder.findMany({ where: { projectId } }),
    ]);
    const featureName = new Map(features.map((f) => [f.featureKey, f.name]));
    const requirementTitle = new Map(
      requirements.map((r) => [r.requirementKey, r.title]),
    );
    const folderById = new Map(folders.map((f) => [f.id, f]));
    return cases.map((c) => {
      const folder = c.folderId ? folderById.get(c.folderId) : null;
      const parent = folder?.parentId
        ? folderById.get(folder.parentId)
        : null;
      return {
        ...c,
        caseStatus: normalizeCaseStatus(c.caseStatus, c.readyForExecution),
        featureName: c.featureKey ? featureName.get(c.featureKey) ?? null : null,
        requirementTitle: c.requirementKey
          ? requirementTitle.get(c.requirementKey) ?? null
          : null,
        folderId: c.folderId ?? null,
        folderName: folder?.name ?? null,
        parentFolderId: folder?.parentId ?? null,
        parentFolderName: parent?.name ?? null,
      };
    });
  }

  private async folderPlacement(
    projectId: string,
    folderId: string | null | undefined,
  ): Promise<{
    folderId?: string | null;
    featureKey?: string | null;
    module?: string;
    requirementKey?: string;
  }> {
    if (folderId === undefined) return {};
    if (folderId === null) {
      return { folderId: null as string | null };
    }
    const folder = await prisma.tcmsFolder.findFirst({
      where: { id: folderId, projectId },
    });
    if (!folder) throw new BadRequestException('Folder not found');
    const parent = folder.parentId
      ? await prisma.tcmsFolder.findFirst({
          where: { id: folder.parentId, projectId },
        })
      : null;
    return {
      folderId: folder.id,
      featureKey: folder.featureKey ?? parent?.featureKey ?? null,
      module: parent?.name ?? folder.name,
      ...(folder.requirementKey
        ? { requirementKey: folder.requirementKey }
        : {}),
    };
  }

  private async loadManualRun(projectId: string, executionId: string) {
    const execution = await prisma.execution.findFirst({
      where: { id: executionId, projectId, runMode: 'MANUAL' },
    });
    if (!execution) throw new NotFoundException('Run not found');
    return execution;
  }

  private assertCycleWritable(execution: {
    status: string;
    runMode: string;
  }) {
    if (execution.runMode !== 'MANUAL') {
      throw new BadRequestException('Not a TCMS execution cycle');
    }
    if (
      execution.status !== ExecutionStatus.RUNNING &&
      execution.status !== ExecutionStatus.PENDING &&
      execution.status !== ExecutionStatus.FAILED
    ) {
      throw new BadRequestException('This cycle is locked');
    }
    if ('deletedAt' in execution && execution.deletedAt) {
      throw new BadRequestException('This run is archived');
    }
  }

  private assertResultComment(status: string, message?: string | null) {
    if (
      (status === 'FAILED' || status === 'BLOCKED') &&
      !message?.trim()
    ) {
      throw new BadRequestException(
        'A comment is required for Fail and Blocked',
      );
    }
  }

  private async resolveRunCaseIds(
    projectId: string,
    input: { testCaseIds: string[]; folderIds: string[] },
  ) {
    const fromCases = [...new Set(input.testCaseIds)];
    const folderIds = [...new Set(input.folderIds)];
    let fromFolders: string[] = [];
    if (folderIds.length) {
      const folders = await prisma.tcmsFolder.findMany({
        where: { projectId },
        select: { id: true, parentId: true, name: true },
      });
      const known = new Set(folders.map((f) => f.id));
      const missing = folderIds.filter((id) => !known.has(id));
      if (missing.length) {
        throw new BadRequestException('One or more suites were not found');
      }
      const expanded = descendantFolderIds(folders, folderIds);
      const inSuites = await prisma.testCase.findMany({
        where: { projectId, folderId: { in: expanded }, deletedAt: null },
      });
      fromFolders = inSuites.filter((c) => isReadyCase(c)).map((c) => c.id);
      if (!fromFolders.length && !fromCases.length) {
        throw new BadRequestException('Those suites have no Ready cases');
      }
    }
    const uniqueIds = [...new Set([...fromCases, ...fromFolders])];
    if (!uniqueIds.length) {
      throw new BadRequestException('Select at least one Ready test case');
    }
    const cases = await prisma.testCase.findMany({
      where: { projectId, id: { in: uniqueIds }, deletedAt: null },
    });
    if (cases.length !== uniqueIds.length) {
      throw new BadRequestException('One or more test cases were not found');
    }
    const notReady = cases.filter((c) => !isReadyCase(c));
    if (notReady.length) {
      throw new BadRequestException('Only Ready cases can be added to a cycle');
    }
    return uniqueIds;
  }

  async listTestCases(
    userId: string,
    orgId: string,
    projectId: string,
    includeArchived = false,
  ) {
    await this.requireProject(userId, orgId, projectId);
    await ensureTcmsFolders(projectId);
    const executionId = await this.latestStlcExecutionId(projectId);
    const cases = await prisma.testCase.findMany({
      where: {
        projectId,
        ...(includeArchived ? {} : { deletedAt: null }),
        ...(executionId
          ? { OR: [{ executionId }, { executionId: null }] }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    if (cases.length) {
      void this.syncDesignDocFromCases(projectId).catch(() => undefined);
    }
    return this.decorateCases(projectId, cases);
  }

  private async syncDesignDocFromCases(projectId: string) {
    const executionId = await this.latestStlcExecutionId(projectId);
    const [project, cases] = await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
        select: { stlcPhaseDocs: true },
      }),
      prisma.testCase.findMany({
        where: {
          ...(executionId ? { executionId } : { projectId }),
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!project) return;

    const docs = (project.stlcPhaseDocs ?? {}) as StlcPhaseDocsMap;
    const previous = docs.DESIGN ?? null;
    const crudOps = ['CREATE', 'READ', 'UPDATE', 'DELETE'] as const;
    const mapped = cases.map((tc) => {
      const steps = Array.isArray(tc.steps)
        ? (tc.steps as unknown[]).map(String)
        : [];
      const blob = `${tc.scenario} ${tc.type ?? ''}`.toLowerCase();
      return {
        id: tc.externalId,
        module: tc.module ?? 'General',
        scenario: tc.scenario,
        preconditions: tc.preconditions ?? '',
        steps,
        expected: tc.expected,
        priority: tc.priority ?? 'P1',
        severity: tc.severity ?? 'medium',
        type: tc.type ?? 'functional',
        requirementKey: tc.requirementKey ?? null,
        designTechnique: tc.designTechnique ?? null,
        featureKey: tc.featureKey ?? null,
        designMode: tc.designMode ?? null,
        priorityLabel: tc.priorityLabel ?? null,
        readyForExecution: tc.readyForExecution,
        testData:
          tc.testData && typeof tc.testData === 'object'
            ? (tc.testData as Record<string, string>)
            : {},
        testingLevel:
          /smoke/i.test(tc.type ?? '') || /smoke/i.test(tc.scenario)
            ? 'SMOKE'
            : /sanity/i.test(tc.type ?? '')
              ? 'SANITY'
              : 'FUNCTIONAL',
        crudHints: crudOps.filter((op) => new RegExp(op, 'i').test(blob)),
      };
    });
    const techniqueCoverage = (() => {
      const byRequirement: Record<
        string,
        { techniques: string[]; caseCount: number }
      > = {};
      for (const c of mapped) {
        const key = c.requirementKey?.trim() || 'UNMAPPED';
        if (!byRequirement[key]) {
          byRequirement[key] = { techniques: [], caseCount: 0 };
        }
        byRequirement[key]!.caseCount += 1;
        const tech = (c.designTechnique ?? '').trim().toUpperCase();
        if (tech && !byRequirement[key]!.techniques.includes(tech)) {
          byRequirement[key]!.techniques.push(tech);
        }
      }
      return { byRequirement, caseCount: mapped.length };
    })();
    const crudMatrix = Array.from(
      new Set(mapped.map((c) => c.module || 'General')),
    ).map((feature) => {
      const featureCases = mapped.filter(
        (c) => (c.module || 'General') === feature,
      );
      const blob = featureCases
        .map((c) => `${c.scenario} ${c.type ?? ''}`.toLowerCase())
        .join(' ');
      return {
        feature,
        CREATE:
          /create|add|new|register|post/.test(blob) || featureCases.length > 0,
        READ: /read|view|list|get|display|open/.test(blob) || true,
        UPDATE: /update|edit|modify|change|put|patch/.test(blob),
        DELETE: /delete|remove|cancel/.test(blob),
        caseCount: featureCases.length,
      };
    });

    const status =
      previous?.status === 'ACCEPTED'
        ? 'ACCEPTED'
        : previous?.status === 'READY_FOR_REVIEW'
          ? 'READY_FOR_REVIEW'
          : cases.length
            ? 'READY_FOR_REVIEW'
            : previous?.status ?? 'READY_FOR_REVIEW';

    const state = buildPhaseDocState({
      phaseId: 'DESIGN',
      status,
      document: {
        kind: 'TEST_DESIGN',
        testCases: mapped,
        crudMatrix,
        techniqueCoverage,
        testingLevelsCovered: [
          'SMOKE',
          'SANITY',
          'FUNCTIONAL',
          'INTEGRATION',
          'REGRESSION',
          'UAT_READY',
        ],
      },
      validation: previous?.validation ?? {
        passed: cases.length > 0,
        blockers: cases.length ? [] : ['No test cases'],
        summary: `${cases.length} technique-mapped case(s)`,
      },
      previous,
      editedByHuman: true,
    });
    const next = upsertPhaseDoc(docs, state);
    await prisma.project.update({
      where: { id: projectId },
      data: { stlcPhaseDocs: next as never },
    });
  }

  async createTestCase(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const input = parseBody(testCaseWriteSchema, body);
    if (!input.scenario?.trim() || !input.expected?.trim()) {
      throw new BadRequestException('scenario and expected are required');
    }
    const count = await prisma.testCase.count({ where: { projectId } });
    const externalId =
      input.externalId?.trim() ||
      `TC-${String(count + 1).padStart(3, '0')}`;
    const status = this.statusFields({
      caseStatus: input.caseStatus,
      readyForExecution: input.readyForExecution,
    });
    const executionId = await this.latestStlcExecutionId(projectId);
    const placement = await this.folderPlacement(projectId, input.folderId);
    const created = await prisma.testCase.create({
      data: {
        projectId,
        executionId,
        externalId,
        module: input.module ?? placement.module ?? 'General',
        scenario: input.scenario.trim(),
        preconditions: input.preconditions ?? '',
        steps: (input.steps ?? ['Perform the scenario steps']) as never,
        expected: input.expected.trim(),
        priority:
          input.priority ??
          priorityFromLabel(input.priorityLabel ?? 'MEDIUM'),
        severity: input.severity ?? 'medium',
        type: input.type ?? 'functional',
        requirementKey: input.requirementKey ?? placement.requirementKey ?? null,
        designTechnique: input.designTechnique ?? null,
        featureKey: input.featureKey ?? placement.featureKey ?? null,
        folderId: placement.folderId ?? null,
        designMode: input.designMode ?? 'GENERIC',
        priorityLabel:
          input.priorityLabel ??
          normalizePriorityLabel(input.priority ?? 'P1'),
        ...status,
        testData: (input.testData ?? null) as never,
        customFields: (input.customFields ?? null) as never,
        templateId: input.templateId ?? null,
      },
    });
    await this.syncDesignDocFromCases(projectId);
    return created;
  }

  async updateTestCase(
    userId: string,
    orgId: string,
    projectId: string,
    testCaseId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const existing = await prisma.testCase.findFirst({
      where: { id: testCaseId, projectId },
    });
    if (!existing) throw new NotFoundException('Test case not found');
    const input = parseBody(testCaseWriteSchema, body);
    const contentChanged =
      (input.scenario !== undefined &&
        input.scenario.trim() !== existing.scenario) ||
      (input.expected !== undefined &&
        input.expected.trim() !== existing.expected) ||
      (input.preconditions !== undefined &&
        (input.preconditions ?? '') !== (existing.preconditions ?? '')) ||
      (input.steps !== undefined &&
        JSON.stringify(input.steps) !== JSON.stringify(existing.steps));
    let statusPatch: {
      caseStatus?: CaseStatus;
      readyForExecution?: boolean;
    } = {};
    if (input.caseStatus !== undefined || input.readyForExecution !== undefined) {
      statusPatch = this.statusFields({
        caseStatus: input.caseStatus,
        readyForExecution: input.readyForExecution,
      });
    } else if (
      contentChanged &&
      normalizeCaseStatus(existing.caseStatus, existing.readyForExecution) !==
        'DRAFT'
    ) {
      statusPatch = this.statusFields({ caseStatus: 'DRAFT' });
    }
    const placement = await this.folderPlacement(projectId, input.folderId);
    const updated = await prisma.testCase.update({
      where: { id: testCaseId },
      data: {
        ...(input.externalId !== undefined
          ? { externalId: input.externalId }
          : {}),
        ...(input.module !== undefined
          ? { module: input.module }
          : placement.module
            ? { module: placement.module }
            : {}),
        ...(input.scenario !== undefined
          ? { scenario: input.scenario.trim() }
          : {}),
        ...(input.preconditions !== undefined
          ? { preconditions: input.preconditions }
          : {}),
        ...(input.steps !== undefined ? { steps: input.steps as never } : {}),
        ...(input.expected !== undefined
          ? { expected: input.expected.trim() }
          : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.severity !== undefined ? { severity: input.severity } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.requirementKey !== undefined
          ? { requirementKey: input.requirementKey }
          : placement.requirementKey
            ? { requirementKey: placement.requirementKey }
            : {}),
        ...(input.designTechnique !== undefined
          ? { designTechnique: input.designTechnique }
          : {}),
        ...(input.featureKey !== undefined
          ? { featureKey: input.featureKey }
          : placement.featureKey !== undefined
            ? { featureKey: placement.featureKey }
            : {}),
        ...(input.folderId !== undefined
          ? { folderId: placement.folderId ?? null }
          : {}),
        ...(input.designMode !== undefined ? { designMode: input.designMode } : {}),
        ...(input.priorityLabel !== undefined
          ? { priorityLabel: input.priorityLabel }
          : input.priority !== undefined
            ? { priorityLabel: normalizePriorityLabel(input.priority) }
            : {}),
        ...statusPatch,
        ...(input.testData !== undefined
          ? { testData: input.testData as never }
          : {}),
        ...(input.customFields !== undefined
          ? { customFields: input.customFields as never }
          : {}),
        ...(input.templateId !== undefined
          ? { templateId: input.templateId }
          : {}),
      },
    });
    await this.syncDesignDocFromCases(projectId);
    return updated;
  }

  async deleteTestCase(
    userId: string,
    orgId: string,
    projectId: string,
    testCaseId: string,
    permanent = false,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const existing = await prisma.testCase.findFirst({
      where: { id: testCaseId, projectId },
    });
    if (!existing) throw new NotFoundException('Test case not found');
    if (permanent) {
      await prisma.testCase.delete({ where: { id: testCaseId } });
    } else {
      await prisma.testCase.update({
        where: { id: testCaseId },
        data: { deletedAt: new Date() },
      });
    }
    await this.syncDesignDocFromCases(projectId);
    return { ok: true, id: testCaseId, archived: !permanent };
  }

  async restoreTestCase(
    userId: string,
    orgId: string,
    projectId: string,
    testCaseId: string,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const existing = await prisma.testCase.findFirst({
      where: { id: testCaseId, projectId },
    });
    if (!existing) throw new NotFoundException('Test case not found');
    await prisma.testCase.update({
      where: { id: testCaseId },
      data: { deletedAt: null },
    });
    await this.syncDesignDocFromCases(projectId);
    return { ok: true, id: testCaseId };
  }

  async markCasesReady(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const input = parseBody(testCaseReadySchema, body);
    if (!input.ids?.length && !input.featureKey) {
      throw new BadRequestException('Provide ids or featureKey');
    }
    const executionId = await this.latestStlcExecutionId(projectId);
    const where = {
      projectId,
      ...(executionId
        ? { OR: [{ executionId }, { executionId: null }] }
        : {}),
      ...(input.ids?.length
        ? { id: { in: input.ids } }
        : input.featureKey
          ? { featureKey: input.featureKey }
          : {}),
    };
    const status = this.statusFields({
      caseStatus: input.ready ? 'READY' : 'DRAFT',
      readyForExecution: input.ready,
    });
    const result = await prisma.testCase.updateMany({
      where,
      data: status,
    });
    await this.syncDesignDocFromCases(projectId);
    return { ok: true, updated: result.count, ready: input.ready };
  }

  async previewExecution(
    userId: string,
    orgId: string,
    projectId: string,
    query: { runKind?: string; featureKey?: string },
  ) {
    await this.requireProject(userId, orgId, projectId);
    const executionId = await this.latestStlcExecutionId(projectId);
    const cases = await prisma.testCase.findMany({
      where: {
        ...(executionId ? { executionId } : { projectId }),
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    const runKind =
      query.runKind === 'REGRESSION' || query.runKind === 'SYSTEM'
        ? query.runKind
        : 'SPRINT';
    const suggestion = suggestExecutionSelection(cases, {
      runKind,
      featureKey: query.featureKey || null,
    });
    const ordered = sortCasesByPriority(
      cases.filter((c) => suggestion.testCaseIds.includes(c.id)),
    );
    return {
      runKind: suggestion.runKind,
      order: 'HIGH_THEN_MEDIUM_THEN_LOW',
      testCaseIds: ordered.map((c) => c.id),
      cases: ordered.map((c) => ({
        id: c.id,
        externalId: c.externalId,
        featureKey: c.featureKey,
        priorityLabel: c.priorityLabel ?? normalizePriorityLabel(c.priority),
        scenario: c.scenario,
        readyForExecution: c.readyForExecution,
      })),
    };
  }

  async listBugsCompat(userId: string, projectId: string) {
    const orgId = await this.resolveOrgId(userId, projectId);
    return this.listBugs(userId, orgId, projectId);
  }

  async listBugs(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    return prisma.bug.findMany({
      where: { projectId },
      include: {
        testCase: { select: { externalId: true, scenario: true } },
      },
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
    const fields = await this.resolvedCaseFields(orgId, projectId);
    const cfHeaders = fields.map((f) => `cf_${f.key}`);
    const headers = [
      'id',
      'folder',
      'scenario',
      'preconditions',
      'steps',
      'expected',
      'priority',
      'priorityLabel',
      'severity',
      'type',
      'requirementKey',
      'designTechnique',
      'featureKey',
      'caseStatus',
      'testData',
      ...cfHeaders,
    ];
    const rows: WorksheetRow[] = cases.map((c) => {
      const custom =
        c.customFields && typeof c.customFields === 'object'
          ? (c.customFields as Record<string, unknown>)
          : {};
      const folder =
        [c.parentFolderName, c.folderName].filter(Boolean).join(' / ') ||
        c.module ||
        '';
      const row: WorksheetRow = {
        id: c.externalId,
        folder,
        scenario: c.scenario,
        preconditions: c.preconditions,
        steps: Array.isArray(c.steps) ? (c.steps as string[]).join(' | ') : '',
        expected: c.expected,
        priority: c.priority,
        priorityLabel: c.priorityLabel,
        severity: c.severity,
        type: c.type,
        requirementKey: c.requirementKey,
        designTechnique: c.designTechnique,
        featureKey: c.featureKey,
        caseStatus: c.caseStatus,
        testData: c.testData ? JSON.stringify(c.testData) : '',
      };
      for (const f of fields) {
        const v = custom[f.key];
        row[`cf_${f.key}`] = v == null ? '' : String(v);
      }
      return row;
    });
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

  async setCaseStatus(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const input = parseBody(testCaseStatusSchema, body);
    const status = this.statusFields({ caseStatus: input.status });
    const result = await prisma.testCase.updateMany({
      where: { projectId, id: { in: input.ids } },
      data: status,
    });
    await this.syncDesignDocFromCases(projectId);
    return { ok: true, updated: result.count, status: input.status };
  }

  async bulkUpdateTestCases(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const input = parseBody(testCaseBulkUpdateSchema, body);
    const status =
      input.status !== undefined
        ? this.statusFields({ caseStatus: input.status })
        : {};
    const placement = await this.folderPlacement(projectId, input.folderId);
    const data = {
      ...status,
      ...(input.priorityLabel !== undefined
        ? {
            priorityLabel: input.priorityLabel,
            priority: priorityFromLabel(input.priorityLabel),
          }
        : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.designTechnique !== undefined
        ? { designTechnique: input.designTechnique }
        : {}),
      ...(input.featureKey !== undefined
        ? { featureKey: input.featureKey }
        : placement.featureKey !== undefined
          ? { featureKey: placement.featureKey }
          : {}),
      ...(input.folderId !== undefined
        ? { folderId: placement.folderId ?? null }
        : {}),
      ...(input.module !== undefined
        ? { module: input.module }
        : placement.module
          ? { module: placement.module }
          : {}),
      ...(input.requirementKey !== undefined
        ? { requirementKey: input.requirementKey }
        : placement.requirementKey
          ? { requirementKey: placement.requirementKey }
          : {}),
    };
    const result = await prisma.testCase.updateMany({
      where: { projectId, id: { in: input.ids } },
      data,
    });
    await this.syncDesignDocFromCases(projectId);
    return { ok: true, updated: result.count };
  }

  async bulkDeleteTestCases(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const input = parseBody(testCaseBulkDeleteSchema, body);
    if (input.permanent) {
      const result = await prisma.testCase.deleteMany({
        where: { projectId, id: { in: input.ids } },
      });
      await this.syncDesignDocFromCases(projectId);
      return { ok: true, deleted: result.count };
    }
    const result = await prisma.testCase.updateMany({
      where: { projectId, id: { in: input.ids } },
      data: { deletedAt: new Date() },
    });
    await this.syncDesignDocFromCases(projectId);
    return { ok: true, archived: result.count };
  }

  async bulkRestoreTestCases(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const input = parseBody(testCaseRestoreSchema, body);
    const result = await prisma.testCase.updateMany({
      where: { projectId, id: { in: input.ids } },
      data: { deletedAt: null },
    });
    await this.syncDesignDocFromCases(projectId);
    return { ok: true, restored: result.count };
  }

  async duplicateTestCase(
    userId: string,
    orgId: string,
    projectId: string,
    testCaseId: string,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const existing = await prisma.testCase.findFirst({
      where: { id: testCaseId, projectId },
    });
    if (!existing) throw new NotFoundException('Test case not found');
    const count = await prisma.testCase.count({ where: { projectId } });
    const created = await prisma.testCase.create({
      data: {
        projectId,
        executionId:
          existing.executionId ?? (await this.latestStlcExecutionId(projectId)),
        externalId: `TC-${String(count + 1).padStart(3, '0')}`,
        module: existing.module,
        scenario: `${existing.scenario} (copy)`,
        preconditions: existing.preconditions,
        steps: existing.steps as never,
        expected: existing.expected,
        priority: existing.priority,
        severity: existing.severity,
        type: existing.type,
        requirementKey: existing.requirementKey,
        designTechnique: existing.designTechnique,
        featureKey: existing.featureKey,
        folderId: existing.folderId,
        designMode: existing.designMode,
        priorityLabel: existing.priorityLabel,
        caseStatus: 'DRAFT',
        readyForExecution: false,
        testData: existing.testData as never,
        customFields: existing.customFields as never,
        templateId: existing.templateId,
      },
    });
    await this.syncDesignDocFromCases(projectId);
    return created;
  }

  async createFeatureFolder(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    return this.createTcmsFolder(userId, orgId, projectId, body);
  }

  async listTcmsFolders(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    const folders = await ensureTcmsFolders(projectId);
    return folders.map(mapFolderDto);
  }

  async createTcmsFolder(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const input = parseBody(createTcmsFolderSchema, body);
    let parentId: string | null = input.parentId ?? null;
    if (parentId) {
      const parent = await prisma.tcmsFolder.findFirst({
        where: { id: parentId, projectId },
      });
      if (!parent) throw new BadRequestException('Parent folder not found');
      if (parent.parentId) {
        throw new BadRequestException('Subfolders cannot have children');
      }
    }
    const siblings = await prisma.tcmsFolder.count({
      where: { projectId, parentId },
    });
    const created = await prisma.tcmsFolder.create({
      data: {
        projectId,
        parentId,
        name: input.name,
        sortOrder: siblings,
        featureKey: parentId
          ? (
              await prisma.tcmsFolder.findFirst({
                where: { id: parentId },
                select: { featureKey: true },
              })
            )?.featureKey ?? null
          : null,
      },
    });
    return mapFolderDto(created);
  }

  async updateTcmsFolder(
    userId: string,
    orgId: string,
    projectId: string,
    folderId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const folder = await prisma.tcmsFolder.findFirst({
      where: { id: folderId, projectId },
    });
    if (!folder) throw new NotFoundException('Folder not found');
    const input = parseBody(updateTcmsFolderSchema, body);
    let parentId = folder.parentId;
    if (input.parentId !== undefined) {
      parentId = input.parentId;
      if (parentId === folderId) {
        throw new BadRequestException('Folder cannot be its own parent');
      }
      if (parentId) {
        const parent = await prisma.tcmsFolder.findFirst({
          where: { id: parentId, projectId },
        });
        if (!parent) throw new BadRequestException('Parent folder not found');
        if (parent.parentId) {
          throw new BadRequestException('Subfolders cannot have children');
        }
        const hasChildren = await prisma.tcmsFolder.count({
          where: { parentId: folderId },
        });
        if (hasChildren) {
          throw new BadRequestException('Move child folders first');
        }
      }
    }
    const updated = await prisma.tcmsFolder.update({
      where: { id: folderId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.parentId !== undefined ? { parentId } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
    return mapFolderDto(updated);
  }

  async deleteTcmsFolder(
    userId: string,
    orgId: string,
    projectId: string,
    folderId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const folder = await prisma.tcmsFolder.findFirst({
      where: { id: folderId, projectId },
    });
    if (!folder) throw new NotFoundException('Folder not found');
    const input = parseBody(
      deleteTcmsFolderSchema,
      body && typeof body === 'object' ? body : {},
    );
    const descendants = await prisma.tcmsFolder.findMany({
      where: { projectId, OR: [{ id: folderId }, { parentId: folderId }] },
      select: { id: true },
    });
    const ids = descendants.map((d) => d.id);
    if (input.deleteCases) {
      await prisma.testCase.updateMany({
        where: { projectId, folderId: { in: ids } },
        data: { deletedAt: new Date() },
      });
    } else {
      await prisma.testCase.updateMany({
        where: { projectId, folderId: { in: ids } },
        data: { folderId: folder.parentId },
      });
    }
    await prisma.tcmsFolder.deleteMany({
      where: { id: { in: ids } },
    });
    await this.syncDesignDocFromCases(projectId);
    return { ok: true, id: folderId, deletedCases: Boolean(input.deleteCases) };
  }

  async createTcmsRun(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    await this.planUsage.assertPlanLimit(orgId, 'TCMS_RUN', 1, userId);
    const input = parseBody(createTcmsRunSchema, body);
    const uniqueIds = await this.resolveRunCaseIds(projectId, {
      testCaseIds: input.testCaseIds ?? [],
      folderIds: input.folderIds ?? [],
    });
    const browserMode = input.browserMode ?? 'HEADLESS';
    const runKind = input.runKind ?? 'MANUAL';
    const status =
      input.status === 'PENDING'
        ? ExecutionStatus.PENDING
        : ExecutionStatus.RUNNING;
    const startedAt = status === ExecutionStatus.RUNNING ? new Date() : null;
    const selection: TcmsSelection = {
      name: input.name.trim(),
      description: input.description ?? null,
      testCaseIds: uniqueIds,
      folderIds: input.folderIds?.length ? [...new Set(input.folderIds)] : [],
      runKind,
      browserMode,
      featureKey: input.featureKey ?? null,
      folderId: input.folderId ?? input.folderIds?.[0] ?? null,
    };
    const execution = await prisma.execution.create({
      data: {
        projectId,
        status,
        phase: 'EXECUTION',
        runMode: 'MANUAL',
        startedAt,
        selection: selection as never,
      },
    });
    await this.planUsage.recordUsage(orgId, 'TCMS_RUN', 1, {
      executionId: execution.id,
      projectId,
    });
    return {
      ...execution,
      name: selection.name,
      locked: false,
      counts: summarizeCycle(uniqueIds, []),
    };
  }

  async proposeTcmsRun(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
    file?: Express.Multer.File,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const input = parseBody(
      proposeTcmsRunSchema,
      coerceGenerateBody(body),
    );
    let sourceText = input.prompt?.trim() ?? '';
    if (file?.buffer?.length) {
      if (!isAllowedRequirementFile(file.originalname, file.mimetype)) {
        throw new BadRequestException(
          'Upload a .pdf, .docx, .txt, or .md requirements file',
        );
      }
      sourceText = (
        await parseRequirementFile(file.buffer, file.originalname, file.mimetype)
      ).trim();
    }
    const cases = await prisma.testCase.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const ready = cases.filter(
      (c) =>
        normalizeCaseStatus(c.caseStatus, c.readyForExecution) === 'READY',
    );
    if (!ready.length) {
      throw new BadRequestException(
        'No Ready cases to select. Mark cases Ready first.',
      );
    }
    await this.planUsage.assertPlanLimit(orgId, 'AI_PLAN_RUN', 1, userId);
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { testStrategy: true, kanbanWipLimit: true },
    });
    const strategy =
      project?.testStrategy === 'KANBAN' ? 'KANBAN' : 'SPRINT';
    const wipLimit = project?.kanbanWipLimit ?? 8;
    const decorated = await this.decorateCases(projectId, ready);
    const proposed = await this.aiGenerate.proposeRunCases({
      sourceText,
      strategy,
      wipLimit,
      cases: decorated.map((c) => ({
        id: c.id,
        externalId: c.externalId,
        scenario: c.scenario,
        priorityLabel: normalizePriorityLabel(c.priorityLabel ?? c.priority),
        folderName: c.folderName ?? c.module ?? '',
      })),
    });
    const picked = new Set(proposed.selectedIds);
    const ordered = sortCasesByPriority(
      decorated.filter((c) => picked.has(c.id)),
    );
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    await this.planUsage.recordUsage(orgId, 'AI_PLAN_RUN', 1, { projectId });
    return {
      name:
        input.name?.trim() ||
        (strategy === 'KANBAN'
          ? `Kanban batch ${stamp}`
          : `Sprint cycle ${stamp}`),
      strategy,
      wipLimit: strategy === 'KANBAN' ? wipLimit : null,
      tokensUsed: proposed.tokensUsed,
      readyCount: ready.length,
      cases: ordered.map((c) => ({
        ...c,
        why: proposed.reasons[c.id] ?? 'Matches requirements',
      })),
    };
  }

  async startTcmsRun(
    userId: string,
    orgId: string,
    projectId: string,
    executionId: string,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.TESTER);
    const execution = await this.loadManualRun(projectId, executionId);
    this.assertCycleWritable(execution);
    if (execution.status === ExecutionStatus.PENDING) {
      const waiting = isWaitingLocalRunner(
        readSelection(execution.selection),
        execution.status,
      );
      if (!waiting) {
        await prisma.execution.update({
          where: { id: executionId },
          data: {
            status: ExecutionStatus.RUNNING,
            startedAt: execution.startedAt ?? new Date(),
          },
        });
      }
    }
    return this.getTcmsRun(userId, orgId, projectId, executionId);
  }

  async pauseTcmsRun(
    userId: string,
    orgId: string,
    projectId: string,
    executionId: string,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.TESTER);
    const execution = await this.loadManualRun(projectId, executionId);
    if (execution.status !== ExecutionStatus.RUNNING) {
      throw new BadRequestException('Only a running cycle can be paused');
    }
    await this.queue.publishPause(executionId);
    return { ok: true, paused: true, executionId };
  }

  async resumeTcmsRun(
    userId: string,
    orgId: string,
    projectId: string,
    executionId: string,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.TESTER);
    const execution = await this.loadManualRun(projectId, executionId);
    this.assertCycleWritable(execution);
    await this.queue.clearPause(executionId);
    return { ok: true, paused: false, executionId };
  }

  async aiExecuteTcmsRun(
    userId: string,
    orgId: string,
    projectId: string,
    executionId: string,
    body: unknown,
    opts?: { usageMode?: 'AI_EXECUTOR' | 'SCRIPT_REPLAY' },
  ) {
    await this.requireProject(userId, orgId, projectId, Role.TESTER);
    const execution = await this.loadManualRun(projectId, executionId);
    this.assertCycleWritable(execution);
    const input = parseBody(aiExecuteRunSchema, body);
    const selection = readSelection(execution.selection);
    const roster = selection.testCaseIds ?? [];
    const runCaseIds = input.testCaseIds?.length
      ? input.testCaseIds
      : roster;
    if (!runCaseIds.length) {
      throw new BadRequestException('No cases in this cycle');
    }
    const usageMode =
      opts?.usageMode ??
      (selection.runKind === 'AUTOMATION' ? 'SCRIPT_REPLAY' : 'AI_EXECUTOR');
    if (usageMode === 'SCRIPT_REPLAY') {
      await this.planUsage.assertPlanLimit(
        orgId,
        'SCRIPT_REPLAY',
        runCaseIds.length,
        userId,
      );
    } else {
      await this.planUsage.assertPlanLimit(
        orgId,
        'AI_EXECUTOR_CASE',
        runCaseIds.length,
        userId,
      );
    }
    const caseRows = await prisma.testCase.findMany({
      where: { id: { in: runCaseIds }, deletedAt: null },
      select: { testData: true, steps: true },
    });
    const fromCases = credsFromCases(caseRows, {});
    const mergedInput = {
      ...input,
      appUrl: input.appUrl?.trim() || fromCases.appUrl || '',
      loginUrl: input.loginUrl || fromCases.loginUrl,
      username: input.username || fromCases.username,
      password: input.password || fromCases.password,
    };
    const creds = await this.saveAiEnvironment(projectId, mergedInput);
    const target = input.target === 'CLOUD' ? 'CLOUD' : 'LOCAL';
    const browserMode =
      input.browserMode ??
      (target === 'CLOUD' ? 'HEADLESS' : 'HEADED');
    /** Headless runs on the API worker; headed Local needs a paired laptop runner. */
    const runOnServer = target === 'CLOUD' || browserMode === 'HEADLESS';
    if (!hasEncryptionKey()) {
      throw new BadRequestException(
        'ENCRYPTION_KEY is not configured — cannot hand credentials to the runner',
      );
    }
    if (target === 'CLOUD') {
      await this.planUsage.assertFeature(orgId, 'cloudRunner', userId);
    }
    if (target === 'LOCAL' && !runOnServer) {
      await this.runners.assertUserRunnerOnline(orgId, userId);
    }
    const nextSelection: TcmsSelection = {
      ...selection,
      testCaseIds: roster.length ? roster : runCaseIds,
      aiExecuteCaseIds: runCaseIds,
      runKind: 'AUTOMATION',
      executeMode: input.executeMode,
      browserMode,
      browser: input.browser ?? 'chromium',
      runnerTarget: runOnServer && target === 'LOCAL' ? 'SERVER' : target,
      runnerUserId: userId,
      localQueuedAt:
        target === 'LOCAL' && !runOnServer
          ? new Date().toISOString()
          : undefined,
      claimedByRunnerId: null,
      localCreds: this.runners.encryptLocalCreds({
        appUrl: creds.appUrl,
        loginUrl: creds.loginUrl,
        username: creds.username,
        password: creds.password,
      }),
    };
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.PENDING,
        startedAt: execution.startedAt ?? null,
        finishedAt: null,
        errorSummary:
          target === 'CLOUD'
            ? 'Queued on BrowserStack'
            : runOnServer
              ? 'Queued for headless server execution'
              : 'Waiting for local runner',
        selection: nextSelection as never,
      },
    });
    if (runOnServer) {
      let browserstackUsername: string | undefined;
      let browserstackAccessKey: string | undefined;
      if (target === 'CLOUD') {
        const keys = await this.orgs.readBrowserstackKeys(orgId);
        browserstackUsername = keys.username;
        browserstackAccessKey = keys.accessKey;
      }
      await this.queue.enqueueAiExecute({
        executionId,
        testCaseIds: runCaseIds,
        browser: input.browser ?? 'chromium',
        headless: browserMode !== 'HEADED',
        username: creds.username,
        password: creds.password,
        appUrl: creds.appUrl,
        loginUrl: creds.loginUrl,
        browserstackUsername,
        browserstackAccessKey,
      });
    }
    await this.queue.clearPause(executionId);
    if (usageMode === 'SCRIPT_REPLAY') {
      await this.planUsage.recordUsage(orgId, 'SCRIPT_REPLAY', runCaseIds.length, {
        executionId,
        projectId,
      });
    } else {
      await this.planUsage.recordUsage(
        orgId,
        'AI_EXECUTOR_CASE',
        runCaseIds.length,
        { executionId, projectId, target },
      );
    }
    return this.getTcmsRun(userId, orgId, projectId, executionId);
  }

  async listAutomatedScripts(
    userId: string,
    orgId: string,
    projectId: string,
  ) {
    await this.requireProject(userId, orgId, projectId);
    const scripts = await prisma.automatedScript.findMany({
      where: { projectId },
      include: {
        testCase: {
          select: {
            id: true,
            externalId: true,
            scenario: true,
            priority: true,
            priorityLabel: true,
            folderId: true,
            deletedAt: true,
            featureKey: true,
            requirementKey: true,
            readyForExecution: true,
            caseStatus: true,
            module: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const cases = scripts
      .filter((s) => s.testCase && !s.testCase.deletedAt)
      .map((s) => s.testCase);
    const decorated = await this.decorateCases(projectId, cases);
    const byId = new Map(decorated.map((c) => [c.id, c]));
    return scripts
      .filter((s) => s.testCase && !s.testCase.deletedAt)
      .map((s) => {
        const tc = byId.get(s.testCaseId);
        return {
          id: s.id,
          testCaseId: s.testCaseId,
          path: s.path,
          language: s.language,
          framework: s.framework,
          lastRunId: s.lastRunId,
          lastStatus: s.lastStatus,
          stabilityStatus: s.stabilityStatus,
          consecutivePasses: s.consecutivePasses,
          healCount: s.healCount,
          recordedBy: s.recordedBy,
          scriptVersion: s.scriptVersion,
          updatedAt: s.updatedAt,
          externalId: tc?.externalId ?? s.testCase.externalId,
          scenario: tc?.scenario ?? s.testCase.scenario,
          priorityLabel: normalizePriorityLabel(
            tc?.priorityLabel ?? s.testCase.priorityLabel ?? s.testCase.priority,
          ),
          folderName: tc?.folderName ?? null,
        };
      });
  }

  async listAutomationHeals(
    userId: string,
    orgId: string,
    projectId: string,
  ) {
    await this.requireProject(userId, orgId, projectId);
    const logs = await prisma.automationHealLog.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const caseIds = [...new Set(logs.map((l) => l.testCaseId))];
    const cases = caseIds.length
      ? await prisma.testCase.findMany({
          where: { id: { in: caseIds } },
          select: { id: true, externalId: true, scenario: true },
        })
      : [];
    const byId = new Map(cases.map((c) => [c.id, c]));
    return logs.map((l) => ({
      ...l,
      externalId: byId.get(l.testCaseId)?.externalId ?? l.testCaseId,
      scenario: byId.get(l.testCaseId)?.scenario ?? '',
    }));
  }

  async decideHeal(
    userId: string,
    orgId: string,
    projectId: string,
    healId: string,
    decision: 'approve' | 'reject',
  ) {
    await this.requireProject(userId, orgId, projectId, Role.LEAD);
    const log = await prisma.automationHealLog.findFirst({
      where: { id: healId, projectId },
    });
    if (!log) throw new NotFoundException('Heal log not found');
    if (log.status !== 'PENDING_REVIEW') {
      throw new BadRequestException('This heal is not awaiting review');
    }
    if (decision === 'reject') {
      await prisma.automationHealLog.update({
        where: { id: healId },
        data: { status: 'REJECTED', committed: false },
      });
      await prisma.automatedScript.updateMany({
        where: { projectId, testCaseId: log.testCaseId },
        data: { stabilityStatus: 'QUARANTINED' },
      });
      await this.audit.log({
        organizationId: orgId,
        userId,
        action: 'automation.heal.reject',
        resource: 'automationHealLog',
        resourceId: healId,
      });
      return { ok: true, status: 'REJECTED' };
    }
    const patched = Array.isArray(log.patchedLog) ? log.patchedLog : null;
    await prisma.automationHealLog.update({
      where: { id: healId },
      data: { status: 'COMMITTED', committed: true },
    });
    if (patched?.length) {
      await prisma.automatedScript.updateMany({
        where: { projectId, testCaseId: log.testCaseId },
        data: {
          actionLog: patched as never,
          recordedBy: 'HEALER',
          scriptVersion: { increment: 1 },
          stabilityStatus: 'WATCH',
          lastVerifiedAt: new Date(),
        },
      });
    }
    await this.audit.log({
      organizationId: orgId,
      userId,
      action: 'automation.heal.approve',
      resource: 'automationHealLog',
      resourceId: healId,
    });
    return { ok: true, status: 'COMMITTED' };
  }

  async clearQuarantine(
    userId: string,
    orgId: string,
    projectId: string,
    testCaseId: string,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.LEAD);
    const updated = await prisma.automatedScript.updateMany({
      where: { projectId, testCaseId },
      data: { stabilityStatus: 'WATCH', consecutivePasses: 0 },
    });
    if (!updated.count) throw new NotFoundException('Script not found');
    await this.audit.log({
      organizationId: orgId,
      userId,
      action: 'automation.quarantine.clear',
      resource: 'automatedScript',
      resourceId: testCaseId,
    });
    return { ok: true };
  }

  async rerecordScript(
    userId: string,
    orgId: string,
    projectId: string,
    testCaseId: string,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.TESTER);
    const updated = await prisma.automatedScript.updateMany({
      where: { projectId, testCaseId },
      data: {
        actionLog: [] as never,
        recordedBy: 'MANUAL',
        stabilityStatus: 'WATCH',
        healCount: 0,
      },
    });
    if (!updated.count) throw new NotFoundException('Script not found');
    await this.audit.log({
      organizationId: orgId,
      userId,
      action: 'automation.script.rerecord',
      resource: 'automatedScript',
      resourceId: testCaseId,
    });
    return { ok: true };
  }

  async executeAutomatedScripts(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.TESTER);
    const input = parseBody(aiExecuteRunSchema, body);
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { allowExecuteQuarantined: true },
    });
    const scripts = await prisma.automatedScript.findMany({
      where: {
        projectId,
        ...(project?.allowExecuteQuarantined
          ? {}
          : { stabilityStatus: { not: 'QUARANTINED' } }),
      },
      select: { testCaseId: true, stabilityStatus: true },
    });
    const allowed = new Set(scripts.map((s) => s.testCaseId));
    const testCaseIds = (input.testCaseIds?.length
      ? input.testCaseIds
      : [...allowed]
    ).filter((id) => allowed.has(id));
    if (!testCaseIds.length) {
      throw new BadRequestException('No automated scripts to execute');
    }
    await this.planUsage.assertPlanLimit(
      orgId,
      'SCRIPT_REPLAY',
      testCaseIds.length,
      userId,
    );
    const creds = await this.saveAiEnvironment(projectId, input);
    const browserMode = input.browserMode ?? 'HEADLESS';
    const runId = await this.resolveLivingAutomationRun(
      projectId,
      testCaseIds,
      browserMode,
    );
    return this.aiExecuteTcmsRun(
      userId,
      orgId,
      projectId,
      runId,
      {
        ...input,
        appUrl: creds.appUrl,
        loginUrl: creds.loginUrl,
        testCaseIds,
      },
      { usageMode: 'SCRIPT_REPLAY' },
    );
  }

  /**
   * Prefer one "living" automation run per project: reopen COMPLETED/FAILED
   * so Results stay on the same cycle; create only when none exists.
   */
  private async resolveLivingAutomationRun(
    projectId: string,
    testCaseIds: string[],
    browserMode: string,
  ): Promise<string> {
    const rows = await prisma.execution.findMany({
      where: {
        projectId,
        runMode: 'MANUAL',
        deletedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
      take: 40,
    });
    const living = rows.find((row) => {
      const sel = readSelection(row.selection);
      return sel.runKind === 'AUTOMATION';
    });

    if (!living) {
      const name = `Automation ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      const created = await prisma.execution.create({
        data: {
          projectId,
          status: ExecutionStatus.PENDING,
          phase: 'EXECUTION',
          runMode: 'MANUAL',
          startedAt: null,
          selection: {
            name,
            testCaseIds,
            folderIds: [],
            runKind: 'AUTOMATION',
            browserMode,
          } as never,
        },
      });
      return created.id;
    }

    if (
      living.status === ExecutionStatus.RUNNING ||
      living.status === ExecutionStatus.PENDING
    ) {
      throw new BadRequestException(
        'An automation run is already in progress. Pause/stop it or wait before re-executing.',
      );
    }

    const prev = readSelection(living.selection);
    const nextSelection: TcmsSelection = {
      ...prev,
      name: prev.name?.trim() || 'Automation',
      testCaseIds,
      runKind: 'AUTOMATION',
      browserMode,
      aiExecuteCaseIds: null,
      claimedByRunnerId: null,
      localQueuedAt: undefined,
      localCreds: undefined,
    };
    await prisma.execution.update({
      where: { id: living.id },
      data: {
        status: ExecutionStatus.PENDING,
        finishedAt: null,
        errorSummary: null,
        startedAt: null,
        selection: nextSelection as never,
      },
    });
    return living.id;
  }

  async pauseProjectAutomation(
    userId: string,
    orgId: string,
    projectId: string,
  ) {
    const running = await this.latestRunningManual(projectId);
    if (!running) {
      throw new BadRequestException('No running AI execution');
    }
    return this.pauseTcmsRun(userId, orgId, projectId, running.id);
  }

  async stopProjectAutomation(
    userId: string,
    orgId: string,
    projectId: string,
  ) {
    const running = await this.latestRunningManual(projectId);
    if (!running) {
      throw new BadRequestException('No running AI execution');
    }
    return this.stopTcmsRun(userId, orgId, projectId, running.id);
  }

  async listAutomationReports(
    userId: string,
    orgId: string,
    projectId: string,
  ) {
    await this.requireProject(userId, orgId, projectId);
    const reports = await prisma.automationReport.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        execution: { select: { id: true, selection: true, createdAt: true } },
      },
    });
    return reports.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      passed: r.passed,
      failed: r.failed,
      blocked: r.blocked,
      skipped: r.skipped,
      pending: r.pending,
      htmlKey: r.htmlKey,
      zipKey: r.zipKey,
      executionId: r.executionId,
      runName: cycleName(
        readSelection(r.execution.selection),
        r.execution.createdAt,
      ),
      createdAt: r.createdAt,
    }));
  }

  async downloadAutomationReport(
    userId: string,
    orgId: string,
    projectId: string,
    reportId: string,
    kind: 'html' | 'zip',
    res: Response,
    disposition: 'inline' | 'attachment' = 'inline',
  ) {
    await this.requireProject(userId, orgId, projectId);
    const report = await prisma.automationReport.findFirst({
      where: { id: reportId, projectId },
    });
    if (!report) throw new NotFoundException('Report not found');
    const key = kind === 'zip' ? report.zipKey : report.htmlKey;
    if (!key) throw new NotFoundException('Report file not found');
    const buf = await this.artifactBody(key);
    if (!buf) throw new NotFoundException('Report file missing');
    const filename =
      kind === 'zip'
        ? `${report.name.replace(/[^\w.-]+/g, '_')}.zip`
        : `${report.name.replace(/[^\w.-]+/g, '_')}.html`;
    res.setHeader(
      'Content-Type',
      kind === 'zip' ? 'application/zip' : 'text/html; charset=utf-8',
    );
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${filename}"`,
    );
    res.send(buf);
  }

  private async latestRunningManual(projectId: string) {
    const rows = await prisma.execution.findMany({
      where: {
        projectId,
        runMode: 'MANUAL',
        deletedAt: null,
        status: {
          in: [ExecutionStatus.RUNNING, ExecutionStatus.PENDING],
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 12,
    });
    return (
      rows.find(
        (row) =>
          row.status === ExecutionStatus.RUNNING ||
          isWaitingLocalRunner(readSelection(row.selection), row.status),
      ) ?? null
    );
  }

  private async artifactBody(storageKey: string): Promise<Buffer | null> {
    try {
      const store = new R2ArtifactStore({
        fallbackRootDir: `${process.cwd()}/.artifacts`,
      });
      return await store.get(storageKey);
    } catch {
      /* try DB */
    }
    const blob = await prisma.artifactBlob.findUnique({
      where: { storageKey },
    });
    return blob ? Buffer.from(blob.body) : null;
  }

  private async saveAiEnvironment(
    projectId: string,
    input: {
      appUrl: string;
      loginUrl?: string;
      username?: string;
      password?: string;
      browserMode?: 'HEADLESS' | 'HEADED';
      confirmProduction?: boolean;
    },
  ) {
    const existing = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        appUrl: true,
        loginUrl: true,
        encryptedConfig: true,
        browserMode: true,
      },
    });
    const appUrl =
      normalizeStoredAppUrl(input.appUrl) ??
      normalizeStoredAppUrl(existing?.appUrl);
    if (!appUrl || !isUsableAppUrl(appUrl)) {
      throw new BadRequestException('A valid environment URL is required');
    }
    if (isLikelyProductionUrl(appUrl) && !input.confirmProduction) {
      throw new BadRequestException(
        'This URL looks like production. Use a QA/UAT/staging URL, or set confirmProduction=true to proceed.',
      );
    }
    const loginUrl =
      normalizeStoredAppUrl(input.loginUrl) ??
      existing?.loginUrl ??
      appUrl;
    let username = input.username?.trim() || '';
    let password = input.password || '';
    if ((!username || !password) && existing?.encryptedConfig) {
      try {
        const parsed = JSON.parse(decrypt(existing.encryptedConfig)) as {
          username?: string;
          password?: string;
        };
        if (!username) username = parsed.username ?? '';
        if (!password) password = parsed.password ?? '';
      } catch {
        /* ignore */
      }
    }
    let encryptedConfig: string | undefined;
    if (username || password) {
      if (!hasEncryptionKey()) {
        throw new BadRequestException(
          'ENCRYPTION_KEY is not configured — cannot store credentials',
        );
      }
      encryptedConfig = encrypt(
        JSON.stringify({
          username,
          password,
          environment: 'non-prod',
        }),
      );
    }
    await prisma.project.update({
      where: { id: projectId },
      data: {
        appUrl,
        loginUrl,
        browserMode: input.browserMode ?? existing?.browserMode ?? 'HEADLESS',
        ...(encryptedConfig ? { encryptedConfig } : {}),
      },
    });
    return {
      appUrl,
      loginUrl: loginUrl ?? undefined,
      username,
      password,
    };
  }

  async listTcmsRuns(
    userId: string,
    orgId: string,
    projectId: string,
    includeArchived = false,
  ) {
    await this.requireProject(userId, orgId, projectId);
    await this.runners.expireWaitingLocalJobs();
    const runs = await prisma.execution.findMany({
      where: {
        projectId,
        runMode: 'MANUAL',
        ...(includeArchived ? {} : { deletedAt: null }),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const ids = runs.map((r) => r.id);
    const results = ids.length
      ? await prisma.testResult.findMany({
          where: { executionId: { in: ids } },
          select: { executionId: true, testCaseId: true, status: true },
        })
      : [];
    return runs.map((run) => {
      const sel = readSelection(run.selection);
      const caseIds = sel.testCaseIds ?? [];
      const mine = results.filter((r) => r.executionId === run.id);
      return {
        ...run,
        selection: publicSelection(sel) as never,
        name: cycleName(sel, run.createdAt),
        description: sel.description ?? null,
        waitingForRunner: isWaitingLocalRunner(sel, run.status),
        locked:
          run.status === ExecutionStatus.COMPLETED ||
          run.status === ExecutionStatus.CANCELLED,
        counts: summarizeCycle(caseIds, mine),
      };
    });
  }

  async getTcmsRun(
    userId: string,
    orgId: string,
    projectId: string,
    executionId: string,
  ) {
    await this.requireProject(userId, orgId, projectId);
    await this.runners.expireWaitingLocalJobs();
    const execution = await this.loadManualRun(projectId, executionId);
    const selection = readSelection(execution.selection);
    const ids = selection.testCaseIds ?? [];
    const [cases, results] = await Promise.all([
      ids.length
        ? prisma.testCase.findMany({
            where: { id: { in: ids } },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([]),
      prisma.testResult.findMany({
        where: { executionId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const decorated = await this.decorateCases(projectId, cases);
    const byCase = new Map(results.map((r) => [r.testCaseId, r]));
    const withResults = decorated.map((c) => ({
      ...c,
      result: byCase.get(c.id) ?? null,
    }));
    return {
      ...execution,
      selection: publicSelection(selection) as never,
      name: cycleName(selection, execution.createdAt),
      description: selection.description ?? null,
      waitingForRunner: isWaitingLocalRunner(selection, execution.status),
      locked:
        execution.status === ExecutionStatus.COMPLETED ||
        execution.status === ExecutionStatus.CANCELLED,
      counts: cycleResultCounts(withResults),
      cases: withResults,
    };
  }

  async updateTcmsRun(
    userId: string,
    orgId: string,
    projectId: string,
    executionId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const execution = await this.loadManualRun(projectId, executionId);
    this.assertCycleWritable(execution);
    const input = parseBody(updateTcmsRunSchema, body);
    const selection = readSelection(execution.selection);
    let testCaseIds = [...(selection.testCaseIds ?? [])];
    if (input.testCaseIds) {
      testCaseIds = [...new Set(input.testCaseIds)];
    }
    if (input.addTestCaseIds?.length) {
      testCaseIds = [...new Set([...testCaseIds, ...input.addTestCaseIds])];
    }
    if (input.removeTestCaseIds?.length) {
      const drop = new Set(input.removeTestCaseIds);
      testCaseIds = testCaseIds.filter((id) => !drop.has(id));
    }
    if (!testCaseIds.length) {
      throw new BadRequestException('A cycle must keep at least one test case');
    }
    const rosterChanged =
      JSON.stringify(testCaseIds) !==
      JSON.stringify(selection.testCaseIds ?? []);
    if (rosterChanged) {
      const cases = await prisma.testCase.findMany({
        where: { projectId, id: { in: testCaseIds }, deletedAt: null },
      });
      if (cases.length !== testCaseIds.length) {
        throw new BadRequestException('One or more test cases were not found');
      }
      const notReady = cases.filter((c) => !isReadyCase(c));
      if (notReady.length) {
        throw new BadRequestException(
          'Only Ready cases can be added to a cycle',
        );
      }
      if (input.removeTestCaseIds?.length) {
        await prisma.testResult.deleteMany({
          where: {
            executionId,
            testCaseId: { in: input.removeTestCaseIds },
          },
        });
      }
    }
    const next: TcmsSelection = {
      ...selection,
      testCaseIds,
      name: input.name?.trim() || selection.name,
      description:
        input.description !== undefined
          ? input.description
          : selection.description,
    };
    return prisma.execution.update({
      where: { id: executionId },
      data: { selection: next as never },
    });
  }

  async deleteTcmsRun(
    userId: string,
    orgId: string,
    projectId: string,
    executionId: string,
    permanent = false,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    await this.loadManualRun(projectId, executionId);
    if (permanent) {
      await prisma.testResult.deleteMany({ where: { executionId } });
      await prisma.execution.delete({ where: { id: executionId } });
      return { ok: true, id: executionId };
    }
    await prisma.execution.update({
      where: { id: executionId },
      data: { deletedAt: new Date() },
    });
    return { ok: true, id: executionId, archived: true };
  }

  async restoreTcmsRun(
    userId: string,
    orgId: string,
    projectId: string,
    executionId: string,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    await this.loadManualRun(projectId, executionId);
    await prisma.execution.update({
      where: { id: executionId },
      data: { deletedAt: null },
    });
    return { ok: true, id: executionId };
  }

  async stopTcmsRun(
    userId: string,
    orgId: string,
    projectId: string,
    executionId: string,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.TESTER);
    const execution = await this.loadManualRun(projectId, executionId);
    if (
      execution.status === ExecutionStatus.COMPLETED ||
      execution.status === ExecutionStatus.CANCELLED
    ) {
      throw new BadRequestException('This cycle is locked');
    }
    await this.queue.publishCancel(executionId);
    return prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.CANCELLED,
        finishedAt: new Date(),
        errorSummary: 'Stopped by user',
      },
    });
  }

  async completeTcmsRun(
    userId: string,
    orgId: string,
    projectId: string,
    executionId: string,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const execution = await this.loadManualRun(projectId, executionId);
    if (execution.status !== ExecutionStatus.RUNNING) {
      throw new BadRequestException('Only a running cycle can be completed');
    }
    return prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.COMPLETED,
        finishedAt: new Date(),
      },
    });
  }

  async upsertTestResult(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.TESTER);
    const input = parseBody(testResultWriteSchema, body);
    if (!input.testCaseId || !input.executionId) {
      throw new BadRequestException('testCaseId and executionId are required');
    }
    const execution = await this.loadManualRun(projectId, input.executionId);
    this.assertCycleWritable(execution);
    if (execution.status === ExecutionStatus.PENDING) {
      await prisma.execution.update({
        where: { id: input.executionId },
        data: {
          status: ExecutionStatus.RUNNING,
          startedAt: execution.startedAt ?? new Date(),
        },
      });
    }
    const ids = readSelection(execution.selection).testCaseIds ?? [];
    if (!ids.includes(input.testCaseId)) {
      throw new BadRequestException('Case is not in this cycle');
    }
    this.assertResultComment(input.status, input.message);
    const existing = await prisma.testResult.findFirst({
      where: { executionId: input.executionId, testCaseId: input.testCaseId },
      orderBy: { createdAt: 'desc' },
    });
    const data = {
      status: input.status,
      message: input.message ?? null,
      executedBy: 'HUMAN',
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    };
    if (existing) {
      return prisma.testResult.update({
        where: { id: existing.id },
        data,
      });
    }
    return prisma.testResult.create({
      data: {
        projectId,
        executionId: input.executionId,
        testCaseId: input.testCaseId,
        ...data,
      },
    });
  }

  async patchTestResult(
    userId: string,
    orgId: string,
    projectId: string,
    resultId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.TESTER);
    const existing = await prisma.testResult.findFirst({
      where: { id: resultId, projectId },
    });
    if (!existing) throw new NotFoundException('Result not found');
    if (!existing.executionId) {
      throw new BadRequestException('Result is not attached to a run');
    }
    const execution = await this.loadManualRun(
      projectId,
      existing.executionId,
    );
    this.assertCycleWritable(execution);
    const input = parseBody(testResultWriteSchema, body);
    this.assertResultComment(
      input.status,
      input.message !== undefined ? input.message : existing.message,
    );
    return prisma.testResult.update({
      where: { id: resultId },
      data: {
        status: input.status,
        ...(input.message !== undefined ? { message: input.message } : {}),
        ...(input.durationMs !== undefined
          ? { durationMs: input.durationMs }
          : {}),
        executedBy: existing.executedBy ?? 'HUMAN',
      },
    });
  }

  async attachResultScreenshot(
    userId: string,
    orgId: string,
    projectId: string,
    resultId: string,
    file: Express.Multer.File | undefined,
  ) {
    return this.attachResultEvidence(userId, orgId, projectId, resultId, file);
  }

  async attachResultEvidence(
    userId: string,
    orgId: string,
    projectId: string,
    resultId: string,
    file: Express.Multer.File | undefined,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.TESTER);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Evidence file is required');
    }
    const result = await prisma.testResult.findFirst({
      where: { id: resultId, projectId },
    });
    if (!result) throw new NotFoundException('Result not found');
    if (!result.executionId) {
      throw new BadRequestException('Result is not attached to a run');
    }
    const execution = await this.loadManualRun(projectId, result.executionId);
    this.assertCycleWritable(execution);
    const mime = file.mimetype || 'application/octet-stream';
    const isVideo = mime.startsWith('video/');
    if (isVideo && file.buffer.length > 50 * 1024 * 1024) {
      throw new BadRequestException('Video must be 50MB or smaller');
    }
    if (!isVideo && file.buffer.length > 8 * 1024 * 1024) {
      throw new BadRequestException('Screenshot must be 8MB or smaller');
    }
    if (!isVideo && !mime.startsWith('image/')) {
      throw new BadRequestException('Attach an image or video file');
    }
    const ext = isVideo
      ? mime.includes('webm')
        ? 'webm'
        : mime.includes('mp4')
          ? 'mp4'
          : 'webm'
      : mime.includes('jpeg') || mime.includes('jpg')
        ? 'jpg'
        : mime.includes('webp')
          ? 'webp'
          : mime.includes('gif')
            ? 'gif'
            : 'png';
    const folder = isVideo ? 'videos' : 'screenshots';
    const key = `${result.executionId}/${folder}/${result.testCaseId}-${Date.now()}.${ext}`;
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    await prisma.artifact.create({
      data: {
        executionId: result.executionId,
        type: isVideo ? ArtifactType.VIDEO : ArtifactType.SCREENSHOT,
        storageKey: key,
        mime,
        size: file.buffer.length,
        checksum,
      },
    });
    await prisma.artifactBlob.upsert({
      where: { storageKey: key },
      create: {
        storageKey: key,
        mime,
        size: file.buffer.length,
        body: file.buffer as never,
      },
      update: {
        mime,
        size: file.buffer.length,
        body: file.buffer as never,
      },
    });
    const keys = Array.isArray(result.evidenceKeys)
      ? [...(result.evidenceKeys as string[]), key]
      : [key];
    return prisma.testResult.update({
      where: { id: result.id },
      data: { evidenceKeys: keys as never },
    });
  }

  async downloadTcmsTcr(
    userId: string,
    orgId: string,
    projectId: string,
    format: string,
    res: Response,
    executionId?: string,
  ) {
    const project = await this.requireProject(userId, orgId, projectId);
    const fmt = (format || 'html').toLowerCase();
    if (fmt !== 'csv' && fmt !== 'json') {
      await this.planUsage.assertFeature(orgId, 'exportsHtml', userId);
    }
    const report = await buildTcrPayload(
      projectId,
      project.name,
      executionId ? [executionId] : undefined,
    );
    const pack =
      fmt === 'docx' || fmt === 'doc' || fmt === 'word'
        ? buildTcmsTcrWord(report)
        : fmt === 'pdf'
          ? buildTcmsTcrPdf(report)
          : buildTcmsTcrHtml(report);
    res.setHeader('Content-Type', pack.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${pack.filename}"`,
    );
    res.send(pack.body);
  }

  async listTcmsAutomation(
    userId: string,
    orgId: string,
    projectId: string,
  ) {
    const project = await this.requireProject(userId, orgId, projectId);
    const executionId = await this.latestStlcExecutionId(projectId);
    const cases = await prisma.testCase.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(executionId
          ? { OR: [{ executionId }, { executionId: null }] }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    const ready = cases.filter(
      (c) =>
        normalizeCaseStatus(c.caseStatus, c.readyForExecution) === 'READY',
    );
    const decorated = await this.decorateCases(projectId, ready);
    const language = project.language || 'TYPESCRIPT';
    const framework = project.framework || 'PLAYWRIGHT';
    const ext =
      language === 'JAVA'
        ? 'java'
        : language === 'PYTHON'
          ? 'py'
          : language === 'CSHARP'
            ? 'cs'
            : 'spec.ts';
    const files = decorated.map((c) => ({
      testCaseId: c.id,
      externalId: c.externalId,
      scenario: c.scenario,
      path: `tests/${c.externalId}.${ext}`,
      placeholder: true,
    }));
    return {
      language,
      framework,
      browserMode: project.browserMode || 'HEADLESS',
      files,
      readyCount: ready.length,
    };
  }

  async saveAutomationStack(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const input = parseBody(
      z.object({
        language: z.enum(['TYPESCRIPT', 'JAVA', 'PYTHON', 'CSHARP']),
        framework: z.enum([
          'PLAYWRIGHT',
          'SELENIUM',
          'SELENIUM_JAVA',
          'CYPRESS',
        ]),
      }),
      body,
    );
    return prisma.project.update({
      where: { id: projectId },
      data: { language: input.language, framework: input.framework },
      select: { id: true, language: true, framework: true },
    });
  }

  async downloadAutomationPack(
    userId: string,
    orgId: string,
    projectId: string,
    res: Response,
  ) {
    const pack = await this.listTcmsAutomation(userId, orgId, projectId);
    const files: Record<string, string> = {
      'README.md': `# Automation pack\n\nLanguage: ${pack.language}\nFramework: ${pack.framework}\n\nScripts will be generated per Ready case. Placeholders:\n\n${pack.files.map((f) => `- ${f.path} — ${f.externalId} ${f.scenario}`).join('\n')}\n`,
    };
    for (const f of pack.files) {
      files[f.path] = `// Placeholder for ${f.externalId}: ${f.scenario}\n// Generate with AI in a later pass.\n`;
    }
    const buf = await buildZipPackage({ files });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="automation-${projectId}.zip"`,
    );
    res.send(buf);
  }

  async listAutomationForOrg(userId: string, orgId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);
    const projects = await prisma.project.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, name: true },
    });
    const items = [];
    for (const p of projects) {
      const row = await this.listAutomationForProject(userId, orgId, p.id);
      if (row) items.push({ ...row, projectId: p.id, projectName: p.name });
    }
    return { items };
  }

  async listAutomationForProject(
    userId: string,
    orgId: string,
    projectId: string,
  ) {
    await this.requireProject(userId, orgId, projectId);

    // Prefer an execution that actually produced automation artifacts
    // (latest cycle may still be mid-run at Authentication).
    const withManifest = await prisma.artifact.findFirst({
      where: {
        type: { in: ['AUTOMATION_MANIFEST', ArtifactType.AUTOMATION_FRAMEWORK] },
        execution: {
          projectId,
          runMode: { in: [...STLC_RUN_MODES] },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { executionId: true },
    });
    const execution = withManifest
      ? await prisma.execution.findUnique({ where: { id: withManifest.executionId } })
      : await prisma.execution.findFirst({
          where: { projectId, runMode: { in: [...STLC_RUN_MODES] } },
          orderBy: { createdAt: 'desc' },
        });
    if (!execution) return null;

    const manifestArt = await prisma.artifact.findFirst({
      where: { executionId: execution.id, type: 'AUTOMATION_MANIFEST' },
      orderBy: { createdAt: 'desc' },
    });
    let manifest: Record<string, unknown> = {
      executionId: execution.id,
      files: [] as string[],
    };
    if (manifestArt) {
      try {
        const store = new R2ArtifactStore({
          fallbackRootDir: `${process.cwd()}/.artifacts`,
        });
        const buf = await store.get(manifestArt.storageKey);
        manifest = JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
      } catch {
        /* keep defaults — storage may be ephemeral after redeploy */
      }
    }

    const frameworkFiles = await prisma.artifact.findMany({
      where: {
        executionId: execution.id,
        type: ArtifactType.AUTOMATION_FRAMEWORK,
      },
      orderBy: { createdAt: 'asc' },
      select: { storageKey: true },
    });
    const filesFromStore = frameworkFiles.map((f) => f.storageKey);
    const filesFromManifest = Array.isArray(manifest.files)
      ? (manifest.files as string[])
      : [];
    const files = filesFromManifest.length ? filesFromManifest : filesFromStore;

    if (!files.length && !manifestArt && !frameworkFiles.length) return null;

    return {
      executionId: execution.id,
      framework: (manifest.framework as string) ?? 'playwright',
      language: (manifest.language as string) ?? 'typescript',
      baseUrl: (manifest.baseUrl as string) ?? undefined,
      files,
      cycleNumber: execution.cycleNumber ?? 1,
    };
  }

  async listReports(userId: string, orgId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);
    const arts = await prisma.artifact.findMany({
      where: {
        type: ArtifactType.REPORT_HTML,
        execution: { project: { organizationId: orgId, deletedAt: null } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        execution: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            project: { select: { name: true } },
          },
        },
      },
    });
    return arts.map((a) => ({
      id: a.executionId,
      executionId: a.executionId,
      status: a.execution.status,
      projectName: a.execution.project.name,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async getReport(userId: string, orgId: string, executionId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);
    const execution = await prisma.execution.findFirst({
      where: {
        id: executionId,
        project: { organizationId: orgId },
      },
      include: { project: true },
    });
    if (!execution) throw new NotFoundException('Execution not found');

    const htmlArt = await prisma.artifact.findFirst({
      where: { executionId, type: ArtifactType.REPORT_HTML },
      orderBy: { createdAt: 'desc' },
    });

    let html: string | undefined;
    if (htmlArt) {
      try {
        const store = new R2ArtifactStore({
          fallbackRootDir: `${process.cwd()}/.artifacts`,
        });
        html = (await store.get(htmlArt.storageKey)).toString('utf8');
      } catch {
        html = undefined;
      }
    }

    const scores =
      execution.scores && typeof execution.scores === 'object'
        ? (execution.scores as Record<string, number>)
        : undefined;

    if (!html) {
      const [results, bugs] = await Promise.all([
        prisma.testResult.findMany({
          where: { executionId },
          include: { testCase: true },
        }),
        prisma.bug.findMany({ where: { executionId } }),
      ]);
      html = renderHtmlReport({
        executionId,
        projectName: execution.project.name,
        appUrl: execution.project.appUrl ?? '',
        status: execution.status,
        scores: {
          functional: scores?.functional,
          accessibility: scores?.accessibility,
          performance: scores?.performance,
          security: scores?.security,
          uiux: scores?.uiux,
        },
        summary: {
          passed:
            scores?.passed ??
            results.filter((r) => r.status === 'PASSED').length,
          failed:
            scores?.failed ??
            results.filter((r) => r.status === 'FAILED').length,
          total: scores?.total ?? results.length,
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

    return {
      html,
      htmlUrl: `${(process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')}/api/v1/orgs/${orgId}/executions/${executionId}/artifacts/by-type/${ArtifactType.REPORT_HTML}`,
      scores,
      summary: scores
        ? {
            passed: scores.passed,
            failed: scores.failed,
            total: scores.total,
          }
        : undefined,
      projectName: execution.project.name,
      executionId,
    };
  }

  async generateTestCases(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
    file?: Express.Multer.File,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    await this.planUsage.assertPlanLimit(orgId, 'AI_GENERATE', 1, userId);
    const input = parseBody(
      generateTestCasesSchema,
      coerceGenerateBody(body),
    );
    let sourceText = input.prompt?.trim() ?? '';
    let documentName = 'prompt';
    if (file?.buffer?.length) {
      if (!isAllowedRequirementFile(file.originalname, file.mimetype)) {
        throw new BadRequestException(
          'Upload a .pdf, .docx, .txt, or .md requirements file',
        );
      }
      sourceText = (
        await parseRequirementFile(file.buffer, file.originalname, file.mimetype)
      ).trim();
      documentName = file.originalname;
    }
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        name: true,
        appUrl: true,
        loginUrl: true,
        encryptedConfig: true,
        requirementText: true,
      },
    });
    const includeReqs = input.includeProjectRequirements !== false;
    const storedRequirements = includeReqs
      ? (
          await prisma.requirement.findMany({
            where: { projectId },
            orderBy: { requirementKey: 'asc' },
            take: 80,
            select: {
              requirementKey: true,
              title: true,
              description: true,
              acceptanceCriteria: true,
            },
          })
        ).map((r) => ({
          requirementKey: r.requirementKey,
          title: r.title,
          description: r.description,
          acceptanceCriteria: Array.isArray(r.acceptanceCriteria)
            ? r.acceptanceCriteria.map(String)
            : [],
        }))
      : [];
    if (
      includeReqs &&
      !storedRequirements.length &&
      project?.requirementText?.trim()
    ) {
      storedRequirements.push({
        requirementKey: 'REQ-001',
        title: project.name,
        description: project.requirementText.trim(),
        acceptanceCriteria: [],
      });
    }
    let username: string | undefined;
    let password: string | undefined;
    if (project?.encryptedConfig && hasEncryptionKey()) {
      try {
        const parsed = JSON.parse(decrypt(project.encryptedConfig)) as {
          username?: string;
          password?: string;
        };
        username = parsed.username;
        password = parsed.password;
      } catch {
        /* ignore */
      }
    }
    const fromPrompt = credsFromCases(
      [{ steps: sourceText.split('\n'), testData: {} }],
      {},
    );
    const promptUrl = extractAppUrlFromText(sourceText);
    const appUrl =
      normalizeStoredAppUrl(project?.appUrl) ??
      fromPrompt.appUrl ??
      promptUrl ??
      null;
    const loginUrl =
      normalizeStoredAppUrl(project?.loginUrl) ?? appUrl;
    username = username || fromPrompt.username;
    password = password || fromPrompt.password;
    const shouldReview = input.reviewApplication !== false && Boolean(appUrl);
    const pageMap = shouldReview && appUrl
      ? await reviewApplicationByFetch(appUrl)
      : null;
    // Persist URL from the prompt onto the project when missing so later runs reuse it.
    if (appUrl && !normalizeStoredAppUrl(project?.appUrl)) {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          appUrl,
          loginUrl: loginUrl ?? appUrl,
        },
      });
    }
    const generated = await this.aiGenerate.generate({
      sourceText,
      documentName,
      techniques: input.techniques as DesignTechnique[] | undefined,
      type: input.type,
      priorityLabel: input.priorityLabel,
      projectName: project?.name,
      appUrl,
      loginUrl,
      username,
      password,
      storedRequirements,
      pageMap,
    });
    await this.planUsage.recordUsage(orgId, 'AI_GENERATE', 1, {
      projectId,
      caseCount: generated.cases.length,
    });
    const promptText = sourceText.trim();
    if (promptText) {
      await prisma.aiPromptHistory.create({
        data: {
          projectId,
          userId,
          prompt: promptText.slice(0, 100_000),
          source: 'GENERATE',
          caseCount: generated.cases.length,
        },
      });
    }
    return {
      ...generated,
      folderId: input.folderId ?? null,
      pageMap,
    };
  }

  async listAiPrompts(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    const items = await prisma.aiPromptHistory.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        prompt: true,
        source: true,
        caseCount: true,
        userId: true,
        createdAt: true,
      },
    });
    return { items };
  }

  async createAiPrompt(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const input = parseBody(aiPromptHistoryCreateSchema, body);
    const row = await prisma.aiPromptHistory.create({
      data: {
        projectId,
        userId,
        prompt: input.prompt.trim().slice(0, 100_000),
        source: input.source ?? 'GENERATE',
        caseCount: input.caseCount ?? null,
      },
      select: {
        id: true,
        prompt: true,
        source: true,
        caseCount: true,
        userId: true,
        createdAt: true,
      },
    });
    return row;
  }

  async clearAiPrompts(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const result = await prisma.aiPromptHistory.deleteMany({
      where: { projectId },
    });
    return { ok: true, deleted: result.count };
  }

  async deleteAiPrompt(
    userId: string,
    orgId: string,
    projectId: string,
    promptId: string,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const existing = await prisma.aiPromptHistory.findFirst({
      where: { id: promptId, projectId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Prompt history entry not found');
    await prisma.aiPromptHistory.delete({ where: { id: promptId } });
    return { ok: true, id: promptId };
  }

  async generateApply(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const input = parseBody(generateApplySchema, body);
    const source =
      input.source ?? (input.mode === 'update' ? 'UPDATE' : 'GENERATE');

    let created = 0;
    let updated = 0;
    const casesOut: Array<{ id: string; externalId: string; scenario: string }> =
      [];

    const tools = createInternalTcmsProvider();
    const ctx = {
      orgId,
      projectId,
      userId,
      permissionLevel: 'EXECUTE' as const,
    };
    const forceCreate = Boolean(input.forceCreate) && input.mode === 'create';

    const template = input.templateId
      ? await prisma.caseTemplate.findFirst({
          where: { id: input.templateId, projectId },
        })
      : await prisma.caseTemplate.findFirst({
          where: { projectId, isDefault: true },
        });
    const templateDefaults =
      template?.defaults && typeof template.defaults === 'object'
        ? (template.defaults as Record<string, string>)
        : {};

    const usedIds = new Set<string>();

    for (let i = 0; i < input.cases.length; i++) {
      const row = input.cases[i]!;
      if (!row.scenario?.trim() || !row.expected?.trim()) continue;
      const folderId =
        row.folderId !== undefined ? row.folderId : input.folderId;
      const placement = await this.folderPlacement(projectId, folderId);
      const preferredId = input.caseIds?.[i];
      if (preferredId && usedIds.has(preferredId)) {
        // already applied in this batch
      }

      const result = await tools.testcase.upsert(ctx, {
        scenario: row.scenario.trim(),
        module: row.module ?? placement.module ?? 'General',
        designTechnique:
          row.designTechnique ?? templateDefaults.designTechnique ?? null,
        requirementKey:
          row.requirementKey ?? placement.requirementKey ?? null,
        preconditions:
          row.preconditions ?? templateDefaults.preconditions ?? '',
        steps: row.steps ?? ['Perform the scenario steps'],
        expected: row.expected.trim(),
        priorityLabel:
          row.priorityLabel ??
          (templateDefaults.priorityLabel as 'HIGH' | 'MEDIUM' | 'LOW') ??
          normalizePriorityLabel(row.priority ?? 'P1'),
        type: row.type ?? templateDefaults.type ?? 'functional',
        testData: row.testData ?? null,
        externalId: row.externalId?.trim() || null,
        preferredId: preferredId && !usedIds.has(preferredId) ? preferredId : null,
        excludeIds: [...usedIds],
        forceCreate,
      });

      usedIds.add(result.case.id);
      const status = this.statusFields({ caseStatus: 'DRAFT' });
      const record = await prisma.testCase.update({
        where: { id: result.case.id },
        data: {
          folderId: placement.folderId ?? null,
          featureKey: row.featureKey ?? placement.featureKey ?? null,
          priority:
            row.priority ??
            priorityFromLabel(
              row.priorityLabel ??
                (templateDefaults.priorityLabel as
                  | 'HIGH'
                  | 'MEDIUM'
                  | 'LOW') ??
                'MEDIUM',
            ),
          severity: row.severity ?? 'medium',
          customFields: (row.customFields ?? null) as never,
          templateId: input.templateId ?? template?.id ?? null,
          ...status,
        },
      });

      if (result.created) created += 1;
      else updated += 1;
      casesOut.push({
        id: record.id,
        externalId: record.externalId,
        scenario: record.scenario,
      });
    }

    if (!created && !updated) {
      throw new BadRequestException('No valid cases to apply');
    }

    const promptText = input.prompt?.trim();
    if (promptText) {
      await prisma.aiPromptHistory.create({
        data: {
          projectId,
          userId,
          prompt: promptText.slice(0, 100_000),
          source,
          caseCount: created + updated,
        },
      });
    }

    await this.syncDesignDocFromCases(projectId);
    return {
      mode: input.mode,
      created,
      updated,
      cases: casesOut,
      provider: 'internal-tcms',
    };
  }

  /**
   * AI QA Engineer intent shell.
   * SUGGEST: generate a plan + case preview (no writes).
   * EXECUTE: generate then apply via Internal TCMS tool provider.
   */
  async runAiAgentIntent(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const input = parseBody(aiAgentIntentSchema, body);
    const permissionLevel = input.permissionLevel ?? 'SUGGEST';

    const generated = await this.generateTestCases(
      userId,
      orgId,
      projectId,
      {
        prompt: input.intent,
        includeProjectRequirements: input.includeProjectRequirements,
        reviewApplication: input.reviewApplication,
        techniques: input.techniques,
      },
    );

    const plan = {
      permissionLevel,
      goal: input.intent.slice(0, 500),
      steps: [
        'Clarify goal from intent',
        'Generate candidate test cases (chunked by technique)',
        permissionLevel === 'EXECUTE'
          ? 'Apply cases via Internal TCMS tool provider'
          : 'Return suggestions for human review (no writes)',
      ],
      caseCount: generated.cases?.length ?? 0,
      coverage: generated.coverage ?? null,
    };

    if (permissionLevel === 'SUGGEST') {
      return {
        permissionLevel,
        applied: false,
        plan,
        cases: generated.cases,
        coverage: generated.coverage,
        tokensUsed: generated.tokensUsed,
        requirementCount: generated.requirementCount,
        pageMap: generated.pageMap ?? null,
      };
    }

    const apply = await this.generateApply(userId, orgId, projectId, {
      mode: 'create',
      prompt: input.intent,
      source: 'GENERATE',
      folderId: input.folderId ?? null,
      cases: (generated.cases ?? []).map((c: {
        scenario: string;
        preconditions?: string;
        steps?: string[];
        expected: string;
        type?: string;
        designTechnique?: string;
        requirementKey?: string | null;
        priorityLabel?: 'HIGH' | 'MEDIUM' | 'LOW';
        testData?: Record<string, string> | null;
        module?: string;
      }) => ({
        scenario: c.scenario,
        preconditions: c.preconditions ?? '',
        steps: c.steps ?? [],
        expected: c.expected,
        type: c.type ?? 'functional',
        designTechnique: c.designTechnique,
        requirementKey: c.requirementKey ?? null,
        priorityLabel: c.priorityLabel ?? 'MEDIUM',
        testData: c.testData ?? null,
        module: c.module ?? 'General',
      })),
    });

    return {
      permissionLevel,
      applied: true,
      plan,
      cases: generated.cases,
      coverage: generated.coverage,
      tokensUsed: generated.tokensUsed,
      requirementCount: generated.requirementCount,
      pageMap: generated.pageMap ?? null,
      apply,
    };
  }

  async bulkCreateTestCases(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const input = parseBody(testCaseBulkCreateSchema, body);
    const created = [];
    let count = await prisma.testCase.count({ where: { projectId } });
    const template = input.templateId
      ? await prisma.caseTemplate.findFirst({
          where: { id: input.templateId, projectId },
        })
      : await prisma.caseTemplate.findFirst({
          where: { projectId, isDefault: true },
        });
    const templateDefaults =
      template?.defaults && typeof template.defaults === 'object'
        ? (template.defaults as Record<string, string>)
        : {};
    for (const row of input.cases) {
      if (!row.scenario?.trim() || !row.expected?.trim()) continue;
      count += 1;
      const folderId =
        row.folderId !== undefined ? row.folderId : input.folderId;
      const placement = await this.folderPlacement(projectId, folderId);
      const status = this.statusFields({ caseStatus: 'DRAFT' });
      const record = await prisma.testCase.create({
        data: {
          projectId,
          executionId: null,
          externalId:
            row.externalId?.trim() ||
            `TC-${String(count).padStart(3, '0')}`,
          module: row.module ?? placement.module ?? 'General',
          scenario: row.scenario.trim(),
          preconditions:
            row.preconditions ?? templateDefaults.preconditions ?? '',
          steps: (row.steps ?? ['Perform the scenario steps']) as never,
          expected: row.expected.trim(),
          priority:
            row.priority ??
            priorityFromLabel(
              row.priorityLabel ??
                (templateDefaults.priorityLabel as 'HIGH' | 'MEDIUM' | 'LOW') ??
                'MEDIUM',
            ),
          severity: row.severity ?? 'medium',
          type: row.type ?? templateDefaults.type ?? 'functional',
          requirementKey:
            row.requirementKey ?? placement.requirementKey ?? null,
          designTechnique:
            row.designTechnique ??
            templateDefaults.designTechnique ??
            null,
          featureKey: row.featureKey ?? placement.featureKey ?? null,
          folderId: placement.folderId ?? null,
          designMode: 'GENERIC',
          priorityLabel:
            row.priorityLabel ??
            normalizePriorityLabel(row.priority ?? 'P1'),
          ...status,
          testData: (row.testData ?? null) as never,
          customFields: (row.customFields ?? null) as never,
          templateId: input.templateId ?? template?.id ?? null,
        },
      });
      created.push(record);
    }
    if (!created.length) {
      throw new BadRequestException('No valid cases to add');
    }
    await this.syncDesignDocFromCases(projectId);
    return { created: created.length, cases: created };
  }

  async importTestCases(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
    file?: Express.Multer.File,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Upload a CSV, JSON, or XLS file');
    }
    const input = parseBody(importTestCasesSchema, coerceImportBody(body));
    const parsed = parseImportBuffer(file);
    const folders = await prisma.tcmsFolder.findMany({ where: { projectId } });
    let count = await prisma.testCase.count({ where: { projectId } });
    let created = 0;
    let updated = 0;
    const errors = [...parsed.errors];
    for (const row of parsed.rows) {
      try {
        const folderId = resolveImportFolder(
          folders,
          row.folder,
          input.folderId,
        );
        const placement = await this.folderPlacement(projectId, folderId);
        const payload = {
          module: placement.module ?? row.folder ?? 'General',
          scenario: row.scenario,
          preconditions: row.preconditions ?? '',
          steps: (row.steps?.length
            ? row.steps
            : ['Perform the scenario steps']) as never,
          expected: row.expected,
          priority: row.priority ?? priorityFromLabel('MEDIUM'),
          severity: row.severity ?? 'medium',
          type: row.type ?? 'functional',
          requirementKey: row.requirementKey ?? placement.requirementKey ?? null,
          designTechnique: row.designTechnique ?? null,
          featureKey: row.featureKey ?? placement.featureKey ?? null,
          folderId: placement.folderId ?? null,
          designMode: 'GENERIC' as const,
          priorityLabel: (['HIGH', 'MEDIUM', 'LOW'].includes(
            (row.priorityLabel ?? '').toUpperCase(),
          )
            ? row.priorityLabel!.toUpperCase()
            : normalizePriorityLabel(row.priority ?? 'P1')) as
            | 'HIGH'
            | 'MEDIUM'
            | 'LOW',
          caseStatus: 'DRAFT' as const,
          readyForExecution: false,
          testData: (row.testData ?? null) as never,
          customFields: (row.customFields ?? null) as never,
          templateId: input.templateId ?? null,
        };
        const existing = row.externalId
          ? await prisma.testCase.findFirst({
              where: { projectId, externalId: row.externalId },
            })
          : null;
        if (existing && input.updateExisting) {
          await prisma.testCase.update({
            where: { id: existing.id },
            data: payload,
          });
          updated += 1;
        } else {
          count += 1;
          await prisma.testCase.create({
            data: {
              projectId,
              executionId: null,
              externalId:
                row.externalId?.trim() ||
                `TC-${String(count).padStart(3, '0')}`,
              ...payload,
            },
          });
          created += 1;
        }
      } catch (err) {
        errors.push({
          line: created + updated + errors.length + 1,
          message: err instanceof Error ? err.message : 'Import row failed',
        });
      }
    }
    await this.syncDesignDocFromCases(projectId);
    return { created, updated, skipped: errors.length, errors };
  }

  private async backfillCaseFieldOrgs() {
    await prisma.$executeRaw`
      UPDATE "CaseField" AS f
      SET "organizationId" = p."organizationId"
      FROM "Project" AS p
      WHERE f."projectId" = p."id"
        AND (f."organizationId" IS NULL OR f."organizationId" = '')
    `;
  }

  private resolvedCaseFields(orgId: string, projectId: string) {
    return prisma.caseField.findMany({
      where: {
        organizationId: orgId,
        OR: [{ projectId: null }, { projectId }],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async listCaseFields(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    await this.backfillCaseFieldOrgs();
    return this.resolvedCaseFields(orgId, projectId);
  }

  async listOrgCaseFields(userId: string, orgId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);
    await this.backfillCaseFieldOrgs();
    return prisma.caseField.findMany({
      where: { organizationId: orgId },
      include: { project: { select: { id: true, name: true } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async assertFieldProject(orgId: string, projectId: string | null) {
    if (!projectId) return null;
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new BadRequestException('Project not found in this organization');
    return project.id;
  }

  async createOrgCaseField(userId: string, orgId: string, body: unknown) {
    await this.orgs.requireMembership(userId, orgId, Role.MEMBER);
    const input = parseBody(caseFieldWriteSchema, body);
    const projectId = await this.assertFieldProject(
      orgId,
      input.projectId === undefined ? null : input.projectId,
    );
    const key = (input.key?.trim() || slugFieldKey(input.label)).toLowerCase();
    const existing = await prisma.caseField.findFirst({
      where: { organizationId: orgId, key },
    });
    if (existing) throw new BadRequestException('A field with this key exists');
    const count = await prisma.caseField.count({ where: { organizationId: orgId } });
    return prisma.caseField.create({
      data: {
        organizationId: orgId,
        projectId,
        key,
        label: input.label.trim(),
        type: input.type ?? 'TEXT',
        options: (input.options ?? null) as never,
        required: input.required ?? false,
        sortOrder: input.sortOrder ?? count,
      },
      include: { project: { select: { id: true, name: true } } },
    });
  }

  async updateOrgCaseField(
    userId: string,
    orgId: string,
    fieldId: string,
    body: unknown,
  ) {
    await this.orgs.requireMembership(userId, orgId, Role.MEMBER);
    const existing = await prisma.caseField.findFirst({
      where: { id: fieldId, organizationId: orgId },
    });
    if (!existing) throw new NotFoundException('Field not found');
    const input = parseBody(caseFieldWriteSchema, body);
    const key = input.key?.trim()
      ? input.key.trim().toLowerCase()
      : existing.key;
    if (key !== existing.key) {
      const clash = await prisma.caseField.findFirst({
        where: { organizationId: orgId, key },
      });
      if (clash) throw new BadRequestException('A field with this key exists');
    }
    const projectId =
      input.projectId === undefined
        ? existing.projectId
        : await this.assertFieldProject(orgId, input.projectId);
    return prisma.caseField.update({
      where: { id: fieldId },
      data: {
        key,
        label: input.label.trim(),
        projectId,
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.options !== undefined
          ? { options: input.options as never }
          : {}),
        ...(input.required !== undefined ? { required: input.required } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
      include: { project: { select: { id: true, name: true } } },
    });
  }

  async deleteOrgCaseField(userId: string, orgId: string, fieldId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.MEMBER);
    const existing = await prisma.caseField.findFirst({
      where: { id: fieldId, organizationId: orgId },
    });
    if (!existing) throw new NotFoundException('Field not found');
    await prisma.caseField.delete({ where: { id: fieldId } });
    return { ok: true, id: fieldId };
  }

  async listCaseTemplates(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    return prisma.caseTemplate.findMany({
      where: { projectId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async createCaseTemplate(
    userId: string,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const input = parseBody(caseTemplateWriteSchema, body);
    if (input.isDefault) {
      await prisma.caseTemplate.updateMany({
        where: { projectId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return prisma.caseTemplate.create({
      data: {
        projectId,
        name: input.name.trim(),
        isDefault: input.isDefault ?? false,
        fieldKeys: (input.fieldKeys ?? []) as never,
        defaults: (input.defaults ?? null) as never,
      },
    });
  }

  async updateCaseTemplate(
    userId: string,
    orgId: string,
    projectId: string,
    templateId: string,
    body: unknown,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const existing = await prisma.caseTemplate.findFirst({
      where: { id: templateId, projectId },
    });
    if (!existing) throw new NotFoundException('Template not found');
    const input = parseBody(caseTemplateWriteSchema, body);
    if (input.isDefault) {
      await prisma.caseTemplate.updateMany({
        where: { projectId, isDefault: true, NOT: { id: templateId } },
        data: { isDefault: false },
      });
    }
    return prisma.caseTemplate.update({
      where: { id: templateId },
      data: {
        name: input.name.trim(),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.fieldKeys !== undefined
          ? { fieldKeys: input.fieldKeys as never }
          : {}),
        ...(input.defaults !== undefined
          ? { defaults: input.defaults as never }
          : {}),
      },
    });
  }

  async deleteCaseTemplate(
    userId: string,
    orgId: string,
    projectId: string,
    templateId: string,
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const existing = await prisma.caseTemplate.findFirst({
      where: { id: templateId, projectId },
    });
    if (!existing) throw new NotFoundException('Template not found');
    await prisma.caseTemplate.delete({ where: { id: templateId } });
    return { ok: true, id: templateId };
  }
}

function coerceGenerateBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return {};
  const raw = { ...(body as Record<string, unknown>) };
  if (raw.folderId === '') raw.folderId = null;
  if (typeof raw.includeProjectRequirements === 'string') {
    raw.includeProjectRequirements =
      raw.includeProjectRequirements === '1' ||
      raw.includeProjectRequirements === 'true';
  }
  if (typeof raw.reviewApplication === 'string') {
    raw.reviewApplication =
      raw.reviewApplication === '1' || raw.reviewApplication === 'true';
  }
  if (typeof raw.techniques === 'string') {
    try {
      raw.techniques = JSON.parse(raw.techniques);
    } catch {
      raw.techniques = String(raw.techniques)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return raw;
}

function coerceImportBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return {};
  const raw = { ...(body as Record<string, unknown>) };
  if (raw.folderId === '') raw.folderId = null;
  if (typeof raw.updateExisting === 'string') {
    raw.updateExisting =
      raw.updateExisting === '1' || raw.updateExisting === 'true';
  }
  if (raw.templateId === '') raw.templateId = null;
  return raw;
}

function slugFieldKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  return slug || 'field';
}

function parseImportBuffer(file: Express.Multer.File): {
  rows: ImportedCaseRow[];
  errors: Array<{ line: number; message: string }>;
} {
  const name = file.originalname.toLowerCase();
  const text = file.buffer.toString('utf8');
  if (name.endsWith('.json') || file.mimetype.includes('json')) {
    try {
      return rowsFromJson(JSON.parse(text));
    } catch {
      return {
        rows: [],
        errors: [{ line: 1, message: 'Invalid JSON' }],
      };
    }
  }
  if (
    name.endsWith('.xls') ||
    name.endsWith('.xlsx') ||
    text.includes('<Workbook') ||
    text.includes('ss:Workbook')
  ) {
    if (file.buffer[0] === 0x50 && file.buffer[1] === 0x4b) {
      return {
        rows: [],
        errors: [
          {
            line: 1,
            message: 'Use CSV or the XLS export from this app (not xlsx zip)',
          },
        ],
      };
    }
    return rowsFromSpreadsheetMl(text);
  }
  return rowsFromCsv(text);
}

function resolveImportFolder(
  folders: Array<{ id: string; name: string; parentId: string | null }>,
  path: string | undefined,
  fallback: string | null | undefined,
): string | null | undefined {
  if (!path?.trim()) return fallback ?? undefined;
  const parts = path.split('/').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return fallback ?? undefined;
  if (parts.length === 1) {
    const hit = folders.find(
      (f) => f.name.toLowerCase() === parts[0]!.toLowerCase(),
    );
    return hit?.id ?? fallback ?? undefined;
  }
  const parent = folders.find(
    (f) =>
      !f.parentId && f.name.toLowerCase() === parts[0]!.toLowerCase(),
  );
  const child = folders.find(
    (f) =>
      f.parentId === parent?.id &&
      f.name.toLowerCase() === parts[1]!.toLowerCase(),
  );
  return child?.id ?? parent?.id ?? fallback ?? undefined;
}
