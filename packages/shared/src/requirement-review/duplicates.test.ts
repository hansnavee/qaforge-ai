import { describe, expect, it } from 'vitest';
import { detectDuplicatePairs } from './duplicates.js';
import { buildSemanticProfile } from './semantic-profile.js';
import { detectBusinessConflicts } from './relationships.js';

describe('Piece 2.1 semantic duplicate intelligence', () => {
  it('REQ014 cart add vs REQ032 admin add → NOT_DUPLICATE', () => {
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
      },
    ]);
    const pair = pairs.find(
      (p) =>
        (p.requirementKeyA === 'REQ-014' && p.requirementKeyB === 'REQ-032') ||
        (p.requirementKeyA === 'REQ-032' && p.requirementKeyB === 'REQ-014'),
    );
    expect(pair?.kind).toBe('NOT_DUPLICATE');
    expect(pair?.reason).toMatch(/actor|entity|catalog|cart/i);
  });

  it('REQ032 add vs REQ034 remove → NOT_DUPLICATE (CRUD)', () => {
    const pairs = detectDuplicatePairs([
      {
        requirementKey: 'REQ-032',
        title: 'Add Product',
        description: 'Administrators should be able to add new products.',
      },
      {
        requirementKey: 'REQ-034',
        title: 'Remove Product',
        description: 'Administrators should be able to remove products.',
      },
    ]);
    const pair = pairs.find(
      (p) =>
        p.requirementKeyA === 'REQ-032' && p.requirementKeyB === 'REQ-034',
    );
    expect(pair?.kind).toBe('NOT_DUPLICATE');
    expect(pair?.sameFeatureDifferentOps).toBe(true);
    expect(pairs.every((p) => p.kind !== 'DUPLICATE')).toBe(true);
  });

  it('REQ033 update product vs REQ035 update inventory → RELATED', () => {
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
    expect(pairs.some((p) => p.kind === 'RELATED')).toBe(true);
    expect(pairs.every((p) => p.kind !== 'DUPLICATE')).toBe(true);
  });

  it('confirmation page vs confirmation email → RELATED', () => {
    const pairs = detectDuplicatePairs([
      {
        requirementKey: 'REQ-026',
        title: 'Order Confirmation Page',
        description:
          'The confirmation page should display product information.',
      },
      {
        requirementKey: 'REQ-027',
        title: 'Order Confirmation Email',
        description:
          'The user should receive an order confirmation email.',
      },
    ]);
    const pair = pairs.find(
      (p) =>
        p.requirementKeyA === 'REQ-026' && p.requirementKeyB === 'REQ-027',
    );
    expect(pair?.kind).toBe('RELATED');
    expect(pair?.reason).toMatch(/channel/i);
  });

  it('identical confirmation page behavior → DUPLICATE', () => {
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
    const pair = pairs.find(
      (p) =>
        p.requirementKeyA === 'REQ-026' && p.requirementKeyB === 'REQ-027',
    );
    expect(pair?.kind).toBe('DUPLICATE');
    expect(pair?.showConfidence).toBe(true);
  });

  it('distinguishes cart_item vs product_catalog entities', () => {
    const cart = buildSemanticProfile({
      requirementKey: 'REQ-014',
      title: 'Add Product To Cart',
      description: 'Users should be able to add an available product to their cart.',
    });
    const admin = buildSemanticProfile({
      requirementKey: 'REQ-032',
      title: 'Add Product',
      description: 'Administrators should be able to add new products.',
    });
    expect(cart.entity).toBe('cart_item');
    expect(admin.entity).toBe('product_catalog');
    expect(cart.actor).toBe('customer');
    expect(admin.actor).toBe('administrator');
  });

  it('detects OTP validity conflicts without choosing a winner', () => {
    const conflicts = detectBusinessConflicts([
      {
        requirementKey: 'REQ-A',
        title: 'OTP Expiry',
        description: 'OTP expires after 10 minutes.',
        rulesText: 'OTP expires after 10 minutes.',
      },
      {
        requirementKey: 'REQ-B',
        title: 'OTP Validity',
        description: 'OTP remains valid for 15 minutes.',
        rulesText: 'OTP remains valid for 15 minutes.',
      },
    ]);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]?.detail).toMatch(/validity period/i);
  });
});
