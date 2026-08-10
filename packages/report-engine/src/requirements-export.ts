import { rowsToCsv, rowsToSpreadsheetMl } from './tabular.js';

export type RequirementExportItem = {
  requirementKey: string;
  title: string;
  description: string;
  type: string;
  businessImpact?: string | null;
  reviewStatus?: string | null;
  readinessScore?: number | null;
  businessIntent?: string | null;
  acceptanceCriteria?: string[];
  businessRules?: string[];
  dependencies?: string[];
  featureName?: string | null;
  businessArea?: string | null;
  openQuestions?: string[];
};

export type RequirementsExportMeta = {
  projectName: string;
  exportedAt: string;
  total: number;
};

function joinLines(values?: string[] | null): string {
  if (!values?.length) return '';
  return values.map((v, i) => `${i + 1}. ${v}`).join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function humanStatus(status?: string | null): string {
  if (!status) return 'Not reviewed';
  if (status === 'READY_FOR_TEST_DESIGN') return 'Ready';
  if (status === 'NEEDS_CLARIFICATION') return 'Needs clarification';
  if (status === 'REVIEW_RECOMMENDED') return 'Review recommended';
  if (status === 'BLOCKED') return 'Blocked';
  return status.replace(/_/g, ' ');
}

function humanType(type: string): string {
  if (type === 'NON_FUNCTIONAL') return 'Non-Functional';
  if (type === 'BUSINESS_RULE') return 'Business Rule';
  if (type === 'FUNCTIONAL') return 'Functional';
  return type;
}

function toRows(items: RequirementExportItem[]) {
  return items.map((r) => ({
    ID: r.requirementKey,
    Title: r.title,
    Type: humanType(r.type),
    Impact: r.businessImpact ?? '',
    Status: humanStatus(r.reviewStatus),
    Readiness: r.readinessScore != null ? `${r.readinessScore}%` : '',
    'Business Area': r.businessArea ?? '',
    Feature: r.featureName ?? '',
    Intent: r.businessIntent ?? '',
    Description: r.description,
    'Acceptance Criteria': joinLines(r.acceptanceCriteria),
    'Business Rules': joinLines(r.businessRules),
    Dependencies: joinLines(r.dependencies),
    'Open Questions': joinLines(r.openQuestions),
  }));
}

const EXCEL_HEADERS = [
  'ID',
  'Title',
  'Type',
  'Impact',
  'Status',
  'Readiness',
  'Business Area',
  'Feature',
  'Intent',
  'Description',
  'Acceptance Criteria',
  'Business Rules',
  'Dependencies',
  'Open Questions',
];

/** Excel-compatible workbook (.xls SpreadsheetML). */
export function buildRequirementsExcel(
  items: RequirementExportItem[],
): { body: string; filename: string; contentType: string } {
  const rows = toRows(items);
  return {
    body: rowsToSpreadsheetMl('Requirements', EXCEL_HEADERS, rows),
    filename: 'requirements.xls',
    contentType: 'application/vnd.ms-excel',
  };
}

export function buildRequirementsCsv(
  items: RequirementExportItem[],
): { body: string; filename: string; contentType: string } {
  const rows = toRows(items);
  return {
    body: rowsToCsv(EXCEL_HEADERS, rows),
    filename: 'requirements.csv',
    contentType: 'text/csv; charset=utf-8',
  };
}

/** Word-openable HTML document (.doc). */
export function buildRequirementsWord(
  items: RequirementExportItem[],
  meta: RequirementsExportMeta,
): { body: string; filename: string; contentType: string } {
  const sections = items
    .map((r, idx) => {
      const ac = (r.acceptanceCriteria ?? [])
        .map((c) => `<li>${escapeHtml(c)}</li>`)
        .join('');
      const rules = (r.businessRules ?? [])
        .map((c) => `<li>${escapeHtml(c)}</li>`)
        .join('');
      const qs = (r.openQuestions ?? [])
        .map((c) => `<li>${escapeHtml(c)}</li>`)
        .join('');
      return `
      <div class="req">
        <h2>${idx + 1}. ${escapeHtml(r.requirementKey)} — ${escapeHtml(r.title)}</h2>
        <p class="meta">
          <b>Type:</b> ${escapeHtml(humanType(r.type))}
          &nbsp;·&nbsp; <b>Status:</b> ${escapeHtml(humanStatus(r.reviewStatus))}
          ${r.businessImpact ? `&nbsp;·&nbsp; <b>Impact:</b> ${escapeHtml(r.businessImpact)}` : ''}
          ${r.featureName ? `&nbsp;·&nbsp; <b>Feature:</b> ${escapeHtml([r.businessArea, r.featureName].filter(Boolean).join(' / '))}` : ''}
        </p>
        ${r.businessIntent ? `<p><b>Intent:</b> ${escapeHtml(r.businessIntent)}</p>` : ''}
        <p>${escapeHtml(r.description)}</p>
        ${ac ? `<h3>Acceptance criteria</h3><ul>${ac}</ul>` : ''}
        ${rules ? `<h3>Business rules</h3><ul>${rules}</ul>` : ''}
        ${qs ? `<h3>Open questions</h3><ul>${qs}</ul>` : ''}
      </div>`;
    })
    .join('\n');

  const body = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:w="urn:schemas-microsoft-com:office:word"
 xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<title>Requirements — ${escapeHtml(meta.projectName)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1a1a1a;line-height:1.45}
h1{font-size:20pt;color:#0f766e;margin-bottom:4pt}
h2{font-size:14pt;margin-top:22pt;border-bottom:1px solid #ccc;padding-bottom:4pt}
h3{font-size:11pt;margin-top:10pt;color:#444}
.meta{color:#555;font-size:10pt}
.req{page-break-inside:avoid;margin-bottom:18pt}
ul{margin:6pt 0 6pt 18pt}
.sub{color:#666;font-size:10pt;margin-bottom:18pt}
</style>
</head>
<body>
<h1>Requirements package</h1>
<p class="sub">${escapeHtml(meta.projectName)} · ${meta.total} requirement${meta.total === 1 ? '' : 's'} · Exported ${escapeHtml(meta.exportedAt)}</p>
${sections}
</body></html>`;

  return {
    body,
    filename: 'requirements.doc',
    contentType: 'application/msword',
  };
}

/** Print-ready PDF report (HTML). Open and use Print → Save as PDF. */
export function buildRequirementsPdfReport(
  items: RequirementExportItem[],
  meta: RequirementsExportMeta,
): { body: string; filename: string; contentType: string } {
  const cards = items
    .map((r) => {
      const ac = (r.acceptanceCriteria ?? [])
        .map((c) => `<li>${escapeHtml(c)}</li>`)
        .join('');
      const qs = (r.openQuestions ?? [])
        .map((c) => `<li>${escapeHtml(c)}</li>`)
        .join('');
      return `
      <article class="card">
        <header>
          <div class="key">${escapeHtml(r.requirementKey)}</div>
          <h2>${escapeHtml(r.title)}</h2>
          <div class="chips">
            <span>${escapeHtml(humanType(r.type))}</span>
            <span class="status">${escapeHtml(humanStatus(r.reviewStatus))}</span>
            ${r.businessImpact ? `<span>${escapeHtml(r.businessImpact)} impact</span>` : ''}
            ${r.readinessScore != null ? `<span>${r.readinessScore}% ready</span>` : ''}
          </div>
        </header>
        ${r.businessIntent ? `<p class="intent">${escapeHtml(r.businessIntent)}</p>` : ''}
        <p class="desc">${escapeHtml(r.description)}</p>
        ${
          r.featureName
            ? `<p class="feature">${escapeHtml([r.businessArea, r.featureName].filter(Boolean).join(' / '))}</p>`
            : ''
        }
        ${ac ? `<h3>Acceptance criteria</h3><ul>${ac}</ul>` : ''}
        ${qs ? `<h3>Open questions</h3><ul>${qs}</ul>` : ''}
      </article>`;
    })
    .join('\n');

  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Requirements — ${escapeHtml(meta.projectName)}</title>
<style>
:root{--ink:#1c1917;--muted:#78716c;--line:#e7e0d5;--accent:#0f766e;--panel:#fffdf9;--bg:#f7f4ef}
*{box-sizing:border-box}
body{margin:0;font-family:"Segoe UI","Helvetica Neue",Arial,sans-serif;color:var(--ink);background:linear-gradient(180deg,#fbf8f3,var(--bg));}
.wrap{max-width:920px;margin:0 auto;padding:2rem 1.25rem 3rem}
.hero{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:1.5rem 1.75rem;margin-bottom:1.25rem}
.brand{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-weight:700}
h1{margin:.35rem 0 0;font-size:1.75rem}
.sub{color:var(--muted);margin-top:.4rem}
.stats{display:flex;flex-wrap:gap:.75rem;margin-top:1rem}
.stat{min-width:100px;padding:.7rem .85rem;border-radius:12px;background:#f3faf8;border:1px solid #d7ebe6}
.stat .n{font-size:1.25rem;font-weight:700}
.stat .l{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:1.1rem 1.25rem;margin-bottom:.9rem;page-break-inside:avoid}
.key{font-family:ui-monospace,Consolas,monospace;font-size:.75rem;color:var(--muted)}
h2{margin:.25rem 0 .5rem;font-size:1.15rem;line-height:1.3}
.chips{display:flex;flex-wrap:gap:.4rem}
.chips span{font-size:.72rem;padding:.2rem .5rem;border-radius:999px;border:1px solid var(--line);color:var(--muted);background:#faf7f2}
.chips .status{border-color:#a7f3d0;color:#047857;background:#ecfdf5}
.intent{margin:.75rem 0 0;font-style:italic;color:#444}
.desc{margin:.65rem 0 0;line-height:1.55}
.feature{margin:.5rem 0 0;font-size:.85rem;color:var(--muted)}
h3{margin:1rem 0 .4rem;font-size:.85rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
ul{margin:.25rem 0 0;padding-left:1.15rem}
li{margin:.25rem 0;line-height:1.45}
@media print{
  body{background:#fff}
  .wrap{padding:0;max-width:none}
  .card,.hero{break-inside:avoid;box-shadow:none}
  .no-print{display:none!important}
}
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div class="brand">QAForge AI</div>
    <h1>Requirements report</h1>
    <p class="sub">${escapeHtml(meta.projectName)} · Exported ${escapeHtml(meta.exportedAt)}</p>
    <div class="stats">
      <div class="stat"><div class="n">${meta.total}</div><div class="l">Requirements</div></div>
      <div class="stat"><div class="n">${items.filter((i) => i.reviewStatus === 'READY_FOR_TEST_DESIGN').length}</div><div class="l">Ready</div></div>
      <div class="stat"><div class="n">${items.reduce((n, i) => n + (i.openQuestions?.length ?? 0), 0)}</div><div class="l">Open questions</div></div>
    </div>
    <p class="sub no-print" style="margin-top:1rem">Tip: use your browser Print dialog and choose <b>Save as PDF</b>.</p>
    <button class="no-print" onclick="window.print()" style="margin-top:.75rem;padding:.55rem 1rem;border:0;border-radius:8px;background:#0f766e;color:#fff;font-weight:600;cursor:pointer">Print / Save as PDF</button>
  </header>
  ${cards}
</div>
</body>
</html>`;

  return {
    body,
    filename: 'requirements-report.html',
    contentType: 'text/html; charset=utf-8',
  };
}
