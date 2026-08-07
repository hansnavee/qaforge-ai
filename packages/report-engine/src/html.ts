import type { ReportManifest } from './types.js';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scoreColor(score: number | undefined): string {
  if (score == null || Number.isNaN(score)) return '#64748b';
  if (score >= 85) return '#34d399';
  if (score >= 70) return '#fbbf24';
  return '#f87171';
}

function severityClass(severity: string): string {
  const s = severity.toLowerCase();
  if (s === 'critical' || s === 'high') return 'sev-high';
  if (s === 'medium') return 'sev-med';
  return 'sev-low';
}

function scoreCards(manifest: ReportManifest): string {
  const entries: Array<[string, number | undefined]> = [
    ['Functional', manifest.scores.functional],
    ['Accessibility', manifest.scores.accessibility],
    ['Performance', manifest.scores.performance],
    ['Security', manifest.scores.security],
    ['UI/UX', manifest.scores.uiux],
  ];

  return entries
    .map(([label, score]) => {
      const value = score ?? 0;
      const color = scoreColor(score);
      return `
      <div class="score-card">
        <div class="score-ring" style="--score:${value};--color:${color}">
          <span>${score == null ? '—' : Math.round(value)}</span>
        </div>
        <div class="score-label">${escapeHtml(label)}</div>
      </div>`;
    })
    .join('');
}

function findingsRows(manifest: ReportManifest): string {
  if (manifest.findings.length === 0) {
    return `<tr><td colspan="5" class="empty">No findings recorded.</td></tr>`;
  }
  return manifest.findings
    .map(
      (f) => `
      <tr>
        <td><span class="badge ${severityClass(f.severity)}">${escapeHtml(f.severity)}</span></td>
        <td>${escapeHtml(f.category)}</td>
        <td>
          <div class="finding-title">${escapeHtml(f.title)}</div>
          <div class="muted">${escapeHtml(f.description)}</div>
        </td>
        <td>${escapeHtml(f.recommendation ?? '—')}</td>
      </tr>`,
    )
    .join('');
}

function testCaseRows(manifest: ReportManifest): string {
  if (manifest.testCases.length === 0) {
    return `<tr><td colspan="5" class="empty">No test cases recorded.</td></tr>`;
  }
  return manifest.testCases
    .map((tc, i) => {
      const id = String(tc.id ?? tc.testId ?? `TC-${i + 1}`);
      const title = String(tc.title ?? tc.name ?? 'Untitled');
      const category = String(tc.category ?? tc.type ?? '—');
      const status = String(tc.status ?? tc.result ?? '—');
      const priority = String(tc.priority ?? '—');
      return `
      <tr>
        <td>${escapeHtml(id)}</td>
        <td>${escapeHtml(title)}</td>
        <td>${escapeHtml(category)}</td>
        <td>${escapeHtml(priority)}</td>
        <td><span class="badge ${String(status).toLowerCase().includes('fail') ? 'sev-high' : 'sev-low'}">${escapeHtml(status)}</span></td>
      </tr>`;
    })
    .join('');
}

function recommendationsList(manifest: ReportManifest): string {
  if (manifest.recommendations.length === 0) {
    return `<li class="muted">No recommendations.</li>`;
  }
  return manifest.recommendations
    .map((r) => `<li>${escapeHtml(r)}</li>`)
    .join('');
}

const SHARED_CSS = `
:root {
  --bg: #0b1220;
  --panel: #121a2b;
  --panel-2: #182236;
  --border: #243049;
  --text: #e8eefc;
  --muted: #93a0b8;
  --accent: #5b8cff;
  --ok: #34d399;
  --warn: #fbbf24;
  --bad: #f87171;
  --radius: 14px;
  --font: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font);
  background:
    radial-gradient(1200px 600px at 10% -10%, #1a2a4a 0%, transparent 55%),
    radial-gradient(900px 500px at 100% 0%, #142033 0%, transparent 50%),
    var(--bg);
  color: var(--text);
  line-height: 1.5;
}
.wrap { max-width: 1100px; margin: 0 auto; padding: 40px 24px 64px; }
.hero {
  display: flex; justify-content: space-between; gap: 24px; align-items: flex-start;
  margin-bottom: 28px; flex-wrap: wrap;
}
.brand { font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); font-weight: 700; }
h1 { margin: 8px 0 6px; font-size: 32px; letter-spacing: -0.02em; }
.subtitle { color: var(--muted); margin: 0; }
.meta { display: grid; gap: 8px; min-width: 220px; }
.meta-item {
  background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px;
}
.meta-item span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
.meta-item strong { font-size: 14px; word-break: break-all; }
.status {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px;
  background: #163024; color: var(--ok); border: 1px solid #245c45; font-weight: 600; font-size: 13px;
}
.status.fail { background: #3a1717; color: var(--bad); border-color: #6b2a2a; }
.cards { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 14px; margin: 24px 0 28px; }
.score-card {
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 12px; text-align: center;
}
.score-ring {
  --size: 72px;
  width: var(--size); height: var(--size); margin: 0 auto 10px; border-radius: 50%;
  display: grid; place-items: center;
  background:
    radial-gradient(closest-side, var(--panel) 78%, transparent 80% 100%),
    conic-gradient(var(--color) calc(var(--score) * 1%), #243049 0);
  font-weight: 700; font-size: 20px;
}
.score-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
.panel {
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 20px; margin-bottom: 18px;
}
.panel h2 { margin: 0 0 14px; font-size: 18px; }
.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.stat {
  background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 14px;
}
.stat .n { font-size: 28px; font-weight: 700; }
.stat .l { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 12px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
.finding-title { font-weight: 600; margin-bottom: 4px; }
.muted { color: var(--muted); font-size: 13px; }
.empty { color: var(--muted); text-align: center; padding: 24px !important; }
.badge {
  display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.sev-high { background: #3a1717; color: #fca5a5; }
.sev-med { background: #3a2e12; color: #fcd34d; }
.sev-low { background: #163024; color: #6ee7b7; }
ul.recs { margin: 0; padding-left: 18px; }
ul.recs li { margin: 8px 0; }
.footer { margin-top: 28px; color: var(--muted); font-size: 12px; text-align: center; }
@media (max-width: 900px) {
  .cards { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .summary-grid { grid-template-columns: 1fr; }
}
@media print {
  body { background: #fff; color: #111; }
  .wrap { max-width: none; padding: 16px; }
  .panel, .score-card, .meta-item, .stat { background: #fff; border-color: #ddd; }
  .muted, .brand, .score-label, th { color: #555; }
  .score-ring { color: #111; }
}
`;

export function renderHtmlReport(manifest: ReportManifest): string {
  const statusFail = /fail|error|abort/i.test(manifest.status);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>QAForge Report — ${escapeHtml(manifest.projectName)}</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div>
        <div class="brand">QAForge AI</div>
        <h1>${escapeHtml(manifest.projectName)}</h1>
        <p class="subtitle">Automated quality assessment for ${escapeHtml(manifest.appUrl)}</p>
        <div style="margin-top:14px">
          <span class="status ${statusFail ? 'fail' : ''}">${escapeHtml(manifest.status)}</span>
        </div>
      </div>
      <div class="meta">
        <div class="meta-item"><span>Execution</span><strong>${escapeHtml(manifest.executionId)}</strong></div>
        <div class="meta-item"><span>App URL</span><strong>${escapeHtml(manifest.appUrl)}</strong></div>
      </div>
    </div>

    <div class="cards">${scoreCards(manifest)}</div>

    <section class="panel">
      <h2>Summary</h2>
      <div class="summary-grid">
        <div class="stat"><div class="n">${manifest.summary.passed}</div><div class="l">Passed</div></div>
        <div class="stat"><div class="n">${manifest.summary.failed}</div><div class="l">Failed</div></div>
        <div class="stat"><div class="n">${manifest.summary.total}</div><div class="l">Total</div></div>
      </div>
    </section>

    <section class="panel">
      <h2>Findings</h2>
      <table>
        <thead>
          <tr><th>Severity</th><th>Category</th><th>Finding</th><th>Recommendation</th></tr>
        </thead>
        <tbody>${findingsRows(manifest)}</tbody>
      </table>
    </section>

    <section class="panel">
      <h2>Test Cases</h2>
      <table>
        <thead>
          <tr><th>ID</th><th>Title</th><th>Category</th><th>Priority</th><th>Status</th></tr>
        </thead>
        <tbody>${testCaseRows(manifest)}</tbody>
      </table>
    </section>

    <section class="panel">
      <h2>Recommendations</h2>
      <ul class="recs">${recommendationsList(manifest)}</ul>
    </section>

    <div class="footer">Generated by QAForge AI · ${escapeHtml(manifest.executionId)}</div>
  </div>
</body>
</html>`;
}

/** Clean print-oriented HTML suitable for PDF conversion. */
export function renderPdfHtml(manifest: ReportManifest): string {
  const statusFail = /fail|error|abort/i.test(manifest.status);
  const scoreLines = (
    [
      ['Functional', manifest.scores.functional],
      ['Accessibility', manifest.scores.accessibility],
      ['Performance', manifest.scores.performance],
      ['Security', manifest.scores.security],
      ['UI/UX', manifest.scores.uiux],
    ] as const
  )
    .map(
      ([label, score]) =>
        `<tr><td>${escapeHtml(label)}</td><td>${score == null ? '—' : Math.round(score)}</td></tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>QAForge Executive Report — ${escapeHtml(manifest.projectName)}</title>
  <style>
    @page { margin: 18mm; }
    body { font-family: Georgia, "Times New Roman", serif; color: #111; line-height: 1.45; }
    h1 { font-size: 26px; margin: 0 0 6px; }
    h2 { font-size: 16px; margin: 22px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    .muted { color: #555; font-size: 13px; }
    .badge { display: inline-block; padding: 2px 8px; border: 1px solid #999; border-radius: 4px; font-size: 12px; }
    .badge.fail { border-color: #b91c1c; color: #b91c1c; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    ul { margin: 8px 0 0; padding-left: 18px; }
    .header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="muted">QAForge AI · Executive Report</div>
      <h1>${escapeHtml(manifest.projectName)}</h1>
      <div class="muted">${escapeHtml(manifest.appUrl)}</div>
    </div>
    <div>
      <span class="badge ${statusFail ? 'fail' : ''}">${escapeHtml(manifest.status)}</span>
      <div class="muted" style="margin-top:8px">${escapeHtml(manifest.executionId)}</div>
    </div>
  </div>

  <h2>Scores</h2>
  <table>
    <thead><tr><th>Category</th><th>Score</th></tr></thead>
    <tbody>${scoreLines}</tbody>
  </table>

  <h2>Summary</h2>
  <p>Passed ${manifest.summary.passed} · Failed ${manifest.summary.failed} · Total ${manifest.summary.total}</p>

  <h2>Findings</h2>
  <table>
    <thead><tr><th>Severity</th><th>Category</th><th>Title</th><th>Description</th><th>Recommendation</th></tr></thead>
    <tbody>
      ${
        manifest.findings.length === 0
          ? `<tr><td colspan="5">No findings.</td></tr>`
          : manifest.findings
              .map(
                (f) => `<tr>
            <td>${escapeHtml(f.severity)}</td>
            <td>${escapeHtml(f.category)}</td>
            <td>${escapeHtml(f.title)}</td>
            <td>${escapeHtml(f.description)}</td>
            <td>${escapeHtml(f.recommendation ?? '')}</td>
          </tr>`,
              )
              .join('')
      }
    </tbody>
  </table>

  <h2>Recommendations</h2>
  <ul>
    ${
      manifest.recommendations.length === 0
        ? '<li>None</li>'
        : manifest.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join('')
    }
  </ul>
</body>
</html>`;
}
