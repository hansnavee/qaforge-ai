/**
 * Build STLC REQUIREMENTS_JSON from Step 2 reviewed requirements
 * so Stage 2+ does not re-parse raw documents.
 */

export type ReviewedRequirementInput = {
  requirementKey: string;
  title: string;
  description: string;
  priority?: string | null;
  businessImpact?: string | null;
  reviewStatus?: string | null;
  acceptanceCriteria?: unknown;
  businessRules?: unknown;
  featureGroup?: {
    featureKey?: string | null;
    name?: string | null;
    businessArea?: string | null;
  } | null;
};

export type ReviewedFeatureInput = {
  featureKey: string;
  name: string;
  businessArea?: string | null;
  businessIntent?: string | null;
  businessImpact?: string | null;
  featureRisk?: string | null;
  reviewStatus?: string | null;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function priorityOf(r: ReviewedRequirementInput): string {
  const impact = (r.businessImpact ?? '').toUpperCase();
  if (impact === 'CRITICAL' || impact === 'HIGH') return 'high';
  if (impact === 'LOW') return 'low';
  if (r.priority) return String(r.priority).toLowerCase();
  return 'medium';
}

export function buildReviewedRequirementsArtifact(input: {
  appUrl?: string | null;
  projectName?: string | null;
  analysisId?: string | null;
  analysisVersion?: string | null;
  requirements: ReviewedRequirementInput[];
  features?: ReviewedFeatureInput[];
}) {
  const requirements = input.requirements.map((r) => ({
    id: r.requirementKey,
    title: r.title,
    description: r.description,
    priority: priorityOf(r),
    businessImpact: r.businessImpact ?? null,
    reviewStatus: r.reviewStatus ?? null,
    featureKey: r.featureGroup?.featureKey ?? null,
    featureName: r.featureGroup?.name ?? null,
    businessArea: r.featureGroup?.businessArea ?? null,
    acceptanceCriteria: asStringArray(r.acceptanceCriteria),
    businessRules: asStringArray(r.businessRules),
  }));

  const businessRules = [
    ...new Set(requirements.flatMap((r) => r.businessRules)),
  ].slice(0, 50);

  const coverageAreas = [
    ...new Set(
      requirements
        .map((r) => r.businessArea || r.featureName || r.featureKey)
        .filter((v): v is string => Boolean(v)),
    ),
  ];

  const risks = requirements
    .filter(
      (r) =>
        r.businessImpact === 'CRITICAL' ||
        r.reviewStatus === 'NEEDS_CLARIFICATION' ||
        r.reviewStatus === 'REVIEW_RECOMMENDED',
    )
    .map((r) => `${r.id}: ${r.title}`)
    .slice(0, 30);

  return {
    source: 'step2-reviewed',
    projectName: input.projectName ?? null,
    appUrl: input.appUrl ?? null,
    analysisId: input.analysisId ?? null,
    analysisVersion: input.analysisVersion ?? null,
    businessRules:
      businessRules.length > 0
        ? businessRules
        : requirements.slice(0, 20).map((r) => r.title),
    risks:
      risks.length > 0
        ? risks
        : ['Critical path coverage may still need human test design review'],
    coverageAreas:
      coverageAreas.length > 0
        ? coverageAreas
        : ['functional', 'business-rules', 'critical-paths'],
    features: (input.features ?? []).map((f) => ({
      featureKey: f.featureKey,
      name: f.name,
      businessArea: f.businessArea ?? null,
      businessIntent: f.businessIntent ?? null,
      businessImpact: f.businessImpact ?? null,
      featureRisk: f.featureRisk ?? null,
      reviewStatus: f.reviewStatus ?? null,
    })),
    requirements,
  };
}

export type ReviewedRequirementsArtifact = ReturnType<
  typeof buildReviewedRequirementsArtifact
>;
