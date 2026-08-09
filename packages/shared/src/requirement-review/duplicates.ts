/**
 * Business-semantic duplicate / related detection.
 * Never deletes requirements. Never marks opposite actions as duplicates.
 */

import type { DuplicatePair } from './types.js';

export type DupComparable = {
  requirementKey: string;
  title: string;
  description: string;
  sourceText?: string | null;
};

const STOP = new Set([
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
  'user',
  'users',
  'customer',
  'customers',
  'system',
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
]);

const ACTION_PAIRS: Array<[RegExp, RegExp]> = [
  [/\badd\b/, /\b(remove|delete)\b/],
  [/\bcreate\b/, /\b(remove|delete)\b/],
  [/\bupdate\b/, /\b(delete|remove)\b/],
  [/\benable\b/, /\bdisable\b/],
  [/\ballow\b/, /\b(deny|prevent|cannot|block)\b/],
  [/\blogin\b/, /\blogout\b/],
  [/\bsuccess\b/, /\bfail(ure|ed)?\b/],
];

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

export function jaccardSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : Math.round((inter / union) * 100);
}

function blob(r: DupComparable): string {
  return `${r.title} ${r.description} ${r.sourceText ?? ''}`;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAction(text: string): string | null {
  const m = text
    .toLowerCase()
    .match(
      /\b(add|remove|delete|update|create|cancel|pay|checkout|search|view|login|register|reset|retry|access|purchase)\b/,
    );
  return m?.[1] ?? null;
}

function extractEntity(text: string): string | null {
  const m = text
    .toLowerCase()
    .match(
      /\b(product|cart|order|payment|inventory|stock|user|account|email|otp|review|checkout)\b/,
    );
  return m?.[1] ?? null;
}

function oppositeActions(a: string, b: string): boolean {
  const ta = a.toLowerCase();
  const tb = b.toLowerCase();
  for (const [x, y] of ACTION_PAIRS) {
    if ((x.test(ta) && y.test(tb)) || (y.test(ta) && x.test(tb))) return true;
  }
  return false;
}

function inventoryVsCatalogUpdate(a: string, b: string): boolean {
  const ta = a.toLowerCase();
  const tb = b.toLowerCase();
  const aInvUpdate =
    /\bupdate\b/.test(ta) && /inventory|stock/.test(ta);
  const bInvUpdate =
    /\bupdate\b/.test(tb) && /inventory|stock/.test(tb);
  const aCatalog =
    /\bupdate\b/.test(ta) &&
    /product/.test(ta) &&
    !/inventory|stock/.test(ta);
  const bCatalog =
    /\bupdate\b/.test(tb) &&
    /product/.test(tb) &&
    !/inventory|stock/.test(tb);
  return (aInvUpdate && bCatalog) || (bInvUpdate && aCatalog);
}

/**
 * Pairwise business-aware duplicate scan.
 * Only emits DUPLICATE / POSSIBLE_DUPLICATE / RELATED (never NOT_DUPLICATE rows).
 */
export function detectDuplicatePairs(
  requirements: DupComparable[],
): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];

  for (let i = 0; i < requirements.length; i++) {
    for (let j = i + 1; j < requirements.length; j++) {
      const a = requirements[i]!;
      const b = requirements[j]!;
      const titleA = normalizeTitle(a.title);
      const titleB = normalizeTitle(b.title);
      const fullA = blob(a);
      const fullB = blob(b);
      const titleSim = jaccardSimilarity(a.title, b.title);
      const fullSim = jaccardSimilarity(fullA, fullB);
      const actionA = extractAction(`${a.title} ${a.description}`);
      const actionB = extractAction(`${b.title} ${b.description}`);
      const entityA = extractEntity(`${a.title} ${a.description}`);
      const entityB = extractEntity(`${b.title} ${b.description}`);

      // Opposite actions on same domain → RELATED at most, never duplicate
      if (oppositeActions(fullA, fullB)) {
        if (entityA && entityA === entityB) {
          pairs.push({
            requirementKeyA: a.requirementKey,
            requirementKeyB: b.requirementKey,
            similarity: Math.max(titleSim, fullSim),
            kind: 'RELATED',
            recommendation:
              'Same business entity/capability but actions and outcomes differ. Not a duplicate.',
            showConfidence: false,
          });
        }
        continue;
      }

      // Update product vs update inventory → RELATED
      if (inventoryVsCatalogUpdate(fullA, fullB)) {
        pairs.push({
          requirementKeyA: a.requirementKey,
          requirementKeyB: b.requirementKey,
          similarity: Math.max(titleSim, fullSim),
          kind: 'RELATED',
          recommendation:
            'Both operate on products, but inventory management is a different business capability from product catalog updates.',
          showConfidence: false,
        });
        continue;
      }

      const sameTitle = titleA === titleB;
      const sameAction = Boolean(actionA && actionB && actionA === actionB);
      const sameEntity = Boolean(entityA && entityB && entityA === entityB);

      // True duplicate: identical/near-identical titles + same business meaning
      if (sameTitle && fullSim >= 60) {
        pairs.push({
          requirementKeyA: a.requirementKey,
          requirementKeyB: b.requirementKey,
          similarity: 100,
          kind: 'DUPLICATE',
          recommendation:
            'These requirements appear to represent the same business behavior. Keep separate until a human decides.',
          showConfidence: true,
        });
        continue;
      }

      if (
        titleSim >= 92 &&
        sameAction &&
        sameEntity &&
        fullSim >= 75
      ) {
        pairs.push({
          requirementKeyA: a.requirementKey,
          requirementKeyB: b.requirementKey,
          similarity: Math.max(titleSim, fullSim),
          kind: 'DUPLICATE',
          recommendation:
            'Titles, actions, entities, and outcomes align closely enough to treat as the same business behavior.',
          showConfidence: true,
        });
        continue;
      }

      if (titleSim >= 85 && sameAction && sameEntity && fullSim >= 55) {
        pairs.push({
          requirementKeyA: a.requirementKey,
          requirementKeyB: b.requirementKey,
          similarity: Math.max(titleSim, fullSim),
          kind: 'POSSIBLE_DUPLICATE',
          recommendation:
            'High similarity with aligned action/entity, but business meaning is not certain. Review before merging.',
          showConfidence: true,
        });
        continue;
      }

      if (sameEntity && sameAction && fullSim >= 45) {
        pairs.push({
          requirementKeyA: a.requirementKey,
          requirementKeyB: b.requirementKey,
          similarity: fullSim,
          kind: 'RELATED',
          recommendation:
            'Same business entity and action family, but not clearly the same requirement.',
          showConfidence: false,
        });
        continue;
      }

      if (sameEntity && fullSim >= 50 && titleSim >= 40) {
        pairs.push({
          requirementKeyA: a.requirementKey,
          requirementKeyB: b.requirementKey,
          similarity: fullSim,
          kind: 'RELATED',
          recommendation:
            'Related through the same business entity/capability; behaviors appear different.',
          showConfidence: false,
        });
      }
    }
  }

  return pairs.sort((x, y) => {
    const rank = (k: string) =>
      k === 'DUPLICATE' ? 0 : k === 'POSSIBLE_DUPLICATE' ? 1 : 2;
    return rank(x.kind) - rank(y.kind) || y.similarity - x.similarity;
  });
}
