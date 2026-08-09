/**
 * Group requirements into Business Area → Feature (logical only; never merges/deletes).
 */

import type { FeatureGroupDraft } from './types.js';

export type GroupableRequirement = {
  requirementKey: string;
  title: string;
  description: string;
  sourceSection?: string | null;
  sourceText?: string | null;
};

type FeatureDef = {
  name: string;
  businessArea: string;
  patterns: RegExp[];
};

const FEATURE_DEFS: FeatureDef[] = [
  {
    name: 'User Registration',
    businessArea: 'Account Management',
    patterns: [/register/, /registration/, /sign up/, /create an account/, /unique email/],
  },
  {
    name: 'User Login',
    businessArea: 'Account Management',
    patterns: [/\blogin\b/, /sign in/, /invalid credential/, /failed login/, /lock/],
  },
  {
    name: 'Password Reset',
    businessArea: 'Account Management',
    patterns: [/password reset/, /reset password/, /\botp\b/, /forgot password/],
  },
  {
    name: 'User Profile',
    businessArea: 'Account Management',
    patterns: [/profile/, /email address.*change/, /change.*email/],
  },
  {
    name: 'Product Search',
    businessArea: 'Purchase',
    patterns: [/search product/, /product search/, /search result/],
  },
  {
    name: 'Product Details',
    businessArea: 'Purchase',
    patterns: [/product detail/, /view product/, /product page/],
  },
  {
    name: 'Shopping Cart',
    businessArea: 'Purchase',
    patterns: [/cart/, /add product/, /add to cart/, /shopping cart/, /out of stock/],
  },
  {
    name: 'Checkout',
    businessArea: 'Purchase',
    patterns: [/checkout/, /proceed to checkout/, /shipping address/, /billing/],
  },
  {
    name: 'Payment',
    businessArea: 'Purchase',
    patterns: [/\bpayment\b/, /pay for/, /payment method/, /payment fail/, /payment success/],
  },
  {
    name: 'Order Management',
    businessArea: 'Purchase',
    patterns: [
      /\border\b/,
      /order history/,
      /order detail/,
      /cancel.*order/,
      /order.*cancel/,
      /order confirmation/,
      /order access/,
    ],
  },
  {
    name: 'Product Reviews',
    businessArea: 'Engagement',
    patterns: [/review/, /rating/, /purchased.*review/],
  },
  {
    name: 'Product Administration',
    businessArea: 'Administration',
    patterns: [/admin/, /administrator/, /manage product/, /add product/, /delete product/, /update product/],
  },
  {
    name: 'Access Control',
    businessArea: 'Administration',
    patterns: [/access control/, /another user/, /own orders?/, /permission/],
  },
];

function blobOf(r: GroupableRequirement): string {
  return `${r.title}\n${r.description}\n${r.sourceSection ?? ''}\n${r.sourceText ?? ''}`.toLowerCase();
}

function matchFeature(r: GroupableRequirement): FeatureDef | null {
  const blob = blobOf(r);
  let best: { def: FeatureDef; score: number } | null = null;
  for (const def of FEATURE_DEFS) {
    let score = 0;
    for (const p of def.patterns) {
      if (p.test(blob)) score += 1;
    }
    // Prefer section name match
    if (
      r.sourceSection &&
      def.name.toLowerCase().includes(r.sourceSection.toLowerCase().slice(0, 12))
    ) {
      score += 2;
    }
    // Prefer admin feature when administrator language is present
    if (
      def.businessArea === 'Administration' &&
      /\b(admin|administrator)\b/.test(blob)
    ) {
      score += 3;
    }
    // Prefer payment over generic order when payment is the focus
    if (def.name === 'Payment' && /\bpayment\b/.test(blob)) {
      score += 2;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { def, score };
    }
  }
  return best?.def ?? null;
}

/**
 * Assign each requirement to exactly one feature group (best match).
 * Unmatched → "General" under business area "Other".
 */
export function groupRequirementsIntoFeatures(
  requirements: GroupableRequirement[],
): FeatureGroupDraft[] {
  const buckets = new Map<string, FeatureGroupDraft>();
  let seq = 1;

  const ensure = (def: { name: string; businessArea: string }) => {
    const mapKey = `${def.businessArea}::${def.name}`;
    let g = buckets.get(mapKey);
    if (!g) {
      g = {
        featureKey: `FG-${String(seq).padStart(3, '0')}`,
        name: def.name,
        businessArea: def.businessArea,
        requirementKeys: [],
        businessIntent: `Support ${def.name} within ${def.businessArea}.`,
      };
      seq += 1;
      buckets.set(mapKey, g);
    }
    return g;
  };

  for (const r of requirements) {
    const matched = matchFeature(r);
    const g = ensure(
      matched ?? { name: 'General', businessArea: 'Other' },
    );
    g.requirementKeys.push(r.requirementKey);
  }

  // Stable order by business area then name
  return [...buckets.values()].sort((a, b) =>
    a.businessArea.localeCompare(b.businessArea) || a.name.localeCompare(b.name),
  );
}

/** Feature status: worst requirement status wins. */
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
