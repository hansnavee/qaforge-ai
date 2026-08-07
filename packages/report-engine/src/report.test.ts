import { describe, expect, it } from 'vitest';
import {
  renderHtmlReport,
  renderJunitXml,
  renderCsvResults,
  buildZipPackage,
  type ReportManifest,
} from '../src/index';

const manifest: ReportManifest = {
  executionId: 'exec_1',
  projectName: 'Demo',
  appUrl: 'https://example.com',
  status: 'COMPLETED',
  scores: { functional: 90, accessibility: 80, performance: 75, security: 85 },
  summary: { passed: 8, failed: 1, total: 9 },
  findings: [
    {
      category: 'functional',
      severity: 'medium',
      title: 'Missing validation',
      description: 'Email field accepts invalid input',
      recommendation: 'Add client and server validation',
    },
  ],
  testCases: [
    {
      id: 'TC-001',
      module: 'Auth',
      scenario: 'Login',
      status: 'passed',
    },
  ],
  recommendations: ['Add rate limiting on login'],
};

describe('report-engine', () => {
  it('renders HTML with scores', () => {
    const html = renderHtmlReport(manifest);
    expect(html).toContain('QAForge');
    expect(html).toContain('90');
    expect(html).toContain('Missing validation');
  });

  it('renders junit and csv', () => {
    expect(renderJunitXml(manifest)).toContain('testsuite');
    expect(renderCsvResults(manifest)).toContain('TC-001');
  });

  it('builds zip package', async () => {
    const zip = await buildZipPackage({
      frameworkDir: '',
      files: {
        'reports/report.html': renderHtmlReport(manifest),
        'README.md': '# Demo',
      },
    });
    expect(Buffer.isBuffer(zip)).toBe(true);
    expect(zip.length).toBeGreaterThan(100);
  });
});
