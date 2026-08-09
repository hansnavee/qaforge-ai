/**
 * Stage 1 → Stage 2 handoff readiness for STLC.
 * Pure checks — no DB / LLM. Used by API gate + UI.
 */

export type StlcRequirementRow = {
  requirementKey: string;
  title: string;
  reviewStatus?: string | null;
  analysisStale?: boolean;
  businessImpact?: string | null;
};

export type StlcQuestionRow = {
  priority?: string | null;
  blocking?: boolean | null;
  status?: string | null;
};

export type StlcReadinessInput = {
  analysisStatus?: string | null;
  staleRequirementCount?: number | null;
  requirementsApprovedAt?: string | Date | null;
  requirements: StlcRequirementRow[];
  openQuestions?: StlcQuestionRow[];
};

export type StlcReadiness = {
  canApprove: boolean;
  canStartPlanning: boolean;
  approved: boolean;
  blockers: string[];
  counts: {
    total: number;
    blocked: number;
    needsClarification: number;
    reviewRecommended: number;
    readyForTestDesign: number;
    stale: number;
    openBlockingCriticalQuestions: number;
  };
};

function isOpen(q: StlcQuestionRow) {
  return !q.status || q.status === 'OPEN';
}

export function evaluateRequirementsReadiness(
  input: StlcReadinessInput,
): StlcReadiness {
  const requirements = input.requirements ?? [];
  const openQuestions = (input.openQuestions ?? []).filter(isOpen);
  const blockers: string[] = [];

  const blocked = requirements.filter((r) => r.reviewStatus === 'BLOCKED');
  const needsClarification = requirements.filter(
    (r) => r.reviewStatus === 'NEEDS_CLARIFICATION',
  );
  const reviewRecommended = requirements.filter(
    (r) => r.reviewStatus === 'REVIEW_RECOMMENDED',
  );
  const readyForTestDesign = requirements.filter(
    (r) => r.reviewStatus === 'READY_FOR_TEST_DESIGN',
  );
  const stale = requirements.filter((r) => r.analysisStale);
  const openBlockingCriticalQuestions = openQuestions.filter(
    (q) => q.blocking && q.priority === 'CRITICAL',
  );

  if (input.analysisStatus !== 'COMPLETED') {
    blockers.push('Requirement analysis must be completed');
  }
  if (requirements.length === 0) {
    blockers.push('No extracted requirements to approve');
  }
  if ((input.staleRequirementCount ?? 0) > 0 || stale.length > 0) {
    blockers.push('Stale requirements — re-run analysis before approval');
  }
  if (blocked.length > 0) {
    blockers.push(
      `${blocked.length} requirement(s) are BLOCKED and must be resolved`,
    );
  }
  if (openBlockingCriticalQuestions.length > 0) {
    blockers.push(
      `${openBlockingCriticalQuestions.length} open CRITICAL blocking question(s)`,
    );
  }

  const canApprove = blockers.length === 0;
  const approved = Boolean(input.requirementsApprovedAt);
  // Once approved, Planning can always start (soft blockers must not freeze CTA).
  const canStartPlanning = approved;

  return {
    canApprove,
    canStartPlanning,
    approved,
    blockers,
    counts: {
      total: requirements.length,
      blocked: blocked.length,
      needsClarification: needsClarification.length,
      reviewRecommended: reviewRecommended.length,
      readyForTestDesign: readyForTestDesign.length,
      stale: stale.length,
      openBlockingCriticalQuestions: openBlockingCriticalQuestions.length,
    },
  };
}
