import {
  type PhaseDocState,
  type PhaseValidation,
  type StlcPhaseDocsMap,
  type StlcPhaseId,
  getStlcPhase,
  STLC_PHASES,
} from './phases.js';

export function emptyPhaseDocs(): StlcPhaseDocsMap {
  return {};
}

export function buildPhaseDocState(opts: {
  phaseId: Exclude<StlcPhaseId, 'DONE'>;
  status: PhaseDocState['status'];
  document: Record<string, unknown>;
  validation?: PhaseValidation | null;
  previous?: PhaseDocState | null;
  editedByHuman?: boolean;
}): PhaseDocState {
  const def = getStlcPhase(opts.phaseId);
  const prev = opts.previous;
  return {
    phaseId: opts.phaseId,
    agentName: def?.agentName ?? 'AI Agent',
    status: opts.status,
    validation: opts.validation ?? prev?.validation ?? null,
    document: opts.document,
    documentVersion: (prev?.documentVersion ?? 0) + (prev ? 1 : 1),
    editedByHuman: opts.editedByHuman ?? prev?.editedByHuman ?? false,
    updatedAt: new Date().toISOString(),
    approvedAt: opts.status === 'ACCEPTED' ? (prev?.approvedAt ?? new Date().toISOString()) : prev?.approvedAt ?? null,
  };
}

export function upsertPhaseDoc(
  map: StlcPhaseDocsMap | null | undefined,
  state: PhaseDocState,
): StlcPhaseDocsMap {
  return {
    ...(map ?? {}),
    [state.phaseId]: state,
  };
}

export function markPhaseAccepted(
  map: StlcPhaseDocsMap | null | undefined,
  phaseId: Exclude<StlcPhaseId, 'DONE'>,
): StlcPhaseDocsMap {
  const current = map?.[phaseId];
  if (!current) return map ?? {};
  return {
    ...map,
    [phaseId]: {
      ...current,
      status: 'ACCEPTED',
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function phaseDocumentToMarkdown(
  phaseId: string,
  doc: Record<string, unknown>,
  validation?: PhaseValidation | null,
): string {
  const def = getStlcPhase(phaseId);
  const lines = [
    `# ${def?.label ?? phaseId}`,
    '',
    `**Agent:** ${def?.agentName ?? 'AI Agent'}`,
    '',
  ];
  if (validation) {
    lines.push(
      `## AI validation`,
      '',
      `- Passed: ${validation.passed ? 'yes' : 'no'}`,
      `- Summary: ${validation.summary}`,
    );
    if (validation.blockers.length) {
      lines.push('', '### Blockers', ...validation.blockers.map((b) => `- ${b}`));
    }
    lines.push('');
  }
  lines.push('## Document', '', '```json', JSON.stringify(doc, null, 2), '```', '');
  return lines.join('\n');
}

export function phaseDocumentToHtml(
  phaseId: string,
  doc: Record<string, unknown>,
  validation?: PhaseValidation | null,
): string {
  const def = getStlcPhase(phaseId);
  const blockers =
    validation?.blockers?.map((b) => `<li>${escapeHtml(b)}</li>`).join('') ??
    '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>${escapeHtml(def?.label ?? phaseId)}</title>
<style>
body{font-family:Georgia,serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1a1a1a;background:#faf8f5}
h1{font-size:1.75rem} pre{background:#f0ebe3;padding:1rem;overflow:auto;border-radius:4px}
.ok{color:#0a7a3e}.bad{color:#a11}.meta{color:#555;margin-bottom:1.5rem}
</style></head>
<body>
<h1>${escapeHtml(def?.label ?? phaseId)}</h1>
<p class="meta">${escapeHtml(def?.agentName ?? '')} · Senior QA documentation package</p>
${
  validation
    ? `<h2>AI validation</h2>
<p class="${validation.passed ? 'ok' : 'bad'}">${escapeHtml(validation.summary)}</p>
${blockers ? `<ul>${blockers}</ul>` : ''}`
    : ''
}
<h2>Document</h2>
<pre>${escapeHtml(JSON.stringify(doc, null, 2))}</pre>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function listPhaseSummaries(
  stage: string | null | undefined,
  docs: StlcPhaseDocsMap | null | undefined,
  requirementsApproved: boolean,
): Array<{
  id: string;
  label: string;
  agentName: string;
  index: number;
  status: PhaseDocState['status'];
  documentVersion: number;
  editedByHuman: boolean;
  approvedAt?: string | null;
}> {
  const stageUpper = (stage ?? 'REQUIREMENTS').toUpperCase();
  let stageIdx =
    stageUpper === 'DONE'
      ? 99
      : (STLC_PHASES.find((p) => p.id === stageUpper)?.index ?? 1);

  // Requirements Accept unlocks Planning even if stage pointer lagged.
  if (requirementsApproved && stageUpper === 'REQUIREMENTS') {
    stageIdx =
      STLC_PHASES.find((p) => p.id === 'PLANNING')?.index ?? stageIdx;
  }

  return STLC_PHASES.map((p) => {
    const stored = docs?.[p.id];
    let status: PhaseDocState['status'] = 'LOCKED';
    if (p.id === 'REQUIREMENTS') {
      if (requirementsApproved || stored?.status === 'ACCEPTED') {
        status = 'ACCEPTED';
      } else if (stored?.status) {
        status = stored.status;
      } else {
        status = 'READY_FOR_REVIEW';
      }
    } else if (stored?.status) {
      // Stored READY_FOR_REVIEW becomes stale after the run moves on —
      // once stage advances past this phase, treat it as accepted.
      if (p.index < stageIdx && stored.status !== 'FAILED') {
        status = 'ACCEPTED';
      } else if (p.index > stageIdx) {
        status = 'LOCKED';
      } else {
        status = stored.status;
      }
    } else if (p.index < stageIdx) {
      status = 'ACCEPTED';
    } else if (p.index === stageIdx) {
      // Current phase unlocked — worker may still be preparing docs
      status = 'RUNNING';
    }
    return {
      id: p.id,
      label: p.label,
      agentName: p.agentName,
      index: p.index,
      status,
      documentVersion: stored?.documentVersion ?? 0,
      editedByHuman: stored?.editedByHuman ?? false,
      approvedAt: stored?.approvedAt ?? null,
    };
  });
}
