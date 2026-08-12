import { classifyFailure, shouldHeal, type FailureClass } from './failure-class.js';

export type AgentSkill =
  | 'GENERATE'
  | 'PLAN'
  | 'RECORD'
  | 'REPLAY'
  | 'RETRY'
  | 'RULE_HEAL'
  | 'LLM_HEAL'
  | 'QUARANTINE'
  | 'DEFECT'
  | 'ESCALATE';

export type AgentDecision = {
  skill: AgentSkill;
  rationale: string[];
  failureClass?: FailureClass;
  escalateToHuman?: string;
  auto: boolean;
};

export type AgentRouteInput = {
  hasValidScript: boolean;
  stabilityStatus?: string | null;
  lastError?: string | null;
  retryCount?: number;
  healAttempts?: number;
  verifyPassed?: number;
  verifyTotal?: number;
  healRequiresReview?: boolean;
  llmHealRequiresApproval?: boolean;
  isP0?: boolean;
};

/**
 * Deterministic orchestrator — same judgment as a senior QA:
 * replay when healthy, retry flakes, heal locators, never heal assertions.
 */
export function routeQaAgent(input: AgentRouteInput): AgentDecision {
  const status = (input.stabilityStatus ?? 'STABLE').toUpperCase();
  if (status === 'QUARANTINED') {
    return {
      skill: 'ESCALATE',
      auto: false,
      rationale: [
        'Script is QUARANTINED — skip in bulk run.',
        'Human must clear quarantine or Re-record.',
      ],
      escalateToHuman: 'Clear quarantine or Re-record this case',
    };
  }

  if (!input.hasValidScript) {
    return {
      skill: 'RECORD',
      auto: true,
      rationale: [
        'No valid ActionLog — first-time automation.',
        'AI Executor will record locators (0 LLM).',
      ],
    };
  }

  if (!input.lastError) {
    return {
      skill: 'REPLAY',
      auto: true,
      rationale: ['Valid script and no failure — daily regression replay (0 LLM).'],
    };
  }

  const failureClass = classifyFailure(input.lastError);
  const retries = input.retryCount ?? 0;

  if (retries < 1 && (failureClass === 'TIMEOUT' || failureClass === 'INFRA')) {
    return {
      skill: 'RETRY',
      failureClass,
      auto: true,
      rationale: [
        `Classified as ${failureClass}.`,
        'Retry once before healing — likely transient.',
      ],
    };
  }

  if (failureClass === 'ASSERTION') {
    return {
      skill: 'DEFECT',
      failureClass,
      auto: false,
      rationale: [
        'Assertion / business-rule mismatch — this is a product defect, not a locator.',
        'Do not heal. Human should log a bug.',
      ],
      escalateToHuman: 'Log defect from failed result',
    };
  }

  if (!shouldHeal(failureClass)) {
    return {
      skill: 'ESCALATE',
      failureClass,
      auto: false,
      rationale: [`Unknown failure class (${failureClass}) — escalate rather than guess.`],
      escalateToHuman: 'Review failure and choose Re-record or defect',
    };
  }

  const heals = input.healAttempts ?? 0;
  if (heals >= 2) {
    return {
      skill: 'QUARANTINE',
      failureClass,
      auto: true,
      rationale: [
        'Two heal cycles already failed.',
        'Quarantine so the suite stays green; human must Re-record or fix the app.',
      ],
      escalateToHuman: 'Re-record or fix application, then clear quarantine',
    };
  }

  if (heals === 0) {
    return {
      skill: 'RULE_HEAL',
      failureClass,
      auto: true,
      rationale: [
        `Locator/timing failure (${failureClass}).`,
        'Apply rule healer (timeout bump, waitFor, SauceDemo selectors) then 3× verify.',
      ],
    };
  }

  if (input.llmHealRequiresApproval !== false) {
    return {
      skill: 'LLM_HEAL',
      failureClass,
      auto: false,
      rationale: [
        'Rule healer did not verify 3/3.',
        'LLM patch requires human approval before commit.',
      ],
      escalateToHuman: 'Approve or reject LLM heal proposal',
    };
  }

  return {
    skill: 'LLM_HEAL',
    failureClass,
    auto: true,
    rationale: ['Rule healer failed verify — escalate to LLM Healer (policy allows auto).'],
  };
}
