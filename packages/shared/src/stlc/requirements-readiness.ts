/**
 * Stage 1 → Stage 2 handoff readiness for STLC.
 * Pure checks — no DB / LLM. Used by API gate + UI.
 *
 * QA Lead rule: do not Approve while conflicts or blocking questions remain.
 * Soft “needs clarification” is surfaced in counts but only CRITICAL/HIGH
 * blocking questions (and conflicts/blocked/stale) stop the gate.
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
  requirementsRejectedAt?: string | Date | null;
  requirementsRejectionReason?: string | null;
  requirements: StlcRequirementRow[];
  openQuestions?: StlcQuestionRow[];
  /** Open business conflicts that still need a human decision */
  openConflicts?: number | null;
};

export type StlcReadiness = {
  canApprove: boolean;
  canStartPlanning: boolean;
  approved: boolean;
  rejected: boolean;
  rejectionReason: string | null;
  blockers: string[];
  /** Plain checklist for UI — done vs pending exit criteria */
  checklist: Array<{ id: string; label: string; done: boolean }>;
  counts: {
    total: number;
    blocked: number;
    needsClarification: number;
    reviewRecommended: number;
    readyForTestDesign: number;
    stale: number;
    openBlockingCriticalQuestions: number;
    openBlockingHighQuestions: number;
    openConflicts: number;
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
  const openConflicts = Math.max(0, input.openConflicts ?? 0);

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
  const openBlockingHighQuestions = openQuestions.filter(
    (q) => q.blocking && q.priority === 'HIGH',
  );

  const analysisDone = input.analysisStatus === 'COMPLETED';
  const hasReqs = requirements.length > 0;
  const noStale =
    (input.staleRequirementCount ?? 0) === 0 && stale.length === 0;
  const noBlocked = blocked.length === 0;
  const noCriticalQs = openBlockingCriticalQuestions.length === 0;
  const noHighBlockingQs = openBlockingHighQuestions.length === 0;
  const noConflicts = openConflicts === 0;

  if (!analysisDone) {
    blockers.push('Requirement analysis must be completed');
  }
  if (!hasReqs) {
    blockers.push('No extracted requirements to approve');
  }
  if (!noStale) {
    blockers.push('Stale requirements — re-run analysis before approval');
  }
  if (!noBlocked) {
    blockers.push(
      `${blocked.length} requirement(s) are BLOCKED and must be resolved`,
    );
  }
  if (!noCriticalQs) {
    blockers.push(
      `${openBlockingCriticalQuestions.length} open CRITICAL blocking question(s)`,
    );
  }
  if (!noHighBlockingQs) {
    blockers.push(
      `${openBlockingHighQuestions.length} open HIGH blocking question(s)`,
    );
  }
  if (!noConflicts) {
    blockers.push(
      `${openConflicts} open conflict(s) must be resolved before approval`,
    );
  }

  const checklist = [
    {
      id: 'analysis',
      label: 'Analysis completed on the provided source',
      done: analysisDone,
    },
    {
      id: 'extracted',
      label: 'At least one requirement extracted from source',
      done: hasReqs,
    },
    {
      id: 'fresh',
      label: 'No stale requirements after edits',
      done: noStale,
    },
    {
      id: 'unblocked',
      label: 'No requirements left in BLOCKED status',
      done: noBlocked,
    },
    {
      id: 'critical-qs',
      label: 'No open CRITICAL blocking questions',
      done: noCriticalQs,
    },
    {
      id: 'high-qs',
      label: 'No open HIGH blocking questions',
      done: noHighBlockingQs,
    },
    {
      id: 'conflicts',
      label: 'No open requirement conflicts',
      done: noConflicts,
    },
  ];

  const canApprove = blockers.length === 0;
  const approved = Boolean(input.requirementsApprovedAt);
  const canStartPlanning = approved;
  const rejected = Boolean(input.requirementsRejectedAt) && !approved;
  const rejectionReason = rejected
    ? (input.requirementsRejectionReason?.trim() || null)
    : null;

  return {
    canApprove,
    canStartPlanning,
    approved,
    rejected,
    rejectionReason,
    blockers,
    checklist,
    counts: {
      total: requirements.length,
      blocked: blocked.length,
      needsClarification: needsClarification.length,
      reviewRecommended: reviewRecommended.length,
      readyForTestDesign: readyForTestDesign.length,
      stale: stale.length,
      openBlockingCriticalQuestions: openBlockingCriticalQuestions.length,
      openBlockingHighQuestions: openBlockingHighQuestions.length,
      openConflicts,
    },
  };
}
