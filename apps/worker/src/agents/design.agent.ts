import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';
import { putBinaryArtifact } from '../context.js';
import { testcaseAgent, type TestCase } from './testcase.agent.js';

type DesignInput = {
  appUrl: string;
};

export type DesignedCase = TestCase & {
  testData?: Record<string, string>;
};

function enrichWithData(cases: TestCase[]): DesignedCase[] {
  return cases.map((tc, i) => ({
    ...tc,
    testData: {
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
      message: 'Designing test cases from strategy (data finalized in Stage 4)',
    });

    const strategy = await ctx.getArtifactJson(ArtifactType.TEST_STRATEGY_JSON);
    const requirements = await ctx.getArtifactJson(ArtifactType.REQUIREMENTS_JSON);

    // Reuse testcase generation, then enrich with data + strategy context
    const base = (await testcaseAgent.run(ctx, {
      appUrl: input.appUrl,
    })) as { testCases?: TestCase[] };

    let cases = enrichWithData(base?.testCases ?? []);

    try {
      const llm = await ctx.llm.complete({
        system: `You are a Senior QA Test Design agent.
Rewrite/expand every case into a fully documented executable test case.
Required per case:
- module, scenario (business outcome)
- preconditions (>= 1 sentence: data, role, page state)
- steps: 4+ concrete UI steps
- expected: observable pass criteria
- priority, severity, type, testingLevel (SMOKE|SANITY|FUNCTIONAL|NEGATIVE)
- testData: realistic values for this app (Sauce Demo: standard_user / secret_sauce when applicable)
No stub one-liners.`,
        prompt: `App URL: ${input.appUrl}
Strategy: ${JSON.stringify(strategy)?.slice(0, 6000)}
Requirements: ${JSON.stringify(requirements)?.slice(0, 10000)}
Draft cases: ${JSON.stringify(cases)}

Return JSON only:
{ "testCases": [{ "id","module","scenario","preconditions","steps":string[],"expected","priority","severity","type","testingLevel","automationCandidate":boolean,"testData":Record<string,string> }] }`,
        json: true,
        model: 'reasoning',
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
          cases = next;
        }
      }
    } catch {
      /* keep heuristic enrichment */
    }

    const design = {
      source: 'test-design-agent',
      strategySummary:
        strategy && typeof strategy === 'object' && 'summary' in strategy
          ? (strategy as { summary?: string }).summary
          : undefined,
      testCases: cases,
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
      'id,module,scenario,preconditions,steps,expected,priority,severity,type,testData\n';
    const csvBody = cases
      .map((c) => {
        const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
        return [
          c.id,
          c.module,
          c.scenario,
          c.preconditions,
          c.steps.join(' | '),
          c.expected,
          c.priority,
          c.severity,
          c.type,
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
      message: `Designed ${cases.length} test case(s); Stage 4 will finalize data`,
      data: { count: cases.length },
    });

    return { testCases: cases, testData: cases.map((c) => c.testData) };
  },
};
