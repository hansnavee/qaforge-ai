'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { formatMeter, parsePlanLimitError } from '@/lib/plan';
import { usePlan } from '@/lib/use-plan';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ProFeatureNotice, UpgradeModal } from '@/components/UpgradeModal';
import {
  ListingEmpty,
  ListingPager,
  ListingTable,
  listingFilterClass,
  listingSearchClass,
  useListingSlice,
} from '@/components/ListingTable';
import { TcmsAiExecutorModal } from './tcms-ai-executor-modal';
import { resultTone, runHref } from './tcms-types';

export type AutomatedScriptRow = {
  id: string;
  testCaseId: string;
  path: string;
  lastRunId?: string | null;
  lastStatus?: string | null;
  stabilityStatus?: string | null;
  healCount?: number;
  recordedBy?: string | null;
  scriptVersion?: number;
  updatedAt: string;
  externalId: string;
  scenario: string;
  priorityLabel: string;
  folderName?: string | null;
};

type HealRow = {
  id: string;
  testCaseId: string;
  status: string;
  healerKind: string;
  patchDiff: string | null;
  rationale: string[] | null;
  committed: boolean;
  createdAt: string;
  externalId: string;
  scenario: string;
};

const RESULT_FILTERS = ['PASSED', 'FAILED', 'RUNNING'] as const;
const PRIORITY_FILTERS = ['HIGH', 'MEDIUM', 'LOW'] as const;

export function TcmsAutomationPanel({
  projectId,
  canEdit,
  onRun,
}: {
  projectId: string;
  canEdit: boolean;
  onRun?: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [executorOpen, setExecutorOpen] = useState(false);
  const [executorIds, setExecutorIds] = useState<string[] | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [upgradeError, setUpgradeError] = useState<ReturnType<typeof parsePlanLimitError>>(null);
  const { billing, isFree, canRuleHealer } = usePlan();

  const scriptsQuery = useQuery({
    queryKey: ['tcms-automation-scripts', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<AutomatedScriptRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/automation/scripts`,
      );
    },
    refetchInterval: 8000,
  });

  const healsQuery = useQuery({
    queryKey: ['tcms-automation-heals', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<HealRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/automation/heals`,
      );
    },
    refetchInterval: 8000,
  });

  const pendingHeals = (healsQuery.data ?? []).filter(
    (h) => h.status === 'PENDING_REVIEW',
  );
  const latestHeal = (healsQuery.data ?? [])[0];
  const quarantinedCount = (scriptsQuery.data ?? []).filter(
    (s) => s.stabilityStatus === 'QUARANTINED',
  ).length;

  const envQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<{ appUrl?: string | null }>(
        `/api/v1/orgs/${orgId}/projects/${projectId}`,
      );
    },
  });

  const scripts = scriptsQuery.data ?? [];
  const filtered = useMemo(() => {
    let rows = scripts;
    if (resultFilter) {
      rows = rows.filter((r) => r.lastStatus === resultFilter);
    }
    if (priorityFilter) {
      rows = rows.filter((r) => r.priorityLabel === priorityFilter);
    }
    return rows;
  }, [scripts, resultFilter, priorityFilter]);
  const listing = useListingSlice(filtered, {
    query: search,
    searchText: (r) =>
      `${r.externalId} ${r.scenario} ${r.path} ${r.priorityLabel} ${r.lastStatus ?? ''}`,
    resetKey: `${resultFilter}:${priorityFilter}`,
  });
  const filtersActive = Boolean(
    search.trim() || resultFilter || priorityFilter,
  );

  const executeMutation = useMutation({
    mutationFn: async (testCaseIds?: string[]) => {
      const orgId = await getDefaultOrgId();
      return api<{ id: string }>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/automation/scripts/execute`,
        {
          method: 'POST',
          body: JSON.stringify({
            testCaseIds,
            appUrl: envQuery.data?.appUrl ?? '',
          }),
        },
      );
    },
    onSuccess: (run) => {
      void onRun?.();
      void qc.invalidateQueries({
        queryKey: ['tcms-automation-scripts', projectId],
      });
      router.push(runHref(projectId, run.id));
    },
    onError: (err) => {
      const planErr =
        err instanceof ApiError ? parsePlanLimitError(err.body) : null;
      if (planErr) {
        setUpgradeError(planErr);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : 'Execute failed');
      }
    },
  });

  function needsExecutorForm() {
    return !envQuery.data?.appUrl;
  }

  function execute(ids?: string[]) {
    setError(null);
    if (needsExecutorForm()) {
      setExecutorIds(ids);
      setExecutorOpen(true);
      return;
    }
    executeMutation.mutate(ids);
  }

  const selectedCaseIds = scripts
    .filter((s) => selected.has(s.id))
    .map((s) => s.testCaseId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-fg">Automation</h3>
          <p className="mt-0.5 text-xs text-muted">
            Playwright scripts generated by AI Executor. Re-run selected or all.
            {isFree && billing?.usage?.SCRIPT_REPLAY ? (
              <span className="ml-1">
                Replay: {formatMeter(billing.usage.SCRIPT_REPLAY)} this month.
              </span>
            ) : null}
          </p>
        </div>
        {!canRuleHealer ? (
          <ProFeatureNotice feature="Rule-based healer">
            Auto-fix locators after replay failures on Pro.
          </ProFeatureNotice>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={listingSearchClass}
            placeholder="Search scripts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className={listingFilterClass}
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value)}
            aria-label="Filter by last result"
          >
            <option value="">All results</option>
            {RESULT_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
          <select
            className={listingFilterClass}
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            aria-label="Filter by priority"
          >
            <option value="">All priorities</option>
            {PRIORITY_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
          {canEdit ? (
            <>
              <Button
                type="button"
                size="sm"
                disabled={!selectedCaseIds.length || executeMutation.isPending}
                onClick={() => execute(selectedCaseIds)}
              >
                Execute selected
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!scripts.length || executeMutation.isPending}
                onClick={() => execute(undefined)}
              >
                Execute all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  void (async () => {
                    const orgId = await getDefaultOrgId();
                    await api(
                      `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/automation/pause`,
                      { method: 'POST', body: '{}' },
                    );
                  })().catch((err) =>
                    setError(err instanceof Error ? err.message : 'Pause failed'),
                  );
                }}
              >
                Pause
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={() => {
                  void (async () => {
                    const orgId = await getDefaultOrgId();
                    await api(
                      `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/automation/stop`,
                      { method: 'POST', body: '{}' },
                    );
                  })().catch((err) =>
                    setError(err instanceof Error ? err.message : 'Stop failed'),
                  );
                }}
              >
                Stop
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {error || executeMutation.error ? (
        <p className="text-sm text-danger">
          {error ||
            (executeMutation.error instanceof Error
              ? executeMutation.error.message
              : 'Execute failed')}
        </p>
      ) : null}

      <div className="rounded-lg border border-border bg-panel/40 p-3 text-sm">
        <p className="font-medium text-fg">Agent panel</p>
        <p className="mt-1 text-xs text-muted">
          Daily regression replays recorded scripts (0 LLM). Locator failures
          retry, then rule-heal with 3× verify. Assertions become defects — not
          heals. Complete the run stays a human gate.
        </p>
        {latestHeal ? (
          <p className="mt-2 text-xs">
            Last decision: <span className="font-medium">{latestHeal.status}</span>
            {' · '}
            {latestHeal.externalId}
            {Array.isArray(latestHeal.rationale) && latestHeal.rationale[0]
              ? ` — ${latestHeal.rationale[0]}`
              : latestHeal.patchDiff
                ? ` — ${latestHeal.patchDiff}`
                : ''}
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted">
            No heal activity yet. Execute from this tab after AI Executor has
            recorded scripts.
          </p>
        )}
        {quarantinedCount ? (
          <p className="mt-1 text-xs text-warning">
            {quarantinedCount} quarantined — skipped on Execute all. Clear
            quarantine or Re-record (Lead).
          </p>
        ) : null}
      </div>

      {pendingHeals.length ? (
        <div className="space-y-2 rounded-lg border border-amber-500/40 p-3">
          <p className="text-sm font-medium">Heal approvals</p>
          {pendingHeals.map((h) => (
            <div
              key={h.id}
              className="flex flex-wrap items-center justify-between gap-2 text-xs"
            >
              <span>
                {h.externalId}: {h.scenario} — {h.patchDiff || 'rule patch'}
              </span>
              <span className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    void (async () => {
                      const orgId = await getDefaultOrgId();
                      await api(
                        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/automation/heals/${h.id}/approve`,
                        { method: 'POST', body: '{}' },
                      );
                      await qc.invalidateQueries({
                        queryKey: ['tcms-automation-heals', projectId],
                      });
                    })().catch((err) =>
                      setError(err instanceof Error ? err.message : 'Approve failed'),
                    );
                  }}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void (async () => {
                      const orgId = await getDefaultOrgId();
                      await api(
                        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/automation/heals/${h.id}/reject`,
                        { method: 'POST', body: '{}' },
                      );
                      await qc.invalidateQueries({
                        queryKey: ['tcms-automation-heals', projectId],
                      });
                      await qc.invalidateQueries({
                        queryKey: ['tcms-automation-scripts', projectId],
                      });
                    })().catch((err) =>
                      setError(err instanceof Error ? err.message : 'Reject failed'),
                    );
                  }}
                >
                  Reject
                </Button>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <ListingTable
        rows={listing.pageRows}
        loading={scriptsQuery.isLoading}
        columnKey="automation-scripts"
        lockedColumnId="id"
        selectable={canEdit}
        selected={selected}
        onToggle={(id) => {
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }}
        onToggleAll={(checked) => {
          setSelected(
            checked ? new Set(listing.pageRows.map((r) => r.id)) : new Set(),
          );
        }}
        empty={
          <ListingEmpty>
            {filtersActive
              ? 'No rows match these filters.'
              : 'No automated scripts yet. Run AI Executor on a cycle to generate them.'}
          </ListingEmpty>
        }
        columns={[
          {
            id: 'id',
            header: 'ID',
            className: 'font-medium',
            cell: (r) => r.externalId,
          },
          {
            id: 'title',
            header: 'Title',
            cell: (r) => r.scenario,
          },
          {
            id: 'priority',
            header: 'Priority',
            cell: (r) => r.priorityLabel,
          },
          {
            id: 'stability',
            header: 'Stability',
            cell: (r) => {
              const status = r.stabilityStatus ?? 'STABLE';
              const tone =
                status === 'QUARANTINED'
                  ? 'danger'
                  : status === 'FLAKY'
                    ? 'warning'
                    : status === 'WATCH'
                      ? 'accent'
                      : 'success';
              return <Badge tone={tone}>{status}</Badge>;
            },
          },
          {
            id: 'result',
            header: 'Last result',
            cell: (r) =>
              r.lastStatus ? (
                <Badge tone={resultTone(r.lastStatus)}>{r.lastStatus}</Badge>
              ) : (
                '—'
              ),
          },
          {
            id: 'path',
            header: 'Path',
            className: 'text-xs text-muted',
            cell: (r) => r.path,
          },
        ]}
        actions={
          canEdit
            ? (r) => [
                {
                  label: 'Execute',
                  onClick: () => execute([r.testCaseId]),
                },
                {
                  label: 'Re-record',
                  onClick: () => {
                    void (async () => {
                      const orgId = await getDefaultOrgId();
                      await api(
                        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/automation/scripts/${r.testCaseId}/rerecord`,
                        { method: 'POST', body: '{}' },
                      );
                      await qc.invalidateQueries({
                        queryKey: ['tcms-automation-scripts', projectId],
                      });
                    })().catch((err) =>
                      setError(
                        err instanceof Error ? err.message : 'Re-record failed',
                      ),
                    );
                  },
                },
                ...(r.stabilityStatus === 'QUARANTINED'
                  ? [
                      {
                        label: 'Clear quarantine',
                        onClick: () => {
                          void (async () => {
                            const orgId = await getDefaultOrgId();
                            await api(
                              `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/automation/scripts/${r.testCaseId}/clear-quarantine`,
                              { method: 'POST', body: '{}' },
                            );
                            await qc.invalidateQueries({
                              queryKey: ['tcms-automation-scripts', projectId],
                            });
                          })().catch((err) =>
                            setError(
                              err instanceof Error
                                ? err.message
                                : 'Clear failed',
                            ),
                          );
                        },
                      },
                    ]
                  : []),
              ]
            : undefined
        }
      />
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
      <TcmsAiExecutorModal
        open={executorOpen}
        projectId={projectId}
        testCaseIds={executorIds}
        onClose={() => setExecutorOpen(false)}
        onStarted={(runId) => {
          void onRun?.();
          void qc.invalidateQueries({
            queryKey: ['tcms-automation-scripts', projectId],
          });
          router.push(runHref(projectId, runId));
        }}
      />
      <UpgradeModal
        open={Boolean(upgradeError)}
        error={upgradeError}
        onClose={() => setUpgradeError(null)}
      />
    </div>
  );
}
