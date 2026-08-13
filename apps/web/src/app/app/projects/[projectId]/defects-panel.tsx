'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
  executionId?: string | null;
  externalRef?: string | null;
  testCase?: { externalId?: string | null; scenario?: string | null } | null;
};

function evidencePath(
  orgId: string,
  executionId: string,
  key: string,
): string {
  return `/api/v1/orgs/${orgId}/executions/${executionId}/artifacts/by-key?key=${encodeURIComponent(key)}`;
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
          const mediaExecId = b.executionId ?? executionId;
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
              {b.externalRef ? (
                <p className="mt-2 text-xs">
                  <a
                    href={b.externalRef}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline"
                  >
                    Jira: {b.externalRef.replace(/\/browse\//, ' · ')}
                  </a>
                </p>
              ) : null}
              {b.stepsToReproduce ? (
                <pre className="mt-2 overflow-auto rounded bg-bg-elevated p-2 text-xs text-muted">
                  {b.stepsToReproduce}
                </pre>
              ) : null}
              {keys.length && mediaExecId ? (
                <EvidenceList executionId={mediaExecId} keys={keys} />
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
      {keys.map((key) => (
        <EvidenceItem
          key={key}
          orgId={orgId}
          executionId={executionId}
          storageKey={key}
        />
      ))}
    </div>
  );
}

function EvidenceItem({
  orgId,
  executionId,
  storageKey,
}: {
  orgId: string;
  executionId: string;
  storageKey: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isVideo = /\.(webm|mp4)$/i.test(storageKey);
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(storageKey);

  useEffect(() => {
    let revoked = false;
    let created: string | null = null;
    void (async () => {
      try {
        const path = evidencePath(orgId, executionId, storageKey);
        const res = await fetch(`${API_URL.replace(/\/$/, '')}${path}`, {
          credentials: 'include',
        });
        if (!res.ok) {
          if (!revoked) setError(res.status === 404 ? 'missing' : `HTTP ${res.status}`);
          return;
        }
        const blob = await res.blob();
        created = URL.createObjectURL(blob);
        if (!revoked) setObjectUrl(created);
      } catch {
        if (!revoked) setError('failed');
      }
    })();
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [orgId, executionId, storageKey]);

  if (error === 'missing') {
    return (
      <span className="rounded border border-border px-2 py-1 text-xs text-muted">
        Evidence unavailable (pre-persistence run)
      </span>
    );
  }
  if (error) {
    return (
      <span className="rounded border border-border px-2 py-1 text-xs text-danger">
        Evidence error
      </span>
    );
  }
  if (!objectUrl) {
    return (
      <span className="rounded border border-border px-2 py-1 text-xs text-muted">
        Loading evidence…
      </span>
    );
  }

  if (isImage) {
    return (
      <a
        href={objectUrl}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded border border-border"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={objectUrl}
          alt={storageKey}
          className="h-28 w-auto max-w-[220px] object-cover"
        />
      </a>
    );
  }
  if (isVideo) {
    return (
      <video
        src={objectUrl}
        controls
        className="h-28 max-w-[240px] rounded border border-border"
      />
    );
  }
  return (
    <a
      href={objectUrl}
      download={storageKey.split('/').pop()}
      className="text-xs text-accent underline"
    >
      {storageKey.split('/').pop()}
    </a>
  );
}
