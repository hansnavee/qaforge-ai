/**
 * Permanent Step 2 golden regression suite.
 * Run on every relationship-logic change: pnpm --filter @qaforge/shared test
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeRelationship,
  toCanonicalRelationships,
} from './duplicates.js';
import { normalizeRequirement } from './normalized-requirement.js';
import { groupRequirementsIntoFeatures } from './feature-grouping.js';
import { generateSemanticTitle } from '../requirement-extraction/normalize-requirements.js';

const fixtures = {
  uniqueEmail: {
    requirementKey: 'G-UE',
    title: 'Unique Email',
    description:
      'An email address must be unique for each user account.',
    type: 'BUSINESS_RULE',
  },
  oneAccount: {
    requirementKey: 'G-OA',
    title: 'One Account Per Email',
    description:
      'A user email address can only be associated with one account.',
    type: 'BUSINESS_RULE',
  },
  registration: {
    requirementKey: 'G-REG',
    title: 'User Registration',
    description: 'Users can register using their email and password.',
  },
  login: {
    requirementKey: 'G-LOGIN',
    title: 'User Login',
    description: 'Users can login using their registered email and password.',
  },
  search: {
    requirementKey: 'G-SEARCH',
    title: 'Product Search',
    description:
      'Users should be able to search for products using the search bar.',
  },
  searchResults: {
    requirementKey: 'G-RESULTS',
    title: 'Product Search Results',
    description:
      'Users can select a product from search results to view its details.',
  },
  filter: {
    requirementKey: 'G-FILTER',
    title: 'Product Filtering',
    description:
      'Users should also be able to filter products by category and price.',
  },
  adminAdd: {
    requirementKey: 'G-ADD',
    title: 'Add Product',
    description: 'Administrators should be able to add new products.',
  },
  adminUpdate: {
    requirementKey: 'G-UPD',
    title: 'Update Product',
    description:
      'Administrators should be able to update product information.',
  },
  addToCart: {
    requirementKey: 'G-CART',
    title: 'Add Product To Cart',
    description:
      'Users should be able to add an available product to their cart.',
  },
  oos: {
    requirementKey: 'G-OOS',
    title: 'Out Of Stock Purchase Rule',
    description: 'Out-of-stock products cannot be purchased.',
    type: 'BUSINESS_RULE',
  },
  openOrder: {
    requirementKey: 'G-OPEN',
    title: 'Open An Order To View Its Details',
    description: 'Users can open an order to view its details.',
  },
  otpExpire: {
    requirementKey: 'G-OTP',
    title: 'OTP Expiration',
    description: 'The OTP should expire after a limited time.',
  },
  confirmPage: {
    requirementKey: 'G-CONF-P',
    title: 'Order Confirmation',
    description:
      'The confirmation page should display product information.',
  },
  confirmEmail: {
    requirementKey: 'G-CONF-E',
    title: 'Order Confirmation Email',
    description: 'The user should receive an order confirmation email.',
  },
  adminAccess: {
    requirementKey: 'G-ADMIN',
    title: 'Have Access To Administrative Functionality',
    description:
      'Administrators should have access to administrative functionality.',
  },
  userDeny: {
    requirementKey: 'G-DENY',
    title: 'Normal Users Should Not Have Administrator',
    description:
      'Normal users should not have administrator permissions.',
  },
};

describe('Step 2 golden regression', () => {
  it('1. Unique Email ↔ One Account → DUPLICATE', () => {
    expect(
      analyzeRelationship(fixtures.uniqueEmail, fixtures.oneAccount),
    ).toBe('DUPLICATE');
  });

  it('1b. Unique Email ↔ Registration → BUSINESS_RULE_CONSTRAINT', () => {
    expect(
      analyzeRelationship(fixtures.uniqueEmail, fixtures.registration),
    ).toBe('BUSINESS_RULE_CONSTRAINT');
  });

  it('2. Registration ↔ Login → SEQUENTIAL', () => {
    expect(
      analyzeRelationship(fixtures.registration, fixtures.login),
    ).toBe('SEQUENTIAL');
  });

  it('3. Search ↔ Search Results → SEQUENTIAL', () => {
    expect(
      analyzeRelationship(fixtures.search, fixtures.searchResults),
    ).toBe('SEQUENTIAL');
  });

  it('4. Search ↔ Filter → RELATED', () => {
    expect(analyzeRelationship(fixtures.search, fixtures.filter)).toBe(
      'RELATED',
    );
  });

  it('5. Add Product ↔ Update Product → RELATED (CRUD)', () => {
    expect(
      analyzeRelationship(fixtures.adminAdd, fixtures.adminUpdate),
    ).toBe('RELATED');
  });

  it('6. Add To Cart ↔ Out Of Stock → BUSINESS_RULE_CONSTRAINT', () => {
    expect(analyzeRelationship(fixtures.addToCart, fixtures.oos)).toBe(
      'BUSINESS_RULE_CONSTRAINT',
    );
  });

  it('7. Open Order ↔ Product Search → INDEPENDENT (no edge)', () => {
    expect(
      analyzeRelationship(fixtures.openOrder, fixtures.search),
    ).toBe('NOT_RELATED');
    const n = normalizeRequirement(fixtures.openOrder);
    expect(n.capability).toBe('order_details');
    expect(n.entity[0]).toBe('order');
  });

  it('8. Out Of Stock ↔ OTP Expiration → INDEPENDENT', () => {
    expect(analyzeRelationship(fixtures.oos, fixtures.otpExpire)).toBe(
      'NOT_RELATED',
    );
  });

  it('9. Confirmation Page ↔ Confirmation Email → RELATED', () => {
    expect(
      analyzeRelationship(fixtures.confirmPage, fixtures.confirmEmail),
    ).toBe('RELATED');
  });

  it('10. Admin Add ↔ Customer Add To Cart → INDEPENDENT', () => {
    expect(
      analyzeRelationship(fixtures.adminAdd, fixtures.addToCart),
    ).toBe('NOT_RELATED');
  });

  it('11. Admin Access ↔ Normal User Deny → RELATED (access control)', () => {
    expect(
      analyzeRelationship(fixtures.adminAccess, fixtures.userDeny),
    ).toBe('RELATED');
  });

  it('does not persist NOT_DUPLICATE / independent edges', () => {
    const rels = toCanonicalRelationships([
      fixtures.openOrder,
      fixtures.search,
      fixtures.oos,
      fixtures.otpExpire,
      fixtures.adminAdd,
      fixtures.addToCart,
      fixtures.registration,
      fixtures.login,
      fixtures.searchResults,
      fixtures.oos,
      fixtures.addToCart,
    ]);
    expect(rels.every((r) => r.relationship !== 'NOT_DUPLICATE')).toBe(true);
    const openSearch = rels.find(
      (r) =>
        (r.sourceRequirementId === 'G-OPEN' &&
          r.targetRequirementId === 'G-SEARCH') ||
        (r.sourceRequirementId === 'G-SEARCH' &&
          r.targetRequirementId === 'G-OPEN'),
    );
    expect(openSearch).toBeUndefined();
    const oosOtp = rels.find(
      (r) =>
        (r.sourceRequirementId === 'G-OOS' &&
          r.targetRequirementId === 'G-OTP') ||
        (r.sourceRequirementId === 'G-OTP' &&
          r.targetRequirementId === 'G-OOS'),
    );
    expect(oosOtp).toBeUndefined();
    // Positive edges still present
    expect(
      rels.some((r) => r.relationship === 'SEQUENTIAL'),
    ).toBe(true);
    expect(
      rels.some((r) => r.relationship === 'BUSINESS_RULE_CONSTRAINT'),
    ).toBe(true);
  });

  it('titles: open order / checkout / profile are not truncated', () => {
    expect(
      generateSemanticTitle(
        'Users can open an order to view its details.',
        null,
        'FUNCTIONAL',
      ),
    ).toBe('View Order Details');
    expect(
      generateSemanticTitle(
        'The checkout page should contain mandatory delivery information.',
        null,
        'FUNCTIONAL',
      ),
    ).toBe('Checkout Required Fields');
    expect(
      generateSemanticTitle(
        'The profile should contain the user name and contact information.',
        null,
        'FUNCTIONAL',
      ),
    ).toBe('User Profile Information');
  });

  it('feature grouping: open order → Purchase / Order Details', () => {
    const groups = groupRequirementsIntoFeatures([fixtures.openOrder]);
    const g = groups.find((x) => x.requirementKeys.includes('G-OPEN'));
    expect(g?.name).toBe('Order Details');
    expect(g?.businessArea).toBe('Purchase');
  });
});
