import { describe, expect, it } from 'vitest';
import { computeReadinessScore, deriveStatuses } from './scoring.js';
import type { ReviewQuestionDraft } from './types.js';

describe('requirement review scoring', () => {
  it('penalizes critical business questions more than low functional ones', () => {
    const critical = computeReadinessScore([
      {
        priority: 'CRITICAL',
        category: 'BUSINESS_RULE',
        blocking: true,
      },
    ]);
    const low = computeReadinessScore([
      { priority: 'LOW', category: 'NAVIGATION', blocking: false },
    ]);
    expect(critical).toBeLessThan(low);
    expect(critical).toBeLessThan(60);
    expect(low).toBeGreaterThan(90);
  });

  it('maps open critical questions to BLOCKED', () => {
    const questions: ReviewQuestionDraft[] = [
      {
        category: 'EXCEPTION',
        priority: 'CRITICAL',
        question: 'What happens on payment failure?',
        reason: 'Outcome undefined',
        blocking: true,
      },
    ];
    const { reviewStatus, businessReadiness } = deriveStatuses({
      openQuestions: questions,
      functionalCompleteness: 'PARTIAL',
    });
    expect(reviewStatus).toBe('BLOCKED');
    expect(businessReadiness).toBe('BLOCKED');
  });

  it('is READY_FOR_TEST_DESIGN when no high gaps remain', () => {
    const { reviewStatus } = deriveStatuses({
      openQuestions: [],
      functionalCompleteness: 'COMPLETE',
    });
    expect(reviewStatus).toBe('READY_FOR_TEST_DESIGN');
  });
});
