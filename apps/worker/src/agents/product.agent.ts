import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';

export const productAgent: AgentHandler = {
  id: 'PRODUCT_IMPROVEMENT',
  name: 'Product Agent',

  async run(ctx) {
    const requirements = await ctx.getArtifactJson(ArtifactType.REQUIREMENTS_JSON);
    const map = await ctx.getArtifactJson(ArtifactType.APPLICATION_MAP);
    const functional = await ctx.getArtifactJson(ArtifactType.FUNCTIONAL_FINDINGS);
    const ux = await ctx.getArtifactJson(ArtifactType.UX_FINDINGS);

    let roadmap: unknown;
    try {
      const llm = await ctx.llm.complete({
        system:
          'You are a product strategist for QA. Suggest prioritized product improvements as JSON.',
        prompt: `Context:\n${JSON.stringify({ requirements, map: { pages: (map as { pages?: unknown })?.pages }, functional, ux }, null, 2).slice(0, 12000)}\n\nReturn JSON: { suggestions: [{ priority: 'P0'|'P1'|'P2', title, rationale, impact }] }`,
        json: true,
        model: 'fast',
      });
      roadmap = JSON.parse(llm.text);
    } catch {
      roadmap = {
        suggestions: [
          {
            priority: 'P1',
            title: 'Strengthen onboarding empty states',
            rationale: 'Discovered pages may leave new users without guidance.',
            impact: 'Higher activation and fewer support tickets',
          },
          {
            priority: 'P2',
            title: 'Surface key actions above the fold',
            rationale: 'Primary CTAs compete with secondary chrome.',
            impact: 'Improved task completion rate',
          },
        ],
      };
    }

    await ctx.putArtifactJson(ArtifactType.PRODUCT_ROADMAP, roadmap);
    await ctx.emit({
      type: 'product.ready',
      phase: 'PRODUCT',
      message: 'Product improvement suggestions ready',
    });
    return roadmap;
  },
};
