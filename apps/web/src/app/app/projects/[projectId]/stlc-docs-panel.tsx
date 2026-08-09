'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { Button } from '@/components/Button';

type PhaseSummary = {
  id: string;
  label: string;
  agentName: string;
  index: number;
  status: string;
  documentVersion: number;
  editedByHuman: boolean;
  downloads?: string[];
};

type PhaseDetail = {
  phaseId: string;
  label: string;
  agentName: string;
  description?: string;
  status: string;
  validation: { passed: boolean; blockers: string[]; summary: string } | null;
  document: Record<string, unknown>;
  documentVersion: number;
  editedByHuman: boolean;
  permissions: {
    canEdit: boolean;
    canSave: boolean;
    canAccept: boolean;
    canReopen: boolean;
  };
  downloads: Array<{ format: string; url: string }>;
  latestExecutionId?: string | null;
};

export function StlcDocsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const phaseParam = (searchParams.get('phase') ?? 'REQUIREMENTS').toUpperCase();
  const [selected, setSelected] = useState(phaseParam);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (phaseParam) {
      setSelected(phaseParam);
      setDirty(false);
    }
  }, [phaseParam]);

  const phasesQuery = useQuery({
    queryKey: ['stlc-phases', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<{
        phases: PhaseSummary[];
        stlcStage: string;
        latestExecutionId: string | null;
      }>(`/api/v1/orgs/${orgId}/projects/${projectId}/stlc/phases`);
    },
    refetchInterval: 4000,
  });

  const phaseQuery = useQuery({
    queryKey: ['stlc-phase', projectId, selected],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<PhaseDetail>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/stlc/phases/${selected}`,
      );
    },
    refetchInterval: (q) =>
      q.state.data?.status === 'RUNNING' ? 3000 : false,
  });

  useEffect(() => {
    if (!phaseQuery.data || dirty) return;
    setDraft(JSON.stringify(phaseQuery.data.document ?? {}, null, 2));
  }, [phaseQuery.data, dirty]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      const document = JSON.parse(draft) as Record<string, unknown>;
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/stlc/phases/${selected}/document`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            document,
            documentVersion: phaseQuery.data?.documentVersion,
          }),
        },
      );
    },
    onSuccess: () => {
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ['stlc-phase', projectId, selected] });
      void qc.invalidateQueries({ queryKey: ['stlc-phases', projectId] });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/stlc/phases/${selected}/accept`,
        { method: 'POST', body: '{}' },
      );
    },
    onSuccess: () => {
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ['stlc-phases', projectId] });
      void qc.invalidateQueries({ queryKey: ['stlc-phase', projectId] });
      void qc.invalidateQueries({ queryKey: ['project', projectId] });
      void qc.invalidateQueries({ queryKey: ['review-summary', projectId] });
    },
  });

  const phases = phasesQuery.data?.phases ?? [];
  const detail = phaseQuery.data;

  async function download(format: string) {
    const orgId = await getDefaultOrgId();
    const url = `/api/v1/orgs/${orgId}/projects/${projectId}/stlc/phases/${selected}/download?format=${format}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[220px_1fr]">
      <aside className="space-y-1 rounded-lg border border-zinc-200 bg-white p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          STLC Docs
        </div>
        {phases.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setSelected(p.id);
              setDirty(false);
            }}
            className={`block w-full rounded px-2 py-1.5 text-left text-sm ${
              selected === p.id
                ? 'bg-zinc-900 text-white'
                : 'text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            <div className="font-medium">{p.label}</div>
            <div
              className={`text-[11px] ${
                selected === p.id ? 'text-zinc-300' : 'text-zinc-500'
              }`}
            >
              {p.status}
              {p.editedByHuman ? ' · edited' : ''}
            </div>
          </button>
        ))}
      </aside>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        {!detail ? (
          <p className="text-sm text-zinc-500">Loading phase document…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900">
                  {detail.label}
                </h3>
                <p className="text-sm text-zinc-600">{detail.agentName}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {detail.description} · v{detail.documentVersion}
                  {detail.editedByHuman ? ' · Edited by you' : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(detail.downloads ?? []).map((d) => (
                  <Button
                    key={d.format}
                    type="button"
                    variant="secondary"
                    onClick={() => void download(d.format)}
                  >
                    {d.format.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>

            {detail.validation ? (
              <div
                className={`mt-4 rounded border px-3 py-2 text-sm ${
                  detail.validation.passed
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <div className="font-medium">AI validation</div>
                <div>{detail.validation.summary}</div>
                {detail.validation.blockers?.length ? (
                  <ul className="mt-1 list-disc pl-5">
                    {detail.validation.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {detail.status === 'LOCKED' ? (
              <p className="mt-4 text-sm text-zinc-600">
                Complete and Accept the previous phase to unlock this document.
              </p>
            ) : detail.status === 'RUNNING' ? (
              <p className="mt-4 text-sm text-zinc-600">
                Senior QA AI is preparing documents in the background…
              </p>
            ) : (
              <>
                <label className="mt-4 block text-sm font-medium text-zinc-800">
                  Phase document {detail.permissions.canEdit ? '(editable)' : ''}
                </label>
                <textarea
                  className="mt-1 min-h-[320px] w-full rounded border border-zinc-300 bg-zinc-50 p-3 font-mono text-xs"
                  value={draft}
                  readOnly={!detail.permissions.canEdit}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setDirty(true);
                  }}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={
                      !detail.permissions.canSave ||
                      !dirty ||
                      saveMutation.isPending
                    }
                    onClick={() => saveMutation.mutate()}
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      !detail.permissions.canAccept ||
                      dirty ||
                      acceptMutation.isPending
                    }
                    onClick={() => acceptMutation.mutate()}
                  >
                    Accept & continue
                  </Button>
                </div>
                {dirty ? (
                  <p className="mt-2 text-xs text-amber-700">
                    Save your edits before Accept.
                  </p>
                ) : null}
                {saveMutation.isError || acceptMutation.isError ? (
                  <p className="mt-2 text-xs text-red-700">
                    {(saveMutation.error || acceptMutation.error)?.message ??
                      'Action failed'}
                  </p>
                ) : null}
              </>
            )}

            {detail.latestExecutionId ? (
              <p className="mt-4 text-xs text-zinc-500">
                Linked execution:{' '}
                <a
                  className="underline"
                  href={`/app/executions/${detail.latestExecutionId}`}
                >
                  {detail.latestExecutionId}
                </a>
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
