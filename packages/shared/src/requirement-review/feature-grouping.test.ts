import { describe, expect, it } from 'vitest';
import {
  countByImpact,
  deriveFeatureRisk,
  deriveFeatureStatus,
  groupRequirementsIntoFeatures,
  matchFeature,
  summarizeFeature,
} from './feature-grouping.js';
import { detectDuplicatePairs } from './duplicates.js';
import { classifyRequirementTypes, computeBusinessImpact } from './classify.js';
import { questionBucket, dedupeQuestionsAgainstExisting } from './question-utils.js';

describe('business-driven feature grouping', () => {
  it('groups product search under Product Management, not Purchase', () => {
    const groups = groupRequirementsIntoFeatures([
      {
        requirementKey: 'REQ-010',
        title: 'Product Search',
        description: 'Users can search products and filter results',
      },
      {
        requirementKey: 'REQ-011',
        title: 'Product Details',
        description: 'Users can view product details',
      },
      {
        requirementKey: 'REQ-022',
        title: 'Successful Payment Handling',
        description: 'Payment success creates order',
      },
      {
        requirementKey: 'REQ-019',
        title: 'Proceed To Checkout',
        description: 'User can proceed to checkout from cart',
      },
      {
        requirementKey: 'REQ-014',
        title: 'Add Product To Cart',
        description: 'User can add a product to the shopping cart',
      },
    ]);

    const search = groups.find((g) => g.name === 'Product Search');
    expect(search?.businessArea).toBe('Product Management');
    expect(search?.businessIntent).toMatch(/discover/i);
    expect(search?.businessIntent).not.toMatch(/^Support /);

    const payment = groups.find((g) => g.name === 'Payment');
    expect(payment?.businessArea).toBe('Purchase');
    expect(payment?.businessCapability).toMatch(/payment/i);

    const cart = groups.find((g) => g.name === 'Shopping Cart');
    expect(cart?.businessArea).toBe('Shopping');
  });

  it('avoids Other/General for common ecommerce capabilities', () => {
    const groups = groupRequirementsIntoFeatures([
      {
        requirementKey: 'REQ-001',
        title: 'User Registration',
        description: 'Users can register with email',
      },
      {
        requirementKey: 'REQ-050',
        title: 'Browser Compatibility',
        description: 'Application works on Chrome and Firefox',
      },
      {
        requirementKey: 'REQ-051',
        title: 'Application Performance',
        description: 'Pages must load within 3 seconds',
      },
      {
        requirementKey: 'REQ-018',
        title: 'Out Of Stock Purchase Rule',
        description: 'Out-of-stock products cannot be purchased',
      },
    ]);
    expect(groups.every((g) => g.businessArea !== 'Other')).toBe(true);
    expect(groups.map((g) => g.businessArea)).toEqual(
      expect.arrayContaining([
        'Account Management',
        'Compatibility',
        'Performance',
        'Inventory',
      ]),
    );
  });

  it('feature status ignores business impact criticality', () => {
    expect(
      deriveFeatureStatus(['READY_FOR_TEST_DESIGN', 'READY_FOR_TEST_DESIGN']),
    ).toBe('READY_FOR_TEST_DESIGN');
    expect(
      deriveFeatureStatus(['READY_FOR_TEST_DESIGN', 'BLOCKED']),
    ).toBe('BLOCKED');
  });

  it('impact counters come only from businessImpact', () => {
    const counts = countByImpact([
      'HIGH',
      'HIGH',
      'MEDIUM',
      'CRITICAL',
      'HIGH',
    ]);
    expect(counts).toEqual({ critical: 1, high: 3, medium: 1, low: 0 });
  });

  it('critical impact alone does not force critical risk without gaps', () => {
    const { risk } = deriveFeatureRisk({
      businessImpacts: ['CRITICAL'],
      reviewStatuses: ['READY_FOR_TEST_DESIGN'],
      openQuestionPriorities: [],
      openConflictCount: 0,
    });
    expect(risk).toBe('HIGH');
  });

  it('summarizeFeature separates impact, status, and risk', () => {
    const summary = summarizeFeature({
      requirementCount: 5,
      businessImpacts: ['HIGH', 'HIGH', 'MEDIUM', 'CRITICAL', 'HIGH'],
      reviewStatuses: [
        'BLOCKED',
        'BLOCKED',
        'REVIEW_RECOMMENDED',
        'REVIEW_RECOMMENDED',
        'READY_FOR_TEST_DESIGN',
      ],
      openQuestionPriorities: ['CRITICAL', 'HIGH', 'MEDIUM'],
    });
    expect(summary.impactCounts.critical).toBe(1);
    expect(summary.impactCounts.high).toBe(3);
    expect(summary.statusCounts.blocked).toBe(2);
    expect(summary.statusCounts.ready).toBe(1);
    expect(summary.openQuestionCount).toBe(3);
    expect(summary.reviewStatus).toBe('BLOCKED');
    expect(summary.featureRisk).toBe('CRITICAL');
  });

  it('matchFeature prefers admin over cart for admin add product', () => {
    const matched = matchFeature({
      requirementKey: 'REQ-042',
      title: 'Administrator Add Product',
      description: 'Only administrators can add products to the catalog',
    });
    expect(matched?.name).toBe('Product Administration');
    expect(matched?.businessArea).toBe('Administration');
  });

  it('groups inventory updates under Inventory, not Product Administration', () => {
    const groups = groupRequirementsIntoFeatures([
      {
        requirementKey: 'REQ-033',
        title: 'Update Product',
        description: 'Administrator can update product details',
      },
      {
        requirementKey: 'REQ-035',
        title: 'Update Product Inventory',
        description: 'Administrator can update product inventory levels',
      },
    ]);
    expect(
      groups.find((g) => g.requirementKeys.includes('REQ-033'))?.businessArea,
    ).toBe('Administration');
    expect(
      groups.find((g) => g.requirementKeys.includes('REQ-035'))?.businessArea,
    ).toBe('Inventory');
  });
});

describe('business-semantic duplicates (legacy suite)', () => {
  it('marks identical order confirmation behavior as DUPLICATE', () => {
    const pairs = detectDuplicatePairs([
      {
        requirementKey: 'REQ-026',
        title: 'Order Confirmation',
        description: 'System sends order confirmation after successful order',
      },
      {
        requirementKey: 'REQ-027',
        title: 'Order Confirmation',
        description: 'System sends order confirmation after successful order',
      },
    ]);
    expect(pairs[0]?.kind).toBe('DUPLICATE');
    expect(pairs[0]?.showConfidence).toBe(true);
  });

  it('treats update product vs update inventory as RELATED not duplicate', () => {
    const pairs = detectDuplicatePairs([
      {
        requirementKey: 'REQ-033',
        title: 'Update Product',
        description: 'Administrator can update product details',
      },
      {
        requirementKey: 'REQ-035',
        title: 'Update Product Inventory',
        description: 'Administrator can update product inventory levels',
      },
    ]);
    expect(pairs.some((p) => p.kind === 'DUPLICATE')).toBe(false);
    expect(pairs.some((p) => p.kind === 'RELATED')).toBe(true);
  });

  it('does not mark add product and remove product as duplicates', () => {
    const pairs = detectDuplicatePairs([
      {
        requirementKey: 'REQ-032',
        title: 'Add Product',
        description: 'Administrator can add a product',
      },
      {
        requirementKey: 'REQ-034',
        title: 'Remove Product',
        description: 'Administrator can remove a product',
      },
    ]);
    expect(pairs.every((p) => p.kind !== 'DUPLICATE')).toBe(true);
    expect(pairs.every((p) => p.kind !== 'POSSIBLE_DUPLICATE')).toBe(true);
  });
});

describe('classify + question dedupe still work', () => {
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
  });
});
