import { normalizePriorityLabel, sortCasesByPriority } from './priority.js';

export const CASE_STATUSES = ['DRAFT', 'APPROVED', 'READY'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export function normalizeCaseStatus(
  raw?: string | null,
  readyForExecution?: boolean | null,
): CaseStatus {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (s === 'APPROVED') return 'APPROVED';
  if (s === 'READY' || readyForExecution) return 'READY';
  return 'DRAFT';
}

export function readyFromCaseStatus(status: CaseStatus): boolean {
  return status === 'READY';
}

export function featureFolderKey(c: {
  featureKey?: string | null;
  module?: string | null;
}): string {
  return c.featureKey?.trim() || c.module?.trim() || 'General';
}

export function featureFolderTitle(c: {
  featureName?: string | null;
  module?: string | null;
  featureKey?: string | null;
}): string {
  return (
    c.featureName?.trim() ||
    c.module?.trim() ||
    c.featureKey?.trim() ||
    'General'
  );
}

export type GroupableCase = {
  id: string;
  externalId?: string | null;
  folderId?: string | null;
  folderName?: string | null;
  parentFolderId?: string | null;
  featureKey?: string | null;
  featureName?: string | null;
  module?: string | null;
  requirementKey?: string | null;
  requirementTitle?: string | null;
  priorityLabel?: string | null;
  priority?: string | null;
  caseStatus?: string | null;
  readyForExecution?: boolean | null;
};

export type TcmsFolderRecord = {
  id: string;
  parentId?: string | null;
  name: string;
  featureKey?: string | null;
  requirementKey?: string | null;
  sortOrder?: number | null;
};

export const UNGROUPED_FOLDER_KEY = '__ungrouped__';

export type CaseSection<T> = {
  key: string;
  title: string;
  cases: T[];
};

export type CaseFolder<T> = {
  key: string;
  title: string;
  sections: CaseSection<T>[];
  cases: T[];
};

export function groupCasesIntoFolders<T extends GroupableCase>(
  cases: T[],
): CaseFolder<T>[] {
  const byFeature = new Map<string, T[]>();
  const titles = new Map<string, string>();
  for (const c of cases) {
    const key = featureFolderKey(c);
    if (!byFeature.has(key)) byFeature.set(key, []);
    byFeature.get(key)!.push(c);
    if (!titles.has(key)) titles.set(key, featureFolderTitle(c));
  }

  const folders: CaseFolder<T>[] = [];
  for (const [key, rows] of byFeature.entries()) {
    const sorted = sortCasesByPriority(rows);
    const reqKeys = [
      ...new Set(
        sorted
          .map((c) => c.requirementKey?.trim())
          .filter((k): k is string => Boolean(k)),
      ),
    ];
    const useSections = reqKeys.length >= 2;
    const sections: CaseSection<T>[] = useSections
      ? reqKeys.map((rk) => {
          const inReq = sorted.filter((c) => c.requirementKey?.trim() === rk);
          const title =
            inReq.find((c) => c.requirementTitle?.trim())?.requirementTitle?.trim() ||
            rk;
          return { key: rk, title, cases: inReq };
        })
      : [{ key: '', title: '', cases: sorted }];
    folders.push({
      key,
      title: titles.get(key) || key,
      sections,
      cases: sorted,
    });
  }

  return folders.sort((a, b) => {
    if (a.key === 'General') return 1;
    if (b.key === 'General') return -1;
    return a.title.localeCompare(b.title);
  });
}

export function buildTcmsTree<T extends GroupableCase>(
  folders: TcmsFolderRecord[],
  cases: T[],
): CaseFolder<T>[] {
  if (!folders.length) return groupCasesIntoFolders(cases);

  const known = new Set(folders.map((f) => f.id));
  const childrenOf = (parentId: string | null) =>
    folders
      .filter((f) => (f.parentId ?? null) === parentId)
      .sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
          a.name.localeCompare(b.name),
      );

  const casesIn = (folderId: string) =>
    sortCasesByPriority(cases.filter((c) => c.folderId === folderId));

  const tree: CaseFolder<T>[] = [];
  for (const top of childrenOf(null)) {
    const subs = childrenOf(top.id);
    const direct = casesIn(top.id);
    const nested = sortCasesByPriority(
      subs.flatMap((s) => casesIn(s.id)),
    );
    const all = sortCasesByPriority([...direct, ...nested]);
    const sections: CaseSection<T>[] = subs.length
      ? subs.map((s) => ({
          key: s.id,
          title: s.name,
          cases: casesIn(s.id),
        }))
      : [{ key: '', title: '', cases: all }];
    tree.push({
      key: top.id,
      title: top.name,
      sections,
      cases: all,
    });
  }

  const ungrouped = sortCasesByPriority(
    cases.filter((c) => !c.folderId || !known.has(c.folderId)),
  );
  if (ungrouped.length) {
    tree.push({
      key: UNGROUPED_FOLDER_KEY,
      title: 'Ungrouped',
      sections: [{ key: '', title: '', cases: ungrouped }],
      cases: ungrouped,
    });
  }
  return tree;
}

export function cycleResultCounts(
  rows: Array<{
    result?: { status?: string | null } | null;
    status?: string | null;
  }>,
) {
  let passed = 0;
  let failed = 0;
  let blocked = 0;
  let skipped = 0;
  let pending = 0;
  for (const row of rows) {
    const s = String(row.result?.status ?? row.status ?? '')
      .trim()
      .toUpperCase();
    if (s === 'PASSED') passed += 1;
    else if (s === 'FAILED' || s === 'ERROR') failed += 1;
    else if (s === 'BLOCKED') blocked += 1;
    else if (s === 'SKIPPED') skipped += 1;
    else pending += 1;
  }
  const total = rows.length;
  return {
    passed,
    failed,
    blocked,
    skipped,
    pending,
    total,
    done: total - pending,
  };
}

export function statusCounts(cases: GroupableCase[]) {
  let draft = 0;
  let approved = 0;
  let ready = 0;
  for (const c of cases) {
    const s = normalizeCaseStatus(c.caseStatus, c.readyForExecution);
    if (s === 'READY') ready += 1;
    else if (s === 'APPROVED') approved += 1;
    else draft += 1;
  }
  return { draft, approved, ready, total: cases.length };
}

export function priorityFromLabel(label: string): string {
  const n = normalizePriorityLabel(label);
  if (n === 'HIGH') return 'P0';
  if (n === 'LOW') return 'P2';
  return 'P1';
}
