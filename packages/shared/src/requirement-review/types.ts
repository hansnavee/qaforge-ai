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
  'PRECEDES',
  'SEQUENTIAL',
  'BUSINESS_RULE_CONSTRAINT',
  'CONFLICTS_WITH',
  'DUPLICATE_OF',
  'OVERLAPS',
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

export const DUPLICATE_KINDS = [
  'DUPLICATE',
  'POSSIBLE_DUPLICATE',
  'RELATED',
  'SEQUENTIAL',
  'BUSINESS_RULE_CONSTRAINT',
  'CONFLICT',
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
    condition?: string | null;
    polarity?: string | null;
    confidence?: number | null;
    uncertain?: boolean | null;
    source?: string | null;
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
  /** Internal signal only — never the primary UI decision */
  similarity: number;
  kind: DuplicateKind;
  recommendation: string;
  /** User-facing semantic reason */
  reason?: string;
  /** Confidence UI only for true DUPLICATE */
  showConfidence?: boolean;
  sameFeatureDifferentOps?: boolean;
  suggestedFeatureSplit?: string[];
  /** Graph edge type for persistence */
  relationType?: RelationType | 'PRECEDES';
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

/** Canonical relationship model — single source of truth for API + UI */
export type RequirementRelationship = {
  sourceRequirementId: string;
  targetRequirementId: string;
  relationship:
    | 'DUPLICATE'
    | 'RELATED'
    | 'POSSIBLE_DUPLICATE'
    | 'SEQUENTIAL'
    | 'BUSINESS_RULE_CONSTRAINT'
    | 'CONFLICT'
    | 'DEPENDS_ON'
    | 'PRECEDES' // legacy alias of SEQUENTIAL
    | 'CONFLICTS_WITH' // legacy alias of CONFLICT
    | 'NOT_DUPLICATE'; // never persisted for new analyses
  /** Optional supporting score only — never primary decision */
  confidence?: number;
  reason: string;
  semanticAnalysis?: {
    actorMatch: boolean;
    entityMatch: boolean;
    actionMatch: boolean;
    capabilityMatch: boolean;
    outcomeMatch: boolean;
    contextMatch: boolean;
    workflowRelation?: boolean;
    businessRuleMatch?: boolean;
  };
};

export const SEMANTIC_ANALYSIS_ENGINE = 'semantic-requirement-review';
export const SEMANTIC_ANALYSIS_VERSION = '2.6.0';

/** Relationships worth persisting (missing edge = INDEPENDENT). */
export const PERSISTABLE_RELATIONSHIPS = new Set<
  RequirementRelationship['relationship']
>([
  'DUPLICATE',
  'POSSIBLE_DUPLICATE',
  'RELATED',
  'SEQUENTIAL',
  'BUSINESS_RULE_CONSTRAINT',
  'CONFLICT',
  'DEPENDS_ON',
  'PRECEDES',
  'CONFLICTS_WITH',
]);

export function factStatusToIntentSource(
  status: ReviewFactStatus,
): IntentSource {
  if (status === 'CONFIRMED') return 'EXPLICIT';
  if (status === 'DERIVED_FROM_USER_ANSWER') return 'USER_CONFIRMED';
  if (status === 'INFERRED') return 'AI_INFERRED';
  return 'AI_INFERRED';
}
