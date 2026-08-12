import { describe, expect, it } from 'vitest';
import { PLAN_LIMITS } from './constants.js';
import {
  checkPlanLimit,
  getPlanLimits,
  limitForUsageType,
  normalizePlanId,
  planLimitErrorPayload,
} from './plan-limits.js';

describe('plan limits', () => {
  it('normalizes unknown plans to FREE', () => {
    expect(normalizePlanId(undefined)).toBe('FREE');
    expect(normalizePlanId('STARTUP')).toBe('FREE');
  });

  it('maps usage types to caps', () => {
    const free = getPlanLimits('FREE');
    expect(limitForUsageType('EXECUTION', free)).toBe(PLAN_LIMITS.FREE.runsPerMonth);
    expect(limitForUsageType('SCRIPT_REPLAY', free)).toBe(50);
  });

  it('treats negative limits as unlimited', () => {
    const check = checkPlanLimit(999, -1, 1);
    expect(check.ok).toBe(true);
    expect(check.unlimited).toBe(true);
  });

  it('warns near cap', () => {
    const check = checkPlanLimit(4, 5, 0);
    expect(check.ok).toBe(true);
    expect(check.warning).toBe(true);
  });

  it('blocks over cap', () => {
    const check = checkPlanLimit(5, 5, 1);
    expect(check.ok).toBe(false);
  });

  it('builds upgrade payload', () => {
    const payload = planLimitErrorPayload('FREE', 'AI_GENERATE', 3, 3);
    expect(payload.code).toBe('PLAN_LIMIT');
    expect(payload.upgradeUrl).toBe('/app/billing');
  });
});
