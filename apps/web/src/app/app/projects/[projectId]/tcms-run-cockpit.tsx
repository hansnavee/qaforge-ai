'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { useOrgCaps } from '@/lib/use-org';
import { formatDuration } from '@/lib/format-duration';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  ListingLink,
  ListingPager,
  ListingTable,
  listingSearchClass,
  useListingSlice,
} from '@/components/ListingTable';
import { TcmsCycleChart } from './tcms-cycle-chart';
import { TcmsProjectChrome } from './tcms-chrome';
import { TcmsAiExecutorModal } from './tcms-ai-executor-modal';
import {
  caseHref,
  firstPendingId,
  isPendingCase,
  resultTone,
  runTone,
  type TcmsRunCase,
  type TcmsRunDetail,
} from './tcms-types';

type Filter =
  | 'all'
  | 'untested'
  | 'failed'
  | 'passed'
  | 'blocked'
  | 'skipped';

export function TcmsRunCockpit({
  projectId,
  runId,
}: {
  projectId: string;
  runId: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { caps } = useOrgCaps();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<'complete' | 'stop' | null>(null);
  const [executorOpen, setExecutorOpen] = useState(false);
  const [retestCaseIds, setRetestCaseIds] = useState<string[] | undefined>();
  const [now, setNow] = useState(() => Date.now());

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () =>
      api<{ name: string; description?: string | null }>(
        `/api/v1/projects/${projectId}`,
      ),
  });

  const runQuery = useQuery({
    queryKey: ['tcms-run', projectId, runId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<TcmsRunDetail>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${runId}`,
      );
    },
    refetchInterval: 5000,
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${runId}/complete`,
        { method: 'POST', body: '{}' },
      );
    },
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['tcms-run', projectId, runId] }),
        qc.invalidateQueries({ queryKey: ['tcms-runs', projectId] }),
      ]),
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${runId}/stop`,
        { method: 'POST', body: '{}' },
      );
    },
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['tcms-run', projectId, runId] }),
        qc.invalidateQueries({ queryKey: ['tcms-runs', projectId] }),
      ]),
  });

  const run = runQuery.data;
  const locked = Boolean(run?.locked || run?.status === 'COMPLETED' || run?.status === 'CANCELLED');
  const pending = run?.cases.filter(isPendingCase).length ?? 0;
  const recorded = (run?.cases ?? []).reduce(
    (sum, c) => sum + (c.result?.durationMs ?? 0),
    0,
  );
  const elapsed =
    run?.status === 'RUNNING' && run.startedAt
      ? Math.max(0, now - new Date(run.startedAt).getTime())
      : recorded;
  const continueId = run ? firstPendingId(run.cases) : null;

  useEffect(() => {
    if (runQuery.data?.status !== 'RUNNING') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [runQuery.data?.status]);

  const statusFiltered = useMemo(() => {
    return (run?.cases ?? []).filter((c) => {
      if (filter === 'untested' && !isPendingCase(c)) return false;
      if (filter === 'failed' && c.result?.status !== 'FAILED') return false;
      if (filter === 'passed' && c.result?.status !== 'PASSED') return false;
      if (filter === 'blocked' && c.result?.status !== 'BLOCKED') return false;
      if (filter === 'skipped' && c.result?.status !== 'SKIPPED') return false;
      return true;
    });
  }, [run?.cases, filter]);

  const listing = useListingSlice(statusFiltered, {
    query: search,
    searchText: (c) =>
      `${c.scenario} ${c.externalId} ${c.folderName ?? ''}`,
    resetKey: filter,
  });

  const groups = useMemo(() => {
    const map = new Map<string, TcmsRunCase[]>();
    for (const c of listing.pageRows) {
      const key = c.folderName?.trim() || 'Ungrouped';
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [listing.pageRows]);

  if (runQuery.isLoading || projectQuery.isLoading) {
    return <p className="text-sm text-muted">Loading run…</p>;
  }
  if (runQuery.error || !run || !projectQuery.data) {
    return (
      <p className="text-sm text-danger">
        {runQuery.error instanceof ApiError
          ? runQuery.error.message
          : 'Run not found.'}
      </p>
    );
  }

  return (
    <TcmsProjectChrome
      projectId={projectId}
      projectName={projectQuery.data.name}
      description={projectQuery.data.description}
      active="runs"
      crumb={run.name ?? 'Run'}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={runTone(run.status)}>{run.status}</Badge>
              <h2 className="text-lg font-semibold">{run.name}</h2>
            </div>
            <p className="mt-1 text-xs text-muted">
              {run.counts
                ? `${run.counts.passed} passed · ${run.counts.failed} failed · ${pending} pending · ${formatDuration(elapsed)} ${run.status === 'RUNNING' ? 'elapsed' : 'recorded'}`
                : null}
            </p>
            {run.waitingForRunner ? (
              <p className="mt-1 text-xs text-muted">
                Waiting for the local runner on your PC. Keep{' '}
                <code className="text-[11px]">pnpm --filter @qaforge/worker local-runner</code>{' '}
                running — Chromium will open there. Use Stop to cancel.
              </p>
            ) : null}
            {run.status === 'RUNNING' && !run.waitingForRunner ? (
              <p className="mt-1 text-xs text-muted">
                Local runner is executing on your machine. Watch this page —
                screenshots land on Automation Results when it finishes. Use
                Stop if it is stuck.
              </p>
            ) : null}
            {run.errorSummary && !run.waitingForRunner ? (
              <p className="mt-1 text-sm text-danger">{run.errorSummary}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {!locked && caps.canExecute ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setRetestCaseIds(undefined);
                    setExecutorOpen(true);
                  }}
                >
                  AI Executor
                </Button>
              ) : null}
              {!locked && continueId && caps.canExecute ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (run.status === 'PENDING') {
                      void (async () => {
                        const orgId = await getDefaultOrgId();
                        await api(
                          `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${runId}/start`,
                          { method: 'POST', body: '{}' },
                        );
                        router.push(caseHref(projectId, runId, continueId));
                      })();
                      return;
                    }
                    router.push(caseHref(projectId, runId, continueId));
                  }}
                >
                  Continue testing
                </Button>
              ) : null}
              {!locked && run.status === 'RUNNING' && caps.canExecute ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void (async () => {
                        const orgId = await getDefaultOrgId();
                        await api(
                          `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${runId}/pause`,
                          { method: 'POST', body: '{}' },
                        );
                      })();
                    }}
                  >
                    Pause
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void (async () => {
                        const orgId = await getDefaultOrgId();
                        await api(
                          `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${runId}/resume`,
                          { method: 'POST', body: '{}' },
                        );
                      })();
                    }}
                  >
                    Resume
                  </Button>
                </>
              ) : null}
              {!locked && caps.canManageRuns ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={pending > 0}
                    title={
                      pending > 0
                        ? `${pending} cases still untested`
                        : undefined
                    }
                    onClick={() => setConfirm('complete')}
                  >
                    Complete
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => setConfirm('stop')}
                  >
                    Stop
                  </Button>
                </>
              ) : null}
              <Link
                href={`/app/projects/${projectId}?tab=runs`}
                className="inline-flex"
              >
                <Button type="button" size="sm" variant="ghost">
                  All runs
                </Button>
              </Link>
            </div>
          </div>
          {run.counts ? <TcmsCycleChart counts={run.counts} /> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              'all',
              'untested',
              'failed',
              'passed',
              'blocked',
              'skipped',
            ] as const
          ).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs capitalize ${
                filter === f
                  ? 'bg-accent/15 text-accent'
                  : 'bg-panel text-muted hover:text-fg'
              }`}
            >
              {f}
            </button>
          ))}
          <input
            className={`ml-auto ${listingSearchClass}`}
            placeholder="Search cases"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
            No cases match this filter.
          </p>
        ) : (
          groups.map(([suite, rows]) => (
            <div key={suite} className="overflow-hidden rounded-xl border border-border">
              <div className="bg-panel/50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                {suite}
              </div>
              <div className="p-1">
                <ListingTable
                  rows={rows}
                  columnKey="cockpit"
                  lockedColumnId="id"
                  onRowClick={(c) =>
                    router.push(caseHref(projectId, runId, c.id))
                  }
                  columns={[
                    {
                      id: 'id',
                      header: 'ID',
                      className: 'font-mono text-xs',
                      cell: (c) => (
                        <ListingLink
                          className="font-mono text-xs"
                          href={caseHref(projectId, runId, c.id)}
                        >
                          {c.externalId}
                        </ListingLink>
                      ),
                    },
                    {
                      id: 'title',
                      header: 'Title',
                      cell: (c) => (
                        <ListingLink
                          className="font-medium"
                          href={caseHref(projectId, runId, c.id)}
                        >
                          {c.scenario}
                        </ListingLink>
                      ),
                    },
                    {
                      id: 'status',
                      header: 'Status',
                      cell: (c) => (
                        <Badge tone={resultTone(c.result?.status)}>
                          {c.result?.status ?? 'Untested'}
                        </Badge>
                      ),
                    },
                    {
                      id: 'duration',
                      header: 'Duration',
                      className: 'text-xs text-muted',
                      cell: (c) =>
                        c.result?.durationMs
                          ? formatDuration(c.result.durationMs)
                          : '—',
                    },
                  ]}
                  actions={(c) => [
                    {
                      label: 'Open',
                      onClick: () =>
                        router.push(caseHref(projectId, runId, c.id)),
                    },
                    ...(!locked && caps.canExecute
                      ? [
                          {
                            label: 'Retest',
                            onClick: () => {
                              setRetestCaseIds([c.id]);
                              setExecutorOpen(true);
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            </div>
          ))
        )}
        <ListingPager
          page={listing.page}
          totalPages={listing.totalPages}
          from={listing.from}
          to={listing.to}
          total={listing.total}
          pageSize={listing.pageSize}
          onPage={listing.setPage}
          onPageSize={listing.setPageSize}
        />
      </div>

      <ConfirmDialog
        open={confirm === 'complete'}
        title="Complete this run?"
        busy={completeMutation.isPending}
        confirmLabel="Complete"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          completeMutation.mutate();
          setConfirm(null);
        }}
      >
        Pending cases should already be tested. The run will lock after this.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'stop'}
        title="Stop this run?"
        danger
        busy={stopMutation.isPending}
        confirmLabel="Stop"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          stopMutation.mutate();
          setConfirm(null);
        }}
      >
        The cycle will be cancelled and locked.
      </ConfirmDialog>
      <TcmsAiExecutorModal
        open={executorOpen}
        projectId={projectId}
        runId={runId}
        testCaseIds={retestCaseIds}
        onClose={() => {
          setExecutorOpen(false);
          setRetestCaseIds(undefined);
        }}
        onStarted={() => {
          void qc.invalidateQueries({ queryKey: ['tcms-run', projectId, runId] });
          void qc.invalidateQueries({ queryKey: ['tcms-runs', projectId] });
        }}
      />
    </TcmsProjectChrome>
  );
}
