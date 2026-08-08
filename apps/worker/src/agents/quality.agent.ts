import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';
import { prisma } from '@qaforge/database';

export const qualityAgent: AgentHandler<
  { projectName: string; appUrl: string },
  unknown
> = {
  id: 'QUALITY_ANALYSIS',
  name: 'Quality Analysis Agent',

  async run(ctx, input) {
    await ctx.emit({
      type: 'quality.analyzing',
      phase: 'QUALITY_ANALYSIS',
      message: 'Aggregating UX, API, coverage, and risk signals',
    });

    const [
      functional,
      ux,
      api,
      a11y,
      perf,
      strategy,
      design,
      failures,
      results,
      bugs,
    ] = await Promise.all([
      ctx.getArtifactJson(ArtifactType.FUNCTIONAL_FINDINGS),
      ctx.getArtifactJson(ArtifactType.UX_FINDINGS),
      ctx.getArtifactJson(ArtifactType.API_RESULTS),
      ctx.getArtifactJson(ArtifactType.ACCESSIBILITY_REPORT),
      ctx.getArtifactJson(ArtifactType.PERFORMANCE_METRICS),
      ctx.getArtifactJson(ArtifactType.TEST_STRATEGY_JSON),
      ctx.getArtifactJson(ArtifactType.TEST_DESIGN_JSON),
      ctx.getArtifactJson(ArtifactType.FAILURE_ANALYSIS),
      prisma.testResult.findMany({ where: { executionId: ctx.executionId } }),
      prisma.bug.findMany({ where: { executionId: ctx.executionId } }),
    ]);

    const passed = results.filter((r) => r.status === 'PASSED').length;
    const failed = results.filter((r) => r.status === 'FAILED').length;
    const total = results.length || 1;
    const passRate = Math.round((passed / total) * 100);

    const quality = {
      projectName: input.projectName,
      appUrl: input.appUrl,
      passRate,
      counts: { passed, failed, total, bugs: bugs.length },
      dimensions: {
        functional: functional ?? null,
        ux: ux ?? null,
        api: api ?? null,
        accessibility: a11y ?? null,
        performance: perf ?? null,
      },
      strategySummary:
        strategy && typeof strategy === 'object' && 'summary' in strategy
          ? (strategy as { summary?: string }).summary
          : null,
      designedCaseCount:
        design &&
        typeof design === 'object' &&
        'testCases' in design &&
        Array.isArray((design as { testCases: unknown[] }).testCases)
          ? (design as { testCases: unknown[] }).testCases.length
          : 0,
      riskSummary:
        failed > 0
          ? `${failed} failing scenario(s); ${bugs.length} bug(s) open for triage`
          : 'No open failures after STLC execution/retest',
      failureAnalysis: failures ?? null,
      recommendations: [
        failed > 0
          ? 'Prioritize fixing P0/P1 failures before expanding automation'
          : 'Promote stable cases into the automation suite',
        'Keep clarification answers linked to requirement snapshots',
        'Re-run STLC after major auth or navigation changes',
      ],
      source: 'quality-analysis-agent',
    };

    await ctx.putArtifactJson(ArtifactType.QUALITY_ANALYSIS_JSON, quality);
    await ctx.emit({
      type: 'quality.ready',
      phase: 'QUALITY_ANALYSIS',
      message: `Quality analysis complete — pass rate ${passRate}%`,
      data: { passRate, bugs: bugs.length },
    });
    return quality;
  },
};
