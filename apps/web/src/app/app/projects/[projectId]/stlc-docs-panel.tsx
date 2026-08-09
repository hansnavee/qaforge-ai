'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { Button } from '@/components/Button';
import { cn } from '@/lib/cn';

type PhaseSummary = {
  id: string;
  label: string;
  agentName: string;
  index: number;
  status: string;
  documentVersion: number;
  editedByHuman: boolean;
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

function statusLabel(status: string) {
  switch (status) {
    case 'ACCEPTED':
      return 'Done';
    case 'READY_FOR_REVIEW':
      return 'Your turn';
    case 'RUNNING':
      return 'AI working';
    case 'FAILED':
      return 'Needs attention';
    case 'LOCKED':
      return 'Locked';
    default:
      return status;
  }
}

function friendlyDocPreview(doc: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (typeof doc.summary === 'string' && doc.summary.trim()) {
    lines.push(doc.summary);
  }
  if (typeof doc.kind === 'string') {
    lines.push(`Package: ${doc.kind}`);
  }
  const cases = Array.isArray(doc.testCases)
    ? doc.testCases
    : Array.isArray(doc.cases)
      ? doc.cases
      : null;
  if (cases) lines.push(`${cases.length} item(s) in this package`);
  if (Array.isArray(doc.checklist)) {
    lines.push(`${doc.checklist.length} environment check(s)`);
  }
  if (Array.isArray(doc.scorecard)) {
    lines.push(`${doc.scorecard.length} exit criterion row(s)`);
  }
  if (doc.strategy && typeof doc.strategy === 'object') {
    lines.push('Test strategy package included');
  }
  if (!lines.length) {
    const keys = Object.keys(doc);
    if (keys.length) lines.push(`Contains: ${keys.slice(0, 6).join(', ')}`);
    else lines.push('No document content yet.');
  }
  return lines;
}

export function StlcDocsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const phaseParam = (searchParams.get('phase') ?? '').toUpperCase();
  const [selected, setSelected] = useState(phaseParam || 'REQUIREMENTS');
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

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

  const phases = phasesQuery.data?.phases ?? [];

  const autoPhase = useMemo(() => {
    const yourTurn = phases.find((p) => p.status === 'READY_FOR_REVIEW');
    if (yourTurn) return yourTurn.id;
    const working = phases.find((p) => p.status === 'RUNNING');
    if (working) return working.id;
    const firstOpen = phases.find((p) => p.status !== 'LOCKED');
    return firstOpen?.id ?? 'REQUIREMENTS';
  }, [phases]);

  useEffect(() => {
    if (phaseParam) {
      setSelected(phaseParam);
      setDirty(false);
      setShowRaw(false);
      return;
    }
    if (autoPhase) setSelected(autoPhase);
  }, [phaseParam, autoPhase]);

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

  const detail = phaseQuery.data;
  const currentIndex = phases.find((p) => p.id === selected)?.index ?? 1;
  const doneCount = phases.filter((p) => p.status === 'ACCEPTED').length;

  function selectPhase(id: string) {
    setSelected(id);
    setDirty(false);
    setShowRaw(false);
    router.replace(`?tab=stlc&phase=${id}`, { scroll: false });
  }

  async function download(format: string) {
    const orgId = await getDefaultOrgId();
    window.open(
      `/api/v1/orgs/${orgId}/projects/${projectId}/stlc/phases/${selected}/download?format=${format}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-panel/40 px-4 py-3">
        <p className="text-sm text-fg">
          Simple flow: <strong>AI prepares</strong> → <strong>you review</strong>{' '}
          → <strong>Accept</strong> → next step unlocks.
        </p>
        <p className="mt-1 text-xs text-muted">
          Progress: {doneCount} of {phases.length || 10} steps done
          {detail ? ` · Viewing step ${currentIndex}` : ''}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-1 rounded-xl border border-border bg-surface p-2">
          {phases.map((p) => {
            const active = selected === p.id;
            const done = p.status === 'ACCEPTED';
            const yourTurn = p.status === 'READY_FOR_REVIEW';
            const locked = p.status === 'LOCKED';
            return (
              <button
                key={p.id}
                type="button"
                disabled={locked}
                onClick={() => selectPhase(p.id)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition',
                  active && 'bg-accent/15 ring-1 ring-accent/40',
                  !active && !locked && 'hover:bg-bg-elevated',
                  locked && 'cursor-not-allowed opacity-45',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                    done && 'bg-success/20 text-success',
                    yourTurn && 'bg-accent/25 text-accent',
                    p.status === 'RUNNING' && 'bg-warning/20 text-warning',
                    locked && 'bg-border text-muted',
                  )}
                >
                  {done ? '✓' : p.index}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-fg">{p.label}</span>
                  <span className="block text-[11px] text-muted">
                    {statusLabel(p.status)}
                  </span>
                </span>
              </button>
            );
          })}
        </aside>

        <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          {!detail ? (
            <p className="text-sm text-muted">Loading this step…</p>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Step {currentIndex} · {statusLabel(detail.status)}
                </p>
                <h3 className="text-xl font-semibold text-fg">{detail.label}</h3>
                <p className="text-sm text-muted">
                  Prepared by {detail.agentName}
                </p>
              </div>

              {detail.status === 'LOCKED' ? (
                <div className="mt-6 rounded-lg border border-border bg-panel/50 p-4 text-sm text-muted">
                  This step is locked. Finish the previous step and click{' '}
                  <strong className="text-fg">Accept</strong> to unlock it.
                </div>
              ) : null}

              {detail.status === 'RUNNING' ? (
                <div className="mt-6 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">
                  AI is working on this step in the background. This page
                  refreshes automatically. You only need to wait, then review.
                </div>
              ) : null}

              {detail.status !== 'LOCKED' && detail.status !== 'RUNNING' ? (
                <>
                  {detail.validation ? (
                    <div
                      className={cn(
                        'mt-5 rounded-lg border px-3 py-3 text-sm',
                        detail.validation.passed
                          ? 'border-success/30 bg-success/10 text-fg'
                          : 'border-warning/30 bg-warning/10 text-fg',
                      )}
                    >
                      <p className="font-medium">
                        {detail.validation.passed
                          ? 'AI check passed'
                          : 'AI found issues to review'}
                      </p>
                      <p className="mt-1 text-muted">
                        {detail.validation.summary}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-5 rounded-lg border border-border bg-panel/40 p-4">
                    <p className="text-sm font-medium text-fg">What to review</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                      {friendlyDocPreview(detail.document).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">Download:</span>
                    {(detail.downloads ?? [])
                      .filter((d) =>
                        ['json', 'md', 'html', 'csv'].includes(d.format),
                      )
                      .map((d) => (
                        <Button
                          key={d.format}
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => void download(d.format)}
                        >
                          {d.format.toUpperCase()}
                        </Button>
                      ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowRaw((v) => !v)}
                    >
                      {showRaw ? 'Hide details' : 'Edit details'}
                    </Button>
                  </div>

                  {showRaw ? (
                    <div className="mt-3 space-y-2">
                      <textarea
                        className="min-h-[240px] w-full rounded-lg border border-border bg-bg-elevated p-3 font-mono text-xs text-fg"
                        value={draft}
                        readOnly={!detail.permissions.canEdit}
                        onChange={(e) => {
                          setDraft(e.target.value);
                          setDirty(true);
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={
                          !detail.permissions.canSave ||
                          !dirty ||
                          saveMutation.isPending
                        }
                        onClick={() => saveMutation.mutate()}
                      >
                        {saveMutation.isPending ? 'Saving…' : 'Save edits'}
                      </Button>
                    </div>
                  ) : null}

                  <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
                    <Button
                      type="button"
                      size="lg"
                      disabled={
                        !detail.permissions.canAccept ||
                        dirty ||
                        acceptMutation.isPending
                      }
                      onClick={() => acceptMutation.mutate()}
                    >
                      {acceptMutation.isPending
                        ? 'Accepting…'
                        : detail.status === 'ACCEPTED'
                          ? 'Already accepted'
                          : 'Accept & go to next step'}
                    </Button>
                    <p className="text-xs text-muted">
                      Accept means you reviewed this step and approve moving on.
                    </p>
                  </div>
                  {dirty ? (
                    <p className="mt-2 text-xs text-warning">
                      Save your edits before Accept.
                    </p>
                  ) : null}
                  {saveMutation.isError || acceptMutation.isError ? (
                    <p className="mt-2 text-sm text-danger">
                      {(saveMutation.error || acceptMutation.error)?.message ??
                        'Action failed'}
                    </p>
                  ) : null}
                </>
              ) : null}

              {detail.latestExecutionId ? (
                <p className="mt-4 text-xs text-muted">
                  Run details:{' '}
                  <a
                    className="underline"
                    href={`/app/executions/${detail.latestExecutionId}`}
                  >
                    open execution
                  </a>
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
