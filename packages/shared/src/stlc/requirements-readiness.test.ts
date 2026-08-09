import { describe, expect, it } from 'vitest';
import { evaluateRequirementsReadiness } from './requirements-readiness.js';

describe('evaluateRequirementsReadiness', () => {
  const baseReqs = [
    {
      requirementKey: 'REQ-001',
      title: 'Login',
      reviewStatus: 'READY_FOR_TEST_DESIGN',
    },
  ];

  it('blocks when analysis is not completed', () => {
    const r = evaluateRequirementsReadiness({
      analysisStatus: 'RUNNING',
      requirements: baseReqs,
    });
    expect(r.canApprove).toBe(false);
    expect(r.blockers[0]).toMatch(/completed/i);
  });

  it('allows approve when analysis complete and no blockers', () => {
    const r = evaluateRequirementsReadiness({
      analysisStatus: 'COMPLETED',
      requirements: baseReqs,
      openQuestions: [],
    });
    expect(r.canApprove).toBe(true);
    expect(r.canStartPlanning).toBe(false);
  });

  it('requires approval before planning', () => {
    const r = evaluateRequirementsReadiness({
      analysisStatus: 'COMPLETED',
      requirements: baseReqs,
      requirementsApprovedAt: new Date().toISOString(),
    });
    expect(r.canApprove).toBe(true);
    expect(r.approved).toBe(true);
    expect(r.canStartPlanning).toBe(true);
  });

  it('allows start planning after approve even with soft blockers', () => {
    const r = evaluateRequirementsReadiness({
      analysisStatus: 'RUNNING',
      staleRequirementCount: 2,
      requirements: baseReqs,
      requirementsApprovedAt: new Date().toISOString(),
    });
    expect(r.canApprove).toBe(false);
    expect(r.canStartPlanning).toBe(true);
  });

  it('blocks on CRITICAL blocking open questions', () => {
    const r = evaluateRequirementsReadiness({
      analysisStatus: 'COMPLETED',
      requirements: baseReqs,
      openQuestions: [
        { priority: 'CRITICAL', blocking: true, status: 'OPEN' },
      ],
    });
    expect(r.canApprove).toBe(false);
    expect(r.counts.openBlockingCriticalQuestions).toBe(1);
  });

  it('blocks on BLOCKED requirements', () => {
    const r = evaluateRequirementsReadiness({
      analysisStatus: 'COMPLETED',
      requirements: [
        {
          requirementKey: 'REQ-002',
          title: 'Pay',
          reviewStatus: 'BLOCKED',
        },
      ],
    });
    expect(r.canApprove).toBe(false);
  });
});
