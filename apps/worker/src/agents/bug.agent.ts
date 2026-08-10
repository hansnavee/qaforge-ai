import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';
import { prisma } from '@qaforge/database';

type BugAgentInput = {
  projectId: string;
  failures: Array<{
    testCaseId: string;
    testResultId: string;
    externalId: string;
    scenario: string;
    severity?: string | null;
    message: string;
    steps: string[];
    evidenceKeys: string[];
  }>;
};

export const bugAgent: AgentHandler<BugAgentInput, { bugCount: number }> = {
  id: 'BUG_ANALYSIS',
  name: 'Bug Agent',

  async run(ctx, input) {
    await ctx.emit({
      type: 'bugs.analyzing',
      phase: 'BUG_ANALYSIS',
      message: `Analyzing ${input.failures.length} failure(s)`,
    });

    const reports: Array<Record<string, unknown>> = [];

    for (const fail of input.failures) {
      let title = `Failed: ${fail.scenario}`;
      let description = fail.message;
      let rootCause = 'Observed failure during manual agent execution';
      let suggestedFix = 'Review steps, selectors, and application state after login';

      try {
        const llm = await ctx.llm.complete({
          system:
            'You are a QA bug analyst. Use ONLY the provided failure, scenario, and steps. Do not invent root causes or product behavior beyond the error text. Keep title ≤80 chars and description ≤240 chars. Return JSON only.',
          prompt: `Test: ${fail.externalId} ${fail.scenario}\nError: ${fail.message}\nSteps:\n${fail.steps.join('\n')}\n\nReturn JSON: { "title": string, "description": string, "rootCause": string, "suggestedFix": string, "severity": "low"|"medium"|"high"|"critical" }`,
          json: true,
          model: 'fast',
          temperature: 0.2,
          maxTokens: 500,
        });
        const parsed = JSON.parse(llm.text) as {
          title?: string;
          description?: string;
          rootCause?: string;
          suggestedFix?: string;
          severity?: string;
        };
        title = parsed.title || title;
        description = parsed.description || description;
        rootCause = parsed.rootCause || rootCause;
        suggestedFix = parsed.suggestedFix || suggestedFix;
      } catch {
        /* heuristic fields above */
      }

      const existing = await prisma.bug.findFirst({
        where: {
          executionId: ctx.executionId,
          testResultId: fail.testResultId,
        },
      });

      const payload = {
        title,
        severity: fail.severity ?? 'medium',
        description: `${description}\n\nRoot cause: ${rootCause}\nSuggested fix: ${suggestedFix}`,
        stepsToReproduce: fail.steps.join('\n'),
        evidenceKeys: fail.evidenceKeys as never,
      };

      if (existing) {
        await prisma.bug.update({
          where: { id: existing.id },
          data: payload,
        });
      } else {
        await prisma.bug.create({
          data: {
            projectId: input.projectId,
            executionId: ctx.executionId,
            testCaseId: fail.testCaseId,
            testResultId: fail.testResultId,
            ...payload,
          },
        });
      }

      reports.push({
        testCaseId: fail.externalId,
        title,
        rootCause,
        suggestedFix,
        evidenceKeys: fail.evidenceKeys,
      });
    }

    await ctx.putArtifactJson(ArtifactType.FAILURE_ANALYSIS, {
      summary: `${reports.length} bug report(s) filed`,
      failures: reports,
    });

    await ctx.emit({
      type: 'bugs.ready',
      phase: 'BUG_ANALYSIS',
      message: `Bug Agent filed ${reports.length} report(s)`,
      data: { bugCount: reports.length },
    });

    return { bugCount: reports.length };
  },
};
