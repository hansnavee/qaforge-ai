'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { api, ApiError } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';

type Project = {
  id: string;
  name: string;
  appUrl: string;
  loginUrl?: string | null;
  framework?: string;
  language?: string;
  environment?: string;
  requirementText?: string | null;
};

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      try {
        return await api<Project>(`/api/v1/projects/${projectId}`);
      } catch (e) {
        if (e instanceof ApiError) return null;
        throw e;
      }
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<{ id: string }>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/executions`,
        { method: 'POST', body: '{}' },
      );
    },
    onSuccess: (exec) => {
      router.push(`/app/executions/${exec.id}`);
    },
  });

  if (isLoading) {
    return <p className="text-sm text-muted">Loading project…</p>;
  }

  if (!project) {
    return (
      <Card>
        <h1 className="text-lg font-medium">Project unavailable</h1>
        <p className="mt-1 text-sm text-muted">
          The API returned no project for this id. It may not exist yet.
        </p>
        <Link href="/app/projects" className="mt-4 inline-block">
          <Button variant="secondary" size="sm">
            Back to projects
          </Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {project.name}
          </h1>
          <p className="mt-1 font-mono text-sm text-muted">{project.appUrl}</p>
        </div>
        <Button
          onClick={() => run.mutate()}
          disabled={run.isPending}
        >
          {run.isPending ? 'Starting…' : 'Run execution'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {project.framework ? <Badge tone="accent">{project.framework}</Badge> : null}
        {project.language ? <Badge>{project.language}</Badge> : null}
        {project.environment ? <Badge>{project.environment}</Badge> : null}
      </div>

      <Card>
        <h2 className="text-sm font-medium text-muted">Login URL</h2>
        <p className="mt-1 font-mono text-sm">
          {project.loginUrl || 'Same as app URL'}
        </p>
        <h2 className="mt-5 text-sm font-medium text-muted">Requirements</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm text-muted">
          {project.requirementText || 'No requirements text stored.'}

        </p>
      </Card>

      {run.isError ? (
        <p className="text-sm text-danger">
          Could not start execution. Ensure the API and worker are running.
        </p>
      ) : null}
    </div>
  );
}
