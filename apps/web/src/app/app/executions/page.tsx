'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { api, ApiError } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';

type Execution = {
  id: string;
  projectId: string;
  status: string;
  phase: string;
  createdAt?: string;
  project?: { name?: string };
};

type Project = { id: string; name: string };

function toneFor(status: string) {
  if (status === 'COMPLETED') return 'success' as const;
  if (status === 'FAILED') return 'danger' as const;
  if (status === 'AWAITING_LOGIN') return 'warning' as const;
  if (status === 'RUNNING' || status === 'QUEUED') return 'accent' as const;
  return 'default' as const;
}

export default function ExecutionsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['executions'],
    queryFn: async () => {
      try {
        const orgId = await getDefaultOrgId();
        const projects = await api<Project[]>(`/api/v1/orgs/${orgId}/projects`);
        const lists = await Promise.all(
          (projects ?? []).map(async (p) => {
            const runs = await api<Execution[]>(
              `/api/v1/orgs/${orgId}/projects/${p.id}/executions`,
            );
            return (runs ?? []).map((ex) => ({
              ...ex,
              project: ex.project ?? { name: p.name },
            }));
          }),
        );
        return lists
          .flat()
          .sort((a, b) =>
            (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
          );
      } catch (e) {
        if (e instanceof ApiError) return [] as Execution[];
        throw e;
      }
    },
  });

  const items = data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Executions</h1>
        <p className="mt-1 text-sm text-muted">
          Live and historical agent pipeline runs.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <Card className="border-dashed">
          <h2 className="font-medium">No executions yet</h2>
          <p className="mt-1 text-sm text-muted">
            Start a run from a project detail page.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((ex) => (
            <Link key={ex.id} href={`/app/executions/${ex.id}`}>
              <Card className="hover:border-accent/40">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {ex.project?.name ?? `Project ${ex.projectId}`}
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted">
                      {ex.id}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Badge tone={toneFor(ex.status)}>{ex.status}</Badge>
                    <Badge>{ex.phase}</Badge>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
