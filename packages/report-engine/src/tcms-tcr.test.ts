import { describe, expect, it } from 'vitest';
import { buildTcmsTcrHtml, buildTcmsTcrWord } from './tcms-tcr.js';

const report = {
  projectName: 'Login pack',
  exportedAt: '2026-08-11T00:00:00.000Z',
  cycles: [
    {
      id: '1',
      name: 'Sprint cycle',
      status: 'COMPLETED',
      cases: [
        {
          externalId: 'TC-001',
          title: 'Valid login',
          status: 'PASSED',
          priority: 'HIGH',
        },
        {
          externalId: 'TC-002',
          title: 'Invalid login',
          status: 'FAILED',
          priority: 'HIGH',
          message: 'Error not shown',
        },
      ],
    },
  ],
  bugs: [
    {
      title: 'Error banner missing',
      severity: 'HIGH',
      status: 'OPEN',
      testCase: 'TC-002',
    },
  ],
};

describe('TCR', () => {
  it('renders passed, failed, bugs, and major issues', () => {
    const html = buildTcmsTcrHtml(report);
    expect(html.body).toContain('Test Cycle Report');
    expect(html.body).toContain('Valid login');
    expect(html.body).toContain('Invalid login');
    expect(html.body).toContain('Error banner missing');
    expect(html.body).toContain('high-priority failure');
    const word = buildTcmsTcrWord(report);
    expect(word.contentType).toContain('msword');
    expect(word.body).toContain('Sprint cycle');
  });
});
