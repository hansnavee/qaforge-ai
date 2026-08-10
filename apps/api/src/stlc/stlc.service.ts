import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '@qaforge/database';
import { R2ArtifactStore } from '@qaforge/agent-sdk';
import {
  ArtifactType,
  ExecutionStatus,
  getStlcPhase,
  listPhaseSummaries,
  markPhaseAccepted,
  phaseDocumentToHtml,
  phaseDocumentToMarkdown,
  STLC_PHASES,
  upsertPhaseDoc,
  buildPhaseDocState,
  type StlcPhaseDocsMap,
  type StlcPhaseId,
  Role,
} from '@qaforge/shared';
import type { SessionUser } from '../auth/auth';
import { OrgsService } from '../orgs/orgs.service';
import { ExecutionsService } from '../executions/executions.service';
import { RequirementReviewService } from '../projects/requirement-review.service';
import { QueueService } from '../queue/queue.service';
import type { Response } from 'express';

type PhaseId = Exclude<StlcPhaseId, 'DONE'>;

const AWAIT_TO_PHASE: Record<string, PhaseId> = {
  AWAITING_PLAN_APPROVAL: 'PLANNING',
  AWAITING_DESIGN_APPROVAL: 'DESIGN',
  AWAITING_ENV_APPROVAL: 'ENVIRONMENT',
  AWAITING_DATA_APPROVAL: 'DATA',
  AWAITING_EXECUTION_APPROVAL: 'EXECUTION',
  AWAITING_DEFECT_APPROVAL: 'DEFECTS',
  AWAITING_AUTOMATION_APPROVAL: 'AUTOMATION',
  AWAITING_REPORT_APPROVAL: 'REPORTING',
  AWAITING_QA_SIGNOFF: 'SIGNOFF',
};

const EXEC_PHASE_TO_STLC: Record<string, PhaseId> = {
  INIT: 'PLANNING',
  REQUIREMENTS: 'REQUIREMENTS',
  CLARIFICATION: 'REQUIREMENTS',
  TEST_STRATEGY: 'PLANNING',
  TEST_DESIGN: 'DESIGN',
  ENVIRONMENT: 'ENVIRONMENT',
  TEST_DATA: 'DATA',
  AUTHENTICATION: 'EXECUTION',
  DISCOVERY: 'EXECUTION',
  FUNCTIONAL: 'EXECUTION',
  API: 'EXECUTION',
  MANUAL_TEST: 'EXECUTION',
  EXECUTION: 'EXECUTION',
  RETEST: 'DEFECTS',
  BUGS: 'DEFECTS',
  BUG_ANALYSIS: 'DEFECTS',
  AUTOMATION: 'AUTOMATION',
  REPORT: 'REPORTING',
  REPORTING: 'REPORTING',
  QUALITY_ANALYSIS: 'REPORTING',
  GITHUB: 'REPORTING',
  QA_SIGNOFF: 'SIGNOFF',
  SIGNOFF: 'SIGNOFF',
};

@Injectable()
export class StlcService {
  constructor(
    private readonly orgs: OrgsService,
    private readonly executions: ExecutionsService,
    private readonly review: RequirementReviewService,
    private readonly queue: QueueService,
  ) {}

  private async loadProject(userId: string, orgId: string, projectId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.MEMBER);
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private async latestExecution(projectId: string) {
    const rows = await prisma.execution.findMany({
      where: {
        projectId,
        runMode: { in: ['STLC', 'PHASE1', 'FULL'] },
        status: { notIn: ['CANCELLED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    if (!rows.length) return null;

    const rank = (status: string) => {
      if (status.startsWith('AWAITING_')) return 5;
      if (status === 'RUNNING') return 4;
      if (status === 'QUEUED' || status === 'PENDING') return 2;
      if (status === 'COMPLETED') return 1;
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

  private resolveActivePhaseId(latest: {
    status: string;
    phase: string;
  } | null): PhaseId | null {
    if (!latest) return null;
    const fromAwait = AWAIT_TO_PHASE[latest.status];
    if (fromAwait) return fromAwait;
    if (
      latest.status === 'RUNNING' ||
      latest.status === 'QUEUED' ||
      latest.status === 'PENDING'
    ) {
      return EXEC_PHASE_TO_STLC[latest.phase] ?? 'PLANNING';
    }
    return null;
  }

  private reconcilePhaseStatus(opts: {
    phaseId: string;
    phaseIndex: number;
    baseStatus: string;
    latestStatus?: string | null;
    latestPhase?: string | null;
    requirementsApproved: boolean;
  }): string {
    const activeId = this.resolveActivePhaseId(
      opts.latestStatus
        ? { status: opts.latestStatus, phase: opts.latestPhase ?? 'INIT' }
        : null,
    );
    const activeIdx = activeId
      ? (getStlcPhase(activeId)?.index ?? 0)
      : 0;
    const awaiting = Boolean(
      opts.latestStatus && AWAIT_TO_PHASE[opts.latestStatus],
    );

    if (opts.phaseId === 'REQUIREMENTS') {
      return opts.requirementsApproved || opts.baseStatus === 'ACCEPTED'
        ? 'ACCEPTED'
        : opts.baseStatus;
    }

    // Execution gate / running phase is the source of truth for the open step.
    if (activeId) {
      if (opts.phaseId === activeId) {
        return awaiting ? 'READY_FOR_REVIEW' : 'RUNNING';
      }
      if (opts.phaseIndex < activeIdx) return 'ACCEPTED';
      if (opts.phaseIndex > activeIdx) return 'LOCKED';
    }

    return opts.baseStatus;
  }

  async listPhases(user: SessionUser, orgId: string, projectId: string) {
    const project = await this.loadProject(user.id, orgId, projectId);
    const docs = (project.stlcPhaseDocs ?? {}) as StlcPhaseDocsMap;
    const latest = await this.latestExecution(projectId);
    const requirementsApproved = Boolean(project.requirementsApprovedAt);
    let activePhaseId = this.resolveActivePhaseId(latest);
    // Requirements approved but STLC not started yet → keep Planning current.
    if (
      !activePhaseId &&
      requirementsApproved &&
      (project.stlcStage === 'PLANNING' || project.stlcStage === 'REQUIREMENTS')
    ) {
      activePhaseId = 'PLANNING';
    }

    const phases = listPhaseSummaries(
      project.stlcStage,
      docs,
      requirementsApproved,
    ).map((p) => {
      const def = getStlcPhase(p.id);
      let status = this.reconcilePhaseStatus({
        phaseId: p.id,
        phaseIndex: p.index,
        baseStatus: p.status,
        latestStatus: latest?.status,
        latestPhase: latest?.phase,
        requirementsApproved,
      });
      // Stage pointer alone is not an AI run — avoid fake "RUNNING".
      if (!latest && status === 'RUNNING') {
        status = p.id === 'PLANNING' && requirementsApproved
          ? 'READY_FOR_REVIEW'
          : 'LOCKED';
      }
      return {
        ...p,
        status,
        description: def?.description,
        downloads: def?.downloads ?? [],
        approveAction: def?.approveAction,
        awaitStatus: def?.awaitStatus,
      };
    });

    return {
      stlcStage: project.stlcStage,
      currentCycle: project.currentCycle ?? 1,
      latestExecutionId: latest?.id ?? null,
      latestExecutionStatus: latest?.status ?? null,
      latestCycleNumber: latest?.cycleNumber ?? null,
      currentPhaseId: activePhaseId,
      phases,
      canStartNextCycle: Boolean(
        project.testDataApprovedAt &&
          project.testDesignApprovedAt &&
          (project.qaSignedOffAt ||
            latest?.status === ExecutionStatus.COMPLETED ||
            project.stlcStage === 'DONE'),
      ),
    };
  }

  async getPhase(
    user: SessionUser,
    orgId: string,
    projectId: string,
    phaseId: string,
  ) {
    const project = await this.loadProject(user.id, orgId, projectId);
    const def = getStlcPhase(phaseId);
    if (!def) throw new NotFoundException(`Unknown phase ${phaseId}`);

    const docs = (project.stlcPhaseDocs ?? {}) as StlcPhaseDocsMap;
    const stored = docs[def.id];
    const latest = await this.latestExecution(projectId);
    const summaries = listPhaseSummaries(
      project.stlcStage,
      docs,
      Boolean(project.requirementsApprovedAt),
    );
    const summary = summaries.find((s) => s.id === def.id)!;
    let status = this.reconcilePhaseStatus({
      phaseId: def.id,
      phaseIndex: def.index,
      baseStatus: summary.status,
      latestStatus: latest?.status,
      latestPhase: latest?.phase,
      requirementsApproved: Boolean(project.requirementsApprovedAt),
    });
    if (!latest && status === 'RUNNING') {
      status =
        def.id === 'PLANNING' && project.requirementsApprovedAt
          ? 'READY_FOR_REVIEW'
          : 'LOCKED';
    }

    const isActiveGate = Boolean(
      latest && AWAIT_TO_PHASE[latest.status] === def.id,
    );
    const canEdit = status === 'READY_FOR_REVIEW' && isActiveGate;
    // Designed cases stay editable after Accept (Test Board CRUD).
    const canManageCases =
      def.id === 'DESIGN' &&
      (status === 'READY_FOR_REVIEW' ||
        status === 'ACCEPTED' ||
        Boolean(stored?.document && Array.isArray((stored.document as { testCases?: unknown }).testCases)));
    const canAccept =
      def.id === 'REQUIREMENTS'
        ? !project.requirementsApprovedAt && status === 'READY_FOR_REVIEW'
        : isActiveGate;

    return {
      phaseId: def.id,
      label: def.label,
      agentName: def.agentName,
      description: def.description,
      status,
      validation: stored?.validation ?? null,
      document: stored?.document ?? {},
      documentVersion: stored?.documentVersion ?? 0,
      editedByHuman: stored?.editedByHuman ?? false,
      updatedAt: stored?.updatedAt ?? null,
      permissions: {
        canEdit,
        canSave: canEdit,
        canAccept,
        canManageCases,
        canReopen: status === 'ACCEPTED' && project.stlcStage === def.nextStage,
      },
      downloads: def.downloads.map((format) => ({
        format,
        url: `/api/v1/orgs/${orgId}/projects/${projectId}/stlc/phases/${def.id}/download?format=${format}`,
      })),
      approval: {
        required: true,
        approvedAt: stored?.approvedAt ?? null,
        canAccept,
      },
      latestExecutionId: latest?.id ?? null,
      latestExecutionStatus: latest?.status ?? null,
    };
  }

  async patchDocument(
    user: SessionUser,
    orgId: string,
    projectId: string,
    phaseId: string,
    body: { document?: Record<string, unknown>; documentVersion?: number },
  ) {
    const project = await this.loadProject(user.id, orgId, projectId);
    const def = getStlcPhase(phaseId);
    if (!def) throw new NotFoundException(`Unknown phase ${phaseId}`);

    const current = await this.getPhase(user, orgId, projectId, phaseId);
    if (!current.permissions.canEdit) {
      throw new ForbiddenException('Phase document is not editable');
    }
    if (
      typeof body.documentVersion === 'number' &&
      current.documentVersion > 0 &&
      body.documentVersion !== current.documentVersion
    ) {
      throw new BadRequestException(
        `Stale documentVersion (client=${body.documentVersion}, server=${current.documentVersion})`,
      );
    }
    if (!body.document || typeof body.document !== 'object') {
      throw new BadRequestException('document object required');
    }

    const docs = (project.stlcPhaseDocs ?? {}) as StlcPhaseDocsMap;
    const previous = docs[def.id] ?? null;
    const state = buildPhaseDocState({
      phaseId: def.id,
      status: 'READY_FOR_REVIEW',
      document: body.document,
      validation: previous?.validation ?? current.validation,
      previous,
      editedByHuman: true,
    });
    const next = upsertPhaseDoc(docs, state);
    await prisma.project.update({
      where: { id: projectId },
      data: { stlcPhaseDocs: next as never },
    });

    return this.getPhase(user, orgId, projectId, phaseId);
  }

  async acceptPhase(
    user: SessionUser,
    orgId: string,
    projectId: string,
    phaseId: string,
  ) {
    const def = getStlcPhase(phaseId);
    if (!def) throw new NotFoundException(`Unknown phase ${phaseId}`);

    const project = await this.loadProject(user.id, orgId, projectId);
    const docs = markPhaseAccepted(
      (project.stlcPhaseDocs ?? {}) as StlcPhaseDocsMap,
      def.id,
    );
    await prisma.project.update({
      where: { id: projectId },
      data: { stlcPhaseDocs: docs as never },
    });

    if (def.id === 'REQUIREMENTS') {
      return this.review.approveRequirements(user, orgId, projectId);
    }

    const latest = await this.latestExecution(projectId);
    if (!latest) {
      throw new BadRequestException('No execution to accept against');
    }

    switch (def.id) {
      case 'PLANNING':
        return this.executions.approveTestPlan(user, orgId, latest.id);
      case 'DESIGN':
        return this.executions.approveTestDesign(user, orgId, latest.id);
      case 'ENVIRONMENT':
        return this.executions.approveEnvironment(user, orgId, latest.id);
      case 'DATA':
        return this.executions.approveTestData(user, orgId, latest.id);
      case 'EXECUTION':
        return this.executions.approveTestExecution(user, orgId, latest.id);
      case 'DEFECTS':
        return this.executions.approveDefects(user, orgId, latest.id);
      case 'AUTOMATION':
        return this.executions.approveAutomation(user, orgId, latest.id);
      case 'REPORTING':
        return this.executions.approveReport(user, orgId, latest.id);
      case 'SIGNOFF':
        return this.executions.approveQaSignoff(user, orgId, latest.id);
      default:
        throw new BadRequestException(`Cannot accept phase ${phaseId}`);
    }
  }

  async downloadPhase(
    user: SessionUser,
    orgId: string,
    projectId: string,
    phaseId: string,
    format: string,
    res: Response,
  ) {
    const phase = await this.getPhase(user, orgId, projectId, phaseId);
    const def = getStlcPhase(phaseId)!;
    const fmt = (format || 'json').toLowerCase();
    if (!def.downloads.includes(fmt as never) && fmt !== 'json') {
      throw new BadRequestException(
        `Format ${fmt} not supported for ${phaseId}`,
      );
    }

    const base = `stlc-${phaseId.toLowerCase()}`;
    if (fmt === 'md') {
      const body = phaseDocumentToMarkdown(
        phaseId,
        phase.document,
        phase.validation,
      );
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${base}.md"`,
      );
      res.send(body);
      return;
    }
    if (fmt === 'html') {
      if (phaseId === 'REPORTING' || phaseId === 'SIGNOFF') {
        const project = await this.loadProject(user.id, orgId, projectId);
        const latest = await this.latestExecution(project.id);
        if (latest) {
          const reportHtml = await prisma.artifact.findFirst({
            where: {
              executionId: latest.id,
              type: ArtifactType.REPORT_HTML,
            },
            orderBy: { createdAt: 'desc' },
          });
          if (reportHtml) {
            let buf: Buffer | null = null;
            try {
              const store = new R2ArtifactStore({
                fallbackRootDir: `${process.cwd()}/.artifacts`,
              });
              buf = await store.get(reportHtml.storageKey);
            } catch {
              /* try durable DB blob */
            }
            if (!buf) {
              const blob = await prisma.artifactBlob.findUnique({
                where: { storageKey: reportHtml.storageKey },
              });
              if (blob) buf = Buffer.from(blob.body);
            }
            if (buf) {
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.setHeader(
                'Content-Disposition',
                `attachment; filename="${base}-executive.html"`,
              );
              res.send(buf);
              return;
            }
          }
        }
      }
      const body = phaseDocumentToHtml(
        phaseId,
        phase.document,
        phase.validation,
      );
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${base}.html"`,
      );
      res.send(body);
      return;
    }
    if (fmt === 'csv') {
      const rows = flattenForCsv(phase.document);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${base}.csv"`,
      );
      res.send(rows);
      return;
    }

    if (fmt === 'zip' || fmt === 'junit') {
      const project = await this.loadProject(user.id, orgId, projectId);
      const latest = await this.latestExecution(project.id);
      if (!latest) {
        throw new NotFoundException('No execution found for this project');
      }
      const types =
        fmt === 'junit'
          ? [ArtifactType.REPORT_JUNIT]
          : [
              ArtifactType.STLC_FINAL_ZIP,
              ArtifactType.ZIP_PACKAGE,
            ];
      const artifact = await prisma.artifact.findFirst({
        where: { executionId: latest.id, type: { in: types } },
        orderBy: { createdAt: 'desc' },
      });
      const store = new R2ArtifactStore({
        fallbackRootDir: `${process.cwd()}/.artifacts`,
      });
      let buf: Buffer | null = null;
      if (artifact) {
        try {
          buf = await store.get(artifact.storageKey);
        } catch {
          buf = null;
        }
      }

      if (!buf && fmt === 'junit') {
        const { renderJunitXml } = await import('@qaforge/report-engine');
        const results = await prisma.testResult.findMany({
          where: { executionId: latest.id },
          include: { testCase: true },
        });
        const scores =
          latest.scores && typeof latest.scores === 'object'
            ? (latest.scores as Record<string, number>)
            : {};
        buf = Buffer.from(
          renderJunitXml({
            executionId: latest.id,
            projectName: project.name,
            appUrl: project.appUrl ?? '',
            status: latest.status,
            scores: {},
            summary: {
              passed:
                scores.passed ??
                results.filter((r) => r.status === 'PASSED').length,
              failed:
                scores.failed ??
                results.filter((r) => r.status === 'FAILED').length,
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
          }),
          'utf8',
        );
      }

      if (!buf && fmt === 'zip') {
        const { buildZipPackage, rowsToCsv } = await import(
          '@qaforge/report-engine'
        );
        const [cases, bugs, results] = await Promise.all([
          prisma.testCase.findMany({ where: { executionId: latest.id } }),
          prisma.bug.findMany({ where: { executionId: latest.id } }),
          prisma.testResult.findMany({
            where: { executionId: latest.id },
            include: { testCase: true },
          }),
        ]);
        buf = await buildZipPackage({
          files: {
            'test-cases.csv': rowsToCsv(
              ['id', 'module', 'scenario', 'expected', 'priority', 'type'],
              cases.map((c) => ({
                id: c.externalId,
                module: c.module,
                scenario: c.scenario,
                expected: c.expected,
                priority: c.priority,
                type: c.type,
              })),
            ),
            'bugs.csv': rowsToCsv(
              ['id', 'title', 'severity', 'status'],
              bugs.map((b) => ({
                id: b.id,
                title: b.title,
                severity: b.severity,
                status: b.status,
              })),
            ),
            'results.csv': rowsToCsv(
              ['id', 'testCase', 'status', 'message'],
              results.map((r) => ({
                id: r.id,
                testCase: r.testCase?.externalId ?? '',
                status: r.status,
                message: r.message,
              })),
            ),
            'manifest.json': JSON.stringify(
              {
                executionId: latest.id,
                phaseId,
                rebuiltOnDownload: true,
                generatedAt: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        });
      }

      if (!buf) {
        throw new NotFoundException(
          `${fmt.toUpperCase()} artifact not ready for ${phaseId}`,
        );
      }
      const ext = fmt === 'junit' ? 'xml' : 'zip';
      res.setHeader(
        'Content-Type',
        fmt === 'junit' ? 'application/xml' : 'application/zip',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${base}.${ext}"`,
      );
      res.send(buf);
      return;
    }

    const body = JSON.stringify(
      {
        phaseId,
        agentName: phase.agentName,
        validation: phase.validation,
        document: phase.document,
        documentVersion: phase.documentVersion,
        editedByHuman: phase.editedByHuman,
      },
      null,
      2,
    );
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${base}.json"`,
    );
    res.send(body);
  }

  catalog() {
    return { phases: STLC_PHASES };
  }

  /**
   * Start Cycle N+1 after sign-off: reuse Design/Env/Data approvals,
   * re-run from Authentication → Execution → Sign-off.
   */
  async startNextCycle(user: SessionUser, orgId: string, projectId: string) {
    const project = await this.loadProject(user.id, orgId, projectId);

    if (!project.testDataApprovedAt || !project.testDesignApprovedAt) {
      throw new BadRequestException(
        'Complete Design through Test Data (and prefer Sign-off) before starting the next cycle',
      );
    }

    const active = await prisma.execution.findFirst({
      where: {
        projectId,
        runMode: { in: ['STLC', 'PHASE1'] },
        status: {
          in: [
            ExecutionStatus.QUEUED,
            ExecutionStatus.PENDING,
            ExecutionStatus.RUNNING,
            ExecutionStatus.AWAITING_LOGIN,
            ExecutionStatus.AWAITING_CLARIFICATION,
            ExecutionStatus.AWAITING_DESIGN_APPROVAL,
            ExecutionStatus.AWAITING_ENV_APPROVAL,
            ExecutionStatus.AWAITING_DATA_APPROVAL,
            ExecutionStatus.AWAITING_EXECUTION_APPROVAL,
            ExecutionStatus.AWAITING_DEFECT_APPROVAL,
            ExecutionStatus.AWAITING_AUTOMATION_APPROVAL,
            ExecutionStatus.AWAITING_REPORT_APPROVAL,
            ExecutionStatus.AWAITING_QA_SIGNOFF,
            ExecutionStatus.AWAITING_PLAN_APPROVAL,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (active) {
      throw new BadRequestException(
        `Cannot start next cycle while execution ${active.id} is still active (${active.status})`,
      );
    }

    const parent = await prisma.execution.findFirst({
      where: { projectId, runMode: { in: ['STLC', 'PHASE1'] } },
      orderBy: [{ cycleNumber: 'desc' }, { createdAt: 'desc' }],
    });
    if (!parent) {
      throw new BadRequestException('No prior STLC execution to cycle from');
    }

    const nextCycle = Math.max(project.currentCycle ?? 1, parent.cycleNumber ?? 1) + 1;

    const docs = {
      ...((project.stlcPhaseDocs ?? {}) as StlcPhaseDocsMap),
    };
    for (const pid of [
      'EXECUTION',
      'DEFECTS',
      'AUTOMATION',
      'REPORTING',
      'SIGNOFF',
    ] as PhaseId[]) {
      delete docs[pid];
    }

    const execution = await prisma.execution.create({
      data: {
        projectId,
        status: ExecutionStatus.QUEUED,
        phase: 'AUTHENTICATION',
        runMode: 'STLC',
        cycleNumber: nextCycle,
        parentExecutionId: parent.id,
        startedAt: new Date(),
      },
    });

    const priorCases = await prisma.testCase.findMany({
      where: { executionId: parent.id },
      orderBy: { createdAt: 'asc' },
    });
    for (const tc of priorCases) {
      await prisma.testCase.create({
        data: {
          projectId,
          executionId: execution.id,
          externalId: tc.externalId,
          module: tc.module,
          scenario: tc.scenario,
          preconditions: tc.preconditions,
          steps: tc.steps as never,
          expected: tc.expected,
          priority: tc.priority,
          severity: tc.severity,
          type: tc.type,
          testData: tc.testData as never,
        },
      });
    }

    // Copy grounded planning artifacts so agents can still read JSON by type
    const copyTypes = [
      ArtifactType.REQUIREMENTS_JSON,
      ArtifactType.TEST_STRATEGY_JSON,
      ArtifactType.TEST_DESIGN_JSON,
      ArtifactType.TEST_DATA_JSON,
      ArtifactType.ENVIRONMENT_JSON,
      ArtifactType.TEST_CASES_JSON,
      ArtifactType.CLARIFICATION_ANSWERS,
    ];
    const store = new R2ArtifactStore({
      fallbackRootDir: `${process.cwd()}/.artifacts`,
    });
    for (const type of copyTypes) {
      const art = await prisma.artifact.findFirst({
        where: { executionId: parent.id, type },
        orderBy: { createdAt: 'desc' },
      });
      if (!art) continue;
      try {
        const body = await store.get(art.storageKey);
        const key = `${execution.id}/${type.toLowerCase().replace(/_/g, '-')}.json`;
        const stored = await store.put(key, body, art.mime || 'application/json');
        await prisma.artifact.create({
          data: {
            executionId: execution.id,
            type,
            storageKey: stored.key,
            mime: art.mime,
            size: stored.size,
            checksum: art.checksum,
          },
        });
      } catch {
        /* skip missing blobs */
      }
    }

    await prisma.project.update({
      where: { id: projectId },
      data: {
        currentCycle: nextCycle,
        stlcStage: 'EXECUTION',
        stlcPhaseDocs: docs as never,
        // Keep planning/design/env/data approvals; clear post-data gates
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
      jobId: `stlc-cycle-${nextCycle}-${execution.id}`,
      runMode: 'STLC',
    });

    await this.queue.publishExecutionEvent(execution.id, {
      executionId: execution.id,
      type: 'stlc.cycle_started',
      phase: 'AUTHENTICATION',
      message: `Cycle ${nextCycle} queued — reusing Design/Env/Data; re-running Execution → Sign-off`,
      timestamp: new Date().toISOString(),
      data: { cycleNumber: nextCycle, parentExecutionId: parent.id },
    });

    return {
      execution,
      cycleNumber: nextCycle,
      parentExecutionId: parent.id,
      reusedApprovals: ['PLANNING', 'DESIGN', 'ENVIRONMENT', 'DATA'] as const,
    };
  }
}

function flattenForCsv(doc: Record<string, unknown>): string {
  const cases = Array.isArray(doc.testCases)
    ? doc.testCases
    : Array.isArray(doc.cases)
      ? doc.cases
      : Array.isArray(doc.bugs)
        ? doc.bugs
        : Array.isArray(doc.checklist)
          ? doc.checklist
          : Array.isArray(doc.scorecard)
            ? doc.scorecard
            : null;
  if (!cases?.length) {
    return `key,value\n${Object.entries(doc)
      .map(
        ([k, v]) =>
          `"${k}","${String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/"/g, '""')}"`,
      )
      .join('\n')}`;
  }
  const keys = Array.from(
    new Set(cases.flatMap((row) => Object.keys(row as object))),
  );
  const header = keys.join(',');
  const lines = cases.map((row) =>
    keys
      .map((k) => {
        const v = (row as Record<string, unknown>)[k];
        const s =
          v == null
            ? ''
            : typeof v === 'object'
              ? JSON.stringify(v)
              : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      })
      .join(','),
  );
  return [header, ...lines].join('\n');
}
