/**
 * Semantic relationship detection (Step 2 / Piece 2.4).
 * Evidence-based — never uses similarity as the primary rule.
 * Default = INDEPENDENT (no edge). Never persist NOT_DUPLICATE spam.
 */

import type {
  DuplicateKind,
  DuplicatePair,
  RelationType,
  RequirementRelationship,
} from './types.js';
import { PERSISTABLE_RELATIONSHIPS } from './types.js';
import {
  buildSemanticProfile,
  type SemanticComparable,
} from './semantic-profile.js';
import {
  areSequentialCapabilities,
  capabilityFamily,
  normalizeRequirement,
  sameActor,
  sameCapability,
  sameEntity,
  type NormalizedRequirement,
} from './normalized-requirement.js';

export type DupComparable = SemanticComparable;

/** Internal lexical overlap only — supporting evidence, never primary. */
function tokenOverlap(a: string, b: string): number {
  const stop = new Set([
    'a',
    'an',
    'the',
    'to',
    'of',
    'and',
    'or',
    'for',
    'in',
    'on',
    'with',
    'shall',
    'must',
    'can',
    'be',
    'is',
    'are',
    'should',
    'will',
    'their',
    'that',
    'this',
    'able',
    'user',
    'users',
    'product',
    'order',
    'system',
    'page',
    'data',
    'information',
    'application',
    'admin',
    'administrator',
  ]);
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 2 && !stop.has(t)),
    );
  const ta = tok(a);
  const tb = tok(b);
  if (!ta.size && !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : Math.round((inter / union) * 100);
}

export function jaccardSimilarity(a: string, b: string): number {
  return tokenOverlap(a, b);
}

export type SemanticRelationDraft = {
  requirementKeyA: string;
  requirementKeyB: string;
  kind:
    | DuplicateKind
    | 'SEQUENTIAL'
    | 'BUSINESS_RULE_CONSTRAINT'
    | 'CONFLICT'
    | 'PRECEDES'
    | 'DEPENDS_ON'
    | 'NOT_RELATED';
  relationType: RelationType | 'PRECEDES' | 'SEQUENTIAL' | 'BUSINESS_RULE_CONSTRAINT';
  reason: string;
  recommendation: string;
  /** Internal only — never primary UI signal */
  similarity: number;
  showConfidence: boolean;
  suggestedFeatureSplit?: string[];
  sameFeatureDifferentOps?: boolean;
};

function pairResult(
  a: NormalizedRequirement,
  b: NormalizedRequirement,
  opts: {
    kind: SemanticRelationDraft['kind'];
    relationType: SemanticRelationDraft['relationType'];
    reason: string;
    recommendation?: string;
    showConfidence?: boolean;
    suggestedFeatureSplit?: string[];
    sameFeatureDifferentOps?: boolean;
  },
): SemanticRelationDraft {
  return {
    requirementKeyA: a.id,
    requirementKeyB: b.id,
    kind: opts.kind,
    relationType: opts.relationType,
    reason: opts.reason,
    recommendation: opts.recommendation ?? opts.reason,
    similarity: tokenOverlap(a.originalText, b.originalText),
    showConfidence: opts.showConfidence ?? false,
    suggestedFeatureSplit: opts.suggestedFeatureSplit,
    sameFeatureDifferentOps: opts.sameFeatureDifferentOps,
  };
}

function opposingPolarity(a: NormalizedRequirement, b: NormalizedRequirement): boolean {
  const ta = `${a.title}\n${a.originalText}`.toLowerCase();
  const tb = `${b.title}\n${b.originalText}`.toLowerCase();
  const neg = (t: string) =>
    /\b(should not|must not|cannot|not have|not be allowed|denied|forbidden)\b/.test(
      t,
    );
  const pos = (t: string) =>
    /\b(should|must|can|able to|have access|allowed)\b/.test(t) && !neg(t);
  return (neg(ta) && pos(tb)) || (pos(ta) && neg(tb));
}

function substantiallySameBehavior(
  a: NormalizedRequirement,
  b: NormalizedRequirement,
): boolean {
  if (!sameActor(a, b)) return false;
  if (!sameEntity(a, b)) return false;
  if (a.action[0] !== b.action[0]) return false;
  if (!sameCapability(a, b)) return false;
  if (a.businessOutcome !== b.businessOutcome) return false;
  if (opposingPolarity(a, b)) return false;
  const chA = a.channel ?? null;
  const chB = b.channel ?? null;
  if (chA !== chB) return false;
  const subA = a.subFeature ?? null;
  const subB = b.subFeature ?? null;
  if (subA && subB && subA !== subB) return false;
  if (
    a.capability === 'order_confirmation' &&
    (!chA || !chB) &&
    a.subFeature !== b.subFeature
  ) {
    return false;
  }
  if (
    a.capability === 'order_confirmation' &&
    !a.channel &&
    !b.channel &&
    !a.subFeature &&
    !b.subFeature
  ) {
    return false;
  }
  return true;
}

function isAdminInventoryCap(c: string): boolean {
  return (
    c === 'product_administration' ||
    c === 'inventory' ||
    c === 'inventory_update'
  );
}

function isPurchaseConstrainedCap(c: string): boolean {
  return (
    c === 'shopping_cart' ||
    c === 'checkout' ||
    c === 'payment' ||
    c === 'product_details'
  );
}

function isInventoryConstraint(n: NormalizedRequirement): boolean {
  return (
    n.isBusinessRule &&
    (n.capability === 'inventory' ||
      n.entity[0] === 'inventory' ||
      /unavailable_purchase_blocked/.test(n.businessOutcome) ||
      /out of stock|cannot be purchased/.test(n.originalText.toLowerCase()))
  );
}

function isUniquenessRule(n: NormalizedRequirement): boolean {
  const t = n.originalText.toLowerCase();
  return (
    (/unique/.test(t) && /email/.test(t)) ||
    (/email/.test(t) && /only.*(one|single).*account|one account/.test(t))
  );
}

function isAccessControlPair(
  a: NormalizedRequirement,
  b: NormalizedRequirement,
): boolean {
  const caps = new Set([a.capability, b.capability]);
  if (caps.has('access_control')) return true;
  const ta = a.originalText.toLowerCase();
  const tb = b.originalText.toLowerCase();
  const adminAccess =
    /administrative functionality|administrator permissions|admin(istrator)? access/.test(
      ta,
    ) ||
    /administrative functionality|administrator permissions|admin(istrator)? access/.test(
      tb,
    );
  return adminAccess && opposingPolarity(a, b);
}

/**
 * Evidence-based classifier.
 * Priority: DUPLICATE → BR_CONSTRAINT → CONFLICT → SEQUENTIAL → RELATED → null
 */
function classifyNormalized(
  a: NormalizedRequirement,
  b: NormalizedRequirement,
): SemanticRelationDraft | null {
  // 1) True DUPLICATE
  if (substantiallySameBehavior(a, b)) {
    return pairResult(a, b, {
      kind: 'DUPLICATE',
      relationType: 'DUPLICATE_OF',
      reason:
        'Actor, entity, action, capability, business outcome, and context align — substantially the same business behavior.',
      showConfidence: true,
    });
  }

  // Near-duplicate uniqueness statements (email unique ↔ one account)
  if (isUniquenessRule(a) && isUniquenessRule(b)) {
    return pairResult(a, b, {
      kind: 'DUPLICATE',
      relationType: 'DUPLICATE_OF',
      reason:
        'Both express the same uniqueness constraint: one email address per user account.',
      showConfidence: true,
    });
  }

  // 2) BUSINESS_RULE_CONSTRAINT
  if (isInventoryConstraint(a) && isPurchaseConstrainedCap(b.capability)) {
    return pairResult(a, b, {
      kind: 'BUSINESS_RULE_CONSTRAINT',
      relationType: 'BUSINESS_RULE_CONSTRAINT',
      reason: `${a.title} constrains purchase behavior in ${b.title}.`,
    });
  }
  if (isInventoryConstraint(b) && isPurchaseConstrainedCap(a.capability)) {
    return pairResult(b, a, {
      kind: 'BUSINESS_RULE_CONSTRAINT',
      relationType: 'BUSINESS_RULE_CONSTRAINT',
      reason: `${b.title} constrains purchase behavior in ${a.title}.`,
    });
  }
  if (
    (isUniquenessRule(a) && b.capability === 'user_registration') ||
    (isUniquenessRule(b) && a.capability === 'user_registration')
  ) {
    const rule = isUniquenessRule(a) ? a : b;
    const target = isUniquenessRule(a) ? b : a;
    return pairResult(rule, target, {
      kind: 'BUSINESS_RULE_CONSTRAINT',
      relationType: 'BUSINESS_RULE_CONSTRAINT',
      reason: `${rule.title} constrains ${target.title} (account identity).`,
    });
  }
  // Payment failure BR constraining order creation / confirmation
  {
    const pay = a.capability === 'payment' ? a : b.capability === 'payment' ? b : null;
    const other = pay === a ? b : pay === b ? a : null;
    if (
      pay &&
      other &&
      /fail|not create|must not create/.test(pay.originalText.toLowerCase()) &&
      (other.capability === 'order_confirmation' ||
        /order (creation|creat|placed|place)|must not create.*order|order must not/.test(
          other.originalText.toLowerCase(),
        ))
    ) {
      return pairResult(pay, other, {
        kind: 'BUSINESS_RULE_CONSTRAINT',
        relationType: 'BUSINESS_RULE_CONSTRAINT',
        reason: `${pay.title} constrains order creation behavior in ${other.title}.`,
      });
    }
  }

  // 3) CONFLICT — opposing polarity on same access-control / capability concern
  if (
    opposingPolarity(a, b) &&
    (sameCapability(a, b) || isAccessControlPair(a, b))
  ) {
    if (isAccessControlPair(a, b)) {
      // Complementary access rules — RELATED, not spam CONFLICT
      return pairResult(a, b, {
        kind: 'RELATED',
        relationType: 'RELATED_TO',
        reason:
          'Complementary access-control rules (admin allow vs non-admin deny) for the same administrative boundary.',
      });
    }
    return pairResult(a, b, {
      kind: 'CONFLICT',
      relationType: 'CONFLICTS_WITH',
      reason:
        'Opposite business polarity on the same capability — review for conflict.',
    });
  }

  // 4) RELATED peers that must NOT be misclassified as SEQUENTIAL
  // 4a) Search vs filter — parallel discovery tools
  if (
    (a.capability === 'product_search' &&
      b.capability === 'product_filtering') ||
    (b.capability === 'product_search' && a.capability === 'product_filtering')
  ) {
    return pairResult(a, b, {
      kind: 'RELATED',
      relationType: 'RELATED_TO',
      reason:
        'Related product discovery capabilities (search vs filter). Different user operations, not duplicates.',
    });
  }

  // 4b) Password reset ↔ OTP delivery — related recovery steps
  if (
    (a.capability === 'password_reset' && b.capability === 'otp_delivery') ||
    (b.capability === 'password_reset' && a.capability === 'otp_delivery')
  ) {
    return pairResult(a, b, {
      kind: 'RELATED',
      relationType: 'RELATED_TO',
      reason:
        'Related authentication/password-recovery steps (reset vs OTP delivery), not the same business behavior.',
    });
  }

  // 5) SEQUENTIAL — only explicit workflow adjacency (not same-feature alone)
  // Registration → login
  if (
    (a.capability === 'user_registration' && b.capability === 'user_login') ||
    (b.capability === 'user_registration' && a.capability === 'user_login')
  ) {
    const from = a.capability === 'user_registration' ? a : b;
    const to = a.capability === 'user_registration' ? b : a;
    return pairResult(from, to, {
      kind: 'SEQUENTIAL',
      relationType: 'SEQUENTIAL',
      reason: 'Registration precedes login in the account lifecycle.',
    });
  }

  // Discovery: search → results → details
  const discoveryChain = [
    'product_search',
    'product_search_results',
    'product_details',
  ] as const;
  {
    const ia = discoveryChain.indexOf(
      a.capability as (typeof discoveryChain)[number],
    );
    const ib = discoveryChain.indexOf(
      b.capability as (typeof discoveryChain)[number],
    );
    if (ia >= 0 && ib >= 0 && ia !== ib) {
      const [from, to] = ia < ib ? [a, b] : [b, a];
      return pairResult(from, to, {
        kind: 'SEQUENTIAL',
        relationType: 'SEQUENTIAL',
        reason: `${from.title} precedes ${to.title} in product discovery.`,
      });
    }
  }

  // Purchase chain: cart → checkout → payment → confirmation
  const purchaseChain = [
    'shopping_cart',
    'checkout',
    'payment',
    'order_confirmation',
  ] as const;
  {
    const ia = purchaseChain.indexOf(
      a.capability as (typeof purchaseChain)[number],
    );
    const ib = purchaseChain.indexOf(
      b.capability as (typeof purchaseChain)[number],
    );
    if (ia >= 0 && ib >= 0 && ia !== ib && Math.abs(ia - ib) <= 2) {
      const [from, to] = ia < ib ? [a, b] : [b, a];
      return pairResult(from, to, {
        kind: 'SEQUENTIAL',
        relationType: 'SEQUENTIAL',
        reason: `${from.title} precedes ${to.title} in the purchase workflow.`,
      });
    }
  }

  // Order history → open/view order details
  if (
    (a.capability === 'order_history' && b.capability === 'order_details') ||
    (b.capability === 'order_history' && a.capability === 'order_details')
  ) {
    const from = a.capability === 'order_history' ? a : b;
    const to = a.capability === 'order_history' ? b : a;
    return pairResult(from, to, {
      kind: 'SEQUENTIAL',
      relationType: 'SEQUENTIAL',
      reason: 'Order history precedes opening an order to view details.',
    });
  }

  // Generic flowStep sequential only for remaining same-family adjacent pairs
  // (excludes filter/OTP which were handled as RELATED above)
  if (areSequentialCapabilities(a, b)) {
    const [from, to] = a.flowStep! < b.flowStep! ? [a, b] : [b, a];
    const skip =
      from.capability === 'product_filtering' ||
      to.capability === 'product_filtering' ||
      from.capability === 'otp_delivery' ||
      to.capability === 'otp_delivery' ||
      from.capability === 'password_reset' ||
      to.capability === 'password_reset';
    if (!skip && Math.abs(from.flowStep! - to.flowStep!) === 1) {
      return pairResult(from, to, {
        kind: 'SEQUENTIAL',
        relationType: 'SEQUENTIAL',
        reason: `${from.title} precedes ${to.title} in the business workflow (${from.capability} → ${to.capability}).`,
      });
    }
  }

  // 6) RELATED — evidence required (never a fallback)

  // 5c) Order confirmation page ↔ email
  if (
    a.capability === 'order_confirmation' &&
    b.capability === 'order_confirmation' &&
    (a.channel !== b.channel || a.subFeature !== b.subFeature)
  ) {
    return pairResult(a, b, {
      kind: 'RELATED',
      relationType: 'RELATED_TO',
      reason:
        'Same order-confirmation business event, different delivery channels/sub-features (page vs email).',
    });
  }
  if (
    a.capability === 'order_confirmation' &&
    b.capability === 'order_confirmation' &&
    !substantiallySameBehavior(a, b)
  ) {
    return pairResult(a, b, {
      kind: 'RELATED',
      relationType: 'RELATED_TO',
      reason:
        'Both relate to order confirmation. Context/channel differs enough that they are related, not duplicates.',
    });
  }

  // 5d) Admin/inventory CRUD peers — BOTH sides must be admin/inventory
  if (
    isAdminInventoryCap(a.capability) &&
    isAdminInventoryCap(b.capability) &&
    sameActor(a, b) &&
    (a.crudOp !== b.crudOp ||
      a.entity[0] !== b.entity[0] ||
      a.capability !== b.capability ||
      a.businessOutcome !== b.businessOutcome)
  ) {
    return pairResult(a, b, {
      kind: 'RELATED',
      relationType: 'RELATED_TO',
      reason: [
        'Same administration/inventory capability family with different CRUD/operations.',
        a.crudOp && b.crudOp && a.crudOp !== b.crudOp
          ? `CRUD: ${a.crudOp} vs ${b.crudOp}`
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
      sameFeatureDifferentOps: true,
      suggestedFeatureSplit:
        (a.entity[0] === 'inventory' || b.entity[0] === 'inventory') &&
        (a.entity[0] === 'product_catalog' || b.entity[0] === 'product_catalog')
          ? ['Product Management', 'Inventory Management']
          : undefined,
    });
  }

  // 5e) Order confirmation vs order details/history — RELATED when both order-domain
  const orderCaps = new Set([
    'order_confirmation',
    'order_details',
    'order_history',
    'order_access',
    'order_management',
  ]);
  if (
    orderCaps.has(a.capability) &&
    orderCaps.has(b.capability) &&
    a.capability !== b.capability
  ) {
    // history↔details already SEQUENTIAL; confirmation↔details RELATED
    if (
      !(
        (a.capability === 'order_history' && b.capability === 'order_details') ||
        (b.capability === 'order_history' && a.capability === 'order_details')
      )
    ) {
      return pairResult(a, b, {
        kind: 'RELATED',
        relationType: 'RELATED_TO',
        reason:
          'Related order-domain capabilities (confirmation / history / details / access), not duplicates.',
      });
    }
  }

  // 5f) Same entity + same actor + different actions, but only for strong entities
  const strongEntities = new Set([
    'product_catalog',
    'inventory',
    'cart_item',
    'order',
    'order_confirmation',
    'payment',
    'user_account',
  ]);
  if (
    sameEntity(a, b) &&
    sameActor(a, b) &&
    a.action[0] !== b.action[0] &&
    strongEntities.has(a.entity[0] ?? '') &&
    capabilityFamily(a, b)
  ) {
    return pairResult(a, b, {
      kind: 'RELATED',
      relationType: 'RELATED_TO',
      reason:
        'Same actor and entity within the same capability family, different actions — related operations, not duplicates.',
      sameFeatureDifferentOps: true,
    });
  }

  // 5g) POSSIBLE_DUPLICATE — semantic dims mostly align, outcome uncertain
  if (
    sameActor(a, b) &&
    sameEntity(a, b) &&
    a.action[0] === b.action[0] &&
    sameCapability(a, b) &&
    a.businessOutcome !== b.businessOutcome
  ) {
    return pairResult(a, b, {
      kind: 'POSSIBLE_DUPLICATE',
      relationType: 'OVERLAPS',
      reason:
        'Actor, entity, action, and capability align, but business outcome/context is not certain.',
      showConfidence: false,
    });
  }

  // 6) INDEPENDENT — no edge
  return null;
}

/**
 * Pairwise semantic scan using normalized requirements.
 * Only returns meaningful positive relationships.
 */
export function detectSemanticRelations(
  requirements: DupComparable[],
): SemanticRelationDraft[] {
  const normalized = requirements.map((r) => normalizeRequirement(r));
  const out: SemanticRelationDraft[] = [];

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const left = normalized[i]!;
      const right = normalized[j]!;
      const classified = classifyNormalized(left, right);
      if (!classified) continue;
      if (classified.kind === 'NOT_DUPLICATE' || classified.kind === 'NOT_RELATED')
        continue;
      out.push(classified);
    }
  }

  return out.sort((x, y) => {
    const rank = (k: string) =>
      k === 'DUPLICATE'
        ? 0
        : k === 'BUSINESS_RULE_CONSTRAINT'
          ? 1
          : k === 'CONFLICT'
            ? 2
            : k === 'SEQUENTIAL' || k === 'PRECEDES'
              ? 3
              : k === 'POSSIBLE_DUPLICATE'
                ? 4
                : k === 'RELATED'
                  ? 5
                  : 6;
    return rank(x.kind) - rank(y.kind);
  });
}

/**
 * Back-compat wrapper used by API — maps to DuplicatePair shape.
 */
export function detectDuplicatePairs(
  requirements: DupComparable[],
): DuplicatePair[] {
  return detectSemanticRelations(requirements).map((r) => ({
    requirementKeyA: r.requirementKeyA,
    requirementKeyB: r.requirementKeyB,
    similarity: r.similarity,
    kind:
      r.kind === 'SEQUENTIAL' ||
      r.kind === 'PRECEDES' ||
      r.kind === 'DEPENDS_ON' ||
      r.kind === 'BUSINESS_RULE_CONSTRAINT' ||
      r.kind === 'CONFLICT'
        ? r.kind === 'BUSINESS_RULE_CONSTRAINT'
          ? 'BUSINESS_RULE_CONSTRAINT'
          : r.kind === 'CONFLICT'
            ? 'CONFLICT'
            : r.kind === 'SEQUENTIAL' || r.kind === 'PRECEDES'
              ? 'SEQUENTIAL'
              : 'RELATED'
        : (r.kind as DuplicateKind),
    recommendation: r.recommendation,
    reason: r.reason,
    showConfidence: r.showConfidence && r.kind === 'DUPLICATE',
    sameFeatureDifferentOps: r.sameFeatureDifferentOps,
    suggestedFeatureSplit: r.suggestedFeatureSplit,
    relationType: r.relationType as RelationType,
  }));
}

/** Pairwise helper for unit tests / compare view. */
export function analyzeRelationship(
  a: DupComparable,
  b: DupComparable,
):
  | DuplicateKind
  | 'SEQUENTIAL'
  | 'BUSINESS_RULE_CONSTRAINT'
  | 'CONFLICT'
  | 'PRECEDES'
  | 'DEPENDS_ON'
  | 'NOT_RELATED' {
  const hit = detectSemanticRelations([a, b])[0];
  return hit?.kind ?? 'NOT_RELATED';
}

function semanticDims(a: NormalizedRequirement, b: NormalizedRequirement) {
  return {
    actorMatch: sameActor(a, b),
    entityMatch: sameEntity(a, b),
    actionMatch: a.action[0] === b.action[0],
    capabilityMatch: sameCapability(a, b) || capabilityFamily(a, b),
    outcomeMatch: a.businessOutcome === b.businessOutcome,
    contextMatch:
      (a.channel ?? a.subFeature ?? null) === (b.channel ?? b.subFeature ?? null),
    workflowRelation: areSequentialCapabilities(a, b),
    businessRuleMatch: a.isBusinessRule || b.isBusinessRule,
  };
}

function toCanonicalKind(
  d: SemanticRelationDraft,
): RequirementRelationship['relationship'] | null {
  if (d.kind === 'NOT_DUPLICATE' || d.kind === 'NOT_RELATED') return null;
  if (d.kind === 'SEQUENTIAL' || d.relationType === 'SEQUENTIAL')
    return 'SEQUENTIAL';
  if (d.relationType === 'PRECEDES' || d.kind === 'PRECEDES') return 'SEQUENTIAL';
  if (
    d.kind === 'BUSINESS_RULE_CONSTRAINT' ||
    d.relationType === 'BUSINESS_RULE_CONSTRAINT'
  )
    return 'BUSINESS_RULE_CONSTRAINT';
  if (d.kind === 'CONFLICT' || d.relationType === 'CONFLICTS_WITH')
    return 'CONFLICT';
  if (d.kind === 'DEPENDS_ON') return 'DEPENDS_ON';
  if (d.kind === 'DUPLICATE') return 'DUPLICATE';
  if (d.kind === 'POSSIBLE_DUPLICATE') return 'POSSIBLE_DUPLICATE';
  if (d.kind === 'RELATED') return 'RELATED';
  return null;
}

/** Convert semantic draft pairs into canonical RequirementRelationship rows. */
export function toCanonicalRelationships(
  requirements: DupComparable[],
): RequirementRelationship[] {
  const normalized = new Map(
    requirements.map((r) => [r.requirementKey, normalizeRequirement(r)]),
  );
  const drafts = detectSemanticRelations(requirements);
  const out: RequirementRelationship[] = [];

  for (const d of drafts) {
    const relationship = toCanonicalKind(d);
    if (!relationship) continue;
    if (!PERSISTABLE_RELATIONSHIPS.has(relationship)) continue;
    if (relationship === 'NOT_DUPLICATE') continue;

    const na = normalized.get(d.requirementKeyA);
    const nb = normalized.get(d.requirementKeyB);

    out.push({
      sourceRequirementId: d.requirementKeyA,
      targetRequirementId: d.requirementKeyB,
      relationship,
      reason: d.reason,
      confidence:
        d.kind === 'DUPLICATE' && d.showConfidence
          ? Math.min(100, Math.max(d.similarity, 90)) / 100
          : undefined,
      semanticAnalysis: na && nb ? semanticDims(na, nb) : undefined,
    });
  }
  return out;
}

export { buildSemanticProfile, normalizeRequirement };
