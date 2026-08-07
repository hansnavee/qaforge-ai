import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { prisma } from '@qaforge/database';
import {
  ExecutionStatus,
  Role,
  clarifyExecutionSchema,
} from '@qaforge/shared';
import {
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

const updateRequirementsSchema = z.object({
  requirementText: z.string().min(1),
});

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
        runMode: 'PHASE1',
        startedAt: new Date(),
      },
    });

    await this.queue.enqueueRunExecution(execution.id, {
      jobId: `phase1-${execution.id}`,
      runMode: 'PHASE1',
    });

    await this.queue.publishExecutionEvent(execution.id, {
      executionId: execution.id,
      type: 'phase1.queued',
      phase: 'INIT',
      message: 'Phase 1 QA run queued',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'phase1.start',
      resource: 'execution',
      resourceId: execution.id,
      metadata: { projectId },
    });

    return execution;
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
        runMode: 'PHASE1',
        status: ExecutionStatus.AWAITING_CLARIFICATION,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!execution) {
      throw new ForbiddenException('No Phase 1 run awaiting clarification');
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
    const [latestExecution, snapshot, rounds, testCases, bugs, results] =
      await Promise.all([
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
      ]);

    const openRound = rounds.find((r) => !r.answeredAt && !r.skipped);
    const questionsFromRedis = latestExecution
      ? await this.queue.getClarificationQuestions(latestExecution.id)
      : null;

    return {
      project,
      latestExecution,
      requirementsClear: Boolean(snapshot?.clear),
      requirementSnapshot: snapshot,
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
      counts: {
        testCases: testCases.length,
        bugs: bugs.length,
        results: results.length,
        passed: results.filter((r) => r.status === 'PASSED').length,
        failed: results.filter((r) => r.status === 'FAILED').length,
      },
    };
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
