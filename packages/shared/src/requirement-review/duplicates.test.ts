import { describe, expect, it } from 'vitest';
import {
  detectDuplicatePairs,
  detectSemanticRelations,
} from './duplicates.js';
import { normalizeRequirement } from './normalized-requirement.js';

function kindOf(
  pairs: ReturnType<typeof detectDuplicatePairs>,
  a: string,
  b: string,
) {
  return pairs.find(
    (p) =>
      (p.requirementKeyA === a && p.requirementKeyB === b) ||
      (p.requirementKeyA === b && p.requirementKeyB === a),
  )?.kind;
}

describe('Piece 2.2 semantic relations', () => {
  it('REQ032 vs REQ014 → NOT_DUPLICATE (actor/capability/outcome)', () => {
    const pairs = detectDuplicatePairs([
      {
        requirementKey: 'REQ-014',
        title: 'Add Product To Cart',
        description:
          'Users should be able to add an available product to their cart.',
      },
      {
        requirementKey: 'REQ-032',
        title: 'Add Product',
        description: 'Administrators should be able to add new products.',
        featureName: 'Product Administration',
        businessArea: 'Administration',
      },
    ]);
    expect(kindOf(pairs, 'REQ-014', 'REQ-032')).toBe('NOT_DUPLICATE');
    expect(pairs.every((p) => p.kind !== 'POSSIBLE_DUPLICATE')).toBe(true);
    expect(pairs.every((p) => p.kind !== 'DUPLICATE')).toBe(true);
  });

  it('REQ034 vs REQ032 → RELATED (CRUD ops, not duplicate)', () => {
    const pairs = detectDuplicatePairs([
      {
        requirementKey: 'REQ-032',
        title: 'Add Product',
        description: 'Administrators should be able to add new products.',
        featureName: 'Product Administration',
      },
      {
        requirementKey: 'REQ-034',
        title: 'Remove Product',
        description: 'Administrators should be able to remove products.',
        featureName: 'Product Administration',
      },
    ]);
    expect(kindOf(pairs, 'REQ-032', 'REQ-034')).toBe('RELATED');
  });

  it('REQ035 vs REQ033 → RELATED (inventory vs catalog info)', () => {
    const pairs = detectDuplicatePairs([
      {
        requirementKey: 'REQ-033',
        title: 'Update Product',
        description:
          'Administrators should be able to update product information.',
      },
      {
        requirementKey: 'REQ-035',
        title: 'Update Product Inventory',
        description:
          'Administrators should be able to update product inventory.',
      },
    ]);
    expect(kindOf(pairs, 'REQ-033', 'REQ-035')).toBe('RELATED');
    expect(kindOf(pairs, 'REQ-033', 'REQ-035')).not.toBe('DUPLICATE');
    expect(kindOf(pairs, 'REQ-033', 'REQ-035')).not.toBe('POSSIBLE_DUPLICATE');
  });

  it('REQ026 page vs REQ027 email → RELATED (channels)', () => {
    const pairs = detectDuplicatePairs([
      {
        requirementKey: 'REQ-026',
        title: 'Order Confirmation',
        description:
          'The confirmation page should display product information.',
      },
      {
        requirementKey: 'REQ-027',
        title: 'Order Confirmation',
        description:
          'The user should receive an order confirmation email.',
      },
    ]);
    expect(kindOf(pairs, 'REQ-026', 'REQ-027')).toBe('RELATED');
  });

  it('REQ029 order details vs REQ026 confirmation page → RELATED', () => {
    const pairs = detectDuplicatePairs([
      {
        requirementKey: 'REQ-026',
        title: 'Order Confirmation',
        description:
          'The confirmation page should display product information.',
      },
      {
        requirementKey: 'REQ-029',
        title: 'Order Product Information',
        description: 'Each order should display product information.',
      },
    ]);
    const k = kindOf(pairs, 'REQ-026', 'REQ-029');
    expect(k === 'RELATED' || k === 'POSSIBLE_DUPLICATE').toBe(true);
    expect(k).not.toBe('DUPLICATE');
  });

  it('REQ010 search vs REQ011 search results → RELATED / PRECEDES', () => {
    const rel = detectSemanticRelations([
      {
        requirementKey: 'REQ-010',
        title: 'Product Search',
        description:
          'Users should be able to search for products using the search bar.',
      },
      {
        requirementKey: 'REQ-011',
        title: 'Product Search Results',
        description:
          'Users can select a product from search results to view its details.',
      },
    ]);
    const pair = rel.find(
      (p) =>
        (p.requirementKeyA === 'REQ-010' && p.requirementKeyB === 'REQ-011') ||
        (p.requirementKeyA === 'REQ-011' && p.requirementKeyB === 'REQ-010'),
    );
    expect(pair?.kind === 'RELATED' || pair?.relationType === 'PRECEDES').toBe(
      true,
    );
    expect(pair?.kind).not.toBe('DUPLICATE');
    expect(pair?.kind).not.toBe('POSSIBLE_DUPLICATE');
  });

  it('identical confirmation-page behavior can be DUPLICATE', () => {
    const pairs = detectDuplicatePairs([
      {
        requirementKey: 'REQ-026',
        title: 'Order Confirmation',
        description:
          'The confirmation page should display product information.',
      },
      {
        requirementKey: 'REQ-027',
        title: 'Order Confirmation Screen',
        description:
          'The order confirmation screen should display the purchased products.',
      },
    ]);
    expect(kindOf(pairs, 'REQ-026', 'REQ-027')).toBe('DUPLICATE');
  });

  it('does not classify duplicates from similarity alone', () => {
    const pairs = detectDuplicatePairs([
      {
        requirementKey: 'REQ-A',
        title: 'Add Product Something',
        description: 'Add product add product add product for users to cart.',
      },
      {
        requirementKey: 'REQ-B',
        title: 'Add Product Catalog',
        description:
          'Administrators add product add product into the product catalog.',
      },
    ]);
    expect(kindOf(pairs, 'REQ-A', 'REQ-B')).not.toBe('POSSIBLE_DUPLICATE');
    expect(kindOf(pairs, 'REQ-A', 'REQ-B')).not.toBe('DUPLICATE');
  });

  it('normalizes admin actor aliases', () => {
    const n = normalizeRequirement({
      requirementKey: 'REQ-X',
      title: 'Manage catalog',
      description: 'Admin can update product information',
    });
    expect(n.actor[0]).toBe('administrator');
  });
});
