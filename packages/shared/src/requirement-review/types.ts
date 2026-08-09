/**
 * Business + Functional review types and readiness weights.
 */

export const REVIEW_QUESTION_PRIORITIES = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
] as const;

export type ReviewQuestionPriority =
  (typeof REVIEW_QUESTION_PRIORITIES)[number];

export const REVIEW_QUESTION_CATEGORIES = [
  'BUSINESS_RULE',
  'BUSINESS_FLOW',
  'ACTOR',
  'ROLE_PERMISSION',
  'PRECONDITION',
  'STATE',
  'STATE_TRANSITION',
  'EXCEPTION',
  'BUSINESS_OUTCOME',
  'FUNCTIONAL_BEHAVIOR',
  'VALIDATION',
  'ERROR_HANDLING',
  'INPUT',
  'OUTPUT',
  'NAVIGATION',
  'DATA',
] as const;

export type ReviewQuestionCategory =
  (typeof REVIEW_QUESTION_CATEGORIES)[number];

export const REVIEW_FACT_STATUSES = [
  'CONFIRMED',
  'INFERRED',
  'MISSING',
  'DERIVED_FROM_USER_ANSWER',
] as const;

export type ReviewFactStatus = (typeof REVIEW_FACT_STATUSES)[number];

export const REQUIREMENT_REVIEW_STATUSES = [
  'BLOCKED',
  'NEEDS_CLARIFICATION',
  'REVIEW_RECOMMENDED',
  'READY_FOR_TEST_DESIGN',
] as const;

export type RequirementReviewStatus =
  (typeof REQUIREMENT_REVIEW_STATUSES)[number];

export const BUSINESS_READINESS = [
  'READY',
  'NEEDS_CLARIFICATION',
  'BLOCKED',
] as const;

export type BusinessReadiness = (typeof BUSINESS_READINESS)[number];

export const FUNCTIONAL_COMPLETENESS = [
  'COMPLETE',
  'PARTIAL',
  'INCOMPLETE',
] as const;

export type FunctionalCompleteness =
  (typeof FUNCTIONAL_COMPLETENESS)[number];

/**
 * Configurable question impact weights (business impact over count).
 * Override at runtime via env in the API layer if needed.
 */
export const REVIEW_PRIORITY_WEIGHTS: Record<ReviewQuestionPriority, number> = {
  CRITICAL: 40,
  HIGH: 25,
  MEDIUM: 10,
  LOW: 3,
};

export const BUSINESS_CATEGORIES: ReviewQuestionCategory[] = [
  'BUSINESS_RULE',
  'BUSINESS_FLOW',
  'ACTOR',
  'ROLE_PERMISSION',
  'PRECONDITION',
  'STATE',
  'STATE_TRANSITION',
  'EXCEPTION',
  'BUSINESS_OUTCOME',
];

export type ReviewFact = {
  text: string;
  status: ReviewFactStatus;
  source?: string | null;
};

export type BusinessReviewPayload = {
  intent: ReviewFact | null;
  actors: ReviewFact[];
  rules: ReviewFact[];
  preconditions: ReviewFact[];
  flow: ReviewFact[];
  states: ReviewFact[];
  transitions: ReviewFact[];
  exceptions: ReviewFact[];
  outcomes: ReviewFact[];
  dependencies: ReviewFact[];
  permissions: ReviewFact[];
};

export type FunctionalReviewPayload = {
  inputs: ReviewFact[];
  outputs: ReviewFact[];
  validations: ReviewFact[];
  successBehavior: ReviewFact[];
  failureBehavior: ReviewFact[];
  errorHandling: ReviewFact[];
  navigation: ReviewFact[];
  dataHandling: ReviewFact[];
};

export type ReviewQuestionDraft = {
  category: ReviewQuestionCategory;
  priority: ReviewQuestionPriority;
  question: string;
  reason: string;
  blocking: boolean;
};

export type RequirementAnalysisResult = {
  businessReview: BusinessReviewPayload;
  functionalReview: FunctionalReviewPayload;
  questions: ReviewQuestionDraft[];
  businessReadiness: BusinessReadiness;
  functionalCompleteness: FunctionalCompleteness;
  reviewStatus: RequirementReviewStatus;
  readinessScore: number;
};
