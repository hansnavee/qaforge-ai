'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionMenu } from '@/components/ActionMenu';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { api, ApiError } from '@/lib/api';

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

export default function ProjectsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);

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

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/projects/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDeleteId(null);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const projects = data ?? [];
  const deleting = projects.find((p) => p.id === deleteId);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted">
            Manage projects, requirements, and analysis.
          </p>
        </div>
        <Link href="/app/projects/new">
          <Button>Create Project</Button>
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading projects…</p>
      ) : null}

      {error && !(error instanceof ApiError && error.status === 0) ? (
        <p className="text-sm text-danger">Could not load projects.</p>
      ) : null}

      {!isLoading && projects.length === 0 ? (
        <Card className="border-dashed">
          <h2 className="text-base font-medium">No projects yet</h2>
          <p className="mt-1 text-sm text-muted">
            Create a project, attach requirements, then run analysis.
          </p>
          <Link href="/app/projects/new" className="mt-4 inline-block">
            <Button size="sm">Create Project</Button>
          </Link>
        </Card>
      ) : null}

      <div className="grid gap-3">
        {projects.map((p) => (
          <Card key={p.id} className="transition hover:border-accent/40">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() =>
                  router.push(`/app/projects/${p.id}?tab=overview`)
                }
              >
                <div className="text-xs uppercase tracking-wide text-muted">
                  Project
                </div>
                <div className="mt-1 text-lg font-medium">{p.name}</div>
                {p.description ? (
                  <p className="mt-1 line-clamp-2 text-sm text-muted">
                    {p.description}
                  </p>
                ) : null}
              </button>
              <div className="flex items-center gap-2">
                <Badge tone="warning">{p.status ?? 'DRAFT'}</Badge>
                <ActionMenu
                  items={[
                    {
                      label: 'View',
                      onClick: () =>
                        router.push(`/app/projects/${p.id}?tab=overview`),
                    },
                    {
                      label: 'Open Requirements',
                      onClick: () =>
                        router.push(
                          `/app/projects/${p.id}?tab=requirements&view=list`,
                        ),
                    },
                    {
                      label: 'Edit',
                      onClick: () =>
                        router.push(
                          `/app/projects/${p.id}?tab=overview&edit=1`,
                        ),
                    },
                    {
                      label: 'Delete',
                      danger: true,
                      onClick: () => setDeleteId(p.id),
                    },
                  ]}
                />
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div>
                <div className="text-xs text-muted">Requirements</div>
                <div className="mt-0.5 text-sm font-medium">
                  {p.requirementCount ?? 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted">Analysis</div>
                <div className="mt-0.5 text-sm font-medium">
                  {analysisLabel(p.analysisStatus)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted">Status</div>
                <div className="mt-0.5 text-sm font-medium">
                  {p.status ?? 'DRAFT'}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted">Created</div>
                <div className="mt-0.5 text-sm font-medium">
                  {formatDate(p.createdAt)}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Delete Project?"
        danger
        confirmLabel="Delete Project"
        busy={deleteMutation.isPending}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
        }}
      >
        <p>
          This will remove project <strong>{deleting?.name}</strong>, its
          requirements, analysis results, questions, review data, feature
          groups, and relationships.
        </p>
        <p className="mt-2 font-medium text-danger">
          This action cannot be undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}
