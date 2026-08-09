import { describe, expect, it } from 'vitest';
import {
  deriveFeatureStatus,
  groupRequirementsIntoFeatures,
} from './feature-grouping.js';
import { detectDuplicatePairs } from './duplicates.js';
import { classifyRequirementTypes, computeBusinessImpact } from './classify.js';
import { questionBucket, dedupeQuestionsAgainstExisting } from './question-utils.js';

describe('feature grouping', () => {
  it('groups registration/login/payment into features under business areas', () => {
    const groups = groupRequirementsIntoFeatures([
      {
        requirementKey: 'REQ-001',
        title: 'User Registration',
        description: 'Users can register with email',
      },
      {
        requirementKey: 'REQ-002',
        title: 'Unique Email Address',
        description: 'Email must be unique',
      },
      {
        requirementKey: 'REQ-022',
        title: 'Successful Payment Handling',
        description: 'Payment success creates order',
      },
      {
        requirementKey: 'REQ-025',
        title: 'Payment Failure Handling',
        description: 'Handle payment failure',
      },
    ]);
    const names = groups.map((g) => g.name);
    expect(names).toContain('User Registration');
    expect(names).toContain('Payment');
    const payment = groups.find((g) => g.name === 'Payment');
    expect(payment?.requirementKeys).toEqual(
      expect.arrayContaining(['REQ-022', 'REQ-025']),
    );
    expect(payment?.businessArea).toBe('Purchase');
  });

  it('feature status takes worst requirement status', () => {
    expect(
      deriveFeatureStatus([
        'READY_FOR_TEST_DESIGN',
        'BLOCKED',
        'NEEDS_CLARIFICATION',
      ]),
    ).toBe('BLOCKED');
  });
});

describe('duplicates + classify', () => {
  it('detects near-duplicate cart requirements', () => {
    const pairs = detectDuplicatePairs([
      {
        requirementKey: 'REQ-014',
        title: 'Add Product To Cart',
        description: 'User can add a product to the shopping cart',
      },
      {
        requirementKey: 'REQ-028',
        title: 'Add Product To Cart',
        description: 'Users can add products to shopping cart',
      },
    ]);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0]!.kind).toBe('DUPLICATE');
    expect(pairs[0]!.similarity).toBeGreaterThanOrEqual(70);
  });

  it('classifies access control as business rule with critical impact', () => {
    const types = classifyRequirementTypes({
      title: 'Order Access Control',
      description: 'Users cannot access another users orders',
      type: 'FUNCTIONAL',
    });
    expect(types.primaryType).toBe('BUSINESS_RULE');
    expect(
      computeBusinessImpact({
        title: 'Order Access Control',
        description: 'Users cannot access another users orders',
      }),
    ).toBe('CRITICAL');
  });
});

describe('question dedupe', () => {
  it('suppresses duplicate payment exception questions', () => {
    const fp = questionBucket(
      'What should happen if payment succeeds but order creation fails?',
    );
    const { keep, suppressed } = dedupeQuestionsAgainstExisting(
      [
        {
          category: 'EXCEPTION',
          priority: 'CRITICAL',
          question:
            'What should happen if payment succeeds but order creation fails?',
          reason: 'gap',
          blocking: true,
          fingerprint: fp,
        },
      ],
      [
        {
          question:
            'What should happen if payment succeeds but order creation fails?',
          questionKey: 'Q001',
          requirementKey: 'REQ-022',
          fingerprint: fp,
        },
      ],
    );
    expect(keep).toHaveLength(0);
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]!.existingKey).toBe('Q001');
  });
});
