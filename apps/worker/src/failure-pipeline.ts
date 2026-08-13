import {
  applyRuleHeal,
  classifyAiFailureMessage,
  classifyFailure,
  routeQaAgent,
  specFromActionLog,
  type ActionEntry,
  type AgentDecision,
} from '@qaforge/shared';
import { replayActionLog } from './replay-action-log.js';

export type ReplayEnv = {
  appUrl: string;
  loginUrl?: string | null;
  username?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  postalCode?: string;
};

export type FailurePipelineResult = {
  status: 'PASSED' | 'FAILED';
  message: string;
  actions: ActionEntry[];
  patchedActions?: ActionEntry[];
  decision: AgentDecision;
  committedHeal: boolean;
  pendingReview: boolean;
  quarantined: boolean;
  verificationRuns: boolean[];
  appliedRules: string[];
};

const VERIFY_N = 3;

async function tryReplay(
  page: import('playwright').Page,
  actions: ActionEntry[],
  env: ReplayEnv,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await replayActionLog(page, actions, env);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Daily replay failure handling:
 * retry → classify → rule heal + 3× verify → quarantine / human gate.
 * LLM healer is not auto-applied (requires approval).
 */
export async function runFailurePipeline(opts: {
  page: import('playwright').Page;
  actions: ActionEntry[];
  env: ReplayEnv;
  startUrl: string;
  healAttempts: number;
  stabilityStatus?: string | null;
  healRequiresReview: boolean;
  llmHealRequiresApproval: boolean;
  isP0?: boolean;
  gotoStart: () => Promise<void>;
}): Promise<FailurePipelineResult> {
  const baseDecision = routeQaAgent({
    hasValidScript: opts.actions.length > 0,
    stabilityStatus: opts.stabilityStatus,
    healAttempts: opts.healAttempts,
    healRequiresReview: opts.healRequiresReview,
    llmHealRequiresApproval: opts.llmHealRequiresApproval,
    isP0: opts.isP0,
  });

  if (baseDecision.skill === 'ESCALATE' && opts.stabilityStatus === 'QUARANTINED') {
    return {
      status: 'FAILED',
      message: 'Skipped: script is quarantined',
      actions: opts.actions,
      decision: baseDecision,
      committedHeal: false,
      pendingReview: false,
      quarantined: true,
      verificationRuns: [],
      appliedRules: [],
    };
  }

  await opts.gotoStart();
  let attempt = await tryReplay(opts.page, opts.actions, opts.env);
  if (attempt.ok) {
    return {
      status: 'PASSED',
      message: 'Script replay: ActionLog completed (0 LLM)',
      actions: opts.actions,
      decision: {
        skill: 'REPLAY',
        auto: true,
        rationale: ['Replay passed on first attempt.'],
      },
      committedHeal: false,
      pendingReview: false,
      quarantined: false,
      verificationRuns: [],
      appliedRules: [],
    };
  }

  const failureClass = classifyFailure(attempt.error);
  let decision = routeQaAgent({
    hasValidScript: true,
    lastError: attempt.error,
    retryCount: 0,
    healAttempts: opts.healAttempts,
    healRequiresReview: opts.healRequiresReview,
    llmHealRequiresApproval: opts.llmHealRequiresApproval,
    isP0: opts.isP0,
  });

  if (decision.skill === 'RETRY') {
    await opts.gotoStart();
    attempt = await tryReplay(opts.page, opts.actions, opts.env);
    if (attempt.ok) {
      return {
        status: 'PASSED',
        message: 'Replay passed after retry (transient flake)',
        actions: opts.actions,
        decision: {
          skill: 'RETRY',
          failureClass,
          auto: true,
          rationale: ['First attempt failed; retry recovered without heal.'],
        },
        committedHeal: false,
        pendingReview: false,
        quarantined: false,
        verificationRuns: [],
        appliedRules: [],
      };
    }
    decision = routeQaAgent({
      hasValidScript: true,
      lastError: attempt.error,
      retryCount: 1,
      healAttempts: opts.healAttempts,
      healRequiresReview: opts.healRequiresReview,
      llmHealRequiresApproval: opts.llmHealRequiresApproval,
      isP0: opts.isP0,
    });
  }

  if (decision.skill === 'DEFECT' || decision.skill === 'ESCALATE') {
    return {
      status: 'FAILED',
      message: attempt.error ?? 'Replay failed',
      actions: opts.actions,
      decision,
      committedHeal: false,
      pendingReview: false,
      quarantined: false,
      verificationRuns: [],
      appliedRules: [],
    };
  }

  if (decision.skill === 'QUARANTINE') {
    return {
      status: 'FAILED',
      message: attempt.error ?? 'Quarantined after failed heals',
      actions: opts.actions,
      decision,
      committedHeal: false,
      pendingReview: false,
      quarantined: true,
      verificationRuns: [],
      appliedRules: [],
    };
  }

  if (decision.skill === 'RULE_HEAL') {
    const { patched, applied } = applyRuleHeal(opts.actions, attempt.error);
    const verificationRuns: boolean[] = [];
    for (let i = 0; i < VERIFY_N; i += 1) {
      await opts.gotoStart();
      const v = await tryReplay(opts.page, patched, opts.env);
      verificationRuns.push(v.ok);
    }
    const allPass = verificationRuns.every(Boolean);
    if (!allPass) {
      const after = routeQaAgent({
        hasValidScript: true,
        lastError: attempt.error,
        retryCount: 1,
        healAttempts: (opts.healAttempts ?? 0) + 1,
        llmHealRequiresApproval: opts.llmHealRequiresApproval,
      });
      return {
        status: 'FAILED',
        message: classifyAiFailureMessage(
          `Rule heal verify ${verificationRuns.filter(Boolean).length}/${VERIFY_N} — not committed`,
        ),
        actions: opts.actions,
        patchedActions: patched,
        decision: after.skill === 'LLM_HEAL' ? after : decision,
        committedHeal: false,
        pendingReview: false,
        quarantined: after.skill === 'QUARANTINE',
        verificationRuns,
        appliedRules: applied,
      };
    }

    const needsReview = opts.healRequiresReview || Boolean(opts.isP0);
    return {
      status: needsReview ? 'FAILED' : 'PASSED',
      message: needsReview
        ? `Rule heal 3/${VERIFY_N} verified — awaiting human approve`
        : `Rule heal committed after 3/${VERIFY_N} verify (${applied.join(', ')})`,
      actions: needsReview ? opts.actions : patched,
      patchedActions: patched,
      decision: {
        ...decision,
        rationale: [
          ...decision.rationale,
          `Verify ${VERIFY_N}/${VERIFY_N} passed.`,
          needsReview
            ? 'healRequiresReview / P0 — waiting for human approve.'
            : 'Auto-committed rule patch.',
        ],
        escalateToHuman: needsReview ? 'Approve heal patch' : undefined,
        auto: !needsReview,
      },
      committedHeal: !needsReview,
      pendingReview: needsReview,
      quarantined: false,
      verificationRuns,
      appliedRules: applied,
    };
  }

  return {
    status: 'FAILED',
    message: classifyAiFailureMessage(attempt.error ?? 'Replay failed'),
    actions: opts.actions,
    decision,
    committedHeal: false,
    pendingReview: decision.skill === 'LLM_HEAL' && !decision.auto,
    quarantined: false,
    verificationRuns: [],
    appliedRules: [],
  };
}

export function specFromPipeline(
  externalId: string,
  scenario: string,
  expected: string,
  actions: ActionEntry[],
  appUrl: string,
) {
  return specFromActionLog({
    externalId,
    scenario,
    expected,
    actions,
    fallbackAppUrl: appUrl,
  });
}
