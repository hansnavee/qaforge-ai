'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input } from '@/components/Input';
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
import { api, ApiError } from '@/lib/api';
import { clearOrgCache } from '@/lib/org';
import { SHOW_AI_STLC_UI } from '@/lib/product-flags';
import { useOrgCaps } from '@/lib/use-org';

type Project = {
  id: string;
  name: string;
  description?: string | null;
  appUrl?: string | null;
  status?: string | null;
  analysisStatus?: string | null;
  requirementCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

function formatDate(value?: string) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return value;
  }
}

function analysisLabel(status?: string | null) {
  if (!status || status === 'NOT_STARTED') return 'Not Started';
  if (status === 'READY') return 'Ready';
  if (status === 'RUNNING') return 'Running';
  if (status === 'COMPLETED') return 'Completed';
  if (status === 'FAILED') return 'Failed';
  if (status === 'STALE') return 'Stale';
  return status;
}

function openHref(id: string) {
  return `/app/projects/${id}?tab=${SHOW_AI_STLC_UI ? 'overview' : 'dashboard'}`;
}

export default function ProjectsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { caps } = useOrgCaps();
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      try {
        return await api<Project[]>('/api/v1/projects');
      } catch (e) {
        if (e instanceof ApiError && (e.status === 0 || e.status === 404)) {
          return [] as Project[];
        }
        throw e;
      }
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/projects/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setArchiveId(null);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (trimmed.length < 2) throw new Error('Name must be at least 2 characters');
      if (editing) {
        return api(`/api/v1/projects/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: trimmed,
            description: description.trim() || undefined,
          }),
        });
      }
      return api<{ id: string }>('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: trimmed,
          description: description.trim() || undefined,
        }),
      });
    },
    onSuccess: async (created) => {
      setFormOpen(false);
      setEditing(null);
      clearOrgCache();
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      if (!editing && created && typeof created === 'object' && 'id' in created) {
        router.push(openHref((created as { id: string }).id));
      }
    },
    onError: (e) => {
      setFormError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not save project',
      );
    },
  });

  const projects = data ?? [];
  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) {
      const s = p.status?.trim();
      if (s) set.add(s);
    }
    return [...set].sort();
  }, [projects]);
  const filteredProjects = useMemo(() => {
    if (!statusFilter) return projects;
    return projects.filter((p) => (p.status ?? 'DRAFT') === statusFilter);
  }, [projects, statusFilter]);
  const listing = useListingSlice(filteredProjects, {
    query: search,
    searchText: (p) => `${p.name} ${p.description ?? ''} ${p.status ?? ''}`,
    resetKey: statusFilter,
  });
  const filtersActive = Boolean(search.trim() || statusFilter);
  const archiving = projects.find((p) => p.id === archiveId);

  function openCreate() {
    setEditing(null);
    setName('');
    setDescription('');
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(p: Project) {
    setEditing(p);
    setName(p.name);
    setDescription(p.description ?? '');
    setFormError(null);
    setFormOpen(true);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted">
            {SHOW_AI_STLC_UI
              ? 'Manage projects, requirements, and analysis.'
              : 'Open a project to manage cases, runs, results, and reports.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={listingSearchClass}
            placeholder="Search projects"
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
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          {caps.canDesign ? (
            <Button onClick={openCreate}>Create Project</Button>
          ) : null}
        </div>
      </div>

      {error && !(error instanceof ApiError && error.status === 0) ? (
        <p className="text-sm text-danger">Could not load projects.</p>
      ) : null}

      <ListingTable
        rows={listing.pageRows}
        loading={isLoading}
        columnKey="projects"
        lockedColumnId="name"
        onRowClick={(p) => router.push(openHref(p.id))}
        empty={
          <ListingEmpty
            action={
              !filtersActive && caps.canDesign ? (
                <Button size="sm" onClick={openCreate}>
                  Create Project
                </Button>
              ) : !filtersActive ? (
                <p className="text-xs text-muted">
                  Ask a Lead or Administrator to create a project.
                </p>
              ) : null
            }
          >
            {filtersActive
              ? 'No rows match these filters.'
              : SHOW_AI_STLC_UI
                ? 'Create a project, attach requirements, then run analysis.'
                : 'Create a project, then add folders and cases.'}
          </ListingEmpty>
        }
        columns={[
          {
            id: 'name',
            header: 'Name',
            className: 'font-medium',
            cell: (p) => (
                <ListingLink className="font-medium" href={openHref(p.id)}>
                  {p.name}
                </ListingLink>
              ),
          },
          {
            id: 'status',
            header: 'Status',
            cell: (p) =>
              SHOW_AI_STLC_UI ? (
                <Badge tone="warning">{analysisLabel(p.analysisStatus)}</Badge>
              ) : (
                p.status ?? 'DRAFT'
              ),
          },
          ...(SHOW_AI_STLC_UI
            ? [
                {
                  id: 'reqs',
                  header: 'Requirements',
                  className: 'text-sm',
                  cell: (p: Project) => String(p.requirementCount ?? 0),
                },
              ]
            : []),
          {
            id: 'created',
            header: 'Created',
            className: 'text-sm text-muted',
            cell: (p) => formatDate(p.createdAt),
          },
        ]}
        actions={(p) => [
          {
            label: 'Open',
            onClick: () => router.push(openHref(p.id)),
          },
          ...(caps.canDesign
            ? [{ label: 'Edit', onClick: () => openEdit(p) }]
            : []),
          ...(caps.canManageProject
            ? [
                {
                  label: 'Archive',
                  danger: true,
                  onClick: () => setArchiveId(p.id),
                },
              ]
            : []),
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

      <Modal
        open={formOpen}
        title={editing ? 'Edit project' : 'Create Project'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saveMutation.isPending || name.trim().length < 2}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending
                ? 'Saving…'
                : editing
                  ? 'Save'
                  : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Project Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Login regression"
            hint="Required · at least 2 characters"
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Description
            </label>
            <textarea
              className="min-h-20 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes for this suite."
            />
          </div>
          {formError ? <p className="text-sm text-danger">{formError}</p> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(archiveId)}
        title="Archive Project?"
        danger
        confirmLabel="Archive"
        busy={archiveMutation.isPending}
        onCancel={() => setArchiveId(null)}
        onConfirm={() => {
          if (archiveId) archiveMutation.mutate(archiveId);
        }}
      >
        <p>
          <strong>{archiving?.name}</strong> will leave the project list. Cases
          and runs stay in the database.
        </p>
      </ConfirmDialog>
    </div>
  );
}
