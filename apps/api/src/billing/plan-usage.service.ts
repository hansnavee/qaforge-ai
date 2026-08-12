import { ForbiddenException, Injectable } from '@nestjs/common';
import { prisma } from '@qaforge/database';
import {
  USAGE_EVENT_TYPES,
  checkPlanLimit,
  getPlanLimits,
  limitForUsageType,
  normalizePlanId,
  planFeatureErrorPayload,
  planLimitErrorPayload,
  type PlanFeatureFlags,
  type PlanId,
  type UsageEventType,
} from '@qaforge/shared';

function startOfUtcMonth(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class PlanUsageService {
  async getPlanId(orgId: string): Promise<PlanId> {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId: orgId },
      select: { plan: true },
    });
    return normalizePlanId(subscription?.plan);
  }

  async getLimits(orgId: string) {
    const plan = await this.getPlanId(orgId);
    return { plan, limits: getPlanLimits(plan) };
  }

  async sumUsage(
    orgId: string,
    type: UsageEventType,
    since = startOfUtcMonth(),
  ): Promise<number> {
    const agg = await prisma.usageEvent.aggregate({
      where: {
        organizationId: orgId,
        type,
        createdAt: { gte: since },
      },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? 0;
  }

  async countActiveProjects(orgId: string): Promise<number> {
    return prisma.project.count({
      where: { organizationId: orgId, deletedAt: null },
    });
  }

  async countSeats(orgId: string): Promise<number> {
    return prisma.membership.count({ where: { organizationId: orgId } });
  }

  async assertPlanLimit(
    orgId: string,
    type: UsageEventType,
    quantity = 1,
  ): Promise<{ warning: boolean }> {
    const { plan, limits } = await this.getLimits(orgId);
    const limit = limitForUsageType(type, limits);
    const used = await this.sumUsage(orgId, type);
    const check = checkPlanLimit(used, limit, quantity);
    if (!check.ok) {
      throw new ForbiddenException(
        planLimitErrorPayload(plan, type, used, limit),
      );
    }
    return { warning: check.warning };
  }

  async assertFeature(
    orgId: string,
    feature: keyof PlanFeatureFlags,
  ): Promise<void> {
    const { plan, limits } = await this.getLimits(orgId);
    if (!limits.features[feature]) {
      throw new ForbiddenException(planFeatureErrorPayload(plan, feature));
    }
  }

  async assertProjectLimit(orgId: string): Promise<void> {
    const { plan, limits } = await this.getLimits(orgId);
    const used = await this.countActiveProjects(orgId);
    const check = checkPlanLimit(used, limits.projects, 1);
    if (!check.ok) {
      throw new ForbiddenException({
        ...planLimitErrorPayload(plan, 'TCMS_RUN', used, limits.projects),
        message: `Plan ${plan} allows ${limits.projects} active project(s). Archive a project or upgrade.`,
        code: 'PLAN_LIMIT',
        usageType: undefined,
      });
    }
  }

  async assertSeatLimit(orgId: string): Promise<void> {
    const { plan, limits } = await this.getLimits(orgId);
    const used = await this.countSeats(orgId);
    const check = checkPlanLimit(used, limits.seats, 1);
    if (!check.ok) {
      throw new ForbiddenException({
        ...planLimitErrorPayload(plan, 'TCMS_RUN', used, limits.seats),
        message: `Plan ${plan} allows ${limits.seats} seat(s). Upgrade to add members.`,
        code: 'PLAN_LIMIT',
      });
    }
  }

  async recordUsage(
    orgId: string,
    type: UsageEventType,
    quantity = 1,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    await prisma.usageEvent.create({
      data: {
        organizationId: orgId,
        type,
        quantity,
        meta: (meta ?? undefined) as never,
      },
    });
  }

  async getUsageSummary(orgId: string) {
    const { plan, limits } = await this.getLimits(orgId);
    const since = startOfUtcMonth();
    const types = Object.keys(USAGE_EVENT_TYPES) as UsageEventType[];
    const usage: Record<
      UsageEventType,
      { used: number; limit: number; warning: boolean; unlimited: boolean }
    > = {} as never;

    for (const type of types) {
      const limit = limitForUsageType(type, limits);
      const used = await this.sumUsage(orgId, type, since);
      const check = checkPlanLimit(used, limit, 0);
      usage[type] = {
        used,
        limit,
        warning: check.warning,
        unlimited: check.unlimited,
      };
    }

    return {
      plan,
      limits,
      features: limits.features,
      usage,
      projects: {
        used: await this.countActiveProjects(orgId),
        limit: limits.projects,
      },
      seats: {
        used: await this.countSeats(orgId),
        limit: limits.seats,
      },
    };
  }

  async assertAutomationReplay(orgId: string, caseCount: number): Promise<void> {
    await this.assertPlanLimit(orgId, 'SCRIPT_REPLAY', caseCount);
  }

  async assertRuleHealer(orgId: string): Promise<void> {
    await this.assertFeature(orgId, 'ruleHealer');
  }

  async assertLlmHeal(orgId: string, quantity = 1): Promise<void> {
    await this.assertFeature(orgId, 'llmHealer');
    await this.assertPlanLimit(orgId, 'LLM_HEAL', quantity);
  }

  async recordLlmHeal(
    orgId: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    await this.recordUsage(orgId, 'LLM_HEAL', 1, meta);
  }
}
