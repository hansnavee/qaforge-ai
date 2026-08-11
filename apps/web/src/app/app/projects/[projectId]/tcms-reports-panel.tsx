'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { cycleResultCounts } from '@qaforge/shared';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import {
  ListingEmpty,
  ListingLink,
  ListingPager,
  ListingTable,
  listingFilterClass,
  listingSearchClass,
  useListingSlice,
} from '@/components/ListingTable';
import { api, API_URL } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { TcmsCycleChart } from './tcms-cycle-chart';
import {
  RUN_FILTER_STATUSES,
  runHasPending,
  runHref,
  runTone,
} from './tcms-types';

type RunRow = {
  id: string;
  name?: string;
  status: string;
  createdAt: string;
  counts?: ReturnType<typeof cycleResultCounts>;
};

export function TcmsReportsPanel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [tcrBusy, setTcrBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [progressFilter, setProgressFilter] = useState('');

  const runsQuery = useQuery({
    queryKey: ['tcms-runs', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<RunRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs`,
      );
    },
  });

  const runs = runsQuery.data ?? [];
  const filteredRuns = useMemo(() => {
    let rows = runs;
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (progressFilter === 'pending') {
      rows = rows.filter((r) => runHasPending(r.counts));
    } else if (progressFilter === 'done') {
      rows = rows.filter((r) => !runHasPending(r.counts));
    }
    return rows;
  }, [runs, statusFilter, progressFilter]);
  const listing = useListingSlice(filteredRuns, {
    query: search,
    searchText: (r) => `${r.name ?? ''} ${r.status}`,
    resetKey: `${statusFilter}:${progressFilter}`,
  });
  const filtersActive = Boolean(
    search.trim() || statusFilter || progressFilter,
  );

  const rollup = useMemo(() => {
    const zeros = cycleResultCounts([]);
    return runs.reduce((acc, run) => {
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
  }, [runs]);

  async function downloadTcr(
    format: 'html' | 'docx' | 'pdf',
    runId?: string,
  ) {
    const orgId = await getDefaultOrgId();
    const path = runId
      ? `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${runId}/tcr?format=${format}`
      : `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/tcr?format=${format}`;
    const key = `${runId ?? 'all'}-${format}`;
    setTcrBusy(key);
    try {
      const res = await fetch(`${API_URL.replace(/\/$/, '')}${path}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (format === 'html' || format === 'pdf') {
        window.open(url, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'test-cycle-report.doc';
        a.click();
      }
    } finally {
      setTcrBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-fg">
            Test cycle reports
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            Download TCR for one cycle or every cycle in this project.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className={listingSearchClass}
            placeholder="Search cycles"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className={listingFilterClass}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {RUN_FILTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
          <select
            className={listingFilterClass}
            value={progressFilter}
            onChange={(e) => setProgressFilter(e.target.value)}
            aria-label="Filter by progress"
          >
            <option value="">All progress</option>
            <option value="pending">Has pending</option>
            <option value="done">All done</option>
          </select>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!runs.length || Boolean(tcrBusy)}
            onClick={() => void downloadTcr('html')}
          >
            All HTML
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!runs.length || Boolean(tcrBusy)}
            onClick={() => void downloadTcr('docx')}
          >
            All Word
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!runs.length || Boolean(tcrBusy)}
            onClick={() => void downloadTcr('pdf')}
          >
            All PDF
          </Button>
        </div>
      </div>

      {runs.length ? <TcmsCycleChart counts={rollup} /> : null}

      <ListingTable
        rows={listing.pageRows}
        loading={runsQuery.isLoading}
        columnKey="reports"
        lockedColumnId="name"
        onRowClick={(r) => router.push(runHref(projectId, r.id))}
        empty={
          <ListingEmpty>
            {filtersActive
              ? 'No rows match these filters.'
              : 'No cycles yet. Open Runs and start a cycle first.'}
          </ListingEmpty>
        }
        columns={[
          {
            id: 'name',
            header: 'Cycle',
            className: 'font-medium',
            cell: (r) => (
              <ListingLink
                className="font-medium"
                href={runHref(projectId, r.id)}
              >
                {r.name ?? new Date(r.createdAt).toLocaleString()}
              </ListingLink>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            cell: (r) => <Badge tone={runTone(r.status)}>{r.status}</Badge>,
          },
          {
            id: 'progress',
            header: 'Progress',
            className: 'text-xs text-muted',
            cell: (r) =>
              r.counts
                ? `${r.counts.done}/${r.counts.total} done`
                : '—',
          },
          {
            id: 'created',
            header: 'Created',
            className: 'text-xs text-muted',
            cell: (r) => new Date(r.createdAt).toLocaleString(),
          },
        ]}
        actions={(r) => [
          {
            label: tcrBusy === `${r.id}-html` ? 'Opening…' : 'HTML',
            onClick: () => void downloadTcr('html', r.id),
            disabled: Boolean(tcrBusy),
          },
          {
            label: tcrBusy === `${r.id}-docx` ? 'Downloading…' : 'Word',
            onClick: () => void downloadTcr('docx', r.id),
            disabled: Boolean(tcrBusy),
          },
          {
            label: tcrBusy === `${r.id}-pdf` ? 'Opening…' : 'PDF',
            onClick: () => void downloadTcr('pdf', r.id),
            disabled: Boolean(tcrBusy),
          },
        ]}
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
  );
}
