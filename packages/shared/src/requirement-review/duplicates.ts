/**
 * Soft duplicate / overlap detection. Never deletes requirements.
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
  'system',
  'shall',
  'must',
  'can',
  'be',
  'is',
  'are',
]);

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

/**
 * Pairwise duplicate/overlap scan. O(n²) — fine for typical project sizes.
 */
export function detectDuplicatePairs(
  requirements: DupComparable[],
): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < requirements.length; i++) {
    for (let j = i + 1; j < requirements.length; j++) {
      const a = requirements[i]!;
      const b = requirements[j]!;
      const titleSim = jaccardSimilarity(a.title, b.title);
      const fullSim = jaccardSimilarity(blob(a), blob(b));
      const similarity = Math.max(titleSim, Math.round(fullSim * 0.85 + titleSim * 0.15));

      if (similarity < 55) continue;

      let kind: DuplicatePair['kind'] = 'RELATED';
      if (similarity >= 88 || (titleSim >= 90 && fullSim >= 70)) {
        kind = 'DUPLICATE';
      } else if (similarity >= 70) {
        kind = 'OVERLAPPING';
      }

      pairs.push({
        requirementKeyA: a.requirementKey,
        requirementKeyB: b.requirementKey,
        similarity,
        kind,
        recommendation:
          kind === 'DUPLICATE'
            ? 'These requirements may represent the same business behavior. Keep separate until a human decides.'
            : kind === 'OVERLAPPING'
              ? 'These requirements overlap; clarify whether they share the same rule or distinct behaviors.'
              : 'These requirements appear related; consider linking them.',
      });
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity);
}
