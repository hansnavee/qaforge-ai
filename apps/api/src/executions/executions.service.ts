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
