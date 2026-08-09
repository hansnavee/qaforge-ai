/**
 * Post-extraction pipeline:
 * Candidate → Normalize → Validate → Deduplicate/Merge → Final Requirements
 */

import { extractRequirementsFromSource } from './semantic-extract.js';
import type { SemanticExtractedRequirement, ExtractionResult } from './semantic-extract.js';
import {
  isRequirementCandidate,
  type RejectReason,
  type RequirementCandidate,
} from './quality-gate.js';

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
    };

export type FinalizeResult = {
  requirements: SemanticExtractedRequirement[];
  documentElements: ExtractionResult['documentElements'];
  decisions: ExtractionDecision[];
  stats: {
    candidatesIn: number;
    rejected: number;
    merged: number;
    saved: number;
  };
};

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\busers\b/g, 'user')
    .replace(/\blog\s*in\b/g, 'login')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

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

function capabilityKey(title: string, description: string, _section: string | null): string {
  const t = normalizeKey(title);
  const d = normalizeKey(description);
  // Do NOT include section name — it falsely merges distinct reqs in the same section
  const blob = `${t} ${d}`;

  if (/unique email|email .*unique|must be unique/.test(blob) && /email/.test(blob)) {
    return 'cap:unique-email';
  }
  // Collapse obvious same-capability duplicates (ignore section drift from AI)
  if (/user login|^login$|login using|\blog in\b/.test(blob)) return 'cap:login';
  if (/user registration|create an account|register using/.test(blob)) {
    return 'cap:registration';
  }
  if (/product search results/.test(blob)) return 'cap:search-results';
  if (/product search|search for products/.test(blob) && !/result|filter/.test(blob)) {
    return 'cap:search';
  }
  if (/product details|details page should display/.test(blob)) {
    return 'cap:product-details';
  }
  if (/password reset|reset .*password/.test(blob)) return 'cap:password-reset';

  return `src:${normalizeKey(description)}`;
}

function normalizeCandidate(
  raw: RequirementCandidate & {
    requirementKey?: string;
    priority?: string | null;
    dependencies?: string[];
    source?: { document?: string | null; page?: number | null; section?: string | null; text?: string | null };
  },
  documentName: string,
): SemanticExtractedRequirement {
  const description = stripMarkdown(raw.description || raw.sourceText || '');
  const sourceText = stripMarkdown(raw.sourceText || raw.source?.text || description);
  const title = stripMarkdown(raw.title || 'Requirement');
  const section = raw.section ?? raw.source?.section ?? null;

  return {
    requirementKey: (raw.requirementKey || 'REQ-001').toUpperCase(),
    title,
    description: /[.!?]$/.test(description) ? description : `${description}.`,
    type: (raw.type as SemanticExtractedRequirement['type']) || 'FUNCTIONAL',
    priority: raw.priority ?? null,
    acceptanceCriteria: [...(raw.acceptanceCriteria ?? [])],
    businessRules: [...(raw.businessRules ?? [])],
    dependencies: [...(raw.dependencies ?? [])],
    supportingInformation: [...(raw.supportingInformation ?? [])],
    source: {
      document: raw.source?.document || documentName,
      page: raw.source?.page ?? null,
      section,
      text: sourceText,
    },
  };
}

function titlesSimilar(a: string, b: string): boolean {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function descriptionsOverlap(a: string, b: string): boolean {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length > 24 && nb.length > 24 && (na.includes(nb) || nb.includes(na))) {
    return true;
  }
  // token overlap
  const ta = new Set(na.split(' ').filter((w) => w.length > 3));
  const tb = new Set(nb.split(' ').filter((w) => w.length > 3));
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const ratio = inter / Math.min(ta.size, tb.size);
  return ratio >= 0.85;
}

/**
 * Finalize candidates into validated, deduplicated requirements.
 * Deterministic baseline is always included as the trusted seed.
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

  type Working = SemanticExtractedRequirement & { _cap: string };
  const working: Working[] = [];

  const admit = (candidate: SemanticExtractedRequirement, from: 'BASELINE' | 'AI') => {
    const gate = isRequirementCandidate({
      title: candidate.title,
      description: candidate.description,
      sourceText: candidate.source.text,
      section: candidate.source.section,
      type: candidate.type,
      acceptanceCriteria: candidate.acceptanceCriteria,
      supportingInformation: candidate.supportingInformation,
    });

    if (!gate.ok) {
      decisions.push({
        decision: 'REJECT',
        reason: gate.reason ?? 'NO_SEMANTIC_CONTENT',
        source: candidate.source.text || candidate.description,
        aiCandidate: `${candidate.title}: ${candidate.description}`,
        sourceElementType: from,
      });
      return;
    }

    const cap = capabilityKey(
      candidate.title,
      candidate.description,
      candidate.source.section,
    );

    const existing = working.find(
      (w) =>
        w._cap === cap ||
        (titlesSimilar(w.title, candidate.title) &&
          descriptionsOverlap(w.description, candidate.description)) ||
        (normalizeKey(w.title) === normalizeKey(candidate.title) &&
          (descriptionsOverlap(w.description, candidate.description) ||
            w._cap === cap)) ||
        descriptionsOverlap(w.description, candidate.description),
    );

    if (existing) {
      // Merge AC / supporting info; keep richer description
      const extraStatements: string[] = [];
      if (
        normalizeKey(candidate.description) !== normalizeKey(existing.description)
      ) {
        extraStatements.push(candidate.description);
      }
      for (const ac of candidate.acceptanceCriteria) {
        if (
          !existing.acceptanceCriteria.some(
            (x) => normalizeKey(x) === normalizeKey(ac),
          )
        ) {
          existing.acceptanceCriteria.push(ac);
        }
      }
      for (const si of candidate.supportingInformation) {
        if (
          !existing.supportingInformation.some(
            (x) => normalizeKey(x) === normalizeKey(si),
          )
        ) {
          existing.supportingInformation.push(si);
        }
      }
      for (const stmt of extraStatements) {
        if (
          !existing.supportingInformation.some(
            (x) => normalizeKey(x) === normalizeKey(stmt),
          ) &&
          normalizeKey(stmt) !== normalizeKey(existing.description)
        ) {
          existing.supportingInformation.push(stmt.replace(/[.]+$/, ''));
        }
      }
      if (candidate.description.length > existing.description.length) {
        // Prefer longer faithful description when same capability
        if (descriptionsOverlap(existing.description, candidate.description)) {
          existing.description = candidate.description;
          existing.source.text = candidate.source.text;
        }
      }
      decisions.push({
        decision: 'MERGE',
        source: candidate.source.text || candidate.description,
        intoKey: existing.requirementKey,
        intoTitle: existing.title,
        aiCandidate: candidate.title,
      });
      return;
    }

    working.push({ ...candidate, _cap: cap });
    decisions.push({
      decision: 'SAVE',
      requirementKey: candidate.requirementKey,
      title: candidate.title,
      source: candidate.source.text || candidate.description,
      type: candidate.type,
    });
  };

  // 1) Seed with deterministic baseline (already semantic)
  for (const req of baseline.requirements) {
    admit(req, 'BASELINE');
  }

  // 2) AI candidates — never saved directly; must pass gate + dedupe
  const aiCandidates = opts.aiCandidates ?? [];
  let candidatesIn = baseline.requirements.length + aiCandidates.length;

  for (const raw of aiCandidates) {
    const title = String(raw.title ?? '');
    const description = String(raw.description ?? '');
    const sourceText = String(raw.sourceText ?? (raw as { source?: { text?: string } }).source?.text ?? description);

    // Pre-reject obvious artifacts before normalize
    const pre = isRequirementCandidate({
      title,
      description,
      sourceText,
      section: (raw.section as string) ?? null,
      sourceElementType: (raw.sourceElementType as string) ?? null,
      acceptanceCriteria: raw.acceptanceCriteria as string[] | undefined,
      supportingInformation: raw.supportingInformation as string[] | undefined,
    });
    if (!pre.ok) {
      decisions.push({
        decision: 'REJECT',
        reason: pre.reason ?? 'NO_SEMANTIC_CONTENT',
        source: sourceText || title,
        aiCandidate: title,
        sourceElementType: String(raw.sourceElementType ?? 'AI_CANDIDATE'),
      });
      continue;
    }

    const normalized = normalizeCandidate(
      {
        ...raw,
        title,
        description,
        sourceText,
      },
      opts.documentName,
    );
    admit(normalized, 'AI');
  }

  // Re-number finals stably as REQ-001...
  const requirements = working.map((w, i) => {
    const { _cap: _, ...rest } = w;
    return {
      ...rest,
      requirementKey: `REQ-${String(i + 1).padStart(3, '0')}`,
    };
  });

  // Update SAVE decisions with final keys
  const finalDecisions = decisions.map((d) => {
    if (d.decision !== 'SAVE') return d;
    const match = requirements.find(
      (r) =>
        normalizeKey(r.description) === normalizeKey(d.source) ||
        normalizeKey(r.title) === normalizeKey(d.title),
    );
    if (!match) return d;
    return { ...d, requirementKey: match.requirementKey };
  });

  const rejected = finalDecisions.filter((d) => d.decision === 'REJECT').length;
  const merged = finalDecisions.filter((d) => d.decision === 'MERGE').length;

  void candidatesIn;
  return {
    requirements,
    documentElements: baseline.documentElements,
    decisions: finalDecisions,
    stats: {
      candidatesIn: baseline.requirements.length + aiCandidates.length,
      rejected,
      merged,
      saved: requirements.length,
    },
  };
}
