/**
 * Business-capability feature grouping (Area → Feature → Requirements).
 * Groups by business purpose — not customer journey alone.
 */

import type { FeatureGroupDraft } from './types.js';

export type GroupableRequirement = {
  requirementKey: string;
  title: string;
  description: string;
  sourceSection?: string | null;
  sourceText?: string | null;
  type?: string | null;
};

type FeatureDef = {
  name: string;
  businessArea: string;
  businessCapability: string;
  businessIntent: string;
  /** Higher = stronger preference when multiple match */
  weight: number;
  patterns: RegExp[];
  /** Negative patterns reduce score */
  exclude?: RegExp[];
};

const FEATURE_DEFS: FeatureDef[] = [
  // --- Account ---
  {
    name: 'User Registration',
    businessArea: 'Account Management',
    businessCapability: 'Create and validate new customer accounts.',
    businessIntent:
      'Allow new customers to create accounts with unique credentials so they can access authenticated commerce features.',
    weight: 10,
    patterns: [
      /register/,
      /registration/,
      /sign up/,
      /create an account/,
      /unique email/,
    ],
  },
  {
    name: 'User Login',
    businessArea: 'Account Management',
    businessCapability: 'Authenticate returning customers.',
    businessIntent:
      'Allow registered customers to authenticate securely and access their account-specific shopping and order data.',
    weight: 10,
    patterns: [
      /\blogin\b/,
      /sign in/,
      /invalid credential/,
      /failed login/,
      /account.*lock/,
    ],
    exclude: [/password reset/, /forgot password/, /\botp\b/],
  },
  {
    name: 'Password Reset',
    businessArea: 'Account Management',
    businessCapability: 'Restore account access after credential loss.',
    businessIntent:
      'Allow users who cannot access their password to securely regain account access through OTP-based verification.',
    weight: 12,
    patterns: [
      /password reset/,
      /reset password/,
      /forgot password/,
      /\botp\b/,
    ],
  },
  {
    name: 'User Profile',
    businessArea: 'Account Management',
    businessCapability: 'Manage personal account information.',
    businessIntent:
      'Allow customers to view and maintain their profile information while protecting identity-critical fields.',
    weight: 9,
    patterns: [/profile/, /change.*email/, /email address.*change/, /update.*profile/],
  },

  // --- Product catalog ---
  {
    name: 'Product Search',
    businessArea: 'Product Management',
    businessCapability: 'Discover products in the catalog.',
    businessIntent:
      'Allow customers to quickly discover relevant products and narrow results using available filters.',
    weight: 11,
    patterns: [/search product/, /product search/, /search result/, /\bsearch\b.*\bproduct/, /filter.*product/],
  },
  {
    name: 'Product Details',
    businessArea: 'Product Management',
    businessCapability: 'Present product information for purchase decisions.',
    businessIntent:
      'Allow customers to evaluate a product’s attributes, availability, and pricing before adding it to the cart.',
    weight: 10,
    patterns: [/product detail/, /view product/, /product page/, /product information/],
    exclude: [
      /admin/,
      /administrator/,
      /manage product/,
      /open (an? )?order/,
      /order details?/,
      /view (an? )?order/,
    ],
  },
  {
    name: 'Product Reviews',
    businessArea: 'Engagement',
    businessCapability: 'Collect and display customer product feedback.',
    businessIntent:
      'Allow eligible customers to share product experiences that help other shoppers make purchase decisions.',
    weight: 10,
    patterns: [/\breview\b/, /rating/, /purchased.*review/],
    exclude: [/code review/, /review status/],
  },

  // --- Shopping ---
  {
    name: 'Shopping Cart',
    businessArea: 'Shopping',
    businessCapability: 'Maintain selected products before purchase.',
    businessIntent:
      'Allow customers to collect desired products and adjust quantities before starting checkout.',
    weight: 11,
    patterns: [
      /\bcart\b/,
      /shopping cart/,
      /add to cart/,
      /add product.*cart/,
      /remove.*cart/,
      /cart total/,
    ],
    exclude: [/admin/, /administrator/],
  },

  // --- Purchase ---
  {
    name: 'Checkout',
    businessArea: 'Purchase',
    businessCapability: 'Capture delivery and order setup before payment.',
    businessIntent:
      'Allow customers to provide delivery information and create an order before payment is processed.',
    weight: 12,
    patterns: [/checkout/, /proceed to checkout/, /shipping address/, /billing address/],
    exclude: [/checkout performance/, /performance.*checkout/],
  },
  {
    name: 'Payment',
    businessArea: 'Purchase',
    businessCapability: 'Process customer payments securely.',
    businessIntent:
      'Allow customers to complete an order using supported payment methods while preventing invalid orders when payment fails.',
    weight: 13,
    patterns: [
      /\bpayment\b/,
      /pay for/,
      /payment method/,
      /payment fail/,
      /payment success/,
      /payment process/,
    ],
  },

  // --- Orders ---
  {
    name: 'Order Confirmation',
    businessArea: 'Purchase',
    businessCapability: 'Confirm successful order creation to the customer.',
    businessIntent:
      'Inform customers that their order was successfully created and provide the confirmation details they need next.',
    weight: 11,
    patterns: [/order confirmation/, /confirm.*order/, /confirmation email.*order/],
  },
  {
    name: 'Order History',
    businessArea: 'Purchase',
    businessCapability: 'Let customers review past purchases.',
    businessIntent:
      'Allow customers to view their previous orders and track purchase history over time.',
    weight: 10,
    patterns: [/order history/, /past orders/, /previous orders/, /my orders/],
  },
  {
    name: 'Order Details',
    businessArea: 'Purchase',
    businessCapability: 'Let customers inspect a single order.',
    businessIntent:
      'Allow customers to open an order and view its line items, totals, and status details.',
    weight: 12,
    patterns: [
      /open (an? )?order/,
      /view (an? )?order/,
      /order details?/,
      /view its details.*order|order.*view its details/,
      /each order should/,
    ],
    exclude: [/product detail/, /search result/, /confirmation/],
  },
  {
    name: 'Order Access',
    businessArea: 'Purchase',
    businessCapability: 'Enforce ownership boundaries on order data.',
    businessIntent:
      'Ensure customers can only access their own order information and cannot view another user’s orders.',
    weight: 12,
    patterns: [/order access/, /another user.*order/, /own orders?/, /access control.*order/],
  },
  {
    name: 'Order Cancellation',
    businessArea: 'Purchase',
    businessCapability: 'Control when customers may cancel orders.',
    businessIntent:
      'Allow customers to cancel eligible orders before fulfillment reaches a restricted state.',
    weight: 12,
    patterns: [/cancel.*order/, /order.*cancel/, /cancellation/],
  },

  // --- Admin ---
  {
    name: 'Product Administration',
    businessArea: 'Administration',
    businessCapability: 'Enable administrators to manage the product catalog.',
    businessIntent:
      'Allow authorized administrators to add, update, and remove products while preventing unauthorized catalog changes.',
    weight: 14,
    patterns: [
      /admin/,
      /administrator/,
      /manage product/,
      /add product/,
      /update product/,
      /delete product/,
      /remove product/,
    ],
    exclude: [
      /add to cart/,
      /shopping cart/,
      /inventory/,
      /stock/,
      /out of stock/,
      /out-of-stock/,
    ],
  },

  // --- Inventory ---
  {
    name: 'Inventory / Stock Rules',
    businessArea: 'Inventory',
    businessCapability: 'Protect purchase integrity against unavailable stock.',
    businessIntent:
      'Prevent customers from purchasing products that are not available and keep cart/checkout aligned with inventory.',
    weight: 15,
    patterns: [
      /out of stock/,
      /out-of-stock/,
      /inventory/,
      /stock rule/,
      /stock level/,
      /cannot be purchased/,
      /available inventory/,
      /update.*inventory/,
      /inventory.*update/,
    ],
  },

  // --- Security / NFR ---
  {
    name: 'Password Security',
    businessArea: 'Security',
    businessCapability: 'Protect credentials and authentication secrets.',
    businessIntent:
      'Ensure passwords and authentication credentials are stored and handled in a way that reduces account takeover risk.',
    weight: 12,
    patterns: [
      /password.*(hash|encrypt|bcrypt|security)/,
      /secure.*password/,
      /credential.*stor/,
      /password policy/,
    ],
  },
  {
    name: 'Application Performance',
    businessArea: 'Performance',
    businessCapability: 'Meet system responsiveness expectations.',
    businessIntent:
      'Ensure the application responds within acceptable time limits under expected customer load.',
    weight: 11,
    patterns: [
      /performance/,
      /response time/,
      /latency/,
      /load time/,
      /scalability/,
    ],
    exclude: [/checkout performance/],
  },
  {
    name: 'Checkout Performance',
    businessArea: 'Performance',
    businessCapability: 'Keep checkout responsive during purchase completion.',
    businessIntent:
      'Ensure checkout remains responsive so customers can complete purchases without performance-related abandonment.',
    weight: 12,
    patterns: [/checkout.*performance/, /performance.*checkout/],
  },
  {
    name: 'Browser Compatibility',
    businessArea: 'Compatibility',
    businessCapability: 'Support required desktop browsers.',
    businessIntent:
      'Ensure customers can use core shopping flows across the browsers the business commits to support.',
    weight: 10,
    patterns: [/browser compatibility/, /supported browser/, /chrome|firefox|safari|edge/],
  },
  {
    name: 'Mobile Usability',
    businessArea: 'Compatibility',
    businessCapability: 'Support usable mobile shopping experiences.',
    businessIntent:
      'Ensure customers can complete key shopping tasks on mobile devices with an usable layout and interaction model.',
    weight: 10,
    patterns: [/mobile/, /responsive/, /usability/, /touch/],
  },
  {
    name: 'Error Messages',
    businessArea: 'Error Handling',
    businessCapability: 'Communicate failures clearly to users.',
    businessIntent:
      'Ensure customers receive clear, actionable feedback when validation or system errors occur.',
    weight: 9,
    patterns: [/error message/, /display.*error/, /show.*error/, /error handling/],
    exclude: [/payment fail/, /order creation fails/],
  },
  {
    name: 'Notifications',
    businessArea: 'Notifications',
    businessCapability: 'Deliver operational messages to customers.',
    businessIntent:
      'Inform customers about important account, order, or payment events through the appropriate notification channel.',
    weight: 8,
    patterns: [/notification/, /email notification/, /sms/, /alert/],
  },
  {
    name: 'Reporting',
    businessArea: 'Reporting',
    businessCapability: 'Provide operational or business reports.',
    businessIntent:
      'Allow authorized users to obtain reports needed to monitor business and operational outcomes.',
    weight: 8,
    patterns: [/\breport\b/, /analytics dashboard/, /sales report/],
  },
  {
    name: 'Integration',
    businessArea: 'Integration',
    businessCapability: 'Exchange data with external systems.',
    businessIntent:
      'Enable reliable integration with external services required for commerce operations.',
    weight: 8,
    patterns: [/integration/, /third[- ]party/, /webhook/, /api gateway/],
  },
];

/** Ordered feature dependency edges for journey relationships (not grouping). */
export const FEATURE_DEPENDENCY_EDGES: Array<[string, string]> = [
  ['Product Details', 'Product Search'],
  ['Shopping Cart', 'Product Details'],
  ['Checkout', 'Shopping Cart'],
  ['Payment', 'Checkout'],
  ['Order Confirmation', 'Payment'],
  ['Order History', 'Order Confirmation'],
  ['Order Access', 'Order History'],
  ['Product Reviews', 'Order Confirmation'],
];

function blobOf(r: GroupableRequirement): string {
  return `${r.title}\n${r.description}\n${r.sourceSection ?? ''}\n${r.sourceText ?? ''}\n${r.type ?? ''}`.toLowerCase();
}

function scoreFeature(r: GroupableRequirement, def: FeatureDef): number {
  const blob = blobOf(r);
  let score = 0;
  for (const p of def.patterns) {
    if (p.test(blob)) score += def.weight;
  }
  if (def.exclude?.some((p) => p.test(blob))) score -= def.weight * 2;
  if (r.sourceSection) {
    const sec = r.sourceSection.toLowerCase();
    if (sec.includes(def.name.toLowerCase().slice(0, 10))) score += 4;
    if (sec.includes(def.businessArea.toLowerCase().slice(0, 8))) score += 2;
  }
  // Title exact-ish boost
  const title = r.title.toLowerCase();
  if (title.includes(def.name.toLowerCase())) score += 8;
  return score;
}

export function matchFeature(r: GroupableRequirement): FeatureDef | null {
  let best: { def: FeatureDef; score: number } | null = null;
  for (const def of FEATURE_DEFS) {
    const score = scoreFeature(r, def);
    if (score > 0 && (!best || score > best.score)) {
      best = { def, score };
    }
  }
  // Require a minimum confidence to avoid dumping into weak matches
  if (!best || best.score < 8) return null;
  return best.def;
}

/**
 * Assign each requirement to exactly one feature by business capability.
 * Unmatched → Other / Unclassified (rare).
 */
export function groupRequirementsIntoFeatures(
  requirements: GroupableRequirement[],
): FeatureGroupDraft[] {
  const buckets = new Map<string, FeatureGroupDraft>();
  let seq = 1;

  const ensure = (def: {
    name: string;
    businessArea: string;
    businessCapability: string;
    businessIntent: string;
  }) => {
    const mapKey = `${def.businessArea}::${def.name}`;
    let g = buckets.get(mapKey);
    if (!g) {
      g = {
        featureKey: `FG-${String(seq).padStart(3, '0')}`,
        name: def.name,
        businessArea: def.businessArea,
        businessCapability: def.businessCapability,
        businessIntent: def.businessIntent,
        requirementKeys: [],
      };
      seq += 1;
      buckets.set(mapKey, g);
    }
    return g;
  };

  for (const r of requirements) {
    const matched = matchFeature(r);
    const g = ensure(
      matched ?? {
        name: 'Unclassified',
        businessArea: 'Other',
        businessCapability: 'Review manually for correct business capability.',
        businessIntent:
          'Classify this requirement into a meaningful business area during review.',
      },
    );
    g.requirementKeys.push(r.requirementKey);
  }

  return [...buckets.values()].sort(
    (a, b) =>
      a.businessArea.localeCompare(b.businessArea) ||
      a.name.localeCompare(b.name),
  );
}

/** Feature review status from requirement review statuses only (not impact). */
export function deriveFeatureStatus(
  statuses: Array<string | null | undefined>,
): string {
  const rank = (s: string | null | undefined) => {
    if (s === 'BLOCKED') return 0;
    if (s === 'NEEDS_CLARIFICATION') return 1;
    if (s === 'REVIEW_RECOMMENDED') return 2;
    if (s === 'READY_FOR_TEST_DESIGN') return 3;
    return 4;
  };
  if (!statuses.length) return 'REVIEW_RECOMMENDED';
  return [...statuses].sort((a, b) => rank(a) - rank(b))[0] ?? 'REVIEW_RECOMMENDED';
}

/** Highest business impact among requirements (importance, not status). */
export function deriveFeatureImpact(
  impacts: Array<string | null | undefined>,
): string {
  const rank = (s: string | null | undefined) => {
    if (s === 'CRITICAL') return 0;
    if (s === 'HIGH') return 1;
    if (s === 'MEDIUM') return 2;
    if (s === 'LOW') return 3;
    return 4;
  };
  if (!impacts.length) return 'MEDIUM';
  return [...impacts].sort((a, b) => rank(a) - rank(b))[0] ?? 'MEDIUM';
}

export type FeatureAggregationInput = {
  businessImpacts: Array<string | null | undefined>;
  reviewStatuses: Array<string | null | undefined>;
  openQuestionPriorities: Array<string | null | undefined>;
  openConflictCount?: number;
};

export function countByImpact(impacts: Array<string | null | undefined>) {
  return {
    critical: impacts.filter((i) => i === 'CRITICAL').length,
    high: impacts.filter((i) => i === 'HIGH').length,
    medium: impacts.filter((i) => i === 'MEDIUM').length,
    low: impacts.filter((i) => i === 'LOW').length,
  };
}

export function countByReviewStatus(statuses: Array<string | null | undefined>) {
  return {
    blocked: statuses.filter((s) => s === 'BLOCKED').length,
    needsClarification: statuses.filter((s) => s === 'NEEDS_CLARIFICATION')
      .length,
    reviewRecommended: statuses.filter((s) => s === 'REVIEW_RECOMMENDED')
      .length,
    ready: statuses.filter((s) => s === 'READY_FOR_TEST_DESIGN').length,
  };
}

/**
 * Feature risk blends importance + unresolved gaps + conflicts.
 * Distinct from businessImpact and reviewStatus.
 */
export function deriveFeatureRisk(input: FeatureAggregationInput): {
  risk: string;
  reason: string;
} {
  const impact = countByImpact(input.businessImpacts);
  const status = countByReviewStatus(input.reviewStatuses);
  const criticalQs = input.openQuestionPriorities.filter(
    (p) => p === 'CRITICAL',
  ).length;
  const highQs = input.openQuestionPriorities.filter((p) => p === 'HIGH').length;
  const conflicts = input.openConflictCount ?? 0;

  if (status.blocked > 0 || criticalQs > 0 || conflicts > 0) {
    return {
      risk: 'CRITICAL',
      reason:
        conflicts > 0
          ? 'Open business conflicts require clarification before safe test design.'
          : status.blocked > 0
            ? 'One or more requirements are blocked by unresolved critical business gaps.'
            : 'Critical business questions remain unresolved.',
    };
  }

  if (impact.critical > 0 && (status.needsClarification > 0 || highQs > 0)) {
    return {
      risk: 'CRITICAL',
      reason:
        'Critical business capabilities still have unresolved high-priority clarification needs.',
    };
  }

  if (impact.critical > 0) {
    return {
      risk: 'HIGH',
      reason: 'Contains critical business capabilities that require careful test design.',
    };
  }

  if (status.needsClarification > 0 || highQs > 0 || impact.high > 0) {
    return {
      risk: 'HIGH',
      reason: 'Important business behavior still needs clarification or has high business impact.',
    };
  }

  if (status.reviewRecommended > 0) {
    return {
      risk: 'MEDIUM',
      reason: 'Minor review gaps remain for this feature.',
    };
  }

  return {
    risk: 'LOW',
    reason: 'No major unresolved business gaps detected for this feature.',
  };
}

export function summarizeFeature(input: FeatureAggregationInput & {
  requirementCount: number;
}) {
  const impactCounts = countByImpact(input.businessImpacts);
  const statusCounts = countByReviewStatus(input.reviewStatuses);
  const reviewStatus = deriveFeatureStatus(input.reviewStatuses);
  const businessImpact = deriveFeatureImpact(input.businessImpacts);
  const { risk, reason } = deriveFeatureRisk(input);
  return {
    requirementCount: input.requirementCount,
    impactCounts,
    statusCounts,
    openQuestionCount: input.openQuestionPriorities.length,
    businessImpact,
    reviewStatus,
    featureRisk: risk,
    featureRiskReason: reason,
  };
}
