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

  const tables = extractTabularSections(doc);
  for (const section of tables) {
    lines.push(`## ${section.title}`, '');
    if (section.headers.length && section.rows.length) {
      lines.push(`| ${section.headers.join(' | ')} |`);
      lines.push(`| ${section.headers.map(() => '---').join(' | ')} |`);
      for (const row of section.rows) {
        lines.push(
          `| ${section.headers.map((h) => String(row[h] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`,
        );
      }
      lines.push('');
    } else if (section.prose) {
      lines.push(section.prose, '');
    }
  }

  if (!tables.length) {
    lines.push('## Document', '', '```json', JSON.stringify(doc, null, 2), '```', '');
  }
  return lines.join('\n');
}

type HtmlSection = {
  title: string;
  headers: string[];
  rows: Array<Record<string, unknown>>;
  prose?: string;
  stats?: Array<{ label: string; value: string }>;
};

function flattenCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)))
      .join(' → ');
  }
  return JSON.stringify(value);
}

function rowsFromObjects(
  items: unknown[],
  preferredKeys?: string[],
): { headers: string[]; rows: Array<Record<string, unknown>> } {
  const objects = items.filter(
    (x): x is Record<string, unknown> =>
      Boolean(x) && typeof x === 'object' && !Array.isArray(x),
  );
  if (!objects.length) return { headers: [], rows: [] };

  const keySet = new Set<string>();
  for (const row of objects) {
    for (const k of Object.keys(row)) {
      if (preferredKeys?.includes(k) || !preferredKeys) keySet.add(k);
    }
  }
  const headers =
    preferredKeys?.filter((k) => objects.some((o) => k in o)) ??
    Array.from(keySet).slice(0, 10);

  const rows = objects.map((obj) => {
    const out: Record<string, unknown> = {};
    for (const h of headers) out[h] = flattenCell(obj[h]);
    return out;
  });
  return { headers, rows };
}

function extractTabularSections(doc: Record<string, unknown>): HtmlSection[] {
  const sections: HtmlSection[] = [];
  const consumed = new Set<string>();

  const pushArray = (
    key: string,
    title: string,
    preferredKeys?: string[],
  ) => {
    const value = doc[key];
    if (!Array.isArray(value) || !value.length) return;
    consumed.add(key);
    const { headers, rows } = rowsFromObjects(value, preferredKeys);
    if (headers.length) sections.push({ title, headers, rows });
  };

  if (typeof doc.summary === 'string' && doc.summary.trim()) {
    consumed.add('summary');
    sections.push({
      title: 'Summary',
      headers: [],
      rows: [],
      prose: doc.summary,
    });
  }

  if (doc.totals && typeof doc.totals === 'object' && !Array.isArray(doc.totals)) {
    consumed.add('totals');
    const totals = doc.totals as Record<string, unknown>;
    sections.push({
      title: 'Totals',
      headers: [],
      rows: [],
      stats: Object.entries(totals).map(([label, value]) => ({
        label,
        value: flattenCell(value),
      })),
    });
  }

  if (doc.scores && typeof doc.scores === 'object' && !Array.isArray(doc.scores)) {
    consumed.add('scores');
    const scores = doc.scores as Record<string, unknown>;
    sections.push({
      title: 'Scores',
      headers: [],
      rows: [],
      stats: Object.entries(scores).map(([label, value]) => ({
        label,
        value: flattenCell(value),
      })),
    });
  }

  pushArray('testCases', 'Test cases', [
    'id',
    'externalId',
    'module',
    'scenario',
    'priority',
    'severity',
    'type',
    'expected',
    'preconditions',
    'steps',
  ]);
  pushArray('cases', 'Cases', [
    'id',
    'testCaseId',
    'module',
    'scenario',
    'status',
    'priority',
  ]);
  pushArray('bugs', 'Defects', [
    'id',
    'title',
    'severity',
    'status',
    'description',
    'stepsToReproduce',
  ]);
  pushArray('failures', 'Failures', [
    'externalId',
    'testCaseId',
    'scenario',
    'message',
    'severity',
  ]);
  pushArray('checklist', 'Environment checklist', [
    'id',
    'label',
    'item',
    'name',
    'status',
    'result',
    'detail',
    'notes',
    'required',
  ]);
  pushArray('scorecard', 'Exit criteria', [
    'id',
    'criterion',
    'name',
    'met',
    'status',
    'result',
    'evidence',
    'notes',
    'waiverAllowed',
  ]);
  if (Array.isArray(doc.risks) && doc.risks.length) {
    consumed.add('risks');
    if (doc.risks.every((r) => typeof r === 'string')) {
      sections.push({
        title: 'Risks',
        headers: ['risk'],
        rows: doc.risks.map((r) => ({ risk: String(r) })),
      });
    } else {
      const { headers, rows } = rowsFromObjects(doc.risks as unknown[]);
      if (headers.length) sections.push({ title: 'Risks', headers, rows });
    }
  }
  pushArray('questions', 'Clarification questions', [
    'id',
    'question',
    'priority',
    'blocking',
  ]);

  const generation = doc.generation;
  if (generation && typeof generation === 'object' && !Array.isArray(generation)) {
    consumed.add('generation');
    const gen = generation as Record<string, unknown>;
    if (Array.isArray(gen.files) && gen.files.length) {
      sections.push({
        title: 'Automation files',
        headers: ['file'],
        rows: gen.files.map((f) => ({ file: String(f) })),
      });
    }
  }

  if (Array.isArray(doc.files) && doc.files.length) {
    consumed.add('files');
    sections.push({
      title: 'Files',
      headers: ['file'],
      rows: doc.files.map((f) => ({ file: String(f) })),
    });
  }

  // Remaining primitive / short fields as a meta table
  const metaRows: Array<Record<string, unknown>> = [];
  for (const [k, v] of Object.entries(doc)) {
    if (consumed.has(k)) continue;
    if (v == null) continue;
    if (typeof v === 'object') continue;
    metaRows.push({ field: k, value: String(v) });
  }
  if (metaRows.length) {
    sections.push({
      title: 'Details',
      headers: ['field', 'value'],
      rows: metaRows,
    });
  }

  // Nested leftover objects (short preview, not raw dump)
  for (const [k, v] of Object.entries(doc)) {
    if (consumed.has(k)) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const nested = v as Record<string, unknown>;
    const nestedRows = Object.entries(nested)
      .filter(([, nv]) => nv == null || typeof nv !== 'object')
      .map(([nk, nv]) => ({ field: nk, value: flattenCell(nv) }));
    if (nestedRows.length) {
      sections.push({
        title: humanizeKey(k),
        headers: ['field', 'value'],
        rows: nestedRows,
      });
    }
  }

  return sections;
}

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
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
  const sections = extractTabularSections(doc);

  const bodySections = sections
    .map((section) => {
      const parts: string[] = [`<section class="panel"><h2>${escapeHtml(section.title)}</h2>`];
      if (section.prose) {
        parts.push(`<p class="prose">${escapeHtml(section.prose)}</p>`);
      }
      if (section.stats?.length) {
        parts.push(
          `<div class="stats">${section.stats
            .map(
              (s) =>
                `<div class="stat"><div class="n">${escapeHtml(s.value)}</div><div class="l">${escapeHtml(s.label)}</div></div>`,
            )
            .join('')}</div>`,
        );
      }
      if (section.headers.length && section.rows.length) {
        const th = section.headers
          .map((h) => `<th>${escapeHtml(humanizeKey(h))}</th>`)
          .join('');
        const tr = section.rows
          .map(
            (row) =>
              `<tr>${section.headers
                .map(
                  (h) =>
                    `<td>${escapeHtml(String(row[h] ?? ''))}</td>`,
                )
                .join('')}</tr>`,
          )
          .join('\n');
        parts.push(
          `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`,
        );
      }
      parts.push('</section>');
      return parts.join('\n');
    })
    .join('\n');

  const fallback = !sections.length
    ? `<section class="panel"><h2>Document</h2><p class="muted">No structured rows yet for this phase.</p></section>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(def?.label ?? phaseId)}</title>
<style>
:root {
  --bg: #f7f4ef;
  --panel: #fffdf9;
  --ink: #1c1917;
  --muted: #78716c;
  --line: #e7e0d5;
  --accent: #0f766e;
  --ok: #047857;
  --bad: #b91c1c;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  color: var(--ink);
  background:
    radial-gradient(1200px 500px at 10% -10%, #dcefea 0%, transparent 55%),
    linear-gradient(180deg, #fbf8f3 0%, var(--bg) 100%);
}
.wrap { max-width: 1100px; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
.hero {
  display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1rem;
  padding: 1.5rem 1.75rem; border: 1px solid var(--line); border-radius: 16px;
  background: var(--panel); margin-bottom: 1.25rem;
}
.brand { font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); font-weight: 700; }
h1 { margin: 0.35rem 0 0; font-size: 1.75rem; line-height: 1.2; }
.meta { color: var(--muted); font-size: 0.92rem; margin-top: 0.35rem; }
.panel {
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
  padding: 1.1rem 1.25rem; margin-bottom: 1rem;
}
h2 { margin: 0 0 0.75rem; font-size: 1.05rem; }
.prose { margin: 0; line-height: 1.55; }
.muted { color: var(--muted); }
.ok { color: var(--ok); font-weight: 600; }
.bad { color: var(--bad); font-weight: 600; }
.stats { display: flex; flex-wrap: gap: 0.75rem; }
.stat {
  min-width: 110px; padding: 0.75rem 0.9rem; border-radius: 12px;
  background: #f3faf8; border: 1px solid #d7ebe6;
}
.stat .n { font-size: 1.35rem; font-weight: 700; }
.stat .l { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.table-wrap { overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td {
  border-bottom: 1px solid var(--line); text-align: left;
  padding: 0.65rem 0.55rem; vertical-align: top;
}
th {
  font-size: 0.72rem; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--muted); background: #faf7f2; position: sticky; top: 0;
}
tr:hover td { background: #fcfaf7; }
ul { margin: 0.5rem 0 0; padding-left: 1.2rem; color: var(--bad); }
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div>
      <div class="brand">QAForge AI</div>
      <h1>${escapeHtml(def?.label ?? phaseId)}</h1>
      <p class="meta">${escapeHtml(def?.agentName ?? '')} · Senior QA documentation package</p>
    </div>
  </header>
${
  validation
    ? `<section class="panel">
  <h2>AI validation</h2>
  <p class="${validation.passed ? 'ok' : 'bad'}">${escapeHtml(validation.summary)}</p>
  ${blockers ? `<ul>${blockers}</ul>` : ''}
</section>`
    : ''
}
${bodySections}
${fallback}
</div>
</body>
</html>`;
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
