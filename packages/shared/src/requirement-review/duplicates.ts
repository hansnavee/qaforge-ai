/**
 * Semantic duplicate / related detection.
 * Business meaning first; text similarity is an internal signal only.
 * Never deletes or merges requirements.
 */

import type { DuplicateKind, DuplicatePair } from './types.js';
import {
  buildSemanticProfile,
  describeSemanticDiff,
  profilesAlignedForDuplicate,
  type SemanticComparable,
  type SemanticProfile,
} from './semantic-profile.js';

export type DupComparable = SemanticComparable;

/** Internal lexical overlap — never primary decision. */
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

function blob(r: DupComparable): string {
  return `${r.title} ${r.description} ${r.sourceText ?? ''}`;
}

function oppositeCrud(a: SemanticProfile, b: SemanticProfile): boolean {
  if (!a.crudOp || !b.crudOp) return false;
  const pair = `${a.crudOp}:${b.crudOp}`;
  return (
    pair === 'CREATE:DELETE' ||
    pair === 'DELETE:CREATE' ||
    pair === 'UPDATE:DELETE' ||
    pair === 'DELETE:UPDATE'
  );
}

function sameFeatureFamily(a: SemanticProfile, b: SemanticProfile): boolean {
  return (
    a.actor === b.actor &&
    (a.capability === b.capability ||
      a.entity === b.entity ||
      (a.entity === 'product_catalog' && b.entity === 'inventory') ||
      (a.entity === 'inventory' && b.entity === 'product_catalog') ||
      (a.entity === 'order_confirmation' && b.entity === 'order_confirmation'))
  );
}

function classifyPair(
  a: DupComparable,
  b: DupComparable,
  pa: SemanticProfile,
  pb: SemanticProfile,
): DuplicatePair | null {
  const overlap = tokenOverlap(blob(a), blob(b));
  const diffs = describeSemanticDiff(pa, pb);

  // Cart add vs catalog admin add — always NOT_DUPLICATE (actor/entity/outcome differ)
  if (
    (pa.entity === 'cart_item' && pb.entity === 'product_catalog') ||
    (pb.entity === 'cart_item' && pa.entity === 'product_catalog')
  ) {
    return {
      requirementKeyA: a.requirementKey,
      requirementKeyB: b.requirementKey,
      similarity: overlap,
      kind: 'NOT_DUPLICATE',
      recommendation:
        'Customer cart behavior vs administrator catalog management — not a duplicate.',
      showConfidence: false,
      reason:
        diffs.join('\n') ||
        'Different actor, entity (cart item vs product catalog), action context, and business outcome.',
      semanticA: pa,
      semanticB: pb,
    };
  }

  // --- Strong NOT_DUPLICATE guards (even if text overlaps) ---
  if (pa.actor !== pb.actor && pa.entity !== pb.entity) {
    // Emit when lexical overlap could mislead; otherwise skip noise
    if (overlap < 35) return null;
    return {
      requirementKeyA: a.requirementKey,
      requirementKeyB: b.requirementKey,
      similarity: overlap,
      kind: 'NOT_DUPLICATE',
      recommendation: diffs.join('. ') || 'Different business behavior.',
      showConfidence: false,
      reason: diffs.join('\n') || 'Different actor, entity, and outcome.',
      semanticA: pa,
      semanticB: pb,
    };
  }

  if (oppositeCrud(pa, pb) && pa.actor === pb.actor) {
    // Same feature family, different CRUD → NOT_DUPLICATE (related ops)
    return {
      requirementKeyA: a.requirementKey,
      requirementKeyB: b.requirementKey,
      similarity: overlap,
      kind: 'NOT_DUPLICATE',
      recommendation:
        'Same feature area but different CRUD operations — not a duplicate.',
      showConfidence: false,
      reason:
        diffs.join('\n') ||
        'Same actor/entity family but actions and outcomes differ (CRUD).',
      semanticA: pa,
      semanticB: pb,
      sameFeatureDifferentOps: true,
    };
  }

  // Inventory update vs catalog update → RELATED
  if (
    pa.actor === pb.actor &&
    ((pa.entity === 'inventory' &&
      (pb.entity === 'product_catalog' || pb.entity === 'product') &&
      pa.action === 'update' &&
      pb.action === 'update') ||
      (pb.entity === 'inventory' &&
        (pa.entity === 'product_catalog' || pa.entity === 'product') &&
        pa.action === 'update' &&
        pb.action === 'update'))
  ) {
    return {
      requirementKeyA: a.requirementKey,
      requirementKeyB: b.requirementKey,
      similarity: overlap,
      kind: 'RELATED',
      recommendation:
        'Same actor and product domain, but catalog information vs inventory management are different responsibilities.',
      showConfidence: false,
      reason:
        'Same actor and general product domain, but different business responsibilities: product information vs inventory management.',
      semanticA: pa,
      semanticB: pb,
      suggestedFeatureSplit: ['Product Management', 'Inventory Management'],
    };
  }

  // Order confirmation: same capability, different channel → RELATED
  if (
    pa.capability === pb.capability &&
    pa.entity === 'order_confirmation' &&
    pb.entity === 'order_confirmation' &&
    pa.channel &&
    pb.channel &&
    pa.channel !== pb.channel
  ) {
    return {
      requirementKeyA: a.requirementKey,
      requirementKeyB: b.requirementKey,
      similarity: overlap,
      kind: 'RELATED',
      recommendation:
        'Both belong to order confirmation but use different delivery channels.',
      showConfidence: false,
      reason: `Both are part of order confirmation, but delivery channels differ (${pa.channel} vs ${pb.channel}).`,
      semanticA: pa,
      semanticB: pb,
    };
  }

  // True DUPLICATE — decision matrix
  if (profilesAlignedForDuplicate(pa, pb)) {
    return {
      requirementKeyA: a.requirementKey,
      requirementKeyB: b.requirementKey,
      similarity: Math.max(90, overlap),
      kind: 'DUPLICATE',
      recommendation:
        'These requirements describe substantially the same business behavior. Keep both until a human decides.',
      showConfidence: true,
      reason:
        'Actor, entity, action, business capability, and business outcome align — substantially the same behavior.',
      semanticA: pa,
      semanticB: pb,
    };
  }

  // Near-duplicate: same actor/entity/action/capability, outcome close, channel same/missing
  if (
    pa.actor === pb.actor &&
    pa.entity === pb.entity &&
    pa.action === pb.action &&
    pa.capability === pb.capability &&
    (pa.channel ?? 'none') === (pb.channel ?? 'none') &&
    (pa.outcome === pb.outcome || overlap >= 70)
  ) {
    const certain = pa.outcome === pb.outcome;
    return {
      requirementKeyA: a.requirementKey,
      requirementKeyB: b.requirementKey,
      similarity: Math.max(certain ? 92 : 70, overlap),
      kind: certain ? 'DUPLICATE' : 'POSSIBLE_DUPLICATE',
      recommendation: certain
        ? 'Same business behavior across semantic dimensions.'
        : 'Semantic dimensions mostly align, but business meaning is not certain.',
      showConfidence: certain,
      reason: certain
        ? 'Both requirements describe the same business behavior.'
        : 'High semantic overlap, but outcome/context is not fully certain. Review before merging.',
      semanticA: pa,
      semanticB: pb,
    };
  }

  // RELATED — same feature family, different behavior
  if (sameFeatureFamily(pa, pb) && (diffs.length > 0 || overlap >= 30)) {
    // Avoid RELATED noise for unrelated low-overlap pairs
    if (overlap < 25 && pa.entity !== pb.entity && pa.capability !== pb.capability) {
      return null;
    }
    return {
      requirementKeyA: a.requirementKey,
      requirementKeyB: b.requirementKey,
      similarity: overlap,
      kind: 'RELATED',
      recommendation:
        'Related through the same business area/feature, but behavior differs.',
      showConfidence: false,
      reason:
        diffs.join('\n') ||
        'Same business entity/capability family, but not the same requirement.',
      semanticA: pa,
      semanticB: pb,
    };
  }

  // Uncertain high lexical overlap without semantic alignment
  if (
    overlap >= 80 &&
    pa.actor === pb.actor &&
    (pa.entity === pb.entity || pa.capability === pb.capability)
  ) {
    return {
      requirementKeyA: a.requirementKey,
      requirementKeyB: b.requirementKey,
      similarity: overlap,
      kind: 'POSSIBLE_DUPLICATE',
      recommendation:
        'Textual cues are strong but business semantics are not fully aligned. Review manually.',
      showConfidence: true,
      reason:
        'The system cannot confidently decide. Semantic dimensions partially align; please review.',
      semanticA: pa,
      semanticB: pb,
    };
  }

  return null;
}

/**
 * Pairwise semantic scan.
 * Emits DUPLICATE / POSSIBLE_DUPLICATE / RELATED / NOT_DUPLICATE when useful.
 * NOT_DUPLICATE pairs are emitted when text might otherwise mislead.
 */
export function detectDuplicatePairs(
  requirements: DupComparable[],
): DuplicatePair[] {
  const profiles = requirements.map((r) => ({
    req: r,
    profile: buildSemanticProfile(r),
  }));
  const pairs: DuplicatePair[] = [];

  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const left = profiles[i]!;
      const right = profiles[j]!;
      const classified = classifyPair(
        left.req,
        right.req,
        left.profile,
        right.profile,
      );
      if (!classified) continue;
      // Keep NOT_DUPLICATE when CRUD-opposite or entity family clash; drop weak noise
      if (
        classified.kind === 'NOT_DUPLICATE' &&
        classified.similarity < 30 &&
        !classified.sameFeatureDifferentOps &&
        !(
          (classified.semanticA?.entity === 'cart_item' &&
            classified.semanticB?.entity === 'product_catalog') ||
          (classified.semanticB?.entity === 'cart_item' &&
            classified.semanticA?.entity === 'product_catalog')
        )
      ) {
        continue;
      }
      pairs.push(classified);
    }
  }

  return pairs.sort((x, y) => {
    const rank = (k: DuplicateKind) =>
      k === 'DUPLICATE'
        ? 0
        : k === 'POSSIBLE_DUPLICATE'
          ? 1
          : k === 'RELATED'
            ? 2
            : 3;
    return rank(x.kind) - rank(y.kind) || y.similarity - x.similarity;
  });
}

export { buildSemanticProfile };
