/**
 * Stable fingerprint for AI-generated / applied test cases.
 * Used to prevent duplicate coverage across generate, apply, STLC design, and findings update.
 */

export type CaseFingerprintInput = {
  scenario?: string | null;
  module?: string | null;
  designTechnique?: string | null;
  requirementKey?: string | null;
};

export function normalizeCaseText(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function caseFingerprint(input: CaseFingerprintInput): string {
  const scenario = normalizeCaseText(input.scenario);
  const moduleName = normalizeCaseText(input.module) || 'general';
  const technique = normalizeCaseText(input.designTechnique) || 'happy_path';
  const req = normalizeCaseText(input.requirementKey) || '_';
  return `${scenario}::${moduleName}::${technique}::${req}`;
}

/** Secondary key when scenario wording drifts but steps/expected stay similar. */
export function caseContentFingerprint(opts: {
  steps?: string[] | null;
  expected?: string | null;
}): string {
  const steps = Array.isArray(opts.steps)
    ? opts.steps.map((s) => normalizeCaseText(s)).join('|')
    : '';
  const expected = normalizeCaseText(opts.expected);
  return `${steps}::${expected}`;
}

export type DedupDisposition = 'new' | 'duplicate' | 'updateCandidate';

export function classifyAgainstExisting(opts: {
  candidate: CaseFingerprintInput & {
    steps?: string[] | null;
    expected?: string | null;
  };
  existing: Array<
    CaseFingerprintInput & {
      id: string;
      steps?: string[] | null;
      expected?: string | null;
    }
  >;
  usedIds?: Set<string>;
}): { disposition: DedupDisposition; matchId: string | null } {
  const fp = caseFingerprint(opts.candidate);
  const content = caseContentFingerprint(opts.candidate);
  const used = opts.usedIds ?? new Set<string>();

  for (const row of opts.existing) {
    if (used.has(row.id)) continue;
    if (caseFingerprint(row) === fp) {
      return { disposition: 'updateCandidate', matchId: row.id };
    }
  }
  for (const row of opts.existing) {
    if (used.has(row.id)) continue;
    if (
      content.length > 8 &&
      caseContentFingerprint(row) === content &&
      normalizeCaseText(row.module) ===
        (normalizeCaseText(opts.candidate.module) || 'general')
    ) {
      return { disposition: 'updateCandidate', matchId: row.id };
    }
  }
  return { disposition: 'new', matchId: null };
}
