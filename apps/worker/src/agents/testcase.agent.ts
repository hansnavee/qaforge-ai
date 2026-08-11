import type { AgentHandler } from '@qaforge/agent-sdk';
import {
  ArtifactType,
  DESIGN_TECHNIQUES,
  appAvailablePrecondition,
  expandTechniqueCoverage,
  openAppStep,
  type DesignTechnique,
} from '@qaforge/shared';
import { putBinaryArtifact } from '../context.js';

export { DESIGN_TECHNIQUES, type DesignTechnique };

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
  requirementKey?: string | null;
  designTechnique?: DesignTechnique | string | null;
  featureKey?: string | null;
  designMode?: string | null;
  priorityLabel?: string | null;
  readyForExecution?: boolean;
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
    'requirementKey',
    'designTechnique',
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
      c.requirementKey ?? '',
      c.designTechnique ?? '',
    ]
      .map((x) => escape(String(x)))
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

function defaultCases(appUrl: string): TestCase[] {
  const open = openAppStep(appUrl);
  const pre = appAvailablePrecondition(appUrl);
  return [
    {
      id: 'TC-001',
      module: 'Authentication',
      scenario: 'Valid user can log in with email and password',
      preconditions: `${pre} Valid credentials available.`,
      steps: [
        open,
        'Enter a valid email/username',
        'Enter the matching password',
        'Click Login',
      ],
      expected: 'User is authenticated and redirected to the dashboard.',
      priority: 'P0',
      priorityLabel: 'HIGH',
      severity: 'critical',
      type: 'functional',
      automationCandidate: true,
      requirementKey: 'REQ-001',
      designTechnique: 'HAPPY_PATH',
      designMode: 'GENERIC',
      readyForExecution: false,
    },
    {
      id: 'TC-002',
      module: 'Authentication',
      scenario: 'Invalid credentials show an error and block access',
      preconditions: pre,
      steps: [
        open,
        'Enter a valid username with an incorrect password',
        'Click Login',
      ],
      expected:
        'User remains on login, an error message is displayed, dashboard is not shown.',
      priority: 'P0',
      priorityLabel: 'HIGH',
      severity: 'high',
      type: 'negative',
      automationCandidate: true,
      requirementKey: 'REQ-002',
      designTechnique: 'NEGATIVE',
      designMode: 'GENERIC',
      readyForExecution: false,
    },
    {
      id: 'TC-003',
      module: 'Authentication',
      scenario: 'Empty email/password fields are rejected (equivalence invalid class)',
      preconditions: pre,
      steps: [
        open,
        'Leave email and password empty',
        'Click Login',
      ],
      expected: 'Login is blocked and validation/error feedback is shown.',
      priority: 'P1',
      priorityLabel: 'MEDIUM',
      severity: 'medium',
      type: 'negative',
      automationCandidate: true,
      requirementKey: 'REQ-001',
      designTechnique: 'EQUIVALENCE',
      designMode: 'GENERIC',
      readyForExecution: false,
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

function normalizeTechnique(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const u = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const alias: Record<string, string> = {
    EP: 'EQUIVALENCE',
    EQUIVALENCE_PARTITIONING: 'EQUIVALENCE',
    BVA: 'BOUNDARY',
    BOUNDARY_VALUE: 'BOUNDARY',
    BOUNDARY_VALUE_ANALYSIS: 'BOUNDARY',
    DECISION: 'DECISION_TABLE',
    STATE: 'STATE_TRANSITION',
    HAPPY: 'HAPPY_PATH',
    POSITIVE: 'HAPPY_PATH',
  };
  const mapped = alias[u] ?? u;
  return (DESIGN_TECHNIQUES as readonly string[]).includes(mapped)
    ? mapped
    : mapped;
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
      automationCandidate: Boolean(tc.automationCandidate ?? true),
      requirementKey: tc.requirementKey
        ? String(tc.requirementKey)
        : tc.requirementId
          ? String(tc.requirementId)
          : null,
      designTechnique: normalizeTechnique(
        tc.designTechnique ?? tc.technique ?? tc.testDesignTechnique,
      ),
      featureKey: tc.featureKey ? String(tc.featureKey) : null,
      designMode: tc.designMode ? String(tc.designMode) : null,
      priorityLabel: tc.priorityLabel ? String(tc.priorityLabel) : null,
      readyForExecution: Boolean(tc.readyForExecution),
    } satisfies TestCase;
  });

  const detailed = normalized.filter(isDetailedCase);
  return detailed.length >= Math.min(3, normalized.length)
    ? normalized.map((tc, i) =>
        isDetailedCase(tc) ? tc : defaultCases(appUrl)[i % 3]!,
      )
    : defaultCases(appUrl);
}

const TECHNIQUE_PROMPT = `Apply classic test design techniques — do NOT only write one case per requirement.
For EACH requirementKey, generate multiple cases using appropriate techniques:
- HAPPY_PATH: valid / successful primary flow
- EQUIVALENCE: valid vs invalid input classes (not just one example)
- BOUNDARY: min/max/empty/length edges when inputs exist
- DECISION_TABLE: combinations of conditions/rules when AC has rules
- STATE_TRANSITION: before/after login, redirect, session states when relevant
- NEGATIVE: invalid credentials, blocked navigation, error handling
- ERROR_GUESSING: common defects (XSS in fields, double-submit, trimmed spaces) only if grounded in the UI under test
Every case MUST include requirementKey and designTechnique.
Aim for technique coverage across requirements, not a 1:1 REQ→TC mapping.`;

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
        system: `You are a Senior QA applying formal test design techniques.
HARD RULES:
- Ground every case in the provided requirements only — never invent product features.
- If no application URL is provided, use generic steps ("Open the application under test") — never invent a host such as saucedemo.
- ${TECHNIQUE_PROMPT}
- Short fields: scenario ≤120 chars, expected ≤200, steps 3–6 × ≤100 chars.
- Return JSON only.`,
        prompt: `App: ${input.appUrl}
Requirements: ${JSON.stringify(requirements)?.slice(0, 10000)}
Map: ${JSON.stringify(map)?.slice(0, 5000)}
Functional: ${JSON.stringify(functional)?.slice(0, 3000)}

${TECHNIQUE_PROMPT}

Return JSON only:
{ "testCases": [{ "id": "TC-001", "module", "scenario", "preconditions", "steps": ["1. ...","2. ..."], "expected", "priority", "severity", "type", "automationCandidate": true, "requirementKey": "REQ-001", "designTechnique": "HAPPY_PATH"|"EQUIVALENCE"|"BOUNDARY"|"DECISION_TABLE"|"STATE_TRANSITION"|"NEGATIVE"|"ERROR_GUESSING" }] }`,
        json: true,
        model: 'reasoning',
        temperature: 0.2,
        maxTokens: 4500,
      });
      raw = JSON.parse(llm.text);
    } catch {
      raw = { testCases: defaultCases(input.appUrl) };
    }

    const normalized = normalizeCases(raw, input.appUrl);
    const expanded = expandTechniqueCoverage({
      requirements,
      existingCases: normalized,
      appUrl: input.appUrl,
    });
    const testCases =
      expanded.testCases.length > 0 ? expanded.testCases : normalized;
    const payload = {
      testCases,
      coverage: expanded.coverage,
      generatedAt: new Date().toISOString(),
    };
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
      message: `Generated ${testCases.length} technique-based test cases`,
      data: { count: testCases.length },
    });
    return payload;
  },
};
