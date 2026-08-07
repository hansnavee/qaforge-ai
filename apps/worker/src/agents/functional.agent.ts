import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';

export const functionalAgent: AgentHandler = {
  id: 'FUNCTIONAL_TESTING',
  name: 'Functional Agent',

  async run(ctx) {
    const requirements = await ctx.getArtifactJson<{
      requirements?: Array<{ id: string; title: string; description?: string }>;
    }>(ArtifactType.REQUIREMENTS_JSON);
    const map = await ctx.getArtifactJson<{
      pages?: Array<{ url: string; title: string; forms?: unknown[] }>;
      workflows?: Array<{ id: string; name: string; steps?: string[] }>;
    }>(ArtifactType.APPLICATION_MAP);

    let findings: unknown;
    try {
      const llm = await ctx.llm.complete({
        system: 'Generate functional QA findings and smoke scenarios as JSON.',
        prompt: `Requirements:\n${JSON.stringify(requirements)}\n\nApp map:\n${JSON.stringify({ pages: map?.pages?.slice(0, 10), workflows: map?.workflows })}\n\nReturn JSON: { findings: [{severity,title,description,recommendation}], smokeScenarios: [{id,name,steps:string[],expected}] }`,
        json: true,
        model: 'fast',
      });
      findings = JSON.parse(llm.text);
    } catch {
      findings = {
        findings: [
          {
            severity: 'medium',
            title: 'Validate primary navigation',
            description: 'Ensure primary nav links resolve without 4xx/5xx.',
            recommendation: 'Add smoke coverage for each nav target.',
          },
        ],
        smokeScenarios: (map?.pages ?? []).slice(0, 5).map((p, i) => ({
          id: `SMOKE-${i + 1}`,
          name: `Load ${p.title || p.url}`,
          steps: [`Navigate to ${p.url}`, 'Assert document title is non-empty'],
          expected: 'Page loads successfully',
        })),
      };
    }

    await ctx.putArtifactJson(ArtifactType.FUNCTIONAL_FINDINGS, findings);
    await ctx.emit({
      type: 'functional.ready',
      phase: 'FUNCTIONAL',
      message: 'Functional findings generated',
    });
    return findings;
  },
};
