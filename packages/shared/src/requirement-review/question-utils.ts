/**
 * Question fingerprinting + cross-requirement deduplication.
 */

import type { ReviewQuestionDraft } from './types.js';

/** Normalize question text into a stable fingerprint for dedup. */
export function questionFingerprint(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|should|must|can|please|what|which|when|how)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Semantic buckets for known high-value business questions. */
const BUCKETS: Array<{ id: string; patterns: RegExp[] }> = [
  {
    id: 'payment_success_order_fail',
    patterns: [/payment succeeds.*order.*fail/, /order creation fails/],
  },
  {
    id: 'payment_fail_behavior',
    patterns: [/payment fails/, /when payment fail/],
  },
  {
    id: 'payment_retry',
    patterns: [/retry.*payment/, /failed payment/],
  },
  {
    id: 'cancel_statuses',
    patterns: [/order statuses allow cancellation/, /statuses allow cancel/],
  },
  {
    id: 'stock_cart_checkout',
    patterns: [/out-of-stock.*cart/, /stock changes/, /out of stock.*purchase/],
  },
  {
    id: 'otp_validity',
    patterns: [/otp valid/, /otp expire/],
  },
  {
    id: 'otp_attempts',
    patterns: [/invalid otp attempt/, /otp attempts/],
  },
  {
    id: 'order_access',
    patterns: [/another user'?s order/, /access another/],
  },
  {
    id: 'review_eligibility',
    patterns: [/allowed to submit.*review/, /who is allowed.*review/],
  },
  {
    id: 'login_lockout',
    patterns: [/failed login attempt/, /account is locked/],
  },
];

export function questionBucket(question: string): string {
  const q = question.toLowerCase();
  for (const b of BUCKETS) {
    if (b.patterns.some((p) => p.test(q))) return b.id;
  }
  return questionFingerprint(question);
}

export type ExistingQuestionRef = {
  fingerprint?: string | null;
  question: string;
  requirementKey?: string;
  questionKey?: string;
  status?: string;
};

/**
 * Filter drafts that duplicate existing project questions (open or answered).
 * Returns kept drafts + references for suppressed ones.
 */
export function dedupeQuestionsAgainstExisting(
  drafts: ReviewQuestionDraft[],
  existing: ExistingQuestionRef[],
): {
  keep: ReviewQuestionDraft[];
  suppressed: Array<{
    draft: ReviewQuestionDraft;
    existingKey?: string;
    existingRequirementKey?: string;
  }>;
} {
  const existingBuckets = new Map<string, ExistingQuestionRef>();
  for (const e of existing) {
    const bucket = e.fingerprint || questionBucket(e.question);
    if (!existingBuckets.has(bucket)) existingBuckets.set(bucket, e);
  }

  const keep: ReviewQuestionDraft[] = [];
  const suppressed: Array<{
    draft: ReviewQuestionDraft;
    existingKey?: string;
    existingRequirementKey?: string;
  }> = [];
  const local = new Set<string>();

  for (const d of drafts) {
    const fp = d.fingerprint || questionBucket(d.question);
    d.fingerprint = fp;
    if (local.has(fp)) {
      suppressed.push({ draft: d });
      continue;
    }
    const hit = existingBuckets.get(fp);
    if (hit) {
      suppressed.push({
        draft: d,
        existingKey: hit.questionKey,
        existingRequirementKey: hit.requirementKey,
      });
      continue;
    }
    local.add(fp);
    keep.push(d);
  }

  return { keep, suppressed };
}
