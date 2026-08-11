'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cycleResultCounts } from '@qaforge/shared';
import { api } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { formatDuration } from '@/lib/format-duration';
import { Badge } from '@/components/Badge';
import {
  ListingEmpty,
  ListingLink,
  ListingPager,
  ListingTable,
  listingFilterClass,
  listingSearchClass,
  useListingSlice,
} from '@/components/ListingTable';
import { TcmsBoard, TcmsTreeButton } from './tcms-board';
import { TcmsCycleChart } from './tcms-cycle-chart';
import {
  RESULT_FILTER_STATUSES,
  caseHref,
  isPendingCase,
  resultTone,
  runTone,
  type TcmsRunDetail,
  type TcmsRunRow,
} from './tcms-types';

export function TcmsResultsPanel({
  projectId,
}: {
  projectId: string;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [resultFilter, setResultFilter] = useState('');

  const runsQuery = useQuery({
    queryKey: ['tcms-runs', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<TcmsRunRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs`,
      );
    },
  });

  const runs = runsQuery.data ?? [];
  const selected = activeId ?? runs[0]?.id ?? null;

  const detailQuery = useQuery({
    queryKey: ['tcms-run', projectId, selected],
    enabled: Boolean(selected),
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<TcmsRunDetail>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${selected}`,
      );
    },
  });

  const detail = detailQuery.data;
  const filteredCases = useMemo(() => {
    const rows = detail?.cases ?? [];
    if (!resultFilter) return rows;
    if (resultFilter === 'UNTESTED') return rows.filter(isPendingCase);
    return rows.filter((c) => c.result?.status === resultFilter);
  }, [detail?.cases, resultFilter]);
  const listing = useListingSlice(filteredCases, {
    query: search,
    searchText: (c) =>
      `${c.externalId} ${c.scenario} ${c.result?.status ?? 'untested'}`,
    resetKey: `${selected ?? ''}:${resultFilter}`,
  });
  const filtersActive = Boolean(search.trim() || resultFilter);
  const cycleCounts =
    detail?.counts ??
    cycleResultCounts(
      (detail?.cases ?? []).map((c) => ({ status: c.result?.status })),
    );
  const rollup = useMemo(() => {
    const zeros = cycleResultCounts([]);
    return (runsQuery.data ?? []).reduce((acc, run) => {
      const c = run.counts ?? zeros;
      return {
        passed: acc.passed + c.passed,
        failed: acc.failed + c.failed,
        blocked: acc.blocked + c.blocked,
        skipped: acc.skipped + c.skipped,
        pending: acc.pending + c.pending,
        total: acc.total + c.total,
        done: acc.done + c.done,
      };
    }, zeros);
  }, [runsQuery.data]);

  return (
    <TcmsBoard
      title="Results"
      hint="Open a case to execute or review it on its own page."
      tree={
        <div className="space-y-0.5">
          {runs.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted">
              Start a run on the Runs tab first.
            </p>
          ) : (
            runs.map((r) => (
              <TcmsTreeButton
                key={r.id}
                active={selected === r.id}
                onClick={() => setActiveId(r.id)}
              >
                <span className="flex items-center gap-2">
                  <Badge tone={runTone(r.status)}>{r.status}</Badge>
                  <span className="truncate text-xs">
                    {r.name ?? new Date(r.createdAt).toLocaleString()}
                  </span>
                </span>
              </TcmsTreeButton>
            ))
          )}
        </div>
      }
    >
      {!selected ? (
        <ListingEmpty>Start a run, then open cases from here.</ListingEmpty>
      ) : (
        <div className="space-y-5">
          {runs.length > 1 ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                All runs
              </p>
              <TcmsCycleChart counts={rollup} compact />
            </div>
          ) : null}
          <TcmsCycleChart counts={cycleCounts} />
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              className={listingSearchClass}
              placeholder="Search cases"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className={listingFilterClass}
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value)}
              aria-label="Filter by result"
            >
              <option value="">All results</option>
              <option value="UNTESTED">Untested</option>
              {RESULT_FILTER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <ListingTable
            rows={listing.pageRows}
            loading={detailQuery.isLoading}
            columnKey="results"
            lockedColumnId="id"
            empty={
              <ListingEmpty>
                {filtersActive
                  ? 'No rows match these filters.'
                  : 'No cases in this run.'}
              </ListingEmpty>
            }
            onRowClick={(c) =>
              selected && router.push(caseHref(projectId, selected, c.id))
            }
            columns={[
              {
                id: 'id',
                header: 'ID',
                className: 'font-mono text-xs',
                cell: (c) =>
                  selected ? (
                    <ListingLink
                      className="font-mono text-xs"
                      href={caseHref(projectId, selected, c.id)}
                    >
                      {c.externalId}
                    </ListingLink>
                  ) : (
                    c.externalId
                  ),
              },
              {
                id: 'title',
                header: 'Title',
                className: 'font-medium',
                cell: (c) =>
                  selected ? (
                    <ListingLink
                      className="font-medium"
                      href={caseHref(projectId, selected, c.id)}
                    >
                      {c.scenario}
                    </ListingLink>
                  ) : (
                    c.scenario
                  ),
              },
              {
                id: 'result',
                header: 'Result',
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
            actions={(c) =>
              selected
                ? [
                    {
                      label: 'Open',
                      onClick: () =>
                        router.push(caseHref(projectId, selected, c.id)),
                    },
                  ]
                : []
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
        </div>
      )}
    </TcmsBoard>
  );
}
