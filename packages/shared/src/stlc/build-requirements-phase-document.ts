/**
 * Durable REQUIREMENTS STLC phase document — human analysis pack, not raw JSON dump.
 * Facts only from reviewed requirements; never invents new requirement text.
 */

import { buildPhaseDocState } from './phase-documents.js';
import type { PhaseDocState, PhaseValidation } from './phases.js';

export type RequirementsPhaseDocInput = {
  projectName: string;
  analysisId?: string | null;
  analysisVersion?: string | null;
  analysisEngine?: string | null;
  total: number;
  readyForTestDesign: number;
  needsClarification: number;
  blocked: number;
  openQuestions: number;
  openConflicts: number;
  features: number;
  blockers: string[];
  requirements: Array<{
    requirementKey: string;
    title: string;
    type?: string | null;
    reviewStatus?: string | null;
    businessImpact?: string | null;
    readinessScore?: number | null;
  }>;
  groundingNote?: string;
};

export function buildRequirementsPhaseDocument(
  input: RequirementsPhaseDocInput,
): Record<string, unknown> {
  const ready = input.requirements.filter(
    (r) => r.reviewStatus === 'READY_FOR_TEST_DESIGN',
  );
  return {
    kind: 'REQUIREMENTS_ANALYSIS_PACK',
    projectName: input.projectName,
    summary:
      input.blockers.length === 0
        ? `Requirements analysis pack for ${input.projectName}: ${input.total} requirement(s) reviewed; ready for Planning when approved.`
        : `Requirements analysis for ${input.projectName} has open blockers before approval.`,
    grounding:
      input.groundingNote ??
      'Analysis asks clarifying questions for gaps. Requirement text and examples from the source are not changed without human confirmation.',
    counts: {
      total: input.total,
      readyForTestDesign: input.readyForTestDesign,
      needsClarification: input.needsClarification,
      blocked: input.blocked,
      openQuestions: input.openQuestions,
      openConflicts: input.openConflicts,
      features: input.features,
    },
    blockers: input.blockers,
    analysis: {
      analysisId: input.analysisId ?? null,
      analysisVersion: input.analysisVersion ?? null,
      analysisEngine: input.analysisEngine ?? null,
    },
    // Concise roster — titles only, no invented fields
    requirementRoster: input.requirements.map((r) => ({
      id: r.requirementKey,
      title: r.title,
      type: r.type ?? null,
      status: r.reviewStatus ?? null,
      impact: r.businessImpact ?? null,
      readiness: r.readinessScore ?? null,
    })),
    readySample: ready.slice(0, 20).map((r) => ({
      id: r.requirementKey,
      title: r.title,
    })),
    preparedAt: new Date().toISOString(),
  };
}

export function buildRequirementsPhaseDocState(opts: {
  document: Record<string, unknown>;
  validation: PhaseValidation;
  previous?: PhaseDocState | null;
  status?: PhaseDocState['status'];
}): PhaseDocState {
  return buildPhaseDocState({
    phaseId: 'REQUIREMENTS',
    status: opts.status ?? (opts.validation.passed ? 'READY_FOR_REVIEW' : 'FAILED'),
    document: opts.document,
    validation: opts.validation,
    previous: opts.previous,
  });
}
