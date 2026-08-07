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
  appUrl: string;
  framework?: string;
  environment?: string;
  updatedAt?: string;
};

export default function ProjectsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      try {
        return await api<Project[] | { items: Project[] }>('/api/v1/projects');
      } catch (e) {
        if (e instanceof ApiError && (e.status === 0 || e.status === 404)) {
          return [] as Project[];
        }
        throw e;
      }
    },
  });

  const projects = Array.isArray(data)
    ? data
    : data && 'items' in data
      ? data.items
      : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted">
            Applications under QAForge orchestration.
          </p>
        </div>
        <Link href="/app/projects/new">
          <Button>New project</Button>
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
            Create a project to start requirement analysis and automation.
          </p>
          <Link href="/app/projects/new" className="mt-4 inline-block">
            <Button size="sm">Create project</Button>
          </Link>
        </Card>
      ) : null}

      <div className="grid gap-3">
        {projects.map((p) => (
          <Link key={p.id} href={`/app/projects/${p.id}`}>
            <Card className="transition hover:border-accent/40">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="mt-1 font-mono text-xs text-muted">
                    {p.appUrl}
                  </div>
                </div>
                <div className="flex gap-2">
                  {p.framework ? <Badge>{p.framework}</Badge> : null}
                  {p.environment ? (
                    <Badge tone="accent">{p.environment}</Badge>
                  ) : null}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
