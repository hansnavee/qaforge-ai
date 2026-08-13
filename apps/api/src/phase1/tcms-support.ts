import { prisma } from '@qaforge/database';
import { cycleResultCounts, normalizeCaseStatus } from '@qaforge/shared';
import type { TcrBug, TcrCycle, TcrReport } from '@qaforge/report-engine';

export type TcmsSelection = {
  name?: string;
  description?: string | null;
  testCaseIds?: string[];
  folderIds?: string[];
  runKind?: string;
  /** RECORD | REPLAY — overrides ActionLog auto-replay when set */
  executeMode?: 'RECORD' | 'REPLAY';
  browserMode?: string;
  browser?: string;
  featureKey?: string | null;
  folderId?: string | null;
  runnerTarget?: 'LOCAL' | 'CLOUD' | 'SERVER';
  runnerUserId?: string;
  localQueuedAt?: string;
  claimedByRunnerId?: string | null;
  /// Subset to run now; roster stays in testCaseIds.
  aiExecuteCaseIds?: string[] | null;
  /// AES blob with { username, password, appUrl, loginUrl } — strip before API responses.
  localCreds?: string;
};

export function publicSelection(selection: TcmsSelection): TcmsSelection {
  const { localCreds: _creds, ...rest } = selection;
  return rest;
}

export function isWaitingLocalRunner(selection: TcmsSelection, status: string) {
  return (
    status === 'PENDING' &&
    selection.runnerTarget === 'LOCAL' &&
    !selection.claimedByRunnerId
  );
}

export function descendantFolderIds(
  folders: Array<{ id: string; parentId: string | null }>,
  roots: string[],
): string[] {
  const byParent = new Map<string, string[]>();
  for (const folder of folders) {
    const parent = folder.parentId ?? '';
    const list = byParent.get(parent) ?? [];
    list.push(folder.id);
    byParent.set(parent, list);
  }
  const out = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop();
    if (!id || out.has(id)) continue;
    out.add(id);
    for (const child of byParent.get(id) ?? []) stack.push(child);
  }
  return [...out];
}

export function readSelection(raw: unknown): TcmsSelection {
  if (!raw || typeof raw !== 'object') return { testCaseIds: [] };
  return raw as TcmsSelection;
}

export function cycleName(selection: TcmsSelection, createdAt: Date) {
  const name = selection.name?.trim();
  if (name) return name;
  return `Cycle ${createdAt.toISOString().slice(0, 16).replace('T', ' ')}`;
}

export async function ensureTcmsFolders(projectId: string) {
  const [folders, features, requirements, cases] = await Promise.all([
    prisma.tcmsFolder.findMany({ where: { projectId } }),
    prisma.featureGroup.findMany({
      where: { projectId },
      select: { featureKey: true, name: true },
    }),
    prisma.requirement.findMany({
      where: { projectId },
      select: {
        requirementKey: true,
        title: true,
        featureGroup: { select: { featureKey: true } },
      },
    }),
    prisma.testCase.findMany({
      where: { projectId },
      select: {
        id: true,
        folderId: true,
        featureKey: true,
        requirementKey: true,
        module: true,
      },
    }),
  ]);

  const topByFeature = new Map(
    folders
      .filter((f) => f.featureKey && !f.parentId)
      .map((f) => [f.featureKey as string, f]),
  );

  const neededFeatures = new Map<string, string>();
  for (const fg of features) neededFeatures.set(fg.featureKey, fg.name);
  for (const c of cases) {
    const key = c.featureKey?.trim();
    if (key && !neededFeatures.has(key)) {
      neededFeatures.set(key, c.module?.trim() || key);
    }
  }

  for (const [featureKey, name] of neededFeatures) {
    if (topByFeature.has(featureKey)) continue;
    const created = await prisma.tcmsFolder.create({
      data: { projectId, name, featureKey, parentId: null },
    });
    folders.push(created);
    topByFeature.set(featureKey, created);
  }

  const reqsByFeature = new Map<string, { key: string; title: string }[]>();
  for (const r of requirements) {
    const fk = r.featureGroup?.featureKey;
    if (!fk) continue;
    const list = reqsByFeature.get(fk) ?? [];
    list.push({ key: r.requirementKey, title: r.title });
    reqsByFeature.set(fk, list);
  }
  for (const c of cases) {
    const fk = c.featureKey?.trim();
    const rk = c.requirementKey?.trim();
    if (!fk || !rk) continue;
    const list = reqsByFeature.get(fk) ?? [];
    if (!list.some((x) => x.key === rk)) {
      list.push({ key: rk, title: rk });
      reqsByFeature.set(fk, list);
    }
  }

  for (const [featureKey, reqs] of reqsByFeature) {
    if (reqs.length < 2) continue;
    const parent = topByFeature.get(featureKey);
    if (!parent) continue;
    const existingSubs = folders.filter((f) => f.parentId === parent.id);
    for (const req of reqs) {
      if (existingSubs.some((s) => s.requirementKey === req.key)) continue;
      const created = await prisma.tcmsFolder.create({
        data: {
          projectId,
          parentId: parent.id,
          name: req.title,
          featureKey,
          requirementKey: req.key,
        },
      });
      folders.push(created);
      existingSubs.push(created);
    }
  }

  const folderRows = await prisma.tcmsFolder.findMany({ where: { projectId } });
  const subByReq = new Map<string, string>();
  for (const f of folderRows) {
    if (f.parentId && f.requirementKey) {
      subByReq.set(`${f.featureKey ?? ''}::${f.requirementKey}`, f.id);
    }
  }

  for (const c of cases) {
    if (c.folderId) continue;
    const fk = c.featureKey?.trim();
    if (!fk) continue;
    const top = topByFeature.get(fk);
    if (!top) continue;
    const rk = c.requirementKey?.trim();
    const subId = rk ? subByReq.get(`${fk}::${rk}`) : undefined;
    await prisma.testCase.update({
      where: { id: c.id },
      data: { folderId: subId ?? top.id },
    });
  }

  return prisma.tcmsFolder.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export function mapFolderDto(f: {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  featureKey: string | null;
  requirementKey: string | null;
}) {
  return {
    id: f.id,
    parentId: f.parentId,
    name: f.name,
    sortOrder: f.sortOrder,
    featureKey: f.featureKey,
    requirementKey: f.requirementKey,
  };
}

export async function buildTcrPayload(
  projectId: string,
  projectName: string,
  executionIds?: string[],
): Promise<TcrReport> {
  const runs = await prisma.execution.findMany({
    where: {
      projectId,
      runMode: 'MANUAL',
      ...(executionIds?.length ? { id: { in: executionIds } } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });
  const ids = runs.map((r) => r.id);
  const [results, cases, bugs, folders] = await Promise.all([
    ids.length
      ? prisma.testResult.findMany({ where: { executionId: { in: ids } } })
      : Promise.resolve([]),
    prisma.testCase.findMany({ where: { projectId } }),
    prisma.bug.findMany({
      where: {
        projectId,
        ...(ids.length ? { executionId: { in: ids } } : { id: { in: [] } }),
      },
      include: { testCase: { select: { externalId: true } } },
    }),
    prisma.tcmsFolder.findMany({ where: { projectId } }),
  ]);
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const resultsByExec = new Map<string, typeof results>();
  for (const r of results) {
    if (!r.executionId) continue;
    const list = resultsByExec.get(r.executionId) ?? [];
    list.push(r);
    resultsByExec.set(r.executionId, list);
  }

  const cycles: TcrCycle[] = runs.map((run) => {
    const selection = readSelection(run.selection);
    const testCaseIds = selection.testCaseIds ?? [];
    const runResults = resultsByExec.get(run.id) ?? [];
    const byCase = new Map(runResults.map((r) => [r.testCaseId, r]));
    return {
      id: run.id,
      name: cycleName(selection, run.createdAt),
      status: run.status,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      cases: testCaseIds.map((id) => {
        const tc = caseById.get(id);
        const result = byCase.get(id);
        const folder = tc?.folderId ? folderById.get(tc.folderId) : null;
        return {
          externalId: tc?.externalId ?? id,
          title: tc?.scenario ?? 'Unknown case',
          status: result?.status ?? 'NOT RUN',
          priority: tc?.priorityLabel ?? tc?.priority ?? null,
          folder: folder?.name ?? tc?.module ?? null,
          message: result?.message ?? null,
          evidenceCount: Array.isArray(result?.evidenceKeys)
            ? result.evidenceKeys.length
            : 0,
        };
      }),
    };
  });

  const tcrBugs: TcrBug[] = bugs.map((b) => ({
    title: b.title,
    severity: b.severity,
    status: b.status,
    testCase: b.testCase?.externalId ?? null,
  }));

  return {
    projectName,
    exportedAt: new Date().toISOString(),
    cycles,
    bugs: tcrBugs,
  };
}

export function summarizeCycle(
  testCaseIds: string[],
  results: Array<{ testCaseId: string; status: string }>,
) {
  const byCase = new Map(results.map((r) => [r.testCaseId, r]));
  return cycleResultCounts(
    testCaseIds.map((id) => ({ status: byCase.get(id)?.status ?? null })),
  );
}

export function isReadyCase(c: {
  caseStatus?: string | null;
  readyForExecution?: boolean | null;
}) {
  return normalizeCaseStatus(c.caseStatus, c.readyForExecution) === 'READY';
}
