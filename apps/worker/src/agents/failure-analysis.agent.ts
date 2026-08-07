import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';

export const failureAnalysisAgent: AgentHandler = {
  id: 'FAILURE_ANALYSIS',
  name: 'Failure Analysis Agent',

  async run(ctx) {
    const execution = await ctx.getArtifactJson<{
      playwright?: { attempted?: boolean; exitCode?: number | null; summary?: string };
      failed?: boolean;
      passed?: boolean;
    }>(ArtifactType.EXECUTION_RESULTS);
    const functional = await ctx.getArtifactJson(ArtifactType.FUNCTIONAL_FINDINGS);
    const a11y = await ctx.getArtifactJson(ArtifactType.ACCESSIBILITY_REPORT);
    const security = await ctx.getArtifactJson(ArtifactType.SECURITY_CHECKLIST);

    let analysis: unknown;
    try {
      const llm = await ctx.llm.complete({
        system:
          'You are a senior QA failure analyst. Produce root-cause analysis as JSON.',
        prompt: `Execution: ${JSON.stringify(execution)}\nFunctional: ${JSON.stringify(functional)?.slice(0, 3000)}\nA11y: ${JSON.stringify(a11y)?.slice(0, 2000)}\nSecurity: ${JSON.stringify(security)?.slice(0, 2000)}\n\nReturn JSON: { failures: [{ id, title, severity, rootCause, evidence, suggestedFix }], summary: string }`,
        json: true,
        model: 'reasoning',
      });
      analysis = JSON.parse(llm.text);
    } catch {
      const failures = [];
      if (execution?.failed || (execution?.playwright?.attempted && execution.playwright.exitCode !== 0)) {
        failures.push({
          id: 'FAIL-001',
          title: 'Automated smoke run did not pass',
          severity: 'high',
          rootCause: execution?.playwright?.summary ?? 'Playwright exit non-zero',
          evidence: 'execution-results.json',
          suggestedFix: 'Inspect Playwright report, stabilize selectors, retry flaky steps.',
        });
      }
      analysis = {
        failures,
        summary:
          failures.length === 0
            ? 'No hard failures detected in smoke execution; review medium findings in other agents.'
            : `${failures.length} failure(s) analyzed.`,
      };
    }

    await ctx.putArtifactJson(ArtifactType.FAILURE_ANALYSIS, analysis);
    await ctx.emit({
      type: 'failure_analysis.ready',
      phase: 'FAILURE_ANALYSIS',
      message: 'Failure analysis complete',
    });
    return analysis;
  },
};
