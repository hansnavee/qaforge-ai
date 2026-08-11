import {
  BUSINESS_CATEGORIES,
  REVIEW_PRIORITY_WEIGHTS,
  type BusinessReadiness,
  type FunctionalCompleteness,
  type RequirementReviewStatus,
  type ReviewQuestionCategory,
  type ReviewQuestionDraft,
  type ReviewQuestionPriority,
} from './types.js';

export function isBusinessCategory(category: ReviewQuestionCategory): boolean {
  return BUSINESS_CATEGORIES.includes(category);
}

/** Minor UI / wording questions must not block test design. */
export function isCosmeticQuestion(q: ReviewQuestionDraft): boolean {
  const t = `${q.question} ${q.reason}`.toLowerCase();
  return (
    q.priority === 'LOW' ||
    q.category === 'NAVIGATION' ||
    /\b(button|color|label|wording|exact message|cosmetic|ui text)\b/.test(t) ||
    (q.category === 'ERROR_HANDLING' &&
      /\berror message\b/.test(t) &&
      q.priority !== 'CRITICAL')
  );
}

export function questionPenalty(
  questions: Array<{ priority: ReviewQuestionPriority; status?: string }>,
  weights: Record<ReviewQuestionPriority, number> = REVIEW_PRIORITY_WEIGHTS,
): number {
  return questions
    .filter((q) => !q.status || q.status === 'OPEN')
    .reduce((sum, q) => sum + (weights[q.priority] ?? 0), 0);
}

/** 0–100 score; business gaps weigh more than raw question count. */
export function computeReadinessScore(
  openQuestions: Array<{
    priority: ReviewQuestionPriority;
    category: ReviewQuestionCategory;
    blocking?: boolean;
  }>,
  weights: Record<ReviewQuestionPriority, number> = REVIEW_PRIORITY_WEIGHTS,
): number {
  const penalty = openQuestions.reduce((sum, q) => {
    const w = weights[q.priority] ?? 0;
    const businessBoost = isBusinessCategory(q.category) ? 1.25 : 1;
    const blockBoost = q.blocking ? 1.15 : 1;
    return sum + w * businessBoost * blockBoost;
  }, 0);
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

/**
 * BLOCKED only for critical unresolved business gaps that prevent safe test design.
 * Cosmetic / minor UI gaps → REVIEW_RECOMMENDED.
 *
 * AI analysis never auto-marks READY_FOR_TEST_DESIGN — that requires tester
 * approval (phase Approve or an explicit ready action).
 */
export function deriveStatuses(opts: {
  openQuestions: ReviewQuestionDraft[];
  functionalCompleteness: FunctionalCompleteness;
}): {
  businessReadiness: BusinessReadiness;
  reviewStatus: RequirementReviewStatus;
} {
  const open = opts.openQuestions.filter((q) => !isCosmeticQuestion(q));
  const hasCriticalBlock = open.some(
    (q) =>
      q.priority === 'CRITICAL' &&
      q.blocking &&
      isBusinessCategory(q.category),
  );
  const hasHighBusiness = open.some(
    (q) => q.priority === 'HIGH' && isBusinessCategory(q.category),
  );
  const hasAnyHigh = open.some((q) => q.priority === 'HIGH');

  let businessReadiness: BusinessReadiness = 'NEEDS_CLARIFICATION';
  if (hasCriticalBlock) businessReadiness = 'BLOCKED';
  else if (!hasHighBusiness && !hasAnyHigh) {
    // Business gaps look clear enough for a tester to review — not approved yet
    businessReadiness = 'READY';
  }

  let reviewStatus: RequirementReviewStatus = 'REVIEW_RECOMMENDED';
  if (hasCriticalBlock) reviewStatus = 'BLOCKED';
  else if (hasHighBusiness || hasAnyHigh) {
    reviewStatus = 'NEEDS_CLARIFICATION';
  }

  return { businessReadiness, reviewStatus };
}
