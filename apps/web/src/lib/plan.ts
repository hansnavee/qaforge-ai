import type { PlanFeatureFlags, PlanId, UsageEventType } from '@qaforge/shared';
import { USAGE_METER_LABELS } from '@qaforge/shared';

export type UsageMeter = {
  used: number;
  limit: number;
  warning: boolean;
  unlimited: boolean;
};

export type BillingSummary = {
  plan: PlanId;
  planExempt?: boolean;
  status: string;
  features: PlanFeatureFlags;
  usage: Record<UsageEventType, UsageMeter>;
  projects: { used: number; limit: number };
  seats: { used: number; limit: number };
  upgradeUrl: string;
};

export type PlanLimitErrorBody = {
  code?: 'PLAN_LIMIT' | 'PLAN_FEATURE';
  message?: string;
  plan?: PlanId;
  usageType?: UsageEventType;
  feature?: keyof PlanFeatureFlags;
  used?: number;
  limit?: number;
  upgradeUrl?: string;
};

export function parsePlanLimitError(body: unknown): PlanLimitErrorBody | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  const nested =
    root.message && typeof root.message === 'object'
      ? (root.message as Record<string, unknown>)
      : root;
  const code = nested.code;
  if (code !== 'PLAN_LIMIT' && code !== 'PLAN_FEATURE') return null;
  return {
    code,
    message:
      typeof nested.message === 'string'
        ? nested.message
        : typeof root.message === 'string'
          ? root.message
          : undefined,
    plan: nested.plan as PlanId | undefined,
    usageType: nested.usageType as UsageEventType | undefined,
    feature: nested.feature as keyof PlanFeatureFlags | undefined,
    used: typeof nested.used === 'number' ? nested.used : undefined,
    limit: typeof nested.limit === 'number' ? nested.limit : undefined,
    upgradeUrl:
      typeof nested.upgradeUrl === 'string' ? nested.upgradeUrl : '/app/billing',
  };
}

export function planLimitMessage(err: PlanLimitErrorBody): string {
  if (err.code === 'PLAN_FEATURE' && err.feature) {
    if (err.feature === 'qaAgentFull') {
      return 'AI QA Engineer Execute requires the Enterprise plan. Suggest (preview) stays available on lower plans.';
    }
    return `${err.feature} requires a Pro plan. Upgrade to unlock automation features.`;
  }
  if (err.usageType) {
    const label = USAGE_METER_LABELS[err.usageType] ?? err.usageType;
    if (err.used !== undefined && err.limit !== undefined) {
      return `${label} limit reached (${err.used}/${err.limit} this month). Upgrade for higher limits.`;
    }
    return `${label} limit reached on the ${err.plan ?? 'FREE'} plan.`;
  }
  return err.message ?? 'Plan limit reached. Upgrade to continue.';
}

export function meterLabel(type: UsageEventType): string {
  return USAGE_METER_LABELS[type];
}

export function formatMeter(m: UsageMeter): string {
  if (m.unlimited || m.limit < 0) return `${m.used} / unlimited`;
  return `${m.used} / ${m.limit}`;
}

export function planDisplayName(plan: PlanId): string {
  if (plan === 'PRO') return 'Pro';
  if (plan === 'ENTERPRISE') return 'Enterprise';
  return 'Free';
}
