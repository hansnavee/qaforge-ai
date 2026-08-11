import type { AgentHandler } from '@qaforge/agent-sdk';
import {
  ArtifactType,
  expandTechniqueCoverage,
  type DesignedTestCase,
} from '@qaforge/shared';
import { putBinaryArtifact } from '../context.js';
import { testcaseAgent, type TestCase } from './testcase.agent.js';

type DesignInput = {
  appUrl: string;
};

export type DesignedCase = TestCase & {
  testData?: Record<string, string>;
  testingLevel?: string;
};

function enrichWithData(cases: DesignedTestCase[] | TestCase[]): DesignedCase[] {
  return cases.map((tc, i) => ({
    ...tc,
    testData:
      'testData' in tc && tc.testData
        ? tc.testData
        : {
            username: `qa_user_${i + 1}`,
            password: '<<manual>>',
            sampleInput: `sample-${tc.id.toLowerCase()}`,
            expectedStatus: tc.expected.slice(0, 80),
          },
  }));
}

export const designAgent: AgentHandler<
  DesignInput,
  { testCases: DesignedCase[]; testData: DesignedCase['testData'][] }
> = {
  id: 'TEST_DESIGN',
  name: 'Test Design Agent',

  async run(ctx, input) {
    await ctx.emit({
      type: 'design.planning',
      phase: 'TEST_DESIGN',
      message:
        'Designing technique-based cases (EP/BVA/decision/state/negative) from requirements',
    });

    const strategy = await ctx.getArtifactJson(ArtifactType.TEST_STRATEGY_JSON);
    const requirements = await ctx.getArtifactJson(ArtifactType.REQUIREMENTS_JSON);

    // Reuse testcase generation, then enrich with data + strategy context
    const base = (await testcaseAgent.run(ctx, {
      appUrl: input.appUrl,
    })) as { testCases?: TestCase[] };

    let draftCases: TestCase[] = base?.testCases ?? [];

    try {
      const llm = await ctx.llm.complete({
        system: `You are a Senior QA Test Design agent applying formal design techniques.
HARD RULES (anti-hallucination):
- Use ONLY the provided requirements + strategy. Do not invent features, pages, or APIs not present there.
- Do NOT output only one case per requirement. Expand each requirement with techniques:
  HAPPY_PATH, EQUIVALENCE, BOUNDARY, DECISION_TABLE, STATE_TRANSITION, NEGATIVE, ERROR_GUESSING (when applicable).
- Every case MUST include requirementKey and designTechnique.
- Keep fields short: scenario ≤120 chars, expected ≤200 chars, each step ≤100 chars, preconditions ≤160 chars.
- Return JSON only matching the schema. No prose outside JSON.
Required per case: module, scenario, preconditions, steps (3–6), expected, priority, severity, type, testingLevel, designTechnique, requirementKey, testData.`,
        prompt: `App URL: ${input.appUrl}
Strategy: ${JSON.stringify(strategy)?.slice(0, 4000)}
Requirements: ${JSON.stringify(requirements)?.slice(0, 8000)}
Draft cases: ${JSON.stringify(draftCases)?.slice(0, 6000)}

Expand for technique coverage (not 1:1 REQ→TC). Return JSON only:
{ "testCases": [{ "id","module","scenario","preconditions","steps":string[],"expected","priority","severity","type","testingLevel","automationCandidate":boolean,"testData":Record<string,string>,"requirementKey":string,"designTechnique":"HAPPY_PATH"|"EQUIVALENCE"|"BOUNDARY"|"DECISION_TABLE"|"STATE_TRANSITION"|"NEGATIVE"|"ERROR_GUESSING" }] }`,
        json: true,
        model: 'reasoning',
        temperature: 0.2,
        maxTokens: 4500,
      });
      const parsed = JSON.parse(llm.text) as { testCases?: DesignedCase[] };
      if (Array.isArray(parsed.testCases) && parsed.testCases.length) {
        const next = parsed.testCases.map((tc, i) => ({
          id: tc.id || `TC-${String(i + 1).padStart(3, '0')}`,
          module: tc.module || 'General',
          scenario: tc.scenario || `Scenario ${i + 1}`,
          preconditions: tc.preconditions || '',
          steps: Array.isArray(tc.steps) ? tc.steps.map(String) : [],
          expected: tc.expected || 'Expected behavior observed',
          priority: tc.priority || 'P1',
          severity: tc.severity || 'medium',
          type: tc.type || 'functional',
          automationCandidate: Boolean(tc.automationCandidate ?? true),
          requirementKey: tc.requirementKey ?? null,
          designTechnique: tc.designTechnique ?? null,
          featureKey: tc.featureKey ?? null,
          designMode: tc.designMode ?? null,
          priorityLabel: tc.priorityLabel ?? null,
          readyForExecution: Boolean(tc.readyForExecution),
          testingLevel: tc.testingLevel,
          testData: tc.testData ?? {
            username: `qa_user_${i + 1}`,
            password: '<<manual>>',
          },
        }));
        const richEnough = next.filter(
          (tc) =>
            tc.steps.length >= 3 &&
            tc.preconditions.length >= 20 &&
            tc.expected.length >= 20,
        );
        if (richEnough.length >= Math.min(3, next.length)) {
          draftCases = next;
        }
      }
    } catch {
      /* keep draft from testcase agent */
    }

    const expanded = expandTechniqueCoverage({
      requirements,
      existingCases: draftCases,
      appUrl: input.appUrl,
    });
    const cases = enrichWithData(
      expanded.testCases.length ? expanded.testCases : draftCases,
    );

    const design = {
      source: 'test-design-agent',
      strategySummary:
        strategy && typeof strategy === 'object' && 'summary' in strategy
          ? (strategy as { summary?: string }).summary
          : undefined,
      testCases: cases,
      coverage: expanded.coverage,
    };

    const testData = {
      cases: cases.map((c) => ({
        testCaseId: c.id,
        data: c.testData ?? {},
      })),
    };

    await ctx.putArtifactJson(ArtifactType.TEST_DESIGN_JSON, design);
    await ctx.putArtifactJson(ArtifactType.TEST_DATA_JSON, testData);
    await ctx.putArtifactJson(ArtifactType.TEST_CASES_JSON, { testCases: cases });

    const csvHeader =
      'id,module,scenario,preconditions,steps,expected,priority,severity,type,requirementKey,designTechnique,testData\n';
    const csvBody = cases
      .map((c) => {
        const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
        return [
          c.id,
          c.module,
          c.scenario,
          c.preconditions,
          Array.isArray(c.steps) ? c.steps.join(' | ') : '',
          c.expected,
          c.priority,
          c.severity,
          c.type,
          c.requirementKey ?? '',
          c.designTechnique ?? '',
          JSON.stringify(c.testData ?? {}),
        ]
          .map((x) => escape(String(x)))
          .join(',');
      })
      .join('\n');

    await putBinaryArtifact({
      executionId: ctx.executionId,
      type: ArtifactType.TEST_CASES_CSV,
      key: `${ctx.executionId}/test-cases/cases.csv`,
      body: Buffer.from(csvHeader + csvBody, 'utf8'),
      mime: 'text/csv',
      store: ctx.artifactStore,
    });

    await ctx.emit({
      type: 'design.ready',
      phase: 'TEST_DESIGN',
      message: `Designed ${cases.length} technique-based case(s)`,
      data: {
        count: cases.length,
        coverage: design.coverage,
      },
    });

    return { testCases: cases, testData: cases.map((c) => c.testData) };
  },
};
