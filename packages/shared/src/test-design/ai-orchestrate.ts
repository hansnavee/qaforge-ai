import { classifyAgainstExisting } from './case-fingerprint.js';
import { cosineSimilarity, hashEmbedding } from './embeddings.js';
import type { GeneratedCasePreview } from './ai-generate.js';
import { DEFAULT_GENERATE_TECHNIQUES } from './ai-generate.js';

export type LibraryCase = {
  id: string;
  scenario: string;
  module?: string | null;
  designTechnique?: string | null;
  requirementKey?: string | null;
  steps?: string[];
  expected?: string | null;
  source?: 'tcms' | 'xray' | 'testrail';
};

export type OrchestratedSuggestion = GeneratedCasePreview & {
  kind: 'new' | 'duplicate' | 'gap' | 'quality';
  score: number;
  reason: string;
  matchCaseId: string | null;
  embedding: number[];
  externalRef: string | null;
};

function qualityNote(c: GeneratedCasePreview): string | null {
  const issues: string[] = [];
  if (!c.steps?.length || c.steps.length < 2) issues.push('few steps');
  if (!c.expected || c.expected.length < 8) issues.push('weak expected result');
  if (/placeholder|todo|tbd|valid user/i.test(`${c.scenario} ${c.steps.join(' ')}`)) {
    issues.push('placeholder wording');
  }
  return issues.length ? issues.join(', ') : null;
}

export function orchestrateSuggestions(opts: {
  cases: GeneratedCasePreview[];
  existing: LibraryCase[];
}): OrchestratedSuggestion[] {
  const usedIds = new Set<string>();
  const existingEmb = opts.existing.map((row) => ({
    ...row,
    embedding: hashEmbedding(
      `${row.scenario} ${row.module ?? ''} ${(row.steps ?? []).join(' ')} ${row.expected ?? ''}`,
    ),
  }));

  const out: OrchestratedSuggestion[] = [];
  for (const c of opts.cases) {
    const embedding = hashEmbedding(
      `${c.scenario} ${c.module} ${c.steps.join(' ')} ${c.expected}`,
    );
    const fp = classifyAgainstExisting({
      candidate: {
        scenario: c.scenario,
        module: c.module,
        designTechnique: c.designTechnique,
        requirementKey: c.requirementKey,
        steps: c.steps,
        expected: c.expected,
      },
      existing: opts.existing,
      usedIds,
    });

    let bestSim = 0;
    let bestId: string | null = null;
    let bestSource = '';
    for (const row of existingEmb) {
      const sim = cosineSimilarity(embedding, row.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestId = row.id;
        bestSource = row.source ?? 'tcms';
      }
    }

    const q = qualityNote(c);
    let kind: OrchestratedSuggestion['kind'] = 'new';
    let score = 0.72;
    let reason = 'New coverage from selected sources';
    let matchCaseId: string | null = null;

    if (fp.disposition !== 'new' || bestSim >= 0.92) {
      kind = 'duplicate';
      score = 0.15;
      matchCaseId = fp.matchId ?? bestId;
      if (matchCaseId) usedIds.add(matchCaseId);
      reason = `Looks like an existing ${bestSource || 'library'} case`;
    } else if (c.requirementKey) {
      const covered = opts.existing.filter(
        (e) =>
          (e.requirementKey ?? '').toUpperCase() ===
          c.requirementKey!.toUpperCase(),
      );
      const techniques = new Set(
        covered.map((e) => (e.designTechnique ?? '').toUpperCase()).filter(Boolean),
      );
      const missing = DEFAULT_GENERATE_TECHNIQUES.filter((t) => !techniques.has(t));
      if (covered.length === 0 || missing.includes(c.designTechnique as never)) {
        kind = 'gap';
        score = 0.9;
        reason =
          covered.length === 0
            ? `No cases yet for ${c.requirementKey}`
            : `Adds ${c.designTechnique} for ${c.requirementKey}`;
      }
    }

    if (q && kind !== 'duplicate') {
      kind = kind === 'new' ? 'quality' : kind;
      score = Math.min(score, 0.55);
      reason = `${reason} (${q})`;
    }

    out.push({
      ...c,
      kind,
      score,
      reason,
      matchCaseId,
      embedding,
      externalRef: c.requirementKey,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}
