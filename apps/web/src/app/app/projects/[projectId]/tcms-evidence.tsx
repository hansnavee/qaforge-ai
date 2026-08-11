'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { cn } from '@/lib/cn';

export function isVideoKey(key: string) {
  return /\.(webm|mp4|mov)(\?|$)/i.test(key) || key.includes('/videos/');
}

export async function uploadEvidence(opts: {
  orgId: string;
  projectId: string;
  resultId: string;
  file: File;
}) {
  const fd = new FormData();
  fd.append('file', opts.file);
  const res = await fetch(
    `${API_URL.replace(/\/$/, '')}/api/v1/orgs/${opts.orgId}/projects/${opts.projectId}/results/${opts.resultId}/evidence`,
    { method: 'POST', credentials: 'include', body: fd },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Upload failed');
  }
}

export function TcmsEvidence({
  projectId,
  executionId,
  resultId,
  keys,
  canEdit,
  onUploaded,
  dropzone,
}: {
  projectId: string;
  executionId: string;
  resultId?: string | null;
  keys: string[];
  canEdit: boolean;
  onUploaded: () => void;
  dropzone?: boolean;
}) {
  const { data: orgId } = useQuery({
    queryKey: ['org-id'],
    queryFn: () => getDefaultOrgId(),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function onFile(file: File) {
    if (!orgId || !resultId) {
      setError('Mark Pass or Fail before attaching evidence.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadEvidence({ orgId, projectId, resultId, file });
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!canEdit || !dropzone) return;
    function onPaste(e: ClipboardEvent) {
      const item = [...(e.clipboardData?.items ?? [])].find((i) =>
        i.type.startsWith('image/'),
      );
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        void onFile(file);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [canEdit, dropzone, orgId, resultId, projectId]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {keys.map((key) => (
          <Shot
            key={key}
            orgId={orgId}
            executionId={executionId}
            storageKey={key}
            video={isVideoKey(key)}
          />
        ))}
      </div>
      {canEdit ? (
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted transition',
            drag ? 'border-accent bg-accent/10 text-fg' : 'border-border hover:text-fg',
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const file = e.dataTransfer.files[0];
            if (file) void onFile(file);
          }}
        >
          {busy
            ? 'Uploading…'
            : dropzone
              ? 'Drop, paste, or click to attach a screenshot or video'
              : 'Attach screenshot or video'}
          <input
            type="file"
            accept="image/*,video/mp4,video/webm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = '';
            }}
          />
        </label>
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function Shot({
  orgId,
  executionId,
  storageKey,
  video,
}: {
  orgId?: string;
  executionId: string;
  storageKey: string;
  video?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!orgId) return;
    let dead = false;
    let created: string | null = null;
    void (async () => {
      const res = await fetch(
        `${API_URL.replace(/\/$/, '')}/api/v1/orgs/${orgId}/executions/${executionId}/artifacts/by-key?key=${encodeURIComponent(storageKey)}`,
        { credentials: 'include' },
      );
      if (!res.ok || dead) return;
      const blob = await res.blob();
      created = URL.createObjectURL(blob);
      if (!dead) setUrl(created);
    })();
    return () => {
      dead = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [orgId, executionId, storageKey]);
  if (!url) {
    return <span className="text-xs text-muted">Loading…</span>;
  }
  if (video) {
    return (
      <video
        src={url}
        controls
        className="h-28 max-w-[220px] rounded-lg border border-border"
      />
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        className="h-24 w-auto max-w-[180px] rounded-lg border border-border object-cover"
      />
    </a>
  );
}
