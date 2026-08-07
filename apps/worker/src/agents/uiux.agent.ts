import type { AgentHandler } from '@qaforge/agent-sdk';
import type { BrowserSessionManager } from '@qaforge/browser-session';
import { ArtifactType } from '@qaforge/shared';

type UiuxInput = {
  browserManager: BrowserSessionManager;
  sessionId: string;
};

export const uiuxAgent: AgentHandler<UiuxInput, unknown> = {
  id: 'UI_UX_REVIEW',
  name: 'UI/UX Agent',

  async run(ctx, input) {
    const page = await input.browserManager.getPage(input.sessionId);

    const heuristics = await page.evaluate(() => {
      const findings: Array<{
        severity: string;
        title: string;
        description: string;
        recommendation: string;
      }> = [];

      // Buttons without accessible name
      const buttons = Array.from(
        document.querySelectorAll('button, [role="button"], a.btn'),
      );
      const unnamed = buttons.filter((el) => {
        const text = (el.textContent || '').trim();
        const aria = el.getAttribute('aria-label') || el.getAttribute('title');
        return !text && !aria;
      });
      if (unnamed.length) {
        findings.push({
          severity: 'medium',
          title: 'Buttons without accessible name',
          description: `${unnamed.length} interactive controls lack visible or ARIA labels.`,
          recommendation: 'Add visible text or aria-label to every control.',
        });
      }

      // Tiny touch targets (< 24x24)
      let tiny = 0;
      buttons.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)) {
          tiny += 1;
        }
      });
      if (tiny) {
        findings.push({
          severity: 'low',
          title: 'Small touch targets',
          description: `${tiny} controls are smaller than 24×24 CSS pixels.`,
          recommendation: 'Increase tap target size to at least 44×44 where possible.',
        });
      }

      // Low-contrast placeholder-only forms
      const placeholdersOnly = Array.from(
        document.querySelectorAll('input[placeholder]'),
      ).filter((el) => {
        const id = el.id;
        const hasLabel =
          (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
          el.getAttribute('aria-label');
        return !hasLabel;
      }).length;
      if (placeholdersOnly) {
        findings.push({
          severity: 'medium',
          title: 'Placeholder used as label',
          description: `${placeholdersOnly} inputs rely on placeholder without a label.`,
          recommendation: 'Use persistent labels; placeholders are hints only.',
        });
      }

      const score = Math.max(0, 100 - findings.length * 12 - unnamed.length * 2);
      return { findings, score };
    });

    const report = {
      score: heuristics.score,
      findings: heuristics.findings,
    };

    await ctx.putArtifactJson(ArtifactType.UX_FINDINGS, report);
    await ctx.emit({
      type: 'uiux.ready',
      phase: 'UI_UX',
      message: `UI/UX score ${heuristics.score}`,
      data: { score: heuristics.score },
    });
    return report;
  },
};
