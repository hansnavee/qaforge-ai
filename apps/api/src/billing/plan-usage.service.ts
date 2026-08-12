import { ForbiddenException, Injectable } from '@nestjs/common';
import { prisma } from '@qaforge/database';
import {
  PLAN_LIMITS,
  Role,
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

  /** Org OWNER bypasses FREE/PRO quantity and feature gates. */
  async isPlanExempt(userId: string | undefined, orgId: string): Promise<boolean> {
    if (!userId) return false;
    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId },
      },
      select: { role: true },
    });
    return membership?.role === Role.OWNER;
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
    userId?: string,
  ): Promise<{ warning: boolean }> {
    if (await this.isPlanExempt(userId, orgId)) {
      return { warning: false };
    }
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
    userId?: string,
  ): Promise<void> {
    if (await this.isPlanExempt(userId, orgId)) return;
    const { plan, limits } = await this.getLimits(orgId);
    if (!limits.features[feature]) {
      throw new ForbiddenException(planFeatureErrorPayload(plan, feature));
    }
  }

  async assertProjectLimit(orgId: string, userId?: string): Promise<void> {
    if (await this.isPlanExempt(userId, orgId)) return;
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

  async assertSeatLimit(orgId: string, userId?: string): Promise<void> {
    if (await this.isPlanExempt(userId, orgId)) return;
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

  async getUsageSummary(orgId: string, userId?: string) {
    const { plan, limits: planLimits } = await this.getLimits(orgId);
    const planExempt = await this.isPlanExempt(userId, orgId);
    const limits = planExempt ? getPlanLimits('ENTERPRISE') : planLimits;
    const features = planExempt
      ? PLAN_LIMITS.ENTERPRISE.features
      : planLimits.features;
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
        limit: planExempt ? -1 : limit,
        warning: planExempt ? false : check.warning,
        unlimited: planExempt ? true : check.unlimited,
      };
    }

    return {
      plan,
      planExempt,
      limits,
      features,
      usage,
      projects: {
        used: await this.countActiveProjects(orgId),
        limit: planExempt ? -1 : planLimits.projects,
      },
      seats: {
        used: await this.countSeats(orgId),
        limit: planExempt ? -1 : planLimits.seats,
      },
    };
  }

  async assertAutomationReplay(
    orgId: string,
    caseCount: number,
    userId?: string,
  ): Promise<void> {
    await this.assertPlanLimit(orgId, 'SCRIPT_REPLAY', caseCount, userId);
  }

  async assertRuleHealer(orgId: string, userId?: string): Promise<void> {
    await this.assertFeature(orgId, 'ruleHealer', userId);
  }

  async assertLlmHeal(
    orgId: string,
    quantity = 1,
    userId?: string,
  ): Promise<void> {
    await this.assertFeature(orgId, 'llmHealer', userId);
    await this.assertPlanLimit(orgId, 'LLM_HEAL', quantity, userId);
  }

  async recordLlmHeal(
    orgId: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    await this.recordUsage(orgId, 'LLM_HEAL', 1, meta);
  }
}
