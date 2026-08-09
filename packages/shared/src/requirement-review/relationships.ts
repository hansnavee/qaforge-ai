/**
 * Detect DEPENDS_ON / AFFECTS / RELATED_TO edges between requirements.
 */

import type { RelationDraft } from './types.js';

export type RelatableRequirement = {
  requirementKey: string;
  title: string;
  description: string;
  sourceText?: string | null;
  featureName?: string | null;
};

function blob(r: RelatableRequirement): string {
  return `${r.title}\n${r.description}\n${r.sourceText ?? ''}`.toLowerCase();
}

type Tag =
  | 'cart'
  | 'checkout'
  | 'payment'
  | 'order'
  | 'stock'
  | 'login'
  | 'register'
  | 'otp'
  | 'admin'
  | 'review'
  | 'access';

function tagsOf(r: RelatableRequirement): Set<Tag> {
  const b = blob(r);
  const tags = new Set<Tag>();
  if (/cart|add to cart/.test(b)) tags.add('cart');
  if (/checkout/.test(b)) tags.add('checkout');
  if (/payment|pay for/.test(b)) tags.add('payment');
  if (/\border\b|cancel/.test(b)) tags.add('order');
  if (/stock|inventory|out of stock/.test(b)) tags.add('stock');
  if (/\blogin\b|sign in/.test(b)) tags.add('login');
  if (/register|registration/.test(b)) tags.add('register');
  if (/\botp\b|password reset/.test(b)) tags.add('otp');
  if (/admin|administrator/.test(b)) tags.add('admin');
  if (/review|rating/.test(b)) tags.add('review');
  if (/access control|another user|own order/.test(b)) tags.add('access');
  return tags;
}

/** Journey / dependency edges (from → depends on to). */
const DEPENDENCY_EDGES: Array<[Tag, Tag]> = [
  ['checkout', 'cart'],
  ['checkout', 'login'],
  ['payment', 'checkout'],
  ['order', 'payment'],
  ['order', 'checkout'],
  ['otp', 'login'],
  ['review', 'order'],
  ['cart', 'stock'],
  ['checkout', 'stock'],
];

export function detectRequirementRelations(
  requirements: RelatableRequirement[],
): RelationDraft[] {
  const byTag = new Map<Tag, RelatableRequirement[]>();
  for (const r of requirements) {
    for (const t of tagsOf(r)) {
      const list = byTag.get(t) ?? [];
      list.push(r);
      byTag.set(t, list);
    }
  }

  const seen = new Set<string>();
  const out: RelationDraft[] = [];

  const push = (rel: RelationDraft) => {
    if (rel.fromKey === rel.toKey) return;
    const k = `${rel.fromKey}|${rel.toKey}|${rel.relationType}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(rel);
  };

  for (const [fromTag, toTag] of DEPENDENCY_EDGES) {
    const froms = byTag.get(fromTag) ?? [];
    const tos = byTag.get(toTag) ?? [];
    for (const f of froms) {
      for (const t of tos) {
        push({
          fromKey: f.requirementKey,
          toKey: t.requirementKey,
          relationType: 'DEPENDS_ON',
          confidence: 0.7,
          detail: `${fromTag} typically depends on ${toTag}`,
        });
        push({
          fromKey: t.requirementKey,
          toKey: f.requirementKey,
          relationType: 'AFFECTS',
          confidence: 0.55,
          detail: `${toTag} can affect ${fromTag}`,
        });
      }
    }
  }

  // Same feature → RELATED_TO
  const byFeature = new Map<string, RelatableRequirement[]>();
  for (const r of requirements) {
    if (!r.featureName) continue;
    const list = byFeature.get(r.featureName) ?? [];
    list.push(r);
    byFeature.set(r.featureName, list);
  }
  for (const group of byFeature.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        push({
          fromKey: a.requirementKey,
          toKey: b.requirementKey,
          relationType: 'RELATED_TO',
          confidence: 0.6,
          detail: 'Same feature group',
        });
      }
    }
  }

  // Cap explosion: keep highest-confidence unique pairs per fromKey (max 8)
  const byFrom = new Map<string, RelationDraft[]>();
  for (const rel of out) {
    const list = byFrom.get(rel.fromKey) ?? [];
    list.push(rel);
    byFrom.set(rel.fromKey, list);
  }
  const capped: RelationDraft[] = [];
  for (const list of byFrom.values()) {
    list.sort((a, b) => b.confidence - a.confidence);
    capped.push(...list.slice(0, 8));
  }
  return capped;
}

/**
 * Conflict heuristics for contradictory business rules (cancel eligibility, stock, access).
 */
export function detectBusinessConflicts(
  requirements: Array<{
    requirementKey: string;
    title: string;
    description: string;
    rulesText: string;
  }>,
): Array<{
  keyA: string;
  keyB: string;
  summary: string;
  detail: string;
}> {
  const conflicts: Array<{
    keyA: string;
    keyB: string;
    summary: string;
    detail: string;
  }> = [];

  const cancelRelated = requirements.filter((r) =>
    /cancel/.test(`${r.title} ${r.description} ${r.rulesText}`.toLowerCase()),
  );

  for (let i = 0; i < cancelRelated.length; i++) {
    for (let j = i + 1; j < cancelRelated.length; j++) {
      const a = cancelRelated[i]!;
      const b = cancelRelated[j]!;
      const rulesA = a.rulesText.toLowerCase();
      const rulesB = b.rulesText.toLowerCase();
      const aPendingOnly =
        /pending/.test(rulesA) &&
        !/confirmed|shipped|until shipment/.test(rulesA);
      const bUntilShip = /until shipment|shipped/.test(rulesB);
      const aUntilShip = /until shipment|shipped/.test(rulesA);
      const bPendingOnly =
        /pending/.test(rulesB) &&
        !/confirmed|shipped|until shipment/.test(rulesB);

      if ((aPendingOnly && bUntilShip) || (bPendingOnly && aUntilShip)) {
        conflicts.push({
          keyA: a.requirementKey,
          keyB: b.requirementKey,
          summary: 'BUSINESS CONFLICT: cancellation eligibility differs',
          detail: `${a.requirementKey} conflicts with ${b.requirementKey} on which order statuses allow cancellation. Do not decide automatically. Question: Which order statuses actually allow cancellation?`,
        });
      }
    }
  }

  // Stock: "can purchase OOS" vs "cannot purchase OOS"
  const stock = requirements.filter((r) =>
    /stock|inventory/.test(`${r.title} ${r.description} ${r.rulesText}`.toLowerCase()),
  );
  for (let i = 0; i < stock.length; i++) {
    for (let j = i + 1; j < stock.length; j++) {
      const a = stock[i]!;
      const b = stock[j]!;
      const ta = `${a.description} ${a.rulesText}`.toLowerCase();
      const tb = `${b.description} ${b.rulesText}`.toLowerCase();
      const aForbid = /cannot.*(purchase|buy|checkout)|not.*purchased|prevent/.test(ta);
      const bAllow = /can.*(purchase|buy|add).*out of stock|allow.*out of stock/.test(tb);
      const bForbid = /cannot.*(purchase|buy|checkout)|not.*purchased|prevent/.test(tb);
      const aAllow = /can.*(purchase|buy|add).*out of stock|allow.*out of stock/.test(ta);
      if ((aForbid && bAllow) || (bForbid && aAllow)) {
        conflicts.push({
          keyA: a.requirementKey,
          keyB: b.requirementKey,
          summary: 'Out-of-stock purchase rules conflict',
          detail: `${a.requirementKey} and ${b.requirementKey} disagree on out-of-stock purchase behavior.`,
        });
      }
    }
  }

  return conflicts;
}
