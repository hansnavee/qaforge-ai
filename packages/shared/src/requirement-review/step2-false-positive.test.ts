/**
 * Regression: cross-domain RELATED false positives, implicit extraction,
 * duplicate over-matching, and BR constraints.
 */
import { describe, expect, it } from 'vitest';
import { analyzeRelationship, toCanonicalRelationships } from './duplicates.js';
import { extractStructuredSemanticsHeuristic } from './structured-semantics.js';
import { normalizeRequirement } from './normalized-requirement.js';

const adminPerms = {
  requirementKey: 'ADMIN-PERM',
  title: 'Have Access To Administrative Functionality',
  description:
    'Administrators should have access to administrative functionality.',
};
const adminDeny = {
  requirementKey: 'USER-DENY',
  title: 'Normal Users Should Not Have Administrator',
  description: 'Normal users should not have administrator permissions.',
};

describe('cross-domain pairs stay INDEPENDENT', () => {
  const cases: Array<[string, { requirementKey: string; title: string; description: string }]> = [
    [
      'Browser Compatibility',
      {
        requirementKey: 'NFR-BROWSER',
        title: 'Browser Compatibility',
        description:
          'The application should be compatible with modern browsers.',
      },
    ],
    [
      'Mobile Usability',
      {
        requirementKey: 'NFR-MOBILE',
        title: 'Mobile Usability',
        description: 'The application should be mobile friendly and easy to use.',
      },
    ],
    [
      'Application Performance',
      {
        requirementKey: 'NFR-PERF',
        title: 'Application Performance',
        description:
          'The application should respond within 3 seconds for common pages.',
      },
    ],
    [
      'Error Messages',
      {
        requirementKey: 'NFR-ERR',
        title: 'Provide Clear Error Messages',
        description: 'The application should display clear error messages.',
      },
    ],
    [
      'Product Review',
      {
        requirementKey: 'REV',
        title: 'Product Review',
        description: 'Users should be able to submit a product review.',
      },
    ],
  ];

  for (const [label, req] of cases) {
    it(`${label} ↔ Admin Permissions → INDEPENDENT`, () => {
      expect(analyzeRelationship(req, adminPerms)).toBe('NOT_RELATED');
      expect(analyzeRelationship(req, adminDeny)).toBe('NOT_RELATED');
    });
  }

  it('Out-of-stock ↔ OTP / Password Reset → INDEPENDENT', () => {
    const oos = {
      requirementKey: 'OOS',
      title: 'Out Of Stock Purchase Rule',
      description: 'Customers cannot buy an out-of-stock product.',
      type: 'BUSINESS_RULE',
    };
    expect(
      analyzeRelationship(oos, {
        requirementKey: 'OTP',
        title: 'OTP Expiration',
        description: 'The OTP should expire after 10 minutes.',
      }),
    ).toBe('NOT_RELATED');
    expect(
      analyzeRelationship(oos, {
        requirementKey: 'RESET',
        title: 'Password Reset',
        description:
          'The user should be able to reset their password using OTP.',
      }),
    ).toBe('NOT_RELATED');
  });

  it('Admin allow ↔ user deny remains RELATED (same access domain)', () => {
    expect(analyzeRelationship(adminPerms, adminDeny)).toBe('RELATED');
  });
});

describe('structured extraction — implicit object/action', () => {
  it('registered email cannot be changed', () => {
    const s = extractStructuredSemanticsHeuristic({
      requirementKey: 'EMAIL-LOCK',
      title: 'Profile Update Restrictions',
      description:
        'Users should not be allowed to change their registered email address.',
    });
    expect(s.actor).toBe('customer');
    expect(s.object).toBe('user_account');
    expect(s.action).toBe('update');
    expect(s.polarity).toBe('NOT_ALLOWED');
    expect(s.requirementType).toBe('BUSINESS_RULE');
    expect(s.condition).toBe('REGISTERED_EMAIL_IMMUTABLE');
    expect(s.capability).toBe('profile_email_restriction');

    const n = normalizeRequirement({
      requirementKey: 'EMAIL-LOCK',
      title: 'Profile Update Restrictions',
      description:
        'Users should not be allowed to change their registered email address.',
    });
    expect(n.entity[0]).toBe('user_account');
    expect(n.action[0]).toBe('update');
    expect(n.isBusinessRule).toBe(true);
  });

  it('out-of-stock purchase rule structure', () => {
    const s = extractStructuredSemanticsHeuristic({
      requirementKey: 'OOS',
      title: 'Out Of Stock',
      description: 'Customers cannot buy an out-of-stock product.',
    });
    expect(s.actor).toBe('customer');
    expect(s.action).toBe('purchase');
    expect(s.object).toBe('product');
    expect(s.condition).toBe('OUT_OF_STOCK');
    expect(s.polarity).toBe('NOT_ALLOWED');
    expect(s.requirementType).toBe('BUSINESS_RULE');
  });
});

describe('duplicate over-matching', () => {
  it('User Registration ↔ Registration Redirect is RELATED not DUPLICATE', () => {
    const kind = analyzeRelationship(
      {
        requirementKey: 'REG',
        title: 'User Registration',
        description: 'Users can create an account using their email and password.',
      },
      {
        requirementKey: 'REDIR',
        title: 'Registration Redirect',
        description:
          'After successful registration the user should be redirected to the login page.',
      },
    );
    expect(kind).toBe('RELATED');
    expect(kind).not.toBe('DUPLICATE');
  });

  it('Payment Methods ↔ Payment Processing is RELATED not DUPLICATE', () => {
    expect(
      analyzeRelationship(
        {
          requirementKey: 'PM',
          title: 'Payment Methods',
          description:
            'Users can pay using credit card or debit card payment methods.',
        },
        {
          requirementKey: 'PP',
          title: 'Payment Processing',
          description: 'The system should process payment for the order.',
        },
      ),
    ).toBe('RELATED');
  });

  it('Payment Methods ↔ Payment Failure Handling is RELATED not DUPLICATE', () => {
    expect(
      analyzeRelationship(
        {
          requirementKey: 'PM',
          title: 'Payment Methods',
          description:
            'Users can pay using credit card or debit card payment methods.',
        },
        {
          requirementKey: 'PF',
          title: 'Payment Failure Handling',
          description:
            'When payment fails, an order must not be created.',
        },
      ),
    ).toBe('RELATED');
  });
});

describe('business-rule constraints', () => {
  it('OOS constrains Add to Cart / Checkout via BUSINESS_RULE_CONSTRAINT', () => {
    const oos = {
      requirementKey: 'OOS',
      title: 'Out Of Stock Purchase Rule',
      description: 'Customers cannot buy an out-of-stock product.',
      type: 'BUSINESS_RULE',
    };
    expect(
      analyzeRelationship(oos, {
        requirementKey: 'CART',
        title: 'Add Product To Cart',
        description:
          'Users should be able to add an available product to their cart.',
      }),
    ).toBe('BUSINESS_RULE_CONSTRAINT');
    expect(
      analyzeRelationship(oos, {
        requirementKey: 'CHECKOUT',
        title: 'Proceed To Checkout',
        description: 'Users should be able to proceed to checkout from the cart.',
      }),
    ).toBe('BUSINESS_RULE_CONSTRAINT');
  });
});

describe('CONFLICT requires same capability/entity + opposite polarity', () => {
  const orderAccess = {
    requirementKey: 'REQ-040',
    title: 'Order Access Control',
    description:
      "Users should not be able to access another user's order information.",
    type: 'BUSINESS_RULE',
  };

  it('Profile Update ↔ Order Access Control → INDEPENDENT (false conflict)', () => {
    expect(
      analyzeRelationship(
        {
          requirementKey: 'REQ-037',
          title: 'Profile Update',
          description: 'Users should be able to update their profile information.',
        },
        orderAccess,
      ),
    ).toBe('NOT_RELATED');
  });

  it('Modify Product Quantity ↔ Order Access Control → INDEPENDENT', () => {
    expect(
      analyzeRelationship(
        {
          requirementKey: 'REQ-015',
          title: 'Modify Product Quantity',
          description:
            'Users can increase or decrease the quantity of products.',
        },
        orderAccess,
      ),
    ).toBe('NOT_RELATED');
  });

  it('cart / checkout wording vs order access is not CONFLICT', () => {
    expect(
      analyzeRelationship(
        {
          requirementKey: 'REQ-016',
          title: 'Remove Product From Cart',
          description: 'Users should be able to remove products from the cart.',
        },
        orderAccess,
      ),
    ).toBe('NOT_RELATED');
  });

  it('genuine opposite polarity on same capability/entity → CONFLICT', () => {
    expect(
      analyzeRelationship(
        {
          requirementKey: 'ORDER-ACCESS-ALLOW',
          title: 'Cross-User Order Access Allowed',
          description:
            "Users should be able to access another user's order information.",
        },
        {
          requirementKey: 'ORDER-ACCESS-DENY',
          title: 'Order Access Control',
          description:
            "Users should not be able to access another user's order information.",
          type: 'BUSINESS_RULE',
        },
      ),
    ).toBe('CONFLICT');
  });
});

describe('structured extraction for weak/general requirements', () => {
  it('password stored securely → actor/entity/action/capability', () => {
    const s = extractStructuredSemanticsHeuristic({
      requirementKey: 'REQ-039',
      title: 'Passwords Should Be Stored Securely',
      description: 'User passwords should be stored securely.',
      type: 'NON_FUNCTIONAL',
    });
    expect(s.actor).toBe('system');
    expect(s.object).toBe('password');
    expect(s.action).toBe('store');
    expect(s.capability).toBe('password_security');
    expect(s.requirementType).toBe('NON_FUNCTIONAL');
    expect(s.object).not.toBe('general');
    expect(s.action).not.toBe('unspecified');
  });

  it('order access control is not capability=general', () => {
    const n = normalizeRequirement({
      requirementKey: 'REQ-040',
      title: 'Order Access Control',
      description:
        "Users should not be able to access another user's order information.",
      type: 'BUSINESS_RULE',
    });
    expect(n.entity[0]).toBe('order');
    expect(n.capability).toBe('order_access');
    expect(n.polarity).toBe('NOT_ALLOWED');
  });
});

describe('truncated titles', () => {
  it('open-order description titles as View Order Details', async () => {
    const { generateSemanticTitle, isTruncatedTitle } = await import(
      '../requirement-extraction/normalize-requirements.js'
    );
    expect(isTruncatedTitle('Open An Order To View Its')).toBe(true);
    expect(
      generateSemanticTitle(
        'Users should be able to open an order to view its details.',
        null,
        'FUNCTIONAL',
      ),
    ).toBe('View Order Details');
  });
});

describe('RELATED is not a catch-all', () => {
  it('canonical graph omits cross-domain NFR↔admin edges', () => {
    const rels = toCanonicalRelationships([
      adminPerms,
      adminDeny,
      {
        requirementKey: 'NFR-BROWSER',
        title: 'Browser Compatibility',
        description:
          'The application should be compatible with modern browsers.',
      },
      {
        requirementKey: 'NFR-ERR',
        title: 'Provide Clear Error Messages',
        description: 'The application should display clear error messages.',
      },
      {
        requirementKey: 'OOS',
        title: 'Out Of Stock',
        description: 'Customers cannot buy an out-of-stock product.',
        type: 'BUSINESS_RULE',
      },
      {
        requirementKey: 'OTP',
        title: 'OTP Expiration',
        description: 'The OTP should expire after 10 minutes.',
      },
    ]);
    const has = (a: string, b: string) =>
      rels.some(
        (r) =>
          (r.sourceRequirementId === a && r.targetRequirementId === b) ||
          (r.sourceRequirementId === b && r.targetRequirementId === a),
      );
    expect(has('ADMIN-PERM', 'NFR-BROWSER')).toBe(false);
    expect(has('ADMIN-PERM', 'NFR-ERR')).toBe(false);
    expect(has('USER-DENY', 'NFR-BROWSER')).toBe(false);
    expect(has('OOS', 'OTP')).toBe(false);
    expect(has('ADMIN-PERM', 'USER-DENY')).toBe(true);
  });
});
