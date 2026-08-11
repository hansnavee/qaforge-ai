'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import {
  ListingEmpty,
  ListingPager,
  ListingTable,
  listingFilterClass,
  listingSearchClass,
  useListingSlice,
} from '@/components/ListingTable';
import {
  api,
  downloadAuthenticated,
  openAuthenticated,
} from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { resultTone, runHref } from './tcms-types';
import { useRouter } from 'next/navigation';

type AutomationReportRow = {
  id: string;
  name: string;
  status: string;
  passed: number;
  failed: number;
  executionId: string;
  runName: string;
  createdAt: string;
};

export function TcmsAutomationResultsPanel({
  projectId,
}: {
  projectId: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reportsQuery = useQuery({
    queryKey: ['tcms-automation-reports', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<AutomationReportRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/automation/reports`,
      );
    },
    refetchInterval: 8000,
  });

  const reports = reportsQuery.data ?? [];
  const filtered = useMemo(() => {
    if (!statusFilter) return reports;
    return reports.filter((r) => r.status === statusFilter);
  }, [reports, statusFilter]);
  const listing = useListingSlice(filtered, {
    query: search,
    searchText: (r) => `${r.name} ${r.runName} ${r.status}`,
    resetKey: statusFilter,
  });
  const filtersActive = Boolean(search.trim() || statusFilter);

  async function withOrg(
    fn: (orgId: string) => Promise<void>,
  ) {
    setError(null);
    try {
      const orgId = await getDefaultOrgId();
      await fn(orgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-fg">
            Automation Results
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            HTML reports from AI Executor runs. Older reports are kept.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={listingSearchClass}
            placeholder="Search reports"
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
            <option value="PASSED">Passed</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <ListingTable
        rows={listing.pageRows}
        loading={reportsQuery.isLoading}
        columnKey="automation-reports"
        lockedColumnId="name"
        empty={
          <ListingEmpty>
            {filtersActive
              ? 'No rows match these filters.'
              : 'No automation reports yet. Finish an AI Executor run to create one.'}
          </ListingEmpty>
        }
        columns={[
          {
            id: 'name',
            header: 'Name',
            className: 'font-medium',
            cell: (r) => r.name,
          },
          {
            id: 'run',
            header: 'Run',
            cell: (r) => r.runName,
          },
          {
            id: 'counts',
            header: 'Passed / failed',
            cell: (r) => `${r.passed} / ${r.failed}`,
          },
          {
            id: 'status',
            header: 'Status',
            cell: (r) => (
              <Badge tone={resultTone(r.status)}>{r.status}</Badge>
            ),
          },
          {
            id: 'date',
            header: 'Date',
            className: 'text-xs text-muted',
            cell: (r) => new Date(r.createdAt).toLocaleString(),
          },
        ]}
        actions={(r) => [
          {
            label: 'Open',
            onClick: () =>
              void withOrg((orgId) =>
                openAuthenticated(
                  `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/automation/reports/${r.id}/html`,
                ),
              ),
          },
          {
            label: 'Download HTML',
            onClick: () =>
              void withOrg((orgId) =>
                downloadAuthenticated(
                  `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/automation/reports/${r.id}/html?download=1`,
                  `${r.name}.html`,
                ),
              ),
          },
          {
            label: 'Download ZIP',
            onClick: () =>
              void withOrg((orgId) =>
                downloadAuthenticated(
                  `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/automation/reports/${r.id}/zip`,
                  `${r.name}.zip`,
                ),
              ),
          },
          {
            label: 'Open run',
            onClick: () => router.push(runHref(projectId, r.executionId)),
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
