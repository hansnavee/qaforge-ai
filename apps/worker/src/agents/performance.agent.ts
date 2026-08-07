import type { AgentHandler } from '@qaforge/agent-sdk';
import type { BrowserSessionManager } from '@qaforge/browser-session';
import { ArtifactType } from '@qaforge/shared';

type PerfInput = {
  browserManager: BrowserSessionManager;
  sessionId: string;
  appUrl: string;
};

export const performanceAgent: AgentHandler<PerfInput, unknown> = {
  id: 'PERFORMANCE',
  name: 'Performance Agent',

  async run(ctx, input) {
    const page = await input.browserManager.getPage(input.sessionId);

    try {
      await page.goto(input.appUrl, {
        waitUntil: 'load',
        timeout: 30000,
      });
    } catch {
      /* continue with whatever is loaded */
    }

    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType(
        'navigation',
      )[0] as PerformanceNavigationTiming | undefined;
      const timing = performance.timing;
      const paint = performance.getEntriesByType('paint');

      const loadTime = nav
        ? nav.loadEventEnd - nav.startTime
        : timing.loadEventEnd - timing.navigationStart;

      const ttfb = nav
        ? nav.responseStart - nav.requestStart
        : timing.responseStart - timing.requestStart;

      const domContentLoaded = nav
        ? nav.domContentLoadedEventEnd - nav.startTime
        : timing.domContentLoadedEventEnd - timing.navigationStart;

      return {
        loadTime,
        ttfb,
        domContentLoaded,
        transferSize: nav?.transferSize ?? null,
        paint: paint.map((p) => ({ name: p.name, startTime: p.startTime })),
      };
    });

    const load = metrics.loadTime || 0;
    let score = 100;
    if (load > 1000) score -= 10;
    if (load > 2500) score -= 20;
    if (load > 4000) score -= 25;
    if (load > 6000) score -= 25;
    if ((metrics.ttfb || 0) > 800) score -= 10;
    score = Math.max(0, Math.min(100, score));

    const report = {
      score,
      metrics,
      recommendations:
        score < 80
          ? [
              'Optimize critical rendering path and compress assets',
              'Reduce TTFB with caching / edge delivery',
            ]
          : ['Load time within acceptable range for smoke check'],
    };

    await ctx.putArtifactJson(ArtifactType.PERFORMANCE_METRICS, report);
    await ctx.emit({
      type: 'performance.ready',
      phase: 'PERFORMANCE',
      message: `Performance score ${score} (load ${Math.round(load)}ms)`,
      data: { score, loadTime: load },
    });
    return report;
  },
};
