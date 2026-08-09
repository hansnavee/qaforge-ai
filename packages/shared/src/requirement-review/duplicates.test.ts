import { describe, expect, it, test } from 'vitest';
import {
  analyzeRelationship,
  detectDuplicatePairs,
  detectSemanticRelations,
  toCanonicalRelationships,
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

describe('Piece 2.4 semantic relations', () => {
  it('REQ032 vs REQ014 → INDEPENDENT (no edge)', () => {
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
    expect(kindOf(pairs, 'REQ-014', 'REQ-032')).toBeUndefined();
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
    expect(k === 'RELATED' || k === 'SEQUENTIAL').toBe(true);
    expect(k).not.toBe('DUPLICATE');
  });

  it('REQ010 search vs REQ011 search results → SEQUENTIAL', () => {
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
        (p.requirementKeyA === 'REQ-010' &&
          p.requirementKeyB === 'REQ-011') ||
        (p.requirementKeyA === 'REQ-011' &&
          p.requirementKeyB === 'REQ-010'),
    );
    expect(pair?.kind).toBe('SEQUENTIAL');
  });

  it('acceptance: Open Order is order_details, not product_details', () => {
    const n = normalizeRequirement({
      requirementKey: 'REQ-030',
      title: 'Open An Order To View Its Details',
      description: 'Users can open an order to view its details.',
    });
    expect(n.capability).toBe('order_details');
    expect(n.entity[0]).toBe('order');
    expect(
      analyzeRelationship(
        {
          requirementKey: 'REQ-030',
          title: 'Open An Order To View Its Details',
          description: 'Users can open an order to view its details.',
        },
        {
          requirementKey: 'REQ-010',
          title: 'Product Search',
          description:
            'Users should be able to search for products using the search bar.',
        },
      ),
    ).toBe('NOT_RELATED');
  });

  it('canonical relationships omit independent pairs', () => {
    const rels = toCanonicalRelationships([
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
      },
    ]);
    expect(rels).toHaveLength(0);
  });
});

describe('false duplicate guards', () => {
  it('password reset is related to OTP delivery, not duplicate', () => {
    expect(
      analyzeRelationship(
        {
          requirementKey: 'REQ-006',
          title: 'Password Reset',
          description:
            'The user should be able to reset their password using OTP.',
        },
        {
          requirementKey: 'REQ-007',
          title: 'OTP Delivery',
          description:
            "The OTP will be sent to the user's registered email address.",
        },
      ),
    ).toBe('RELATED');
  });

  it('product search is related to product filtering, not duplicate', () => {
    expect(
      analyzeRelationship(
        {
          requirementKey: 'REQ-010',
          title: 'Product Search',
          description:
            'Users should be able to search for products using the search bar.',
        },
        {
          requirementKey: 'REQ-012',
          title: 'Product Filtering',
          description:
            'Users should also be able to filter products by category and price.',
        },
      ),
    ).toBe('RELATED');
  });

  it('admin allow vs user deny are RELATED access-control peers', () => {
    expect(
      analyzeRelationship(
        {
          requirementKey: 'REQ-041',
          title: 'Have Access To Administrative Functionality',
          description:
            'Administrators should have access to administrative functionality.',
        },
        {
          requirementKey: 'REQ-042',
          title: 'Normal Users Should Not Have Administrator',
          description:
            'Normal users should not have administrator permissions.',
        },
      ),
    ).toBe('RELATED');
  });
});

describe('Requirement semantic relationships', () => {
  const adminAddProduct = {
    requirementKey: 'REQ-032',
    title: 'Add Product',
    description: 'Administrators should be able to add new products.',
  };
  const addProductToCart = {
    requirementKey: 'REQ-014',
    title: 'Add Product To Cart',
    description:
      'Users should be able to add an available product to their cart.',
  };
  const createProduct = adminAddProduct;
  const deleteProduct = {
    requirementKey: 'REQ-034',
    title: 'Remove Product',
    description: 'Administrators should be able to remove products.',
  };
  const updateProduct = {
    requirementKey: 'REQ-033',
    title: 'Update Product',
    description:
      'Administrators should be able to update product information.',
  };
  const updateInventory = {
    requirementKey: 'REQ-035',
    title: 'Update Product Inventory',
    description:
      'Administrators should be able to update product inventory.',
  };
  const confirmationPage = {
    requirementKey: 'REQ-026',
    title: 'Order Confirmation',
    description:
      'The confirmation page should display product information.',
  };
  const confirmationEmail = {
    requirementKey: 'REQ-027',
    title: 'Order Confirmation',
    description: 'The user should receive an order confirmation email.',
  };
  const search = {
    requirementKey: 'REQ-010',
    title: 'Product Search',
    description:
      'Users should be able to search for products using the search bar.',
  };
  const searchResultSelection = {
    requirementKey: 'REQ-011',
    title: 'Product Search Results',
    description:
      'Users can select a product from search results to view its details.',
  };

  test('admin add product is independent of add to cart', () => {
    expect(analyzeRelationship(adminAddProduct, addProductToCart)).toBe(
      'NOT_RELATED',
    );
  });

  test('create and delete product are related', () => {
    expect(analyzeRelationship(createProduct, deleteProduct)).toBe('RELATED');
  });

  test('product information and inventory update are related', () => {
    expect(analyzeRelationship(updateProduct, updateInventory)).toBe(
      'RELATED',
    );
  });

  test('confirmation page and confirmation email are related', () => {
    expect(analyzeRelationship(confirmationPage, confirmationEmail)).toBe(
      'RELATED',
    );
  });

  test('search and selecting search result are sequential', () => {
    expect(analyzeRelationship(search, searchResultSelection)).toBe(
      'SEQUENTIAL',
    );
  });
});
