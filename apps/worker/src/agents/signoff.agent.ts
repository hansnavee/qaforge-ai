import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';

export type ExitCriteriaRow = {
  id: string;
  criterion: string;
  met: boolean;
  evidence: string;
  waiverAllowed: boolean;
};

export type SignoffDocument = {
  recommendation: 'READY' | 'NOT_READY';
  scorecard: ExitCriteriaRow[];
  summary: string;
  risks: string[];
  notes: string;
  validation: {
    passed: boolean;
    blockers: string[];
    summary: string;
  };
};

type SignoffInput = {
  strategy?: unknown;
  scores?: {
    functionalScore?: number | null;
    passed?: number | null;
    failed?: number | null;
    bugsOpen?: number | null;
  } | null;
  bugCount?: number;
  failedCount?: number;
  passedCount?: number;
  reportReady?: boolean;
};

export const signoffAgent: AgentHandler<SignoffInput, SignoffDocument> = {
  id: 'QA_SIGNOFF',
  name: 'AI Sign-off Agent',

  async run(ctx, input) {
    await ctx.emit({
      type: 'signoff.evaluating',
      phase: 'REPORT',
      message:
        'Senior QA evaluating exit criteria for go/no-go recommendation',
    });

    const strategy =
      input.strategy ??
      (await ctx.getArtifactJson(ArtifactType.TEST_STRATEGY_JSON));
    const scores = input.scores ?? {};
    const passedCount = input.passedCount ?? scores.passed ?? 0;
    const failedCount = input.failedCount ?? scores.failed ?? 0;
    const bugCount = input.bugCount ?? scores.bugsOpen ?? 0;
    const functional =
      typeof scores.functionalScore === 'number' ? scores.functionalScore : null;

    const strategyObj =
      strategy && typeof strategy === 'object'
        ? (strategy as Record<string, unknown>)
        : {};
    const exitFromStrategy = Array.isArray(strategyObj.exitCriteria)
      ? (strategyObj.exitCriteria as unknown[])
      : [];

    const scorecard: ExitCriteriaRow[] = [];

    if (exitFromStrategy.length) {
      for (let i = 0; i < exitFromStrategy.length; i++) {
        const raw = exitFromStrategy[i];
        const text =
          typeof raw === 'string'
            ? raw
            : typeof raw === 'object' && raw && 'criterion' in raw
              ? String((raw as { criterion: unknown }).criterion)
              : String(raw);
        scorecard.push({
          id: `exit-${i + 1}`,
          criterion: text,
          met: failedCount === 0 || functional === null || functional >= 70,
          evidence: `Pass=${passedCount}, Fail=${failedCount}, Bugs=${bugCount}`,
          waiverAllowed: true,
        });
      }
    } else {
      scorecard.push(
        {
          id: 'no-blocking-fails',
          criterion: 'No unresolved critical test failures',
          met: failedCount === 0,
          evidence: `${failedCount} failed case(s)`,
          waiverAllowed: true,
        },
        {
          id: 'bugs-triaged',
          criterion: 'Defects logged and reviewed for failed cases',
          met: failedCount === 0 || bugCount > 0,
          evidence: `${bugCount} bug(s) recorded`,
          waiverAllowed: true,
        },
        {
          id: 'report-ready',
          criterion: 'Test report package available',
          met: Boolean(input.reportReady),
          evidence: input.reportReady ? 'Report artifacts present' : 'Report missing',
          waiverAllowed: false,
        },
        {
          id: 'functional-score',
          criterion: 'Functional score meets threshold (≥70) or N/A',
          met: functional === null || functional >= 70,
          evidence:
            functional === null ? 'Score not computed' : `Score=${functional}`,
          waiverAllowed: true,
        },
      );
    }

    const unmet = scorecard.filter((r) => !r.met);
    const blockers = unmet
      .filter((r) => !r.waiverAllowed)
      .map((r) => r.criterion);
    const softGaps = unmet.filter((r) => r.waiverAllowed).map((r) => r.criterion);
    const recommendation =
      blockers.length === 0 && unmet.length <= 1 ? 'READY' : 'NOT_READY';

    const validation = {
      passed: recommendation === 'READY',
      blockers: unmet.map((r) => r.criterion),
      summary:
        recommendation === 'READY'
          ? 'Exit criteria largely met — recommend QA sign-off (human must Accept)'
          : `Not ready for sign-off: ${unmet.map((r) => r.criterion).join('; ')}`,
    };

    const document: SignoffDocument = {
      recommendation,
      scorecard,
      summary: validation.summary,
      risks: softGaps,
      notes:
        'AI recommends only. Human QA lead must Accept to close STLC.',
      validation,
    };

    await ctx.putArtifactJson(ArtifactType.SIGNOFF_JSON, document);
    await ctx.emit({
      type: 'signoff.ready',
      phase: 'REPORT',
      message: validation.summary,
      data: { recommendation, unmet: unmet.length },
    });

    return document;
  },
};
