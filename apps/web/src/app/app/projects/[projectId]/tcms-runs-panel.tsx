'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { normalizeCaseStatus } from '@qaforge/shared';
import { api, ApiError } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  ListingEmpty,
  ListingLink,
  ListingPager,
  ListingTable,
  listingFilterClass,
  listingSearchClass,
  useListingSlice,
} from '@/components/ListingTable';
import { Modal } from '@/components/Modal';
import { fieldClass } from './tcms-board';
import { TcmsSuitePicker } from './tcms-suite-picker';
import type { TestCaseRow, TcmsFolderRow } from './design-cases-panel';
import { TcmsAiRunModal } from './tcms-ai-run-modal';
import {
  RUN_FILTER_STATUSES,
  runHasPending,
  runHref,
  runTone,
  type TcmsRunDetail,
  type TcmsRunRow,
} from './tcms-types';

export function TcmsRunsPanel({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [cycleName, setCycleName] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [purgeId, setPurgeId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [progressFilter, setProgressFilter] = useState('');
  const [aiOpen, setAiOpen] = useState(false);

  const casesQuery = useQuery({
    queryKey: ['test-cases', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<TestCaseRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases`,
      );
    },
  });

  const foldersQuery = useQuery({
    queryKey: ['tcms-folders', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<TcmsFolderRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/folders`,
      );
    },
  });

  const runsQuery = useQuery({
    queryKey: ['tcms-runs', projectId, showArchived],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      const q = showArchived ? '?includeArchived=1' : '';
      return api<TcmsRunRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs${q}`,
      );
    },
    refetchInterval: 8000,
  });

  const readyCount = useMemo(
    () =>
      (casesQuery.data ?? []).filter(
        (c) =>
          !c.deletedAt &&
          normalizeCaseStatus(c.caseStatus, c.readyForExecution) === 'READY',
      ).length,
    [casesQuery.data],
  );

  const runs = useMemo(() => {
    let rows = runsQuery.data ?? [];
    if (!showArchived) rows = rows.filter((r) => !r.deletedAt);
    else rows = rows.filter((r) => Boolean(r.deletedAt));
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (progressFilter === 'pending') {
      rows = rows.filter((r) => runHasPending(r.counts));
    } else if (progressFilter === 'done') {
      rows = rows.filter((r) => !runHasPending(r.counts));
    }
    return rows;
  }, [runsQuery.data, showArchived, statusFilter, progressFilter]);

  const listing = useListingSlice(runs, {
    query: search,
    searchText: (r) =>
      `${r.name ?? ''} ${r.status} ${r.description ?? ''}`,
    resetKey: `${showArchived}:${statusFilter}:${progressFilter}`,
  });
  const filtersActive = Boolean(
    search.trim() || statusFilter || progressFilter,
  );

  function resetForm() {
    setCycleName('');
    setDescription('');
    setPicked(new Set());
    setFormError(null);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const name = cycleName.trim();
      if (name.length < 1) throw new Error('Run name is required');
      if (!picked.size) throw new Error('Select at least one Ready test case');
      const orgId = await getDefaultOrgId();
      return api<TcmsRunRow>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs`,
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            description: description.trim() || undefined,
            testCaseIds: [...picked],
            runKind: 'MANUAL',
          }),
        },
      );
    },
    onSuccess: async (run) => {
      setCreateOpen(false);
      resetForm();
      await qc.invalidateQueries({ queryKey: ['tcms-runs', projectId] });
      router.push(runHref(projectId, run.id));
    },
    onError: (e) => {
      setFormError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not start run',
      );
    },
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editId) throw new Error('No run selected');
      const name = cycleName.trim();
      if (name.length < 1) throw new Error('Run name is required');
      if (!picked.size) throw new Error('Select at least one Ready test case');
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${editId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            description: description.trim() || null,
            testCaseIds: [...picked],
          }),
        },
      );
    },
    onSuccess: async () => {
      setEditId(null);
      resetForm();
      await qc.invalidateQueries({ queryKey: ['tcms-runs', projectId] });
    },
    onError: (e) => {
      setFormError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not update run',
      );
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${id}`,
        { method: 'DELETE' },
      );
    },
    onSuccess: async () => {
      setArchiveId(null);
      await qc.invalidateQueries({ queryKey: ['tcms-runs', projectId] });
    },
  });

  const purgeMutation = useMutation({
    mutationFn: async (id: string) => {
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${id}?permanent=1`,
        { method: 'DELETE' },
      );
    },
    onSuccess: async () => {
      setPurgeId(null);
      await qc.invalidateQueries({ queryKey: ['tcms-runs', projectId] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${id}/restore`,
        { method: 'POST', body: '{}' },
      );
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['tcms-runs', projectId] }),
  });

  async function startEdit(id: string) {
    const orgId = await getDefaultOrgId();
    const detail = await api<TcmsRunDetail>(
      `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${id}`,
    );
    setEditId(id);
    setCycleName(detail.name ?? '');
    setDescription(detail.description ?? '');
    setPicked(new Set(detail.cases.map((c) => c.id)));
    setFormError(null);
  }

  const formOpen = createOpen || Boolean(editId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-fg">Runs</h3>
          <p className="mt-0.5 text-xs text-muted">
            Pick suites to start a run, then execute each case on its own page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={listingSearchClass}
            placeholder="Search runs"
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
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Archived
          </label>
          {canEdit && !showArchived ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setAiOpen(true)}
                disabled={!readyCount}
                title={
                  readyCount
                    ? undefined
                    : 'Mark cases Ready before proposing a cycle'
                }
              >
                AI
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  resetForm();
                  setCreateOpen(true);
                }}
                disabled={!readyCount}
                title={
                  readyCount
                    ? undefined
                    : 'Mark cases Ready before starting a run'
                }
              >
                Start a run
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <ListingTable
        rows={listing.pageRows}
        loading={runsQuery.isLoading}
        columnKey="runs"
        lockedColumnId="name"
        onRowClick={
          showArchived
            ? undefined
            : (r) => router.push(runHref(projectId, r.id))
        }
        empty={
          <ListingEmpty
            action={
              canEdit && readyCount && !showArchived && !filtersActive ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    resetForm();
                    setCreateOpen(true);
                  }}
                >
                  Start a run
                </Button>
              ) : null
            }
          >
            {filtersActive
              ? 'No rows match these filters.'
              : showArchived
                ? 'No archived runs.'
                : readyCount
                  ? 'No runs yet. Pick a suite and start one.'
                  : 'Mark cases Ready, then start a run from a test suite.'}
          </ListingEmpty>
        }
        columns={[
          {
            id: 'name',
            header: 'Name',
            className: 'font-medium',
            cell: (r) =>
              showArchived ? (
                r.name ?? 'Untitled run'
              ) : (
                <ListingLink
                  className="font-medium"
                  href={runHref(projectId, r.id)}
                >
                  {r.name ?? 'Untitled run'}
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
                ? `${r.counts.done}/${r.counts.total} done · ${r.counts.pending} pending`
                : '—',
          },
          {
            id: 'created',
            header: 'Created',
            className: 'text-xs text-muted',
            cell: (r) => new Date(r.createdAt).toLocaleString(),
          },
        ]}
        actions={(r) => {
          if (showArchived) {
            return canEdit
              ? [
                  {
                    label: 'Restore',
                    onClick: () => restoreMutation.mutate(r.id),
                  },
                  {
                    label: 'Delete',
                    danger: true,
                    onClick: () => setPurgeId(r.id),
                  },
                ]
              : [];
          }
          return [
            {
              label: 'Open',
              onClick: () => router.push(runHref(projectId, r.id)),
            },
            ...(canEdit && !r.locked
              ? [
                  {
                    label: 'Edit',
                    onClick: () => void startEdit(r.id),
                  },
                ]
              : []),
            ...(canEdit
              ? [
                  {
                    label: 'Archive',
                    onClick: () => setArchiveId(r.id),
                  },
                  {
                    label: 'Delete',
                    danger: true,
                    onClick: () => setPurgeId(r.id),
                  },
                ]
              : []),
          ];
        }}
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

      <Modal
        open={formOpen}
        title={editId ? 'Edit run' : 'Start a run'}
        size="xl"
        onClose={() => {
          setCreateOpen(false);
          setEditId(null);
        }}
        footer={
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setCreateOpen(false);
                setEditId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={createMutation.isPending || editMutation.isPending}
              onClick={() => {
                setFormError(null);
                if (!cycleName.trim()) {
                  setFormError('Run name is required');
                  return;
                }
                if (!picked.size) {
                  setFormError('Select at least one Ready test case');
                  return;
                }
                if (editId) editMutation.mutate();
                else createMutation.mutate();
              }}
            >
              {createMutation.isPending || editMutation.isPending
                ? 'Saving…'
                : editId
                  ? 'Save'
                  : `Start run (${picked.size})`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1 text-xs text-muted">
            Run name
            <input
              className={fieldClass}
              value={cycleName}
              placeholder="Sprint 12 — Login"
              onChange={(e) => setCycleName(e.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs text-muted">
            Description
            <textarea
              className="min-h-16 w-full rounded-lg border border-border bg-bg-elevated px-2.5 py-2 text-sm text-fg outline-none focus:border-accent/60"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <TcmsSuitePicker
            folders={foldersQuery.data ?? []}
            cases={casesQuery.data ?? []}
            picked={picked}
            onChange={setPicked}
          />
          {formError ? <p className="text-sm text-danger">{formError}</p> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(archiveId)}
        title="Archive this run?"
        danger
        busy={archiveMutation.isPending}
        confirmLabel="Archive"
        onCancel={() => setArchiveId(null)}
        onConfirm={() => {
          if (archiveId) archiveMutation.mutate(archiveId);
        }}
      >
        It leaves the live list and can be restored later.
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(purgeId)}
        title="Delete this run permanently?"
        danger
        busy={purgeMutation.isPending}
        confirmLabel="Delete forever"
        onCancel={() => setPurgeId(null)}
        onConfirm={() => {
          if (purgeId) purgeMutation.mutate(purgeId);
        }}
      >
        Results and evidence for this run will be removed.
      </ConfirmDialog>

      <TcmsAiRunModal
        open={aiOpen}
        projectId={projectId}
        folders={foldersQuery.data ?? []}
        cases={casesQuery.data ?? []}
        readyCount={readyCount}
        onClose={() => setAiOpen(false)}
        onApproved={(runId) => {
          void qc.invalidateQueries({ queryKey: ['tcms-runs', projectId] });
          router.push(runHref(projectId, runId));
        }}
      />
    </div>
  );
}
