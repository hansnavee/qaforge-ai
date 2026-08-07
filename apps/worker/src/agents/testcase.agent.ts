import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';
import { putBinaryArtifact } from '../context.js';

export type TestCase = {
  id: string;
  module: string;
  scenario: string;
  preconditions: string;
  steps: string[];
  expected: string;
  priority: string;
  severity: string;
  type: string;
  automationCandidate: boolean;
};

function toCsv(cases: TestCase[]): string {
  const header = [
    'id',
    'module',
    'scenario',
    'preconditions',
    'steps',
    'expected',
    'priority',
    'severity',
    'type',
    'automationCandidate',
  ];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = cases.map((c) =>
    [
      c.id,
      c.module,
      c.scenario,
      c.preconditions,
      c.steps.join(' | '),
      c.expected,
      c.priority,
      c.severity,
      c.type,
      String(c.automationCandidate),
    ]
      .map((x) => escape(String(x)))
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

function defaultCases(appUrl: string): TestCase[] {
  return [
    {
      id: 'TC-001',
      module: 'Authentication',
      scenario: 'Successful login path',
      preconditions: 'Valid user exists',
      steps: [
        `Navigate to ${appUrl}`,
        'Enter valid credentials (manual)',
        'Submit login',
      ],
      expected: 'User lands on authenticated home',
      priority: 'P0',
      severity: 'critical',
      type: 'functional',
      automationCandidate: true,
    },
    {
      id: 'TC-002',
      module: 'Navigation',
      scenario: 'Primary navigation reachable',
      preconditions: 'Session available',
      steps: ['Open home', 'Click each primary nav item'],
      expected: 'Each target loads without error',
      priority: 'P0',
      severity: 'high',
      type: 'smoke',
      automationCandidate: true,
    },
    {
      id: 'TC-003',
      module: 'Accessibility',
      scenario: 'Keyboard operable login',
      preconditions: 'Login page available',
      steps: ['Tab through controls', 'Activate submit with Enter'],
      expected: 'Focus order logical; submit keyboard operable',
      priority: 'P1',
      severity: 'medium',
      type: 'accessibility',
      automationCandidate: true,
    },
  ];
}

function normalizeCases(raw: unknown, appUrl: string): TestCase[] {
  const arr =
    raw && typeof raw === 'object' && 'testCases' in raw
      ? (raw as { testCases: unknown }).testCases
      : Array.isArray(raw)
        ? raw
        : null;

  if (!Array.isArray(arr) || arr.length === 0) return defaultCases(appUrl);

  return arr.map((item, i) => {
    const tc = (item ?? {}) as Record<string, unknown>;
    return {
      id: String(tc.id ?? `TC-${String(i + 1).padStart(3, '0')}`),
      module: String(tc.module ?? tc.category ?? 'General'),
      scenario: String(tc.scenario ?? tc.title ?? tc.name ?? `Scenario ${i + 1}`),
      preconditions: String(tc.preconditions ?? 'Application available'),
      steps: Array.isArray(tc.steps)
        ? tc.steps.map(String)
        : [String(tc.steps ?? 'Execute scenario')],
      expected: String(tc.expected ?? tc.expectedResult ?? 'Expected behavior observed'),
      priority: String(tc.priority ?? 'P1'),
      severity: String(tc.severity ?? 'medium'),
      type: String(tc.type ?? tc.category ?? 'functional'),
      automationCandidate: Boolean(
        tc.automationCandidate ?? true,
      ),
    };
  });
}

export const testcaseAgent: AgentHandler<{ appUrl: string }, unknown> = {
  id: 'TEST_CASE_GENERATION',
  name: 'Test Case Agent',

  async run(ctx, input) {
    const requirements = await ctx.getArtifactJson(ArtifactType.REQUIREMENTS_JSON);
    const map = await ctx.getArtifactJson(ArtifactType.APPLICATION_MAP);
    const functional = await ctx.getArtifactJson(ArtifactType.FUNCTIONAL_FINDINGS);

    let raw: unknown;
    try {
      const llm = await ctx.llm.complete({
        system:
          'Generate professional software test cases as JSON with full fields.',
        prompt: `App: ${input.appUrl}\nRequirements: ${JSON.stringify(requirements)}\nMap: ${JSON.stringify(map)?.slice(0, 8000)}\nFunctional: ${JSON.stringify(functional)?.slice(0, 4000)}\n\nReturn JSON: { testCases: [{ id, module, scenario, preconditions, steps: string[], expected, priority, severity, type, automationCandidate: boolean }] }`,
        json: true,
        model: 'reasoning',
      });
      raw = JSON.parse(llm.text);
    } catch {
      raw = { testCases: defaultCases(input.appUrl) };
    }

    const testCases = normalizeCases(raw, input.appUrl);
    const payload = { testCases, generatedAt: new Date().toISOString() };
    const csv = toCsv(testCases);

    await ctx.putArtifactJson(ArtifactType.TEST_CASES_JSON, payload);
    await putBinaryArtifact({
      executionId: ctx.executionId,
      type: ArtifactType.TEST_CASES_CSV,
      key: `${ctx.executionId}/test-cases.csv`,
      body: csv,
      mime: 'text/csv',
      store: ctx.artifactStore,
    });

    await ctx.emit({
      type: 'testcases.ready',
      phase: 'TEST_CASES',
      message: `Generated ${testCases.length} test cases`,
      data: { count: testCases.length },
    });
    return payload;
  },
};
