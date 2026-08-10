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
  buildPhaseDocState,
  clarifyExecutionSchema,
  evaluateRequirementsReadiness,
  markPhaseAccepted,
  upsertPhaseDoc,
  type StlcPhaseDocsMap,
} from '@qaforge/shared';
import {
  buildZipPackage,
  renderHtmlReport,
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

const testCaseWriteSchema = z.object({
  externalId: z.string().min(1).max(64).optional(),
  module: z.string().max(200).nullable().optional(),
  scenario: z.string().min(1).max(2000).optional(),
  preconditions: z.string().max(8000).nullable().optional(),
  steps: z.array(z.string().max(2000)).max(100).optional(),
  expected: z.string().min(1).max(8000).optional(),
  priority: z.string().max(40).nullable().optional(),
  severity: z.string().max(40).nullable().optional(),
  type: z.string().max(80).nullable().optional(),
  testData: z.record(z.string(), z.string()).nullable().optional(),
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
            const body = await store.get(art.storageKey);
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

  async listTestCases(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    const cases = await prisma.testCase.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    // Keep DESIGN phase doc aligned with persisted cases (browse/edit after Accept).
    if (cases.length) {
      void this.syncDesignDocFromCases(projectId).catch(() => undefined);
    }
    return cases;
  }

  private async syncDesignDocFromCases(projectId: string) {
    const [project, cases] = await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
        select: { stlcPhaseDocs: true },
      }),
      prisma.testCase.findMany({
        where: { projectId },
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
        summary: `${cases.length} case(s) — human edited`,
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
    const created = await prisma.testCase.create({
      data: {
        projectId,
        externalId,
        module: input.module ?? 'General',
        scenario: input.scenario.trim(),
        preconditions: input.preconditions ?? '',
        steps: (input.steps ?? ['Perform the scenario steps']) as never,
        expected: input.expected.trim(),
        priority: input.priority ?? 'P1',
        severity: input.severity ?? 'medium',
        type: input.type ?? 'functional',
        testData: (input.testData ?? null) as never,
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
    const updated = await prisma.testCase.update({
      where: { id: testCaseId },
      data: {
        ...(input.externalId !== undefined
          ? { externalId: input.externalId }
          : {}),
        ...(input.module !== undefined ? { module: input.module } : {}),
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
        ...(input.testData !== undefined
          ? { testData: input.testData as never }
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
  ) {
    await this.requireProject(userId, orgId, projectId, Role.MEMBER);
    const existing = await prisma.testCase.findFirst({
      where: { id: testCaseId, projectId },
    });
    if (!existing) throw new NotFoundException('Test case not found');
    await prisma.testCase.delete({ where: { id: testCaseId } });
    await this.syncDesignDocFromCases(projectId);
    return { ok: true, id: testCaseId };
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
    const execution = await prisma.execution.findFirst({
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
        /* keep defaults */
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
    const files = Array.isArray(manifest.files)
      ? (manifest.files as string[])
      : filesFromStore;

    if (!files.length && !manifestArt) return null;

    return {
      executionId: execution.id,
      framework: (manifest.framework as string) ?? 'playwright',
      language: (manifest.language as string) ?? 'typescript',
      baseUrl: (manifest.baseUrl as string) ?? undefined,
      files,
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
      htmlUrl: `/api/v1/orgs/${orgId}/executions/${executionId}/artifacts/by-type/${ArtifactType.REPORT_HTML}`,
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
}
