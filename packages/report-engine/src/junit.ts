import type { ReportManifest } from './types.js';

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isFailed(status: unknown): boolean {
  return /fail|error|broken/i.test(String(status ?? ''));
}

export function renderJunitXml(manifest: ReportManifest): string {
  const cases: Array<Record<string, unknown>> =
    manifest.testCases.length > 0
      ? manifest.testCases
      : manifest.findings.map((f, i) => ({
          id: `FINDING-${i + 1}`,
          title: f.title,
          category: f.category,
          status: /high|critical/i.test(f.severity) ? 'failed' : 'passed',
          message: f.description,
        }));

  const failures = cases.filter((c) => isFailed(c.status ?? c.result)).length;
  const tests = cases.length || manifest.summary.total;
  const failedCount = failures || manifest.summary.failed;

  const testcaseXml = cases
    .map((tc, i) => {
      const name = escapeXml(tc.title ?? tc.name ?? `case-${i + 1}`);
      const classname = escapeXml(
        tc.category ?? tc.classname ?? manifest.projectName,
      );
      const failed = isFailed(tc.status ?? tc.result);
      const body = failed
        ? `<failure message="${escapeXml(tc.message ?? tc.error ?? tc.title ?? 'failed')}">${escapeXml(tc.description ?? tc.message ?? '')}</failure>`
        : '';
      return `    <testcase name="${name}" classname="${classname}" time="0">${body}</testcase>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="${escapeXml(manifest.projectName)}" tests="${tests}" failures="${failedCount}" time="0">
  <testsuite name="${escapeXml(manifest.projectName)}" tests="${tests}" failures="${failedCount}" time="0" timestamp="${new Date().toISOString()}">
    <properties>
      <property name="executionId" value="${escapeXml(manifest.executionId)}"/>
      <property name="appUrl" value="${escapeXml(manifest.appUrl)}"/>
      <property name="status" value="${escapeXml(manifest.status)}"/>
    </properties>
${testcaseXml}
  </testsuite>
</testsuites>
`;
}
