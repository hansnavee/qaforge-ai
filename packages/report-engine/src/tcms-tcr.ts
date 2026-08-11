import { cycleResultCounts } from '@qaforge/shared';

export type TcrCase = {
  externalId: string;
  title: string;
  status: string;
  priority?: string | null;
  folder?: string | null;
  message?: string | null;
  evidenceCount?: number;
};

export type TcrBug = {
  title: string;
  severity: string;
  status: string;
  testCase?: string | null;
};

export type TcrCycle = {
  id: string;
  name: string;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  cases: TcrCase[];
};

export type TcrReport = {
  projectName: string;
  exportedAt: string;
  cycles: TcrCycle[];
  bugs: TcrBug[];
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function allCases(report: TcrReport): TcrCase[] {
  return report.cycles.flatMap((c) => c.cases);
}

function totals(report: TcrReport) {
  return cycleResultCounts(allCases(report).map((c) => ({ status: c.status })));
}

function majorIssues(report: TcrReport) {
  const failedHigh = allCases(report).filter(
    (c) =>
      (c.status === 'FAILED' || c.status === 'ERROR') &&
      String(c.priority ?? '').toUpperCase() === 'HIGH',
  );
  const openBugs = report.bugs.filter((b) => {
    const s = b.status.toUpperCase();
    return s === 'OPEN' || s === 'NEW' || s === 'IN_PROGRESS';
  });
  const severe = openBugs.filter((b) => {
    const sev = b.severity.toUpperCase();
    return sev === 'HIGH' || sev === 'CRITICAL' || sev === 'BLOCKER';
  });
  return { failedHigh, openBugs, severe };
}

function caseList(items: TcrCase[], empty: string) {
  if (!items.length) return `<p class="empty">${escapeHtml(empty)}</p>`;
  return `<table>
    <thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Priority</th><th>Folder</th><th>Notes</th></tr></thead>
    <tbody>
      ${items
        .map(
          (c) => `<tr>
        <td class="mono">${escapeHtml(c.externalId)}</td>
        <td>${escapeHtml(c.title)}</td>
        <td>${escapeHtml(c.status || 'NOT RUN')}</td>
        <td>${escapeHtml(c.priority ?? '—')}</td>
        <td>${escapeHtml(c.folder ?? '—')}</td>
        <td>${escapeHtml(c.message ?? '')}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>`;
}

function tcrBody(report: TcrReport, kind: 'html' | 'word' | 'pdf') {
  const counts = totals(report);
  const issues = majorIssues(report);
  const passed = allCases(report).filter((c) => c.status === 'PASSED');
  const failed = allCases(report).filter(
    (c) => c.status === 'FAILED' || c.status === 'ERROR' || c.status === 'BLOCKED',
  );
  const printBtn =
    kind === 'pdf'
      ? `<p class="sub no-print">Tip: use Print → Save as PDF.</p>
         <button class="no-print" onclick="window.print()">Print / Save as PDF</button>`
      : '';
  const cycleBlocks = report.cycles
    .map((cycle) => {
      const c = cycleResultCounts(cycle.cases.map((x) => ({ status: x.status })));
      return `<section class="card">
        <h2>${escapeHtml(cycle.name)}</h2>
        <p class="meta">${escapeHtml(cycle.status)} · ${c.passed} passed · ${c.failed} failed · ${c.pending} pending · ${c.total} cases</p>
        ${caseList(cycle.cases, 'No cases in this cycle.')}
      </section>`;
    })
    .join('\n');
  const bugRows = report.bugs.length
    ? `<table>
        <thead><tr><th>Bug</th><th>Severity</th><th>Status</th><th>Case</th></tr></thead>
        <tbody>
          ${report.bugs
            .map(
              (b) => `<tr>
            <td>${escapeHtml(b.title)}</td>
            <td>${escapeHtml(b.severity)}</td>
            <td>${escapeHtml(b.status)}</td>
            <td>${escapeHtml(b.testCase ?? '—')}</td>
          </tr>`,
            )
            .join('')}
        </tbody>
      </table>`
    : `<p class="empty">No known bugs recorded.</p>`;

  return `
<h1>Test Cycle Report</h1>
<p class="sub">${escapeHtml(report.projectName)} · ${report.cycles.length} cycle(s) · Exported ${escapeHtml(report.exportedAt)}</p>
${printBtn}
<div class="stats">
  <div class="stat"><div class="n">${counts.total}</div><div class="l">Cases</div></div>
  <div class="stat pass"><div class="n">${counts.passed}</div><div class="l">Passed</div></div>
  <div class="stat fail"><div class="n">${counts.failed}</div><div class="l">Failed</div></div>
  <div class="stat"><div class="n">${counts.blocked}</div><div class="l">Blocked</div></div>
  <div class="stat"><div class="n">${counts.pending}</div><div class="l">Pending</div></div>
</div>
<section class="card">
  <h2>Major issues</h2>
  <ul>
    <li>${issues.failedHigh.length} high-priority failure(s)</li>
    <li>${issues.severe.length} open high/critical bug(s)</li>
    <li>${issues.openBugs.length} open bug(s) total</li>
  </ul>
  ${
    issues.failedHigh.length
      ? caseList(issues.failedHigh, '')
      : '<p class="empty">No high-priority failures.</p>'
  }
</section>
<section class="card">
  <h2>Passed test cases</h2>
  ${caseList(passed, 'No passed cases yet.')}
</section>
<section class="card">
  <h2>Failed / blocked test cases</h2>
  ${caseList(failed, 'No failed or blocked cases.')}
</section>
<section class="card">
  <h2>Known bugs</h2>
  ${bugRows}
</section>
<h2>Cycles</h2>
${cycleBlocks}
`;
}

const SHARED_CSS = `
body{font-family:Calibri,Arial,sans-serif;color:#1c1917;line-height:1.45;margin:0}
h1{font-size:22pt;color:#0f766e;margin:0 0 6pt}
h2{font-size:14pt;margin:22pt 0 8pt;border-bottom:1px solid #e7e0d5;padding-bottom:4pt}
.sub{color:#78716c;margin:0 0 14pt}
.stats{display:flex;flex-wrap:gap:10px;margin:12pt 0 18pt}
.stat{min-width:90px;padding:8px 10px;border:1px solid #d7ebe6;border-radius:10px;background:#f3faf8}
.stat .n{font-size:18pt;font-weight:700}
.stat .l{font-size:9pt;text-transform:uppercase;color:#78716c}
.stat.pass{background:#ecfdf5;border-color:#a7f3d0}
.stat.fail{background:#fef2f2;border-color:#fecaca}
.card{border:1px solid #e7e0d5;border-radius:12px;padding:12px 14px;margin:12px 0;page-break-inside:avoid}
table{width:100%;border-collapse:collapse;font-size:10pt}
th,td{border-bottom:1px solid #eee;text-align:left;padding:6px 8px;vertical-align:top}
th{color:#78716c;font-size:9pt;text-transform:uppercase}
.mono{font-family:Consolas,monospace}
.empty{color:#78716c;font-style:italic}
.meta{color:#555;font-size:10pt}
button{margin-top:8px;padding:8px 14px;border:0;border-radius:8px;background:#0f766e;color:#fff;font-weight:600;cursor:pointer}
@media print{.no-print{display:none!important}}
`;

export function buildTcmsTcrHtml(
  report: TcrReport,
): { body: string; filename: string; contentType: string } {
  const body = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>TCR — ${escapeHtml(report.projectName)}</title>
<style>${SHARED_CSS}
body{background:#f7f4ef}
.wrap{max-width:960px;margin:0 auto;padding:24px}
</style></head>
<body><div class="wrap">${tcrBody(report, 'html')}</div></body></html>`;
  return {
    body,
    filename: 'test-cycle-report.html',
    contentType: 'text/html; charset=utf-8',
  };
}

export function buildTcmsTcrWord(
  report: TcrReport,
): { body: string; filename: string; contentType: string } {
  const body = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:w="urn:schemas-microsoft-com:office:word"
 xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/><title>TCR — ${escapeHtml(report.projectName)}</title>
<style>${SHARED_CSS}</style></head>
<body>${tcrBody(report, 'word')}</body></html>`;
  return {
    body,
    filename: 'test-cycle-report.doc',
    contentType: 'application/msword',
  };
}

export function buildTcmsTcrPdf(
  report: TcrReport,
): { body: string; filename: string; contentType: string } {
  const body = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>TCR — ${escapeHtml(report.projectName)}</title>
<style>${SHARED_CSS}
body{background:#fff}
.wrap{max-width:960px;margin:0 auto;padding:24px}
</style></head>
<body><div class="wrap">${tcrBody(report, 'pdf')}</div></body></html>`;
  return {
    body,
    filename: 'test-cycle-report.html',
    contentType: 'text/html; charset=utf-8',
  };
}
