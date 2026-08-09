'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { api, ApiError } from '@/lib/api';

type Project = {
  id: string;
  name: string;
  appUrl?: string | null;
  status?: string | null;
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

export default function ProjectsPage() {
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

  const projects = data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Your QA projects and requirement intake status.
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
            Create a project, attach requirements, and open the Requirements
            workspace.
          </p>
          <Link href="/app/projects/new" className="mt-4 inline-block">
            <Button size="sm">Create Project</Button>
          </Link>
        </Card>
      ) : null}

      <div className="grid gap-3">
        {projects.map((p) => (
          <Link
            key={p.id}
            href={`/app/projects/${p.id}?tab=requirements`}
          >
            <Card className="transition hover:border-accent/40">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted">
                    Project
                  </div>
                  <div className="mt-1 text-lg font-medium">{p.name}</div>
                  {p.appUrl ? (
                    <div className="mt-1 font-mono text-xs text-muted">
                      {p.appUrl}
                    </div>
                  ) : null}
                </div>
                <Badge tone="warning">{p.status ?? 'DRAFT'}</Badge>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-muted">Requirements</div>
                  <div className="mt-0.5 text-sm font-medium">
                    {p.requirementCount ?? 0} Document
                    {(p.requirementCount ?? 0) === 1 ? '' : 's'}
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

              <div className="mt-4 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded border border-success/40 bg-success/10 px-2 py-0.5 text-success">
                  ✓ Project
                </span>
                <span className="rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-accent">
                  ● Requirements
                </span>
                {[
                  'Test Design',
                  'Manual Testing',
                  'Bug Management',
                  'Automation',
                  'Execution',
                  'Reports',
                ].map((label) => (
                  <span
                    key={label}
                    className="rounded border border-border px-2 py-0.5 text-muted"
                  >
                    🔒 {label}
                  </span>
                ))}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
