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

function friendlyDocPreview(doc: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (typeof doc.summary === 'string' && doc.summary.trim()) {
    lines.push(doc.summary);
  }
  if (typeof doc.kind === 'string') lines.push(`Package: ${doc.kind}`);
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
    lines.push(
      keys.length
        ? `Contains: ${keys.slice(0, 6).join(', ')}`
        : 'No document content yet.',
    );
  }
  return lines;
}

export function StlcDocsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const phaseParam = (searchParams.get('phase') ?? '').toUpperCase();
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
        latestExecutionStatus: string | null;
        currentPhaseId: string | null;
      }>(`/api/v1/orgs/${orgId}/projects/${projectId}/stlc/phases`);
    },
    refetchInterval: 4000,
  });

  const phases = phasesQuery.data?.phases ?? [];
  const currentPhaseId = phasesQuery.data?.currentPhaseId ?? null;

  /** Only the active gate phase — ignore stale READY docs from earlier steps. */
  const currentPhase = useMemo(() => {
    if (currentPhaseId) {
      const active = phases.find((p) => p.id === currentPhaseId);
      if (active) return active;
    }
    const yourTurn = phases.find((p) => p.status === 'READY_FOR_REVIEW');
    if (yourTurn) return yourTurn;
    return (
      phases.find((p) => p.status === 'RUNNING') ??
      phases.find((p) => p.status === 'FAILED') ??
      [...phases].reverse().find((p) => p.status === 'ACCEPTED') ??
      phases[0] ??
      null
    );
  }, [phases, currentPhaseId]);

  const selected = currentPhase?.id ?? 'PLANNING';

  useEffect(() => {
    if (!currentPhase) return;
    // Always keep the URL on the active gate so users don't get stuck on an
    // older step with Accept disabled.
    if (phaseParam !== currentPhase.id) {
      router.replace(`?tab=stlc&phase=${currentPhase.id}`, { scroll: false });
    }
  }, [currentPhase, phaseParam, router]);

  const phaseQuery = useQuery({
    queryKey: ['stlc-phase', projectId, selected],
    enabled: Boolean(currentPhase),
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
    setShowRaw(false);
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
    onSuccess: async () => {
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ['stlc-phases', projectId] });
      await qc.invalidateQueries({ queryKey: ['stlc-phase', projectId] });
      void qc.invalidateQueries({ queryKey: ['project', projectId] });
      void qc.invalidateQueries({ queryKey: ['review-summary', projectId] });
      // After accept, refetch phases and jump to next unlocked step
      const orgId = await getDefaultOrgId();
      const next = await api<{ phases: PhaseSummary[] }>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/stlc/phases`,
      );
      const following =
        next.phases.find((p) => p.status === 'READY_FOR_REVIEW') ??
        next.phases.find((p) => p.status === 'RUNNING') ??
        next.phases.find((p) => p.status !== 'LOCKED' && p.status !== 'ACCEPTED');
      if (following) {
        router.replace(`?tab=stlc&phase=${following.id}`, { scroll: false });
      }
    },
  });

  const detail = phaseQuery.data;
  const stepNum = currentPhase?.index ?? 1;
  const total = phases.length || 10;
  const doneCount = phases.filter((p) => p.status === 'ACCEPTED').length;
  const prevPhase = phases.find((p) => p.index === stepNum - 1);
  const nextPhase = phases.find((p) => p.index === stepNum + 1);

  async function download(format: string) {
    const orgId = await getDefaultOrgId();
    window.open(
      `/api/v1/orgs/${orgId}/projects/${projectId}/stlc/phases/${selected}/download?format=${format}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  function goPrev() {
    if (!prevPhase || prevPhase.status === 'LOCKED') return;
    setDirty(false);
    router.replace(`?tab=stlc&phase=${prevPhase.id}`, { scroll: false });
  }

  if (!currentPhase) {
    return (
      <p className="text-sm text-muted">
        No QA step available yet. Approve requirements first, then start Test
        Planning.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Single progress strip — not a list of all tabs */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-fg">
            Step {stepNum} of {total}
          </span>
          <span className="text-muted">{doneCount} completed</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${Math.max(8, (stepNum / total) * 100)}%` }}
          />
        </div>
      </div>

      <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          Current phase only
        </p>
        <h3 className="mt-1 text-2xl font-semibold text-fg">
          {currentPhase.label}
        </h3>
        <p className="mt-1 text-sm text-muted">
          {currentPhase.agentName}
          {detail?.description ? ` · ${detail.description}` : ''}
        </p>

        {!detail ? (
          <p className="mt-6 text-sm text-muted">Loading this step…</p>
        ) : detail.status === 'RUNNING' ? (
          <div className="mt-6 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">
            AI is preparing this step. Wait here — the page updates
            automatically. Then review and Accept.
          </div>
        ) : (
          <>
            {detail.validation ? (
              <div
                className={cn(
                  'mt-5 rounded-lg border px-3 py-3 text-sm',
                  detail.validation.passed
                    ? 'border-success/30 bg-success/10'
                    : 'border-warning/30 bg-warning/10',
                )}
              >
                <p className="font-medium text-fg">
                  {detail.validation.passed
                    ? 'Ready for your review'
                    : 'Review carefully'}
                </p>
                <p className="mt-1 text-muted">{detail.validation.summary}</p>
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
              <span className="text-xs text-muted">Download</span>
              {(detail.downloads ?? [])
                .filter((d) => ['md', 'html', 'csv', 'json'].includes(d.format))
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
                {showRaw ? 'Hide edit' : 'Edit'}
              </Button>
            </div>

            {showRaw ? (
              <div className="mt-3 space-y-2">
                <textarea
                  className="min-h-[200px] w-full rounded-lg border border-border bg-bg-elevated p-3 font-mono text-xs"
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
                  Save
                </Button>
              </div>
            ) : null}

            {dirty ? (
              <p className="mt-2 text-xs text-warning">
                Save edits before continuing.
              </p>
            ) : null}
            {acceptMutation.isError || saveMutation.isError ? (
              <p className="mt-2 text-sm text-danger">
                {(acceptMutation.error || saveMutation.error)?.message ??
                  'Action failed'}
              </p>
            ) : null}
          </>
        )}
      </section>

      {/* One-by-one navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={!prevPhase || prevPhase.status === 'LOCKED'}
          onClick={goPrev}
        >
          ← Previous
        </Button>

        <div className="flex flex-wrap gap-2">
          {detail?.status === 'ACCEPTED' &&
          nextPhase &&
          nextPhase.status !== 'LOCKED' ? (
            <Button
              type="button"
              onClick={() =>
                router.replace(`?tab=stlc&phase=${nextPhase.id}`, {
                  scroll: false,
                })
              }
            >
              Next step →
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              disabled={
                !detail?.permissions.canAccept ||
                dirty ||
                acceptMutation.isPending ||
                detail?.status === 'RUNNING' ||
                detail?.status === 'ACCEPTED'
              }
              onClick={() => acceptMutation.mutate()}
            >
              {acceptMutation.isPending
                ? 'Saving…'
                : detail?.status === 'ACCEPTED'
                  ? 'Accepted'
                  : 'Accept & next →'}
            </Button>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-muted">
        You only work on this one phase. After Accept, we take you to the next
        phase automatically.
      </p>
    </div>
  );
}
