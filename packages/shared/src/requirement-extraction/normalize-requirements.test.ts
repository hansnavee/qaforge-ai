import { describe, expect, it } from 'vitest';
import { finalizeExtraction } from './finalize-extraction';
import {
  classifyRequirementType,
  generateSemanticTitle,
  normalizeRequirements,
  type TempCandidate,
} from './normalize-requirements';

function cand(
  partial: Partial<TempCandidate> & { title: string; description: string },
  i: number,
): TempCandidate {
  return {
    tempId: `candidate-${String(i).padStart(3, '0')}`,
    type: 'FUNCTIONAL',
    priority: null,
    acceptanceCriteria: [],
    businessRules: [],
    dependencies: [],
    supportingInformation: [],
    source: {
      document: 'test.txt',
      page: null,
      section: null,
      text: partial.description,
    },
    ...partial,
  };
}

describe('generateSemanticTitle', () => {
  it('avoids truncated sentence titles', () => {
    expect(
      generateSemanticTitle(
        'Users should be able to proceed to checkout from the shopping cart.',
        'Checkout',
        'FUNCTIONAL',
      ),
    ).toBe('Proceed To Checkout');

    expect(
      generateSemanticTitle(
        'After successful payment, the user should see an order confirmation.',
        'Payment',
        'FUNCTIONAL',
      ),
    ).toBe('Successful Payment Handling');

    expect(
      generateSemanticTitle(
        'Administrators should be able to add products to the catalog.',
        'Admin',
        'FUNCTIONAL',
      ),
    ).toBe('Add Product');
  });
});

describe('classifyRequirementType', () => {
  it('classifies security, usability, performance as NON_FUNCTIONAL', () => {
    expect(
      classifyRequirementType('Passwords should be stored securely.'),
    ).toBe('NON_FUNCTIONAL');
    expect(classifyRequirementType('The application should be user friendly.')).toBe(
      'NON_FUNCTIONAL',
    );
    expect(
      classifyRequirementType('The application should be fast and responsive.'),
    ).toBe('NON_FUNCTIONAL');
    expect(
      classifyRequirementType('Search should return results quickly.'),
    ).toBe('NON_FUNCTIONAL');
  });

  it('classifies constraints as BUSINESS_RULE', () => {
    expect(
      classifyRequirementType(
        'Only users who have purchased a product should be allowed to submit a review.',
      ),
    ).toBe('BUSINESS_RULE');
    expect(
      classifyRequirementType('Users cannot change their registered email address.'),
    ).toBe('BUSINESS_RULE');
  });
});

describe('normalizeRequirements', () => {
  it('merges duplicate add-to-cart candidates and assigns sequential IDs last', () => {
    const { requirements, stats } = normalizeRequirements([
      cand(
        {
          title: 'Add Product To Cart',
          description: 'Users can add products to cart.',
        },
        1,
      ),
      cand(
        {
          title: 'Add Product To Cart',
          description: 'Users should be able to add available products to their shopping cart.',
        },
        2,
      ),
      cand(
        {
          title: 'Users can add products to cart',
          description: 'Users can add products to their shopping cart.',
        },
        3,
      ),
    ]);

    expect(stats.merged).toBeGreaterThanOrEqual(2);
    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.requirementKey).toBe('REQ-001');
    expect(requirements[0]?.title).toBe('Add Product To Cart');
    expect(requirements[0]?.description.toLowerCase()).toContain('shopping cart');
  });

  it('merges review functional + eligibility into one capability', () => {
    const { requirements } = normalizeRequirements([
      cand(
        {
          title: 'Review Eligibility',
          description: 'Users can provide a rating and review for products.',
        },
        1,
      ),
      cand(
        {
          title: 'Review Eligibility',
          description:
            'Only users who have purchased a product should be allowed to submit a review for that product.',
          type: 'BUSINESS_RULE',
        },
        2,
      ),
    ]);

    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.title).toBe('Product Review');
    expect(requirements[0]?.businessRules.length).toBeGreaterThanOrEqual(1);
  });

  it('does not over-merge distinct cart behaviors', () => {
    const { requirements } = normalizeRequirements([
      cand(
        {
          title: 'Add Product To Cart',
          description: 'Users can add products to the shopping cart.',
        },
        1,
      ),
      cand(
        {
          title: 'Remove Product From Cart',
          description: 'Users can remove products from the cart.',
        },
        2,
      ),
      cand(
        {
          title: 'Modify Product Quantity',
          description: 'Users can increase or decrease the quantity.',
        },
        3,
      ),
      cand(
        {
          title: 'Display Cart Total',
          description: 'The cart should display the total price.',
        },
        4,
      ),
    ]);

    expect(requirements).toHaveLength(4);
    expect(requirements.map((r) => r.requirementKey)).toEqual([
      'REQ-001',
      'REQ-002',
      'REQ-003',
      'REQ-004',
    ]);
  });

  it('collapses generic Payment duplicates into meaningful titles when possible', () => {
    const { requirements } = normalizeRequirements([
      cand(
        {
          title: 'Payment',
          description:
            'The application should support credit card, debit card and other supported payment methods.',
        },
        1,
      ),
      cand(
        {
          title: 'Payment',
          description: 'Payment',
        },
        2,
      ),
      cand(
        {
          title: 'After Successful Payment, The User',
          description:
            'After successful payment, the user should see an order confirmation.',
        },
        3,
      ),
      cand(
        {
          title: 'Payment',
          description:
            'If payment fails, the user should be notified and the order should not be created.',
        },
        4,
      ),
    ]);

    const titles = requirements.map((r) => r.title);
    expect(titles.filter((t) => t === 'Payment').length).toBeLessThanOrEqual(1);
    expect(titles).toContain('Payment Methods');
    expect(titles).toContain('Successful Payment Handling');
    expect(titles).toContain('Payment Failure Handling');
  });
});

describe('finalizeExtraction sequential IDs', () => {
  it('assigns REQ IDs only after normalization', () => {
    const result = finalizeExtraction({
      sourceText: `
## Shopping Cart
Users can add products to the shopping cart.
Users can add products to their shopping cart.
Users can remove products from the cart.
Passwords should be stored securely.
The application should be easy to navigate.
`,
      documentName: 'sample.txt',
      aiCandidates: [
        {
          title: 'Add Product To Cart',
          description: 'Users can add products to cart.',
          sourceText: 'Users can add products to cart.',
        },
      ],
    });

    expect(result.requirements.every((r, i) => r.requirementKey === `REQ-${String(i + 1).padStart(3, '0')}`)).toBe(true);
    expect(
      result.requirements.filter((r) => /Add Product To Cart/i.test(r.title)),
    ).toHaveLength(1);
    const nfr = result.requirements.filter((r) => r.type === 'NON_FUNCTIONAL');
    expect(nfr.length).toBeGreaterThanOrEqual(1);
    expect(
      nfr.some((r) => /secure|password|usability|navigat|friendly/i.test(r.description)),
    ).toBe(true);
  });
});
