import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma, type Prisma } from '@qaforge/database';
import {
  ExecutionStatus,
  PLAN_LIMITS,
  Role,
  clarifyExecutionSchema,
  type PlanId,
} from '@qaforge/shared';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/parse-body';
import type { SessionUser } from '../auth/auth';
import { OrgsService } from '../orgs/orgs.service';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class ExecutionsService {
  constructor(
    private readonly orgs: OrgsService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  private async assertUsageLimit(orgId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId: orgId },
    });
    const plan = (subscription?.plan ?? 'FREE') as PlanId;
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.FREE;

    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const used = await prisma.usageEvent.count({
      where: {
        organizationId: orgId,
        type: 'EXECUTION',
        createdAt: { gte: startOfMonth },
      },
    });

    if (used >= limits.runsPerMonth) {
      throw new ForbiddenException(
        `Plan ${plan} limit reached (${limits.runsPerMonth} runs/month)`,
      );
    }
  }

  async create(user: SessionUser, orgId: string, projectId: string) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Project not found');

    await this.assertUsageLimit(orgId);

    const execution = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.execution.create({
        data: {
          projectId,
          status: ExecutionStatus.QUEUED,
          phase: 'INIT',
          startedAt: new Date(),
        },
      });
      await tx.usageEvent.create({
        data: {
          organizationId: orgId,
          type: 'EXECUTION',
          quantity: 1,
          meta: { executionId: created.id, projectId },
        },
      });
      return created;
    });

    await this.queue.enqueueRunExecution(execution.id);

    await this.queue.publishExecutionEvent(execution.id, {
      executionId: execution.id,
      type: 'execution.queued',
      phase: 'INIT',
      message: 'Execution queued',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'execution.create',
      resource: 'execution',
      resourceId: execution.id,
      metadata: { projectId },
    });

    return execution;
  }

  async get(userId: string, orgId: string, executionId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);

    const execution = await prisma.execution.findFirst({
      where: {
        id: executionId,
        project: { organizationId: orgId },
      },
      include: {
        agentRuns: { orderBy: { createdAt: 'asc' } },
        artifacts: { orderBy: { createdAt: 'asc' } },
        browserSession: true,
        project: { select: { id: true, name: true, organizationId: true } },
      },
    });
    if (!execution) throw new NotFoundException('Execution not found');

    const clarificationQuestions =
      await this.queue.getClarificationQuestions(executionId);

    return {
      ...execution,
      clarificationQuestions,
    };
  }

  async listForProject(userId: string, orgId: string, projectId: string) {
    await this.orgs.requireMembership(userId, orgId, Role.VIEWER);

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
    });
    if (!project) throw new NotFoundException('Project not found');

    return prisma.execution.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async clarify(
    user: SessionUser,
    orgId: string,
    executionId: string,
    body: unknown,
  ) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const execution = await this.get(user.id, orgId, executionId);
    const input = parseBody(clarifyExecutionSchema, body);

    if (execution.status !== ExecutionStatus.AWAITING_CLARIFICATION) {
      throw new ForbiddenException(
        `Cannot clarify from status ${execution.status}`,
      );
    }

    const skip = Boolean(input.skip);
    const answers = input.answers ?? {};

    await this.queue.publishClarify(executionId, { skip, answers });
    await this.queue.publishExecutionEvent(executionId, {
      executionId,
      type: skip
        ? 'execution.clarification_skipped'
        : 'execution.clarification_submitted',
      phase: 'CLARIFICATION',
      message: skip
        ? 'User skipped clarification'
        : 'User submitted clarification answers',
      timestamp: new Date().toISOString(),
      data: { skip, answerCount: Object.keys(answers).length },
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'execution.clarify',
      resource: 'execution',
      resourceId: executionId,
      metadata: { skip, answerCount: Object.keys(answers).length },
    });

    return this.get(user.id, orgId, executionId);
  }

  async approveTestPlan(
    user: SessionUser,
    orgId: string,
    executionId: string,
  ) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const execution = await this.get(user.id, orgId, executionId);

    if (execution.status !== ExecutionStatus.AWAITING_PLAN_APPROVAL) {
      throw new ForbiddenException(
        `Cannot approve test plan from status ${execution.status}`,
      );
    }

    const approvedAt = new Date();
    await prisma.project.update({
      where: { id: execution.projectId },
      data: {
        testPlanApprovedAt: approvedAt,
        testPlanApprovedBy: user.id,
        stlcStage: 'DESIGN',
      },
    });

    const updated = await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        phase: 'TEST_DESIGN',
      },
    });

    await this.queue.publishContinue(executionId);
    await this.queue.publishExecutionEvent(executionId, {
      executionId,
      type: 'stlc.plan_approved',
      phase: 'TEST_STRATEGY',
      message: 'Human approved test strategy; continuing to Test Design',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'stlc.plan.approve',
      resource: 'execution',
      resourceId: executionId,
      metadata: { projectId: execution.projectId },
    });

    return updated;
  }

  async approveTestDesign(
    user: SessionUser,
    orgId: string,
    executionId: string,
  ) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const execution = await this.get(user.id, orgId, executionId);

    if (execution.status !== ExecutionStatus.AWAITING_DESIGN_APPROVAL) {
      throw new ForbiddenException(
        `Cannot approve test design from status ${execution.status}`,
      );
    }

    const approvedAt = new Date();
    await prisma.project.update({
      where: { id: execution.projectId },
      data: {
        testDesignApprovedAt: approvedAt,
        testDesignApprovedBy: user.id,
        stlcStage: 'ENVIRONMENT',
      },
    });

    const updated = await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        phase: 'ENVIRONMENT',
      },
    });

    await this.queue.publishContinue(executionId);
    await this.queue.publishExecutionEvent(executionId, {
      executionId,
      type: 'stlc.design_approved',
      phase: 'TEST_DESIGN',
      message: 'Human approved test design; continuing to Environment Setup',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'stlc.design.approve',
      resource: 'execution',
      resourceId: executionId,
      metadata: { projectId: execution.projectId },
    });

    return updated;
  }

  async approveEnvironment(
    user: SessionUser,
    orgId: string,
    executionId: string,
  ) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const execution = await this.get(user.id, orgId, executionId);

    if (execution.status !== ExecutionStatus.AWAITING_ENV_APPROVAL) {
      throw new ForbiddenException(
        `Cannot approve environment from status ${execution.status}`,
      );
    }

    const approvedAt = new Date();
    await prisma.project.update({
      where: { id: execution.projectId },
      data: {
        environmentApprovedAt: approvedAt,
        environmentApprovedBy: user.id,
        stlcStage: 'DATA',
      },
    });

    const updated = await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        phase: 'TEST_DATA',
      },
    });

    await this.queue.publishContinue(executionId);
    await this.queue.publishExecutionEvent(executionId, {
      executionId,
      type: 'stlc.env_approved',
      phase: 'ENVIRONMENT',
      message: 'Human approved environment; continuing to Test Data',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'stlc.environment.approve',
      resource: 'execution',
      resourceId: executionId,
      metadata: { projectId: execution.projectId },
    });

    return updated;
  }

  async approveTestData(
    user: SessionUser,
    orgId: string,
    executionId: string,
  ) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const execution = await this.get(user.id, orgId, executionId);

    if (execution.status !== ExecutionStatus.AWAITING_DATA_APPROVAL) {
      throw new ForbiddenException(
        `Cannot approve test data from status ${execution.status}`,
      );
    }

    const approvedAt = new Date();
    await prisma.project.update({
      where: { id: execution.projectId },
      data: {
        testDataApprovedAt: approvedAt,
        testDataApprovedBy: user.id,
        stlcStage: 'EXECUTION',
      },
    });

    const updated = await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        phase: 'AUTHENTICATION',
      },
    });

    await this.queue.publishContinue(executionId);
    await this.queue.publishExecutionEvent(executionId, {
      executionId,
      type: 'stlc.data_approved',
      phase: 'TEST_DATA',
      message: 'Human approved test data; continuing to Test Execution',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'stlc.data.approve',
      resource: 'execution',
      resourceId: executionId,
      metadata: { projectId: execution.projectId },
    });

    return updated;
  }

  async approveTestExecution(
    user: SessionUser,
    orgId: string,
    executionId: string,
  ) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const execution = await this.get(user.id, orgId, executionId);

    if (execution.status !== ExecutionStatus.AWAITING_EXECUTION_APPROVAL) {
      throw new ForbiddenException(
        `Cannot approve test execution from status ${execution.status}`,
      );
    }

    const approvedAt = new Date();
    await prisma.project.update({
      where: { id: execution.projectId },
      data: {
        testExecutionApprovedAt: approvedAt,
        testExecutionApprovedBy: user.id,
        stlcStage: 'DEFECTS',
      },
    });

    const updated = await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        phase: 'BUG_ANALYSIS',
      },
    });

    await this.queue.publishContinue(executionId);
    await this.queue.publishExecutionEvent(executionId, {
      executionId,
      type: 'stlc.execution_approved',
      phase: 'MANUAL_TEST',
      message:
        'Human approved test execution results; continuing to Defect Management',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'stlc.execution.approve',
      resource: 'execution',
      resourceId: executionId,
      metadata: { projectId: execution.projectId },
    });

    return updated;
  }

  async approveDefects(
    user: SessionUser,
    orgId: string,
    executionId: string,
  ) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const execution = await this.get(user.id, orgId, executionId);

    if (execution.status !== ExecutionStatus.AWAITING_DEFECT_APPROVAL) {
      throw new ForbiddenException(
        `Cannot approve defects from status ${execution.status}`,
      );
    }

    const approvedAt = new Date();
    await prisma.project.update({
      where: { id: execution.projectId },
      data: {
        defectsApprovedAt: approvedAt,
        defectsApprovedBy: user.id,
        stlcStage: 'AUTOMATION',
      },
    });

    const updated = await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        phase: 'RETEST',
      },
    });

    await this.queue.publishContinue(executionId);
    await this.queue.publishExecutionEvent(executionId, {
      executionId,
      type: 'stlc.defects_approved',
      phase: 'BUG_ANALYSIS',
      message:
        'Human approved defect management; continuing to Automation (inline retest)',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'stlc.defects.approve',
      resource: 'execution',
      resourceId: executionId,
      metadata: { projectId: execution.projectId },
    });

    return updated;
  }

  async approveRegression(
    user: SessionUser,
    orgId: string,
    executionId: string,
  ) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const execution = await this.get(user.id, orgId, executionId);

    if (execution.status !== ExecutionStatus.AWAITING_REGRESSION_APPROVAL) {
      throw new ForbiddenException(
        `Cannot approve regression from status ${execution.status}`,
      );
    }

    const approvedAt = new Date();
    await prisma.project.update({
      where: { id: execution.projectId },
      data: {
        regressionApprovedAt: approvedAt,
        regressionApprovedBy: user.id,
        stlcStage: 'AUTOMATION',
      },
    });

    const updated = await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        phase: 'AUTOMATION',
      },
    });

    await this.queue.publishContinue(executionId);
    await this.queue.publishExecutionEvent(executionId, {
      executionId,
      type: 'stlc.regression_approved',
      phase: 'RETEST',
      message: 'Human approved regression; continuing to Automation',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'stlc.regression.approve',
      resource: 'execution',
      resourceId: executionId,
      metadata: { projectId: execution.projectId },
    });

    return updated;
  }

  async approveAutomation(
    user: SessionUser,
    orgId: string,
    executionId: string,
  ) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const execution = await this.get(user.id, orgId, executionId);

    if (execution.status !== ExecutionStatus.AWAITING_AUTOMATION_APPROVAL) {
      throw new ForbiddenException(
        `Cannot approve automation from status ${execution.status}`,
      );
    }

    const approvedAt = new Date();
    await prisma.project.update({
      where: { id: execution.projectId },
      data: {
        automationApprovedAt: approvedAt,
        automationApprovedBy: user.id,
        stlcStage: 'REPORTING',
      },
    });

    const updated = await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        phase: 'REPORT',
      },
    });

    await this.queue.publishContinue(executionId);
    await this.queue.publishExecutionEvent(executionId, {
      executionId,
      type: 'stlc.automation_approved',
      phase: 'AUTOMATION',
      message: 'Human approved automation; continuing to Test Reporting',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'stlc.automation.approve',
      resource: 'execution',
      resourceId: executionId,
      metadata: { projectId: execution.projectId },
    });

    return updated;
  }

  async approveReport(
    user: SessionUser,
    orgId: string,
    executionId: string,
  ) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const execution = await this.get(user.id, orgId, executionId);

    if (execution.status !== ExecutionStatus.AWAITING_REPORT_APPROVAL) {
      throw new ForbiddenException(
        `Cannot approve report from status ${execution.status}`,
      );
    }

    const approvedAt = new Date();
    await prisma.project.update({
      where: { id: execution.projectId },
      data: {
        reportApprovedAt: approvedAt,
        reportApprovedBy: user.id,
        stlcStage: 'SIGNOFF',
      },
    });

    const updated = await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        phase: 'REPORT',
      },
    });

    await this.queue.publishContinue(executionId);
    await this.queue.publishExecutionEvent(executionId, {
      executionId,
      type: 'stlc.report_approved',
      phase: 'REPORT',
      message: 'Human approved test report; continuing to QA Sign-off',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'stlc.report.approve',
      resource: 'execution',
      resourceId: executionId,
      metadata: { projectId: execution.projectId },
    });

    return updated;
  }

  async approveQaSignoff(
    user: SessionUser,
    orgId: string,
    executionId: string,
  ) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const execution = await this.get(user.id, orgId, executionId);

    if (execution.status !== ExecutionStatus.AWAITING_QA_SIGNOFF) {
      throw new ForbiddenException(
        `Cannot sign off from status ${execution.status}`,
      );
    }

    const signedOffAt = new Date();
    await prisma.project.update({
      where: { id: execution.projectId },
      data: {
        qaSignedOffAt: signedOffAt,
        qaSignedOffBy: user.id,
        stlcStage: 'DONE',
        status: 'STLC_COMPLETE',
      },
    });

    const updated = await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        phase: 'DONE',
      },
    });

    await this.queue.publishContinue(executionId);
    await this.queue.publishExecutionEvent(executionId, {
      executionId,
      type: 'stlc.qa_signed_off',
      phase: 'REPORT',
      message: 'Human QA sign-off recorded; closing STLC run',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'stlc.signoff.approve',
      resource: 'execution',
      resourceId: executionId,
      metadata: { projectId: execution.projectId },
    });

    return updated;
  }

  async continueAfterLogin(user: SessionUser, orgId: string, executionId: string) {
    await this.orgs.requireMembership(user.id, orgId, Role.MEMBER);
    const execution = await this.get(user.id, orgId, executionId);

    if (
      execution.status !== ExecutionStatus.AWAITING_LOGIN &&
      execution.status !== ExecutionStatus.RUNNING
    ) {
      throw new ForbiddenException(
        `Cannot continue from status ${execution.status}`,
      );
    }

    const updated = await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        phase: 'DISCOVERY',
      },
    });

    // Unblock the waiting worker via Redis — do not re-enqueue a full run.
    await this.queue.publishContinue(executionId);
    await this.queue.publishExecutionEvent(executionId, {
      executionId,
      type: 'execution.continue_after_login',
      phase: 'AUTHENTICATION',
      message: 'User signaled continue after login; resuming execution',
      timestamp: new Date().toISOString(),
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'execution.continue_after_login',
      resource: 'execution',
      resourceId: executionId,
    });

    return updated;
  }

  async getEvents(userId: string, orgId: string, executionId: string, after?: string) {
    await this.get(userId, orgId, executionId);
    return this.queue.getEventsAfter(executionId, after);
  }
}
