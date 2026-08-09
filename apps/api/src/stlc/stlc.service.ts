import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '@qaforge/database';
import {
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

@Injectable()
export class StlcService {
  constructor(
    private readonly orgs: OrgsService,
    private readonly executions: ExecutionsService,
    private readonly review: RequirementReviewService,
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
    return prisma.execution.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPhases(user: SessionUser, orgId: string, projectId: string) {
    const project = await this.loadProject(user.id, orgId, projectId);
    const docs = (project.stlcPhaseDocs ?? {}) as StlcPhaseDocsMap;
    const latest = await this.latestExecution(projectId);
    const phases = listPhaseSummaries(
      project.stlcStage,
      docs,
      Boolean(project.requirementsApprovedAt),
    ).map((p) => {
      const def = getStlcPhase(p.id);
      let status = p.status;
      if (
        latest &&
        AWAIT_TO_PHASE[latest.status] === p.id &&
        status !== 'ACCEPTED'
      ) {
        status = 'READY_FOR_REVIEW';
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
      latestExecutionId: latest?.id ?? null,
      latestExecutionStatus: latest?.status ?? null,
      phases,
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
    let status = summary.status;
    if (
      latest &&
      AWAIT_TO_PHASE[latest.status] === def.id &&
      status !== 'ACCEPTED'
    ) {
      status = 'READY_FOR_REVIEW';
    }

    const canEdit = status === 'READY_FOR_REVIEW';
    const canAccept =
      canEdit &&
      (def.id === 'REQUIREMENTS'
        ? !project.requirementsApprovedAt
        : Boolean(latest && AWAIT_TO_PHASE[latest.status] === def.id));

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
