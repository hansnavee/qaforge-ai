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

export function deriveStatuses(opts: {
  openQuestions: ReviewQuestionDraft[];
  functionalCompleteness: FunctionalCompleteness;
}): {
  businessReadiness: BusinessReadiness;
  reviewStatus: RequirementReviewStatus;
} {
  const open = opts.openQuestions;
  const hasCritical = open.some((q) => q.priority === 'CRITICAL' && q.blocking);
  const hasHighBusiness = open.some(
    (q) =>
      q.priority === 'HIGH' &&
      (isBusinessCategory(q.category) || q.blocking),
  );
  const onlyLowMedium =
    open.length > 0 &&
    open.every((q) => q.priority === 'MEDIUM' || q.priority === 'LOW');

  let businessReadiness: BusinessReadiness = 'READY';
  if (hasCritical) businessReadiness = 'BLOCKED';
  else if (hasHighBusiness || open.some((q) => q.priority === 'HIGH')) {
    businessReadiness = 'NEEDS_CLARIFICATION';
  }

  let reviewStatus: RequirementReviewStatus = 'READY_FOR_TEST_DESIGN';
  if (hasCritical) reviewStatus = 'BLOCKED';
  else if (hasHighBusiness || open.some((q) => q.priority === 'HIGH')) {
    reviewStatus = 'NEEDS_CLARIFICATION';
  } else if (onlyLowMedium || opts.functionalCompleteness === 'INCOMPLETE') {
    reviewStatus = 'REVIEW_RECOMMENDED';
  } else if (opts.functionalCompleteness === 'PARTIAL' && open.length > 0) {
    reviewStatus = 'REVIEW_RECOMMENDED';
  }

  return { businessReadiness, reviewStatus };
}
