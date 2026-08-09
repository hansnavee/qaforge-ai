import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';

export type TestDataCaseRow = {
  testCaseId: string;
  module?: string;
  scenario?: string;
  data: Record<string, string>;
  variants?: Array<{
    name: string;
    data: Record<string, string>;
  }>;
};

type TestDataInput = {
  appUrl?: string | null;
  cases: Array<{
    id: string;
    externalId?: string | null;
    module?: string | null;
    scenario?: string | null;
    type?: string | null;
    testData?: Record<string, string> | null;
  }>;
};

function heuristicRow(tc: TestDataInput['cases'][number], index: number): TestDataCaseRow {
  const base = tc.testData ?? {};
  const id = tc.externalId || tc.id;
  return {
    testCaseId: id,
    module: tc.module ?? undefined,
    scenario: tc.scenario ?? undefined,
    data: {
      username: base.username ?? `qa_user_${index + 1}`,
      password: base.password ?? '<<manual>>',
      email: base.email ?? `qa_user_${index + 1}@example.test`,
      sampleInput: base.sampleInput ?? `sample-${String(id).toLowerCase()}`,
      ...base,
    },
    variants: [
      {
        name: 'happy-path',
        data: {
          username: base.username ?? `qa_user_${index + 1}`,
          password: base.password ?? '<<manual>>',
        },
      },
      {
        name: 'negative',
        data: {
          username: 'invalid_user',
          password: 'bad-password',
        },
      },
    ],
  };
}

export const testdataAgent: AgentHandler<
  TestDataInput,
  { cases: TestDataCaseRow[]; source: string }
> = {
  id: 'TEST_DATA',
  name: 'Test Data Agent',

  async run(ctx, input) {
    await ctx.emit({
      type: 'testdata.preparing',
      phase: 'TEST_DATA',
      message: 'Preparing Stage 4 test data sets for designed cases',
    });

    const design = await ctx.getArtifactJson(ArtifactType.TEST_DESIGN_JSON);
    const requirements = await ctx.getArtifactJson(
      ArtifactType.REQUIREMENTS_JSON,
    );

    let rows = input.cases.map((tc, i) => heuristicRow(tc, i));

    try {
      const llm = await ctx.llm.complete({
        system:
          'You are a QA test-data engineer. Produce realistic, domain-agnostic test data for each case. Never invent real PII. Mark secrets as <<manual>>. Return JSON only.',
        prompt: `App URL: ${input.appUrl ?? ''}\nRequirements: ${JSON.stringify(requirements)}\nDesign: ${JSON.stringify(design)}\nCases: ${JSON.stringify(input.cases)}\n\nReturn JSON: { cases: [{ testCaseId, module, scenario, data: Record<string,string>, variants?: [{name, data}] }] }`,
        json: true,
        model: 'fast',
      });
      const parsed = JSON.parse(llm.text) as { cases?: TestDataCaseRow[] };
      if (Array.isArray(parsed.cases) && parsed.cases.length) {
        const byId = new Map(
          parsed.cases
            .filter((c) => c?.testCaseId)
            .map((c) => [String(c.testCaseId), c]),
        );
        rows = input.cases.map((tc, i) => {
          const id = tc.externalId || tc.id;
          const fromLlm = byId.get(String(id));
          if (!fromLlm) return heuristicRow(tc, i);
          return {
            testCaseId: String(id),
            module: fromLlm.module ?? tc.module ?? undefined,
            scenario: fromLlm.scenario ?? tc.scenario ?? undefined,
            data:
              fromLlm.data && typeof fromLlm.data === 'object'
                ? Object.fromEntries(
                    Object.entries(fromLlm.data).map(([k, v]) => [
                      k,
                      String(v),
                    ]),
                  )
                : heuristicRow(tc, i).data,
            variants: Array.isArray(fromLlm.variants)
              ? fromLlm.variants.map((v) => ({
                  name: String(v.name ?? 'variant'),
                  data:
                    v.data && typeof v.data === 'object'
                      ? Object.fromEntries(
                          Object.entries(v.data).map(([k, val]) => [
                            k,
                            String(val),
                          ]),
                        )
                      : {},
                }))
              : heuristicRow(tc, i).variants,
          };
        });
      }
    } catch {
      /* keep heuristic rows */
    }

    const artifact = {
      source: 'test-data-agent',
      generatedAt: new Date().toISOString(),
      cases: rows,
    };

    await ctx.putArtifactJson(ArtifactType.TEST_DATA_JSON, artifact);
    await ctx.emit({
      type: 'testdata.ready',
      phase: 'TEST_DATA',
      message: `Test data ready for ${rows.length} case(s)`,
      data: { count: rows.length },
    });

    return { cases: rows, source: artifact.source };
  },
};
