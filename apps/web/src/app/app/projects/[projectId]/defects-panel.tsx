'use client';

import { useQuery } from '@tanstack/react-query';
import { api, API_URL, downloadAuthenticated } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';

type BugRow = {
  id: string;
  title: string;
  severity: string;
  status: string;
  description: string;
  stepsToReproduce?: string | null;
  evidenceKeys?: string[] | null;
  testCaseId?: string | null;
  testCase?: { externalId?: string | null; scenario?: string | null } | null;
};

function evidenceUrl(
  orgId: string,
  executionId: string,
  key: string,
): string {
  return `${API_URL.replace(/\/$/, '')}/api/v1/orgs/${orgId}/executions/${executionId}/artifacts/by-key?key=${encodeURIComponent(key)}`;
}

export function DefectsPanel({
  projectId,
  executionId,
}: {
  projectId: string;
  executionId: string | null;
}) {
  const bugsQuery = useQuery({
    queryKey: ['bugs', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<BugRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/bugs`,
      );
    },
    refetchInterval: 5000,
  });

  const bugs = bugsQuery.data ?? [];

  async function exportBugs(format: string) {
    const orgId = await getDefaultOrgId();
    await downloadAuthenticated(
      `/api/v1/orgs/${orgId}/projects/${projectId}/bugs/download?format=${format}`,
      `bugs.${format === 'xls' ? 'csv' : format}`,
    );
  }

  if (bugsQuery.isLoading) {
    return <p className="mt-5 text-sm text-muted">Loading defects…</p>;
  }

  if (!bugs.length) {
    return (
      <div className="mt-5 rounded-lg border border-border bg-panel/40 p-4 text-sm text-muted">
        No defects filed for this run. Board is empty.
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg">
          Defect board ({bugs.length})
        </p>
        <div className="flex flex-wrap gap-2">
          {(['csv', 'json', 'html'] as const).map((f) => (
            <Button
              key={f}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void exportBugs(f)}
            >
              {f.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>
      <ul className="space-y-3">
        {bugs.map((b) => {
          const keys = Array.isArray(b.evidenceKeys) ? b.evidenceKeys : [];
          return (
            <li
              key={b.id}
              className="rounded-lg border border-border bg-panel/40 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-fg">{b.title}</p>
                  <p className="mt-1 text-xs text-muted">
                    {b.testCase?.externalId ?? b.testCaseId ?? '—'}
                    {b.testCase?.scenario ? ` · ${b.testCase.scenario}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge tone="accent">{b.severity}</Badge>
                  <Badge>{b.status}</Badge>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-muted">
                {b.description}
              </p>
              {b.stepsToReproduce ? (
                <pre className="mt-2 overflow-auto rounded bg-bg-elevated p-2 text-xs text-muted">
                  {b.stepsToReproduce}
                </pre>
              ) : null}
              {keys.length && executionId ? (
                <EvidenceList executionId={executionId} keys={keys} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EvidenceList({
  executionId,
  keys,
}: {
  executionId: string;
  keys: string[];
}) {
  const { data: orgId } = useQuery({
    queryKey: ['org-id'],
    queryFn: () => getDefaultOrgId(),
  });
  if (!orgId) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-3">
      {keys.map((key) => {
        const url = evidenceUrl(orgId, executionId, key);
        const isVideo = /\.(webm|mp4)$/i.test(key);
        const isImage = /\.(png|jpe?g|gif|webp)$/i.test(key);
        if (isImage) {
          return (
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={key}
                className="h-28 w-auto max-w-[220px] object-cover"
              />
            </a>
          );
        }
        if (isVideo) {
          return (
            <video
              key={key}
              src={url}
              controls
              className="h-28 max-w-[240px] rounded border border-border"
            />
          );
        }
        return (
          <a
            key={key}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent underline"
          >
            {key.split('/').pop()}
          </a>
        );
      })}
    </div>
  );
}
