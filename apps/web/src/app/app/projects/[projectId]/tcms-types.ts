import type { TestCaseRow } from './design-cases-panel';
import type { CycleCounts } from './tcms-cycle-chart';

export type ResultStatus = 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';

export const RUN_FILTER_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'CANCELLED',
] as const;

export const RESULT_FILTER_STATUSES = [
  'PASSED',
  'FAILED',
  'BLOCKED',
  'SKIPPED',
] as const;

export function runHasPending(counts?: CycleCounts | null) {
  if (!counts) return true;
  return counts.pending > 0;
}

export type { CycleCounts };

export type TcmsResult = {
  id: string;
  status: string;
  message?: string | null;
  evidenceKeys?: string[] | null;
  executedBy?: string | null;
  durationMs?: number | null;
};

export type TcmsRunCase = TestCaseRow & {
  result?: TcmsResult | null;
};

export type TcmsRunRow = {
  id: string;
  name?: string;
  status: string;
  runMode?: string;
  locked?: boolean;
  counts?: CycleCounts;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  description?: string | null;
  deletedAt?: string | null;
  errorSummary?: string | null;
  waitingForRunner?: boolean;
};

export type TcmsRunDetail = TcmsRunRow & {
  cases: TcmsRunCase[];
};

export function resultTone(status?: string | null) {
  if (status === 'PASSED') return 'success' as const;
  if (status === 'FAILED' || status === 'BLOCKED') return 'danger' as const;
  if (status === 'SKIPPED') return 'warning' as const;
  return 'default' as const;
}

export function runTone(status: string) {
  if (status === 'COMPLETED') return 'success' as const;
  if (status === 'CANCELLED' || status === 'FAILED') return 'danger' as const;
  if (status === 'RUNNING') return 'accent' as const;
  return 'default' as const;
}

export function isPendingCase(c: TcmsRunCase) {
  return !c.result?.status;
}

export function firstPendingId(cases: TcmsRunCase[]) {
  return cases.find((c) => isPendingCase(c))?.id ?? cases[0]?.id ?? null;
}

export function runHref(projectId: string, runId: string) {
  return `/app/projects/${projectId}/runs/${runId}`;
}

export function caseHref(projectId: string, runId: string, caseId: string) {
  return `/app/projects/${projectId}/runs/${runId}/cases/${caseId}`;
}
