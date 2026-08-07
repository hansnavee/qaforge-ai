import type { AgentHandler } from '@qaforge/agent-sdk';
import type { BrowserSessionManager } from '@qaforge/browser-session';
import { ArtifactType } from '@qaforge/shared';

type A11yInput = {
  browserManager: BrowserSessionManager;
  sessionId: string;
};

export const accessibilityAgent: AgentHandler<A11yInput, unknown> = {
  id: 'ACCESSIBILITY',
  name: 'Accessibility Agent',

  async run(ctx, input) {
    const page = await input.browserManager.getPage(input.sessionId);
    let axeResults: unknown = null;

    try {
      await page.addScriptTag({
        url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js',
      });
      axeResults = await page.evaluate(async () => {
        const axe = (window as unknown as { axe?: { run: () => Promise<unknown> } })
          .axe;
        if (!axe) return null;
        return axe.run();
      });
    } catch {
      /* CDN may be blocked — fall through to heuristics */
    }

    const heuristic = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      const missingAlt = images.filter((img) => !img.getAttribute('alt')).length;

      const inputs = Array.from(
        document.querySelectorAll('input, select, textarea'),
      );
      const unlabeled = inputs.filter((el) => {
        const id = el.id;
        const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
        if (aria) return false;
        if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) return false;
        if (el.closest('label')) return false;
        return true;
      }).length;

      // Simple contrast heuristic: light text on light bg via inline styles
      let contrastFlags = 0;
      document.querySelectorAll('*').forEach((el) => {
        const style = window.getComputedStyle(el);
        const color = style.color;
        const bg = style.backgroundColor;
        if (
          color.includes('255, 255, 255') &&
          (bg.includes('255, 255, 255') || bg === 'rgba(0, 0, 0, 0)')
        ) {
          contrastFlags += 1;
        }
      });

      const issues = [
        ...(missingAlt
          ? [
              {
                id: 'img-alt',
                severity: 'serious',
                title: 'Images missing alt text',
                count: missingAlt,
              },
            ]
          : []),
        ...(unlabeled
          ? [
              {
                id: 'form-label',
                severity: 'serious',
                title: 'Form controls without accessible name',
                count: unlabeled,
              },
            ]
          : []),
        ...(contrastFlags > 5
          ? [
              {
                id: 'contrast',
                severity: 'moderate',
                title: 'Potential low-contrast text',
                count: contrastFlags,
              },
            ]
          : []),
      ];

      const penalty = missingAlt * 8 + unlabeled * 6 + Math.min(contrastFlags, 10);
      const score = Math.max(0, Math.min(100, 100 - penalty));

      return { issues, score, missingAlt, unlabeled, contrastFlags };
    });

    const axeViolations =
      axeResults &&
      typeof axeResults === 'object' &&
      'violations' in axeResults
        ? (axeResults as { violations: unknown[] }).violations
        : [];

    const score =
      axeViolations.length > 0
        ? Math.max(0, 100 - axeViolations.length * 10)
        : heuristic.score;

    const report = {
      score,
      source: axeViolations.length ? 'axe-core' : 'heuristic',
      issues: heuristic.issues,
      axeViolationCount: Array.isArray(axeViolations) ? axeViolations.length : 0,
      axeViolations: Array.isArray(axeViolations)
        ? axeViolations.slice(0, 25)
        : [],
    };

    await ctx.putArtifactJson(ArtifactType.ACCESSIBILITY_REPORT, report);
    await ctx.emit({
      type: 'accessibility.ready',
      phase: 'ACCESSIBILITY',
      message: `Accessibility score ${score}`,
      data: { score },
    });
    return report;
  },
};
