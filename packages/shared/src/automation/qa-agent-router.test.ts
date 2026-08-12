import { describe, expect, it } from 'vitest';
import { classifyFailure } from './failure-class.js';
import { routeQaAgent } from './qa-agent-router.js';
import { applyRuleHeal } from './rule-healer.js';

describe('failure classification', () => {
  it('treats expect() as assertion', () => {
    expect(classifyFailure('expect(received).toBeVisible()')).toBe('ASSERTION');
  });
  it('treats missing locator as locator', () => {
    expect(classifyFailure('waiting for locator("[data-test=x]")')).toBe('LOCATOR');
  });
});

describe('qa agent router', () => {
  it('replays when script is healthy', () => {
    const d = routeQaAgent({ hasValidScript: true });
    expect(d.skill).toBe('REPLAY');
    expect(d.auto).toBe(true);
  });
  it('records when no script', () => {
    expect(routeQaAgent({ hasValidScript: false }).skill).toBe('RECORD');
  });
  it('does not heal assertions', () => {
    const d = routeQaAgent({
      hasValidScript: true,
      lastError: 'expect(page).toHaveURL(/inventory/)',
    });
    expect(d.skill).toBe('DEFECT');
    expect(d.escalateToHuman).toBeTruthy();
  });
  it('rule-heals locators', () => {
    const d = routeQaAgent({
      hasValidScript: true,
      lastError: 'waiting for locator("[data-test=add-to-cart]")',
      healAttempts: 0,
    });
    expect(d.skill).toBe('RULE_HEAL');
  });
  it('quarantines after two heals', () => {
    const d = routeQaAgent({
      hasValidScript: true,
      lastError: 'Timeout 30000ms exceeded',
      retryCount: 1,
      healAttempts: 2,
    });
    expect(d.skill).toBe('QUARANTINE');
  });
});

describe('rule healer', () => {
  it('bumps timeouts', () => {
    const { patched, applied } = applyRuleHeal(
      [{ kind: 'click', locator: "locator('button').first()", timeoutMs: 15_000 }],
      'Timeout exceeded',
    );
    const click = patched.find((a) => a.kind === 'click');
    expect(click?.timeoutMs).toBe(30_000);
    expect(applied.length).toBeGreaterThan(0);
  });
});
