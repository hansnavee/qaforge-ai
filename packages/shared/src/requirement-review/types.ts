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

/** Legacy fact statuses (preserved for existing Json payloads). */
export const REVIEW_FACT_STATUSES = [
  'CONFIRMED',
  'INFERRED',
  'MISSING',
  'DERIVED_FROM_USER_ANSWER',
] as const;

export type ReviewFactStatus = (typeof REVIEW_FACT_STATUSES)[number];

/** Provenance for business intent / rules (enhancement vocabulary). */
export const INTENT_SOURCES = [
  'EXPLICIT',
  'USER_CONFIRMED',
  'AI_DERIVED',
  'AI_INFERRED',
] as const;

export type IntentSource = (typeof INTENT_SOURCES)[number];

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

export const BUSINESS_IMPACT_LEVELS = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
] as const;

export type BusinessImpact = (typeof BUSINESS_IMPACT_LEVELS)[number];

export const REVIEW_REQUIREMENT_TYPES = [
  'FUNCTIONAL',
  'BUSINESS_RULE',
  'NON_FUNCTIONAL',
] as const;

export type ReviewRequirementType = (typeof REVIEW_REQUIREMENT_TYPES)[number];

export const RELATION_TYPES = [
  'DEPENDS_ON',
  'AFFECTS',
  'RELATED_TO',
  'CONFLICTS_WITH',
  'DUPLICATE_OF',
  'OVERLAPS',
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

export const DUPLICATE_KINDS = [
  'DUPLICATE',
  'POSSIBLE_DUPLICATE',
  'RELATED',
  'NOT_DUPLICATE',
] as const;

export type DuplicateKind = (typeof DUPLICATE_KINDS)[number];

/**
 * Configurable question impact weights (business impact over count).
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
  /** Optional enhancement provenance; defaults derived from status. */
  intentSource?: IntentSource | null;
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
  /** Structured semantic fingerprint used by duplicate/feature intelligence */
  semantic?: {
    actor: string;
    entity: string;
    action: string;
    businessCapability: string;
    businessOutcome: string;
    channel?: string | null;
    crudOp?: string | null;
  } | null;
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
  /** Stable key for cross-requirement deduplication */
  fingerprint?: string;
};

export type RequirementAnalysisResult = {
  businessReview: BusinessReviewPayload;
  functionalReview: FunctionalReviewPayload;
  questions: ReviewQuestionDraft[];
  businessReadiness: BusinessReadiness;
  functionalCompleteness: FunctionalCompleteness;
  reviewStatus: RequirementReviewStatus;
  readinessScore: number;
  primaryType: ReviewRequirementType;
  secondaryType: ReviewRequirementType | null;
  businessImpact: BusinessImpact;
  intentSource: IntentSource;
  businessIntentText: string | null;
};

export type FeatureGroupDraft = {
  featureKey: string;
  name: string;
  businessArea: string;
  businessCapability?: string;
  businessIntent?: string;
  requirementKeys: string[];
};

export type DuplicatePair = {
  requirementKeyA: string;
  requirementKeyB: string;
  /** Internal signal only — not primary UI decision */
  similarity: number;
  kind: DuplicateKind;
  recommendation: string;
  /** User-facing semantic reason */
  reason?: string;
  /** Only show % for true/possible duplicates when useful */
  showConfidence?: boolean;
  sameFeatureDifferentOps?: boolean;
  suggestedFeatureSplit?: string[];
  semanticA?: {
    actor: string;
    entity: string;
    action: string;
    capability: string;
    outcome: string;
    channel: string | null;
  };
  semanticB?: {
    actor: string;
    entity: string;
    action: string;
    capability: string;
    outcome: string;
    channel: string | null;
  };
};

export type RelationDraft = {
  fromKey: string;
  toKey: string;
  relationType: RelationType;
  confidence: number;
  detail?: string;
};

export function factStatusToIntentSource(
  status: ReviewFactStatus,
): IntentSource {
  if (status === 'CONFIRMED') return 'EXPLICIT';
  if (status === 'DERIVED_FROM_USER_ANSWER') return 'USER_CONFIRMED';
  if (status === 'INFERRED') return 'AI_INFERRED';
  return 'AI_INFERRED';
}
