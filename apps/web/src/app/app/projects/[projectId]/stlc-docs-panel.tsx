'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, downloadAuthenticated } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { Button } from '@/components/Button';
import { cn } from '@/lib/cn';
import { DesignCasesPanel } from './design-cases-panel';
import { DefectsPanel } from './defects-panel';

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
    canManageCases?: boolean;
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
  if (Array.isArray(doc.bugs)) {
    lines.push(`${doc.bugs.length} defect(s) on the board`);
  }
  if (Array.isArray(doc.checklist)) {
    lines.push(`${doc.checklist.length} environment check(s)`);
  }
  if (Array.isArray(doc.scorecard)) {
    lines.push(`${doc.scorecard.length} exit criterion row(s)`);
  }
  if (doc.strategy && typeof doc.strategy === 'object') {
    lines.push('Test strategy package included');
  }
  const generation = doc.generation as { files?: string[]; manifest?: unknown } | undefined;
  if (generation?.files?.length) {
    lines.push(`${generation.files.length} automation file(s) generated`);
  }
  if (doc.scores && typeof doc.scores === 'object') {
    lines.push('Scorecard / report metrics included');
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

function phaseTick(status: string): string {
  if (status === 'ACCEPTED') return '✓';
  if (status === 'READY_FOR_REVIEW' || status === 'RUNNING') return '●';
  if (status === 'FAILED') return '!';
  return '○';
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
        currentCycle?: number;
        canStartNextCycle?: boolean;
        latestExecutionId: string | null;
        latestExecutionStatus: string | null;
        currentPhaseId: string | null;
      }>(`/api/v1/orgs/${orgId}/projects/${projectId}/stlc/phases`);
    },
    refetchInterval: 4000,
  });

  const phases = phasesQuery.data?.phases ?? [];
  const currentPhaseId = phasesQuery.data?.currentPhaseId ?? null;

  /** Active Accept-gate phase (where the run is waiting). */
  const gatePhase = useMemo(() => {
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

  /**
   * Allow browsing ACCEPTED/READY prior steps (e.g. Design cases while the
   * gate is Environment). Only bounce away from LOCKED / unknown phases.
   */
  const viewingPhase = useMemo(() => {
    if (phaseParam) {
      const requested = phases.find((p) => p.id === phaseParam);
      if (requested && requested.status !== 'LOCKED') return requested;
    }
    return gatePhase;
  }, [phaseParam, phases, gatePhase]);

  const selected = viewingPhase?.id ?? 'PLANNING';

  useEffect(() => {
    if (!phases.length || !gatePhase) return;
    const requested = phaseParam
      ? phases.find((p) => p.id === phaseParam)
      : null;
    if (!phaseParam || !requested || requested.status === 'LOCKED') {
      if (phaseParam !== gatePhase.id) {
        router.replace(`?tab=stlc&phase=${gatePhase.id}`, { scroll: false });
      }
    }
  }, [phases, gatePhase, phaseParam, router]);

  const phaseQuery = useQuery({
    queryKey: ['stlc-phase', projectId, selected],
    enabled: Boolean(viewingPhase),
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<PhaseDetail>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/stlc/phases/${selected}`,
      );
    },
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === 'RUNNING' || s === 'READY_FOR_REVIEW') return 3000;
      return false;
    },
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

  const nextCycleMutation = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<{ cycleNumber: number }>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/stlc/cycles`,
        { method: 'POST' },
      );
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['stlc-phases', projectId] });
      await qc.invalidateQueries({ queryKey: ['stlc-phase', projectId] });
      void qc.invalidateQueries({ queryKey: ['project', projectId] });
      router.replace(`?tab=stlc&phase=EXECUTION`, { scroll: false });
    },
  });

  const detail = phaseQuery.data;
  const stepNum = viewingPhase?.index ?? 1;
  const total = phases.length || 10;
  const doneCount = phases.filter((p) => p.status === 'ACCEPTED').length;
  const prevPhase = phases.find((p) => p.index === stepNum - 1);
  const nextPhase = phases.find((p) => p.index === stepNum + 1);
  const latestExecutionId = phasesQuery.data?.latestExecutionId ?? null;
  const browsingPastGate =
    Boolean(gatePhase && viewingPhase && gatePhase.id !== viewingPhase.id);
  const awaitingAi = detail?.status === 'RUNNING';
  const waitingToStart =
    (selected === 'PLANNING' || selected === 'DESIGN') &&
    !latestExecutionId &&
    detail?.status !== 'ACCEPTED';

  async function download(format: string) {
    const orgId = await getDefaultOrgId();
    await downloadAuthenticated(
      `/api/v1/orgs/${orgId}/projects/${projectId}/stlc/phases/${selected}/download?format=${format}`,
      `stlc-${selected.toLowerCase()}.${format === 'junit' ? 'xml' : format}`,
    );
  }

  async function downloadProjectExport(
    kind: 'test-cases' | 'bugs' | 'results' | 'final-pack',
    format = 'csv',
  ) {
    const orgId = await getDefaultOrgId();
    if (kind === 'final-pack') {
      await downloadAuthenticated(
        `/api/v1/orgs/${orgId}/projects/${projectId}/stlc/final-pack`,
        `stlc-final-pack.zip`,
      );
      return;
    }
    await downloadAuthenticated(
      `/api/v1/orgs/${orgId}/projects/${projectId}/${kind}/download?format=${format}`,
      `${kind}.${format}`,
    );
  }

  function goPrev() {
    if (!prevPhase || prevPhase.status === 'LOCKED') return;
    setDirty(false);
    router.replace(`?tab=stlc&phase=${prevPhase.id}`, { scroll: false });
  }

  if (!gatePhase && !viewingPhase) {
    return (
      <p className="text-sm text-muted">
        No QA step available yet. Approve requirements first, then start Test
        Planning.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Progress + phase ticks */}
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
            style={{
              width: `${Math.max(8, (doneCount / Math.max(total, 1)) * 100)}%`,
            }}
          />
        </div>
        <ol className="flex flex-wrap gap-1.5 pt-1">
          {phases.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                title={`${p.label}: ${p.status}`}
                disabled={p.status === 'LOCKED'}
                onClick={() => {
                  if (p.status === 'LOCKED') return;
                  setDirty(false);
                  router.replace(`?tab=stlc&phase=${p.id}`, { scroll: false });
                }}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]',
                  p.id === selected
                    ? 'border-accent bg-accent/10 text-fg'
                    : p.status === 'ACCEPTED'
                      ? 'border-success/30 bg-success/10 text-success'
                      : p.status === 'LOCKED'
                        ? 'border-border text-muted opacity-50'
                        : 'border-border text-muted hover:bg-panel',
                )}
              >
                <span aria-hidden>{phaseTick(p.status)}</span>
                <span>{p.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      {browsingPastGate && gatePhase ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
          <p className="text-muted">
            Viewing past step. Your turn now:{' '}
            <span className="font-medium text-fg">{gatePhase.label}</span>
          </p>
          <Button
            type="button"
            size="sm"
            onClick={() =>
              router.replace(`?tab=stlc&phase=${gatePhase.id}`, {
                scroll: false,
              })
            }
          >
            Go to your turn →
          </Button>
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          {browsingPastGate ? 'Browsing completed step' : 'Your turn'}
        </p>
        <h3 className="mt-1 text-2xl font-semibold text-fg">
          {viewingPhase?.label ?? selected}
        </h3>
        <p className="mt-1 text-sm text-muted">
          {viewingPhase?.agentName}
          {detail?.description ? ` · ${detail.description}` : ''}
        </p>

        {!detail ? (
          <p className="mt-6 text-sm text-muted">Loading this step…</p>
        ) : waitingToStart ? (
          <div className="mt-6 rounded-lg border border-accent/30 bg-accent/10 p-4 text-sm">
            <p className="font-medium text-fg">Ready to start Test Planning</p>
            <p className="mt-1 text-muted">
              Click <span className="text-fg">Continue to Test Planning</span>{' '}
              above. AI will generate the strategy and design test cases, then
              unlock Test Design for edit/delete review.
            </p>
          </div>
        ) : awaitingAi ? (
          <div className="mt-6 space-y-3">
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">
              {selected === 'PLANNING' || selected === 'DESIGN' ? (
                <>
                  <p className="font-medium text-fg">
                    AI is generating the test strategy and designing test cases
                  </p>
                  <p className="mt-1 text-muted">
                    Stay on this page — Design unlocks automatically when cases
                    are ready for your review.
                  </p>
                </>
              ) : (
                <p>
                  AI is preparing this step. Wait here — the page updates
                  automatically. Then review and Accept.
                </p>
              )}
            </div>
            {selected === 'DESIGN' ? (
              <DesignCasesPanel projectId={projectId} canEdit={false} />
            ) : null}
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

            {selected === 'DESIGN' ? (
              <DesignCasesPanel
                projectId={projectId}
                canEdit={Boolean(
                  detail.permissions.canManageCases ||
                    detail.permissions.canEdit ||
                    detail.status === 'ACCEPTED',
                )}
              />
            ) : selected === 'DEFECTS' ? (
              <DefectsPanel
                projectId={projectId}
                executionId={latestExecutionId}
              />
            ) : (
              <div className="mt-5 rounded-lg border border-border bg-panel/40 p-4">
                <p className="text-sm font-medium text-fg">What to review</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  {friendlyDocPreview(detail.document).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {selected === 'AUTOMATION' &&
                Array.isArray(
                  (detail.document.generation as { files?: string[] } | undefined)
                    ?.files,
                ) ? (
                  <ul className="mt-3 max-h-40 space-y-1 overflow-auto font-mono text-xs text-muted">
                    {(
                      (detail.document.generation as { files: string[] }).files ??
                      []
                    ).map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Download</span>
              {(detail.downloads ?? []).map((d) => {
                const label =
                  d.format === 'xlsx'
                    ? 'Excel'
                    : d.format === 'docx'
                      ? 'Word'
                      : d.format === 'pdf'
                        ? 'PDF'
                        : d.format === 'csv'
                          ? 'CSV'
                          : d.format === 'html'
                            ? 'HTML'
                            : d.format === 'md'
                              ? 'Markdown'
                              : d.format === 'junit'
                                ? 'JUnit'
                                : d.format === 'zip'
                                  ? 'ZIP'
                                  : d.format.toUpperCase();
                return (
                  <Button
                    key={d.format}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void download(d.format)}
                  >
                    {label}
                  </Button>
                );
              })}
              {selected === 'DESIGN' ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void downloadProjectExport('test-cases', 'csv')}
                  >
                    Cases CSV
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void downloadProjectExport('test-cases', 'xlsx')}
                  >
                    Cases Excel
                  </Button>
                </>
              ) : null}
              {selected === 'REPORTING' || selected === 'SIGNOFF' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void downloadProjectExport('final-pack')}
                >
                  Final ZIP
                </Button>
              ) : null}
              {selected !== 'DESIGN' &&
              selected !== 'DEFECTS' &&
              selected !== 'REQUIREMENTS' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowRaw((v) => !v)}
                >
                  {showRaw ? 'Hide edit' : 'Edit'}
                </Button>
              ) : null}
            </div>

            {showRaw && selected !== 'DESIGN' ? (
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
                  : selected === 'DESIGN'
                    ? 'Accept design & continue →'
                    : 'Accept & next →'}
            </Button>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-muted">
        {selected === 'DESIGN'
          ? 'Test cases stay editable anytime — even after Design was accepted.'
          : browsingPastGate
            ? 'You can revisit completed steps. Accept only applies on your current turn.'
            : 'After Accept, we take you to the next phase automatically.'}
      </p>

      {phasesQuery.data?.canStartNextCycle ? (
        <div className="rounded-lg border border-border bg-panel/40 p-4 text-center">
          <p className="text-sm text-fg">
            Cycle {phasesQuery.data.currentCycle ?? 1} complete — start the next
            post-fix cycle (reuses Design / Env / Data).
          </p>
          <Button
            type="button"
            className="mt-3"
            disabled={nextCycleMutation.isPending}
            onClick={() => nextCycleMutation.mutate()}
          >
            {nextCycleMutation.isPending
              ? 'Starting…'
              : `Start Cycle ${(phasesQuery.data.currentCycle ?? 1) + 1} (post-fix)`}
          </Button>
          {nextCycleMutation.isError ? (
            <p className="mt-2 text-sm text-danger">
              {nextCycleMutation.error.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
