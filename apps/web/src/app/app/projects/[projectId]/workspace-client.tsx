'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

type RequirementDoc = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize?: number | null;
  sourceType: string;
  originalContent?: string | null;
  createdAt: string;
};

type ProjectDetail = {
  id: string;
  name: string;
  appUrl?: string | null;
  status?: string | null;
  createdAt: string;
  requirementCount?: number;
  requirements?: RequirementDoc[];
  primaryRequirement?: RequirementDoc | null;
};

const WORKFLOW = [
  { id: 'project', label: 'Project', state: 'done' as const },
  { id: 'requirements', label: 'Requirements', state: 'active' as const },
  { id: 'test-design', label: 'Test Design', state: 'locked' as const },
  { id: 'manual', label: 'Manual Testing', state: 'locked' as const },
  { id: 'bugs', label: 'Bug Management', state: 'locked' as const },
  { id: 'automation', label: 'Automation', state: 'locked' as const },
  { id: 'execution', label: 'Execution', state: 'locked' as const },
  { id: 'reports', label: 'Reports', state: 'locked' as const },
];

function formatDate(value: string) {
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

export default function ProjectWorkspacePage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [analyzeMessage, setAnalyzeMessage] = useState<string | null>(null);

  const showOverview = searchParams.get('tab') === 'overview';

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      try {
        return await api<ProjectDetail>(`/api/v1/projects/${projectId}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) return null;
        throw e;
      }
    },
    enabled: Boolean(projectId),
  });

  const project = projectQuery.data;
  const requirement = useMemo(() => {
    if (!project) return null;
    return (
      project.primaryRequirement ??
      project.requirements?.[0] ??
      null
    );
  }, [project]);

  if (projectQuery.isLoading) {
    return <p className="text-sm text-muted">Loading project…</p>;
  }

  if (projectQuery.error || !project) {
    return (
      <Card>
        <p className="text-sm text-danger">
          {projectQuery.error instanceof ApiError
            ? projectQuery.error.message
            : 'Project not found.'}
        </p>
        <Link href="/app/projects" className="mt-4 inline-block">
          <Button variant="secondary" size="sm">
            Back to dashboard
          </Button>
        </Link>
      </Card>
    );
  }

  const status = project.status ?? 'DRAFT';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Link href="/app/projects" className="hover:text-fg">
              Dashboard
            </Link>
            <span>/</span>
            <span className="text-fg">{project.name}</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {project.name}
          </h1>
          {project.appUrl ? (
            <p className="mt-1 font-mono text-xs text-muted">{project.appUrl}</p>
          ) : (
            <p className="mt-1 text-xs text-muted">No application URL set</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="warning">Status: {status}</Badge>
            <Badge>
              {(project.requirementCount ??
                project.requirements?.length ??
                0) === 1
                ? '1 Document'
                : `${project.requirementCount ?? project.requirements?.length ?? 0} Documents`}
            </Badge>
            <Badge>Created {formatDate(project.createdAt)}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant={showOverview ? 'primary' : 'secondary'}
            size="sm"
            onClick={() =>
              router.replace(`?tab=overview`, { scroll: false })
            }
          >
            Overview
          </Button>
          <Button
            variant={!showOverview ? 'primary' : 'secondary'}
            size="sm"
            onClick={() =>
              router.replace(`?tab=requirements`, { scroll: false })
            }
          >
            Requirements
          </Button>
        </div>
      </div>

      <Card className="space-y-3">
        <h2 className="text-sm font-medium">QA Workflow</h2>
        <div className="flex flex-wrap gap-2">
          {WORKFLOW.map((step) => (
            <span
              key={step.id}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs',
                step.state === 'done' &&
                  'border-success/40 bg-success/10 text-success',
                step.state === 'active' &&
                  'border-accent/40 bg-accent/10 text-accent',
                step.state === 'locked' && 'border-border text-muted',
              )}
            >
              {step.state === 'done'
                ? '✓'
                : step.state === 'active'
                  ? '●'
                  : '🔒'}{' '}
              {step.label}
            </span>
          ))}
        </div>
      </Card>

      {showOverview ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <div className="text-xs uppercase tracking-wide text-muted">
              Project
            </div>
            <div className="mt-2 font-medium">{project.name}</div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide text-muted">
              Requirements
            </div>
            <div className="mt-2 font-medium">
              {project.requirementCount ?? project.requirements?.length ?? 0}{' '}
              Document
              {(project.requirementCount ??
                project.requirements?.length ??
                0) === 1
                ? ''
                : 's'}
            </div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide text-muted">
              Status
            </div>
            <div className="mt-2">
              <Badge tone="warning">{status}</Badge>
            </div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide text-muted">
              Created
            </div>
            <div className="mt-2 font-medium">
              {formatDate(project.createdAt)}
            </div>
          </Card>
        </div>
      ) : (
        <Card className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">Requirements</h2>
              <p className="mt-1 text-sm text-muted">
                Original requirement source for {project.name}
              </p>
            </div>
            <Badge tone="warning">Status: {status}</Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_1fr]">
            <div className="rounded-lg border border-border bg-bg-elevated/50 p-4">
              <h3 className="text-sm font-medium">Requirement Source</h3>
              {requirement ? (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="font-medium text-fg">
                    {requirement.sourceType === 'PASTE'
                      ? 'Pasted requirements'
                      : requirement.fileName}
                  </div>
                  <div className="text-muted">
                    {requirement.sourceType === 'UPLOAD'
                      ? 'Uploaded'
                      : 'Entered manually'}
                  </div>
                  <div className="text-xs text-muted">
                    {formatDate(requirement.createdAt)}
                  </div>
                  {typeof requirement.fileSize === 'number' ? (
                    <div className="text-xs text-muted">
                      {Math.round(requirement.fileSize / 1024)} KB ·{' '}
                      {requirement.fileType}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  No requirement document saved yet.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border p-4">
              <h3 className="text-sm font-medium">Requirement Details</h3>
              <p className="mt-1 text-xs uppercase tracking-wide text-muted">
                Original Requirement
              </p>
              {requirement?.originalContent ? (
                <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">
                  {requirement.originalContent}
                </pre>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  Original content is not available for this document.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 border-t border-border pt-4">
            <Button
              onClick={() =>
                setAnalyzeMessage(
                  'Requirement Analysis will be implemented in Piece 2.',
                )
              }
            >
              Analyze Requirements
            </Button>
            {analyzeMessage ? (
              <p className="text-sm text-muted">{analyzeMessage}</p>
            ) : (
              <p className="text-xs text-muted">
                AI analysis is not enabled yet. Your original requirements stay
                unchanged.
              </p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
