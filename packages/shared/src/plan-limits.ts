import { PLAN_LIMITS, type PlanId } from './constants.js';

export const USAGE_EVENT_TYPES = {
  EXECUTION: 'EXECUTION',
  TCMS_RUN: 'TCMS_RUN',
  AI_GENERATE: 'AI_GENERATE',
  AI_PLAN_RUN: 'AI_PLAN_RUN',
  AI_EXECUTOR_CASE: 'AI_EXECUTOR_CASE',
  SCRIPT_REPLAY: 'SCRIPT_REPLAY',
  LLM_HEAL: 'LLM_HEAL',
} as const;

export type UsageEventType = keyof typeof USAGE_EVENT_TYPES;

export type PlanFeatureFlags = {
  cloudRunner: boolean;
  ruleHealer: boolean;
  llmHealer: boolean;
  aiReview: boolean;
  emailNotify: boolean;
  slack: boolean;
  jira: boolean;
  qaAgentFull: boolean;
  exportsHtml: boolean;
};

export type PlanLimits = {
  runsPerMonth: number;
  seats: number;
  projects: number;
  tcmsRunsPerMonth: number;
  aiGeneratePerMonth: number;
  aiPlanPerMonth: number;
  aiExecutorCasesPerMonth: number;
  scriptReplayPerMonth: number;
  llmHealPerMonth: number;
  features: PlanFeatureFlags;
};

export type PlanLimitCheck = {
  ok: boolean;
  used: number;
  limit: number;
  warning: boolean;
  unlimited: boolean;
};

export type PlanLimitErrorPayload = {
  code: 'PLAN_LIMIT' | 'PLAN_FEATURE';
  message: string;
  plan: PlanId;
  usageType?: UsageEventType;
  feature?: keyof PlanFeatureFlags;
  used?: number;
  limit?: number;
  upgradeUrl: string;
};

export const PLAN_LIMIT_WARNING_RATIO = 0.8;

export function normalizePlanId(plan: string | null | undefined): PlanId {
  if (plan === 'PRO' || plan === 'ENTERPRISE') return plan;
  return 'FREE';
}

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  const id = normalizePlanId(plan);
  return PLAN_LIMITS[id];
}

export function isUnlimitedLimit(limit: number): boolean {
  return limit < 0;
}

export function limitForUsageType(
  type: UsageEventType,
  limits: PlanLimits,
): number {
  switch (type) {
    case 'EXECUTION':
      return limits.runsPerMonth;
    case 'TCMS_RUN':
      return limits.tcmsRunsPerMonth;
    case 'AI_GENERATE':
      return limits.aiGeneratePerMonth;
    case 'AI_PLAN_RUN':
      return limits.aiPlanPerMonth;
    case 'AI_EXECUTOR_CASE':
      return limits.aiExecutorCasesPerMonth;
    case 'SCRIPT_REPLAY':
      return limits.scriptReplayPerMonth;
    case 'LLM_HEAL':
      return limits.llmHealPerMonth;
    default:
      return 0;
  }
}

export function checkPlanLimit(
  used: number,
  limit: number,
  quantity = 1,
): PlanLimitCheck {
  if (isUnlimitedLimit(limit)) {
    return { ok: true, used, limit, warning: false, unlimited: true };
  }
  const next = used + quantity;
  const ok = next <= limit;
  const warning =
    ok && limit > 0 && next / limit >= PLAN_LIMIT_WARNING_RATIO;
  return { ok, used, limit, warning, unlimited: false };
}

export function planLimitErrorPayload(
  plan: PlanId,
  type: UsageEventType,
  used: number,
  limit: number,
): PlanLimitErrorPayload {
  return {
    code: 'PLAN_LIMIT',
    message: `Plan ${plan} limit reached (${used}/${limit} ${type} this month)`,
    plan,
    usageType: type,
    used,
    limit,
    upgradeUrl: '/app/billing',
  };
}

export function planFeatureErrorPayload(
  plan: PlanId,
  feature: keyof PlanFeatureFlags,
): PlanLimitErrorPayload {
  return {
    code: 'PLAN_FEATURE',
    message: `${feature} is not available on the ${plan} plan`,
    plan,
    feature,
    upgradeUrl: '/app/billing',
  };
}

export const USAGE_METER_LABELS: Record<UsageEventType, string> = {
  EXECUTION: 'STLC executions',
  TCMS_RUN: 'Test cycles',
  AI_GENERATE: 'AI case generation',
  AI_PLAN_RUN: 'AI cycle planning',
  AI_EXECUTOR_CASE: 'AI Executor cases',
  SCRIPT_REPLAY: 'Script replay',
  LLM_HEAL: 'LLM heal attempts',
};
