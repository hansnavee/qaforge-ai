import { describe, expect, it } from 'vitest';
import { STLC_PHASES, TestingLevel, getStlcPhase } from './phases.js';

describe('STLC phases registry', () => {
  it('defines exactly 10 human-gated phases', () => {
    expect(STLC_PHASES).toHaveLength(10);
    expect(STLC_PHASES.map((p) => p.index)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('includes Environment and Sign-off agents', () => {
    expect(getStlcPhase('ENVIRONMENT')?.agentName).toContain('Environment');
    expect(getStlcPhase('SIGNOFF')?.agentName).toContain('Sign-off');
  });

  it('exposes testing levels for Senior QA coverage', () => {
    expect(TestingLevel.SMOKE).toBe('SMOKE');
    expect(TestingLevel.UAT_READY).toBe('UAT_READY');
  });
});
