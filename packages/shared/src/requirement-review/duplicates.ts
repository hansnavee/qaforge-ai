/**
 * Semantic duplicate / related detection (Piece 2.2).
 * Works on NormalizedRequirement — never uses similarity as the primary rule.
 * Never deletes or merges requirements.
 */

import type { DuplicateKind, DuplicatePair, RelationType } from './types.js';
import {
  buildSemanticProfile,
  type SemanticComparable,
} from './semantic-profile.js';
import {
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
  kind: DuplicateKind | 'PRECEDES' | 'DEPENDS_ON' | 'NOT_RELATED';
  relationType: RelationType | 'PRECEDES';
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

function differentBusinessMeaning(
  a: NormalizedRequirement,
  b: NormalizedRequirement,
): boolean {
  if (!sameActor(a, b) && (!sameEntity(a, b) || a.capability !== b.capability)) {
    return true;
  }
  if (a.businessOutcome !== b.businessOutcome && a.capability !== b.capability) {
    return true;
  }
  // Cart vs catalog is always different meaning
  const entities = new Set([a.entity[0], b.entity[0]]);
  if (entities.has('cart_item') && entities.has('product_catalog')) return true;
  if (entities.has('cart_item') && entities.has('product')) return true;
  return false;
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
  // Channel/context must agree when present; if both missing for confirmation, not certain
  const chA = a.channel ?? a.subFeature ?? null;
  const chB = b.channel ?? b.subFeature ?? null;
  if (chA && chB && chA !== chB) return false;
  if (
    a.capability === 'order_confirmation' &&
    (!chA || !chB) &&
    a.subFeature !== b.subFeature
  ) {
    return false;
  }
  // Prefer not to hard-duplicate when confirmation channel is unknown on both
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

function classifyNormalized(
  a: NormalizedRequirement,
  b: NormalizedRequirement,
): SemanticRelationDraft | null {
  // 1) Clear NOT_DUPLICATE — different business meaning (do not flag as possible dup)
  if (differentBusinessMeaning(a, b)) {
    // Still emit NOT_DUPLICATE when actors/capabilities clearly clash (for tests/API)
    if (
      (!sameActor(a, b) && a.capability !== b.capability) ||
      (a.entity[0] === 'cart_item' && b.entity[0] === 'product_catalog') ||
      (b.entity[0] === 'cart_item' && a.entity[0] === 'product_catalog')
    ) {
      return pairResult(a, b, {
        kind: 'NOT_DUPLICATE',
        relationType: 'RELATED_TO',
        reason: [
          !sameActor(a, b)
            ? `Different actor: ${a.actor[0]} vs ${b.actor[0]}`
            : null,
          a.entity[0] !== b.entity[0]
            ? `Different entity: ${a.entity[0]} vs ${b.entity[0]}`
            : null,
          a.action[0] !== b.action[0]
            ? `Different action: ${a.action[0]} vs ${b.action[0]}`
            : null,
          a.capability !== b.capability
            ? `Different capability: ${a.capability} vs ${b.capability}`
            : null,
          a.businessOutcome !== b.businessOutcome
            ? `Different business outcome: ${a.businessOutcome} vs ${b.businessOutcome}`
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
      });
    }
  }

  // 2) Business flow — sequential capabilities → RELATED + PRECEDES
  if (
    a.flowStep != null &&
    b.flowStep != null &&
    a.flowStep !== b.flowStep &&
    capabilityFamily(a, b)
  ) {
    const [from, to] = a.flowStep < b.flowStep ? [a, b] : [b, a];
    return pairResult(from, to, {
      kind: 'RELATED',
      relationType: 'PRECEDES',
      reason: `${from.title} precedes ${to.title} in the same business flow (${from.capability} → ${to.capability}). Sequential requirements are related, not duplicates.`,
    });
  }

  // 3) Same confirmation capability, different channel/sub-feature → RELATED
  if (
    a.capability === 'order_confirmation' &&
    b.capability === 'order_confirmation' &&
    (a.channel !== b.channel || a.subFeature !== b.subFeature)
  ) {
    return pairResult(a, b, {
      kind: 'RELATED',
      relationType: 'RELATED_TO',
      reason:
        'Same order-confirmation business event, but different delivery channels/sub-features (for example page vs email).',
    });
  }

  // Uncertain same confirmation titles without channel proof → RELATED (prefer uncertainty)
  if (
    a.capability === 'order_confirmation' &&
    b.capability === 'order_confirmation' &&
    !substantiallySameBehavior(a, b)
  ) {
    return pairResult(a, b, {
      kind: 'RELATED',
      relationType: 'RELATED_TO',
      reason:
        'Both relate to order confirmation. Context/channel is not certain enough to treat as the same requirement.',
    });
  }

  // 4) CRUD / inventory ops in same admin family → RELATED (never duplicate)
  const adminFamily =
    a.capability === 'product_administration' ||
    b.capability === 'product_administration' ||
    a.capability === 'inventory' ||
    b.capability === 'inventory' ||
    a.entity[0] === 'product_catalog' ||
    b.entity[0] === 'product_catalog' ||
    a.entity[0] === 'inventory' ||
    b.entity[0] === 'inventory';
  if (
    sameActor(a, b) &&
    adminFamily &&
    (a.crudOp !== b.crudOp ||
      a.entity[0] !== b.entity[0] ||
      a.subFeature !== b.subFeature ||
      a.businessOutcome !== b.businessOutcome ||
      a.capability !== b.capability)
  ) {
    return pairResult(a, b, {
      kind: 'RELATED',
      relationType: 'RELATED_TO',
      reason: [
        'Same administration/product domain and actor, but different business operations.',
        a.crudOp && b.crudOp && a.crudOp !== b.crudOp
          ? `CRUD: ${a.crudOp} vs ${b.crudOp}`
          : null,
        a.entity[0] !== b.entity[0]
          ? `Entity: ${a.entity[0]} vs ${b.entity[0]}`
          : null,
        a.businessOutcome !== b.businessOutcome
          ? `Outcome: ${a.businessOutcome} vs ${b.businessOutcome}`
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

  // Order confirmation vs order details/history — RELATED, not duplicate
  const orderEntities = new Set(['order', 'order_confirmation', 'order_item']);
  if (
    orderEntities.has(a.entity[0] ?? '') &&
    orderEntities.has(b.entity[0] ?? '') &&
    a.entity[0] !== b.entity[0]
  ) {
    return pairResult(a, b, {
      kind: 'RELATED',
      relationType: 'RELATED_TO',
      reason:
        'Both present order/product information, but in different contexts (for example confirmation page vs order details/history). Prefer RELATED over a false duplicate.',
    });
  }

  // 5) Discovery flow: search ↔ results ↔ details → RELATED
  if (capabilityFamily(a, b) && a.capability !== b.capability) {
    const discovery = new Set([
      'product_search',
      'product_search_results',
      'product_details',
      'product_discovery',
    ]);
    if (discovery.has(a.capability) && discovery.has(b.capability)) {
      const [from, to] =
        (a.flowStep ?? 99) <= (b.flowStep ?? 99) ? [a, b] : [b, a];
      return pairResult(from, to, {
        kind: 'RELATED',
        relationType: 'PRECEDES',
        reason:
          'Related steps in product discovery (search → results → details). Not duplicates.',
      });
    }
  }

  // 6) True DUPLICATE — only when business meaning is substantially identical
  if (substantiallySameBehavior(a, b)) {
    return pairResult(a, b, {
      kind: 'DUPLICATE',
      relationType: 'DUPLICATE_OF',
      reason:
        'Actor, entity, action, capability, business outcome, and context align — substantially the same business behavior.',
      showConfidence: true,
    });
  }

  // 7) POSSIBLE_DUPLICATE — semantic dims mostly align, outcome/context uncertain
  //    (NOT based on text similarity thresholds)
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
        'Actor, entity, action, and capability align, but business outcome/context is not certain. Prefer review over a false duplicate.',
      showConfidence: false,
    });
  }

  // 8) Same entity, different ops → RELATED
  if (sameEntity(a, b) && sameActor(a, b) && a.action[0] !== b.action[0]) {
    return pairResult(a, b, {
      kind: 'RELATED',
      relationType: 'RELATED_TO',
      reason:
        'Same actor and entity, but different actions/outcomes — related operations, not duplicates.',
      sameFeatureDifferentOps: true,
    });
  }

  return null;
}

/**
 * Pairwise semantic scan using normalized requirements.
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
      out.push(classified);
    }
  }

  return out.sort((x, y) => {
    const rank = (k: string) =>
      k === 'DUPLICATE'
        ? 0
        : k === 'POSSIBLE_DUPLICATE'
          ? 1
          : k === 'RELATED' || k === 'PRECEDES'
            ? 2
            : 3;
    return rank(x.kind) - rank(y.kind);
  });
}

/**
 * Back-compat wrapper used by API — maps to DuplicatePair shape.
 * Similarity is retained only as an internal field.
 */
export function detectDuplicatePairs(
  requirements: DupComparable[],
): DuplicatePair[] {
  return detectSemanticRelations(requirements).map((r) => ({
    requirementKeyA: r.requirementKeyA,
    requirementKeyB: r.requirementKeyB,
    similarity: r.similarity,
    kind:
      r.kind === 'PRECEDES' || r.kind === 'DEPENDS_ON' || r.kind === 'NOT_RELATED'
        ? 'RELATED'
        : (r.kind as DuplicateKind),
    recommendation: r.recommendation,
    reason: r.reason,
    showConfidence: r.showConfidence && r.kind === 'DUPLICATE',
    sameFeatureDifferentOps: r.sameFeatureDifferentOps,
    suggestedFeatureSplit: r.suggestedFeatureSplit,
    relationType: r.relationType,
  }));
}

export { buildSemanticProfile, normalizeRequirement };
