/**
 * Post-extraction pipeline:
 * Candidates (temp IDs) → Quality gate → Normalization/Merge → Sequential REQ IDs
 */

import { extractRequirementsFromSource } from './semantic-extract.js';
import type { SemanticExtractedRequirement, ExtractionResult } from './semantic-extract.js';
import {
  isRequirementCandidate,
  type RejectReason,
  type RequirementCandidate,
} from './quality-gate.js';
import {
  normalizeRequirements,
  type TempCandidate,
} from './normalize-requirements.js';

export type ExtractionDecision =
  | {
      decision: 'REJECT';
      reason: RejectReason;
      source: string;
      aiCandidate?: string;
      sourceElementType?: string;
    }
  | {
      decision: 'ATTACH_TO_PARENT';
      type: 'ACCEPTANCE_CRITERIA' | 'SUPPORTING_INFORMATION' | 'BUSINESS_RULE';
      source: string;
      parentKey?: string;
      parentTitle?: string;
      aiCandidate?: string;
    }
  | {
      decision: 'MERGE';
      source: string;
      intoKey: string;
      intoTitle: string;
      aiCandidate?: string;
    }
  | {
      decision: 'SAVE';
      requirementKey: string;
      title: string;
      source: string;
      type: string;
    }
  | {
      decision: 'TABLE_DATA' | 'SECTION_CONTEXT';
      source: string;
      detail?: string;
    }
  | {
      decision: 'NORMALIZE';
      source: string;
      detail?: string;
    };

export type FinalizeResult = {
  requirements: SemanticExtractedRequirement[];
  documentElements: ExtractionResult['documentElements'];
  decisions: ExtractionDecision[];
  stats: {
    candidatesIn: number;
    rejected: number;
    merged: number;
    retitled: number;
    reclassified: number;
    saved: number;
  };
};

function stripMarkdown(value: string): string {
  return value
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\d+(\.\d+)*\s*[.)]\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTempCandidate(
  raw: {
    title: string;
    description: string;
    type?: string;
    priority?: string | null;
    acceptanceCriteria?: string[];
    businessRules?: string[];
    dependencies?: string[];
    supportingInformation?: string[];
    sourceText?: string | null;
    section?: string | null;
    source?: {
      document?: string | null;
      page?: number | null;
      section?: string | null;
      text?: string | null;
    };
  },
  documentName: string,
  index: number,
): TempCandidate {
  const description = stripMarkdown(raw.description || raw.sourceText || '');
  const sourceText = stripMarkdown(
    raw.sourceText || raw.source?.text || description,
  );
  return {
    tempId: `candidate-${String(index + 1).padStart(3, '0')}`,
    title: stripMarkdown(raw.title || 'Requirement'),
    description: /[.!?]$/.test(description) ? description : `${description}.`,
    type: (raw.type as TempCandidate['type']) || 'FUNCTIONAL',
    priority: raw.priority ?? null,
    acceptanceCriteria: [...(raw.acceptanceCriteria ?? [])],
    businessRules: [...(raw.businessRules ?? [])],
    dependencies: [...(raw.dependencies ?? [])],
    supportingInformation: [...(raw.supportingInformation ?? [])],
    source: {
      document: raw.source?.document || documentName,
      page: raw.source?.page ?? null,
      section: raw.section ?? raw.source?.section ?? null,
      text: sourceText,
    },
  };
}

/**
 * Collect candidates with temporary IDs, validate, normalize/merge, then assign REQ IDs.
 */
export function finalizeExtraction(opts: {
  sourceText: string;
  documentName: string;
  aiCandidates?: Array<RequirementCandidate & Record<string, unknown>>;
}): FinalizeResult {
  const decisions: ExtractionDecision[] = [];
  const baseline = extractRequirementsFromSource(opts.sourceText, opts.documentName);

  for (const section of baseline.documentElements.sections) {
    decisions.push({
      decision: 'SECTION_CONTEXT',
      source: section.title,
      detail: `level=${section.level ?? 2}`,
    });
  }
  for (const table of baseline.documentElements.tables) {
    decisions.push({
      decision: 'TABLE_DATA',
      source: `| ${(table.headers || []).join(' | ')} |`,
      detail: `${table.rows.length} rows in section ${table.section ?? 'n/a'}`,
    });
  }

  const accepted: TempCandidate[] = [];
  let rejected = 0;
  let seq = 0;

  const admitRaw = (
    raw: {
      title: string;
      description: string;
      type?: string;
      priority?: string | null;
      acceptanceCriteria?: string[];
      businessRules?: string[];
      dependencies?: string[];
      supportingInformation?: string[];
      sourceText?: string | null;
      section?: string | null;
      source?: TempCandidate['source'];
    },
    from: string,
  ) => {
    const gate = isRequirementCandidate({
      title: raw.title,
      description: raw.description,
      sourceText: raw.sourceText || raw.source?.text || raw.description,
      section: raw.section ?? raw.source?.section ?? null,
      type: raw.type,
      acceptanceCriteria: raw.acceptanceCriteria,
      supportingInformation: raw.supportingInformation,
    });

    if (!gate.ok) {
      rejected += 1;
      decisions.push({
        decision: 'REJECT',
        reason: gate.reason ?? 'NO_SEMANTIC_CONTENT',
        source: raw.sourceText || raw.description || raw.title,
        aiCandidate: `${raw.title}: ${raw.description}`,
        sourceElementType: from,
      });
      return;
    }

    const temp = toTempCandidate(raw, opts.documentName, seq);
    seq += 1;
    accepted.push(temp);
    decisions.push({
      decision: 'NORMALIZE',
      source: temp.source.text,
      detail: `${temp.tempId} accepted for normalization`,
    });
  };

  // 1) Deterministic baseline candidates (still temp IDs — no REQ yet)
  for (const req of baseline.requirements) {
    admitRaw(
      {
        title: req.title,
        description: req.description,
        type: req.type,
        priority: req.priority,
        acceptanceCriteria: req.acceptanceCriteria,
        businessRules: req.businessRules,
        dependencies: req.dependencies,
        supportingInformation: req.supportingInformation,
        sourceText: req.source.text,
        section: req.source.section,
        source: req.source,
      },
      'BASELINE',
    );
  }

  // 2) AI candidates
  const aiCandidates = opts.aiCandidates ?? [];
  for (const raw of aiCandidates) {
    const title = String(raw.title ?? '');
    const description = String(raw.description ?? '');
    const sourceText = String(
      raw.sourceText ??
        (raw as { source?: { text?: string } }).source?.text ??
        description,
    );
    admitRaw(
      {
        title,
        description,
        type: raw.type as string | undefined,
        priority: (raw.priority as string | null | undefined) ?? null,
        acceptanceCriteria: raw.acceptanceCriteria as string[] | undefined,
        businessRules: raw.businessRules as string[] | undefined,
        dependencies: raw.dependencies as string[] | undefined,
        supportingInformation: raw.supportingInformation as string[] | undefined,
        sourceText,
        section: (raw.section as string) ?? null,
        source: {
          document: opts.documentName,
          page: null,
          section: (raw.section as string) ?? null,
          text: sourceText,
        },
      },
      'AI_CANDIDATE',
    );
  }

  // 3) Normalization / merge / titles / classification — THEN sequential REQ IDs
  const { requirements, stats } = normalizeRequirements(accepted);

  for (const req of requirements) {
    decisions.push({
      decision: 'SAVE',
      requirementKey: req.requirementKey,
      title: req.title,
      source: req.source.text || req.description,
      type: req.type,
    });
  }

  // Record merge volume from normalizer
  if (stats.merged > 0) {
    decisions.push({
      decision: 'MERGE',
      source: `${stats.merged} candidate(s) merged during normalization`,
      intoKey: 'FINAL',
      intoTitle: 'Normalized requirement set',
    });
  }

  return {
    requirements,
    documentElements: baseline.documentElements,
    decisions,
    stats: {
      candidatesIn: baseline.requirements.length + aiCandidates.length,
      rejected,
      merged: stats.merged,
      retitled: stats.retitled,
      reclassified: stats.reclassified,
      saved: requirements.length,
    },
  };
}
