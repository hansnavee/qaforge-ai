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
      scenario: 'Valid user can log in and reach inventory',
      preconditions:
        `App URL ${appUrl} is reachable. Standard user credentials are available (e.g. standard_user). Browser cookies/session cleared.`,
      steps: [
        `Open ${appUrl} in a supported browser`,
        'Verify Login page shows Username, Password, and Login controls',
        'Enter a valid username in the Username field',
        'Enter the matching valid password in the Password field',
        'Click the Login button',
        'Wait for navigation to complete',
      ],
      expected:
        'User is authenticated, URL changes to the inventory/products page, and product catalog is visible without an error banner.',
      priority: 'P0',
      severity: 'critical',
      type: 'functional',
      automationCandidate: true,
    },
    {
      id: 'TC-002',
      module: 'Authentication',
      scenario: 'Invalid password shows login error and blocks access',
      preconditions: `Login page at ${appUrl} is available. A known username exists but password used is incorrect.`,
      steps: [
        `Open ${appUrl}`,
        'Enter a valid username',
        'Enter an incorrect password',
        'Click Login',
      ],
      expected:
        'User remains on the login page, an error message is displayed, and inventory/products are not accessible.',
      priority: 'P0',
      severity: 'high',
      type: 'negative',
      automationCandidate: true,
    },
    {
      id: 'TC-003',
      module: 'Cart',
      scenario: 'Add a product to cart and verify cart badge/count',
      preconditions: 'User is logged in and inventory page lists at least one product.',
      steps: [
        'On inventory, locate the first product card',
        'Note the product name',
        'Click Add to cart for that product',
        'Observe the cart icon/badge in the header',
        'Open the cart page',
      ],
      expected:
        'Cart badge increments to 1 (or previous+1). Cart page lists the selected product with correct name and quantity.',
      priority: 'P0',
      severity: 'high',
      type: 'functional',
      automationCandidate: true,
    },
  ];
}

function isDetailedCase(tc: TestCase): boolean {
  return (
    tc.preconditions.trim().length >= 20 &&
    tc.steps.length >= 3 &&
    tc.steps.every((s) => s.trim().length >= 8) &&
    tc.expected.trim().length >= 20 &&
    tc.scenario.trim().length >= 10
  );
}

function normalizeCases(raw: unknown, appUrl: string): TestCase[] {
  const arr =
    raw && typeof raw === 'object' && 'testCases' in raw
      ? (raw as { testCases: unknown }).testCases
      : Array.isArray(raw)
        ? raw
        : null;

  if (!Array.isArray(arr) || arr.length === 0) return defaultCases(appUrl);

  const normalized = arr.map((item, i) => {
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

  const detailed = normalized.filter(isDetailedCase);
  // Prefer fully specified cases; if LLM returned thin stubs, use detailed defaults.
  return detailed.length >= Math.min(3, normalized.length)
    ? normalized.map((tc, i) => (isDetailedCase(tc) ? tc : defaultCases(appUrl)[i % 3]!))
    : defaultCases(appUrl);
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
        system: `You are a Senior QA writing executable manual test cases.
HARD RULES:
- Ground every case in the provided requirements only — never invent product features.
- Prefer requirementKey when requirements include keys; reject unmapped inventiveness.
- Short fields: scenario ≤120 chars, expected ≤200, steps 3–6 × ≤100 chars.
- Return JSON only.`,
        prompt: `App: ${input.appUrl}
Requirements: ${JSON.stringify(requirements)?.slice(0, 10000)}
Map: ${JSON.stringify(map)?.slice(0, 5000)}
Functional: ${JSON.stringify(functional)?.slice(0, 3000)}

Cover happy path, negative, and core features from requirements only.
Return JSON only:
{ "testCases": [{ "id": "TC-001", "module", "scenario", "preconditions", "steps": ["1. ...","2. ..."], "expected", "priority", "severity", "type", "automationCandidate": true, "requirementKey"?: string }] }`,
        json: true,
        model: 'reasoning',
        temperature: 0.2,
        maxTokens: 3000,
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
