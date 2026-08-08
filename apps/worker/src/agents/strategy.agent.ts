import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';

type StrategyInput = {
  appUrl: string;
  projectName: string;
};

function heuristicStrategy(appUrl: string, projectName: string) {
  return {
    summary: `Risk-based STLC strategy for ${projectName}`,
    objectives: [
      'Validate critical user journeys after authentication',
      'Cover UI, API, and regression of failed scenarios',
      'Produce automation-ready cases and quality evidence pack',
    ],
    scope: {
      in: ['Smoke', 'Functional UI', 'API smoke', 'Retest of failures'],
      out: ['Load/soak testing', 'Penetration testing'],
    },
    testLevels: ['smoke', 'functional', 'regression', 'api'],
    environments: [{ name: 'target', baseUrl: appUrl }],
    entryCriteria: [
      'Requirements clarified or skip accepted',
      'Application URL reachable',
    ],
    exitCriteria: [
      'Designed cases executed at least once',
      'Failed cases retested once',
      'Final STLC pack generated',
    ],
    riskAreas: [
      'Authentication and session handling',
      'Primary navigation and forms',
      'API contracts observed during discovery',
    ],
    tooling: ['Playwright', 'QAForge agents', 'CSV/XLSX exports'],
    source: 'heuristic',
  };
}

export const strategyAgent: AgentHandler<StrategyInput, unknown> = {
  id: 'TEST_STRATEGY',
  name: 'Test Strategy Agent',

  async run(ctx, input) {
    await ctx.emit({
      type: 'strategy.planning',
      phase: 'TEST_STRATEGY',
      message: 'Drafting test strategy from requirements',
    });

    const requirements = await ctx.getArtifactJson(ArtifactType.REQUIREMENTS_JSON);
    let output: unknown;

    try {
      const llm = await ctx.llm.complete({
        system:
          'You are a senior QA strategist. Produce a concise STLC test strategy as JSON.',
        prompt: `Project: ${input.projectName}\nApp URL: ${input.appUrl}\nRequirements JSON:\n${JSON.stringify(requirements)}\n\nReturn JSON with keys: summary, objectives[], scope{in[],out[]}, testLevels[], environments[{name,baseUrl}], entryCriteria[], exitCriteria[], riskAreas[], tooling[]`,
        json: true,
        model: 'fast',
      });
      output = JSON.parse(llm.text);
    } catch {
      output = heuristicStrategy(input.appUrl, input.projectName);
    }

    if (!output || typeof output !== 'object') {
      output = heuristicStrategy(input.appUrl, input.projectName);
    }

    await ctx.putArtifactJson(ArtifactType.TEST_STRATEGY_JSON, output);
    await ctx.emit({
      type: 'strategy.ready',
      phase: 'TEST_STRATEGY',
      message: 'Test strategy artifact written',
    });
    return output;
  },
};
