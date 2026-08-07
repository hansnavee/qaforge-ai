import type { ReportManifest } from './types.js';

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function renderCsvResults(manifest: ReportManifest): string {
  const header = [
    'executionId',
    'projectName',
    'appUrl',
    'status',
    'type',
    'id',
    'category',
    'severity',
    'title',
    'description',
    'recommendation',
    'result',
  ];

  const rows: string[][] = [];

  for (const [i, f] of manifest.findings.entries()) {
    rows.push([
      manifest.executionId,
      manifest.projectName,
      manifest.appUrl,
      manifest.status,
      'finding',
      `F-${i + 1}`,
      f.category,
      f.severity,
      f.title,
      f.description,
      f.recommendation ?? '',
      '',
    ]);
  }

  for (const [i, tc] of manifest.testCases.entries()) {
    rows.push([
      manifest.executionId,
      manifest.projectName,
      manifest.appUrl,
      manifest.status,
      'testCase',
      String(tc.id ?? tc.testId ?? `TC-${i + 1}`),
      String(tc.category ?? ''),
      String(tc.priority ?? ''),
      String(tc.title ?? tc.name ?? ''),
      String(tc.description ?? ''),
      '',
      String(tc.status ?? tc.result ?? ''),
    ]);
  }

  if (rows.length === 0) {
    rows.push([
      manifest.executionId,
      manifest.projectName,
      manifest.appUrl,
      manifest.status,
      'summary',
      '',
      '',
      '',
      'No findings or test cases',
      `passed=${manifest.summary.passed};failed=${manifest.summary.failed};total=${manifest.summary.total}`,
      '',
      '',
    ]);
  }

  return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
}
