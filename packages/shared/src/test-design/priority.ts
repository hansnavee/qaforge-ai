export const PRIORITY_LABELS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type PriorityLabel = (typeof PRIORITY_LABELS)[number];

export function normalizePriorityLabel(raw: unknown): PriorityLabel {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (
    s === 'HIGH' ||
    s === 'P0' ||
    s === 'CRITICAL' ||
    s === 'BLOCKER' ||
    s === 'H'
  ) {
    return 'HIGH';
  }
  if (s === 'LOW' || s === 'P2' || s === 'P3' || s === 'P4' || s === 'L') {
    return 'LOW';
  }
  return 'MEDIUM';
}

export function priorityRank(label: unknown): number {
  const n = normalizePriorityLabel(label);
  if (n === 'HIGH') return 0;
  if (n === 'MEDIUM') return 1;
  return 2;
}

/** Flatten across features: all HIGH, then MEDIUM, then LOW (stable by id). */
export function sortCasesByPriority<
  T extends {
    id?: string;
    externalId?: string | null;
    priorityLabel?: string | null;
    priority?: string | null;
  },
>(cases: T[]): T[] {
  return [...cases].sort((a, b) => {
    const ra = priorityRank(a.priorityLabel ?? a.priority);
    const rb = priorityRank(b.priorityLabel ?? b.priority);
    if (ra !== rb) return ra - rb;
    return String(a.externalId ?? a.id ?? '').localeCompare(
      String(b.externalId ?? b.id ?? ''),
    );
  });
}

export const RUN_KINDS = ['SPRINT', 'REGRESSION', 'SYSTEM'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export function suggestExecutionSelection<
  T extends {
    id: string;
    readyForExecution?: boolean | null;
    priorityLabel?: string | null;
    priority?: string | null;
    featureKey?: string | null;
    module?: string | null;
  },
>(
  cases: T[],
  opts: { runKind?: RunKind; featureKey?: string | null } = {},
): { testCaseIds: string[]; runKind: RunKind } {
  const runKind = opts.runKind ?? 'SPRINT';
  const ready = cases.filter((c) => c.readyForExecution);
  const scoped = opts.featureKey
    ? ready.filter((c) => {
        const key = c.featureKey?.trim() || c.module?.trim() || 'General';
        return key === opts.featureKey;
      })
    : ready;
  const picked =
    runKind === 'SPRINT' && !opts.featureKey
      ? scoped.filter(
          (c) => normalizePriorityLabel(c.priorityLabel ?? c.priority) === 'HIGH',
        )
      : scoped;
  const ordered = sortCasesByPriority(picked.length ? picked : scoped);
  return { testCaseIds: ordered.map((c) => c.id), runKind };
}
