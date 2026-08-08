import { describe, expect, it } from 'vitest';
import {
  createProjectSchema,
  createOrganizationSchema,
  PLAN_LIMITS,
  ArtifactType,
  AgentId,
} from '../src/index';

describe('@qaforge/shared schemas', () => {
  it('validates organization create', () => {
    const parsed = createOrganizationSchema.parse({ name: 'Acme QA' });
    expect(parsed.name).toBe('Acme QA');
  });

  it('rejects short org names', () => {
    expect(() => createOrganizationSchema.parse({ name: 'A' })).toThrow();
  });

  it('validates project create with url', () => {
    const parsed = createProjectSchema.parse({
      name: 'Demo',
      appUrl: 'https://example.com',
      framework: 'PLAYWRIGHT',
      language: 'TYPESCRIPT',
      environment: 'QA',
    });
    expect(parsed.appUrl).toContain('https://');
  });

  it('exposes plan limits', () => {
    expect(PLAN_LIMITS.FREE.runsPerMonth).toBeGreaterThan(0);
    expect(PLAN_LIMITS.PRO.runsPerMonth).toBeGreaterThan(PLAN_LIMITS.FREE.runsPerMonth);
  });

  it('includes core artifact and agent ids', () => {
    expect(ArtifactType.ZIP_PACKAGE).toBeTruthy();
    expect(ArtifactType.STLC_FINAL_ZIP).toBeTruthy();
    expect(ArtifactType.TEST_STRATEGY_JSON).toBeTruthy();
    expect(ArtifactType.CLARIFICATION_QUESTIONS).toBeTruthy();
    expect(AgentId.AUTHENTICATION).toBeTruthy();
    expect(AgentId.REQUIREMENT_CLARIFICATION).toBeTruthy();
    expect(AgentId.TEST_STRATEGY).toBeTruthy();
    expect(AgentId.TEST_DESIGN).toBeTruthy();
    expect(AgentId.QUALITY_ANALYSIS).toBeTruthy();
  });
});
