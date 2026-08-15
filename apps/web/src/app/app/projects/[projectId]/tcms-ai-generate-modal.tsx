'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { parsePlanLimitError } from '@/lib/plan';
import { getDefaultOrgId } from '@/lib/org';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { UpgradeModal } from '@/components/UpgradeModal';
import { fieldClass, areaClass } from './tcms-board';
import type { FolderOption } from './tcms-case-modal';

export type AiGenerateModalDefaults = {
  prompt?: string;
  applyMode?: 'create' | 'update';
  reviewApplication?: boolean;
  source?: 'GENERATE' | 'UPDATE' | 'ENV_REFRESH';
  caseIds?: string[];
  intent?: 'generate' | 'gap';
  jiraEpicKey?: string;
};

type Suggestion = {
  id: string;
  scenario: string;
  preconditions: string | null;
  steps: string[];
  expected: string;
  type: string | null;
  designTechnique: string | null;
  requirementKey: string | null;
  priorityLabel: string | null;
  module: string | null;
  kind: string;
  score: number;
  reason: string | null;
  status: string;
};

type GenerateRun = {
  id: string;
  status: string;
  error: string | null;
  suggestions: Suggestion[];
};

type JiraTicket = {
  key: string;
  summary: string;
  issueType: string;
  selectable: boolean;
};

type OrgFlags = {
  xrayConfigured?: boolean;
  testrailConfigured?: boolean;
  jiraConfigured?: boolean;
};

export function TcmsAiGenerateModal({
  open,
  projectId,
  folders,
  defaultFolderId,
  busy,
  defaults,
  onClose,
  onAdded,
}: {
  open: boolean;
  projectId: string;
  folders: FolderOption[];
  defaultFolderId: string;
  busy?: boolean;
  defaults?: AiGenerateModalDefaults | null;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [prompt, setPrompt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [includeTcms, setIncludeTcms] = useState(true);
  const [includeXray, setIncludeXray] = useState(false);
  const [includeTestrail, setIncludeTestrail] = useState(false);
  const [orgFlags, setOrgFlags] = useState<OrgFlags>({});
  const [tickets, setTickets] = useState<JiraTicket[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [ticketFilter, setTicketFilter] = useState('');
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [run, setRun] = useState<GenerateRun | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    scenario: '',
    expected: '',
    steps: '',
  });
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [upgradeError, setUpgradeError] = useState<
    ReturnType<typeof parsePlanLimitError>
  >(null);

  const visibleTickets = useMemo(() => {
    const q = ticketFilter.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter(
      (t) =>
        t.key.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q),
    );
  }, [tickets, ticketFilter]);

  const visibleSuggestions = useMemo(() => {
    const rows = run?.suggestions ?? [];
    if (showDuplicates) return rows;
    return rows.filter((s) => s.kind !== 'duplicate');
  }, [run, showDuplicates]);

  const acceptedCount = (run?.suggestions ?? []).filter(
    (s) => s.status === 'accepted',
  ).length;

  useEffect(() => {
    if (!open) return;
    setStep('form');
    setPrompt(defaults?.prompt ?? '');
    setFile(null);
    setFolderId(defaultFolderId);
    setError(null);
    setRun(null);
    setSelectedKeys(
      defaults?.jiraEpicKey ? new Set([defaults.jiraEpicKey]) : new Set(),
    );
    setIncludeXray(false);
    setIncludeTestrail(false);
    void loadOrgAndTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, defaultFolderId, defaults]);

  async function loadOrgAndTickets() {
    try {
      const orgId = await getDefaultOrgId();
      const org = await api<OrgFlags>(`/api/v1/orgs/${orgId}`);
      setOrgFlags(org);
      if (!org.jiraConfigured) return;
      setTicketsLoading(true);
      const data = await api<{ tickets: JiraTicket[] }>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/integrations/jira/tickets`,
        { method: 'POST', body: JSON.stringify({ mode: 'BROWSE' }) },
      );
      setTickets(data.tickets ?? []);
    } catch {
      setTickets([]);
    } finally {
      setTicketsLoading(false);
    }
  }

  function reset() {
    setStep('form');
    setPrompt('');
    setFile(null);
    setRun(null);
    setError(null);
    setGenerating(false);
    setAdding(false);
    setEditingId(null);
  }

  async function startGenerate() {
    setError(null);
    let documentText = '';
    if (file) {
      documentText = (await file.text()).slice(0, 100_000);
    }
    const jiraKeys = [...selectedKeys];
    if (!prompt.trim() && !documentText && !jiraKeys.length) {
      setError('Add a prompt, upload a document, or select Jira tickets.');
      return;
    }
    setGenerating(true);
    try {
      const orgId = await getDefaultOrgId();
      const started = await api<GenerateRun>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/ai-generate/runs`,
        {
          method: 'POST',
          body: JSON.stringify({
            prompt: prompt.trim() || undefined,
            documentText: documentText || undefined,
            jiraKeys,
            includeXray,
            includeTestrail,
            includeTcms,
            folderId: folderId || null,
          }),
        },
      );
      setRun(started);
      setStep('review');
      await pollRun(orgId, started.id);
    } catch (err) {
      const planErr =
        err instanceof ApiError ? parsePlanLimitError(err.body) : null;
      if (planErr) {
        setUpgradeError(planErr);
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Generate failed',
      );
    } finally {
      setGenerating(false);
    }
  }

  async function pollRun(orgId: string, runId: string) {
    for (let i = 0; i < 90; i += 1) {
      const next = await api<GenerateRun>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/ai-generate/runs/${runId}`,
      );
      setRun(next);
      if (next.status === 'READY' || next.status === 'FAILED') return;
      await new Promise((r) => setTimeout(r, 2000));
    }
    setError('Generate is still running. Refresh later from Cases.');
  }

  async function patchSuggestion(
    suggestionId: string,
    body: Record<string, unknown>,
  ) {
    if (!run) return;
    const orgId = await getDefaultOrgId();
    const updated = await api<Suggestion>(
      `/api/v1/orgs/${orgId}/projects/${projectId}/ai-generate/runs/${run.id}/suggestions/${suggestionId}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
    setRun((prev) =>
      prev
        ? {
            ...prev,
            suggestions: prev.suggestions.map((s) =>
              s.id === updated.id
                ? {
                    ...s,
                    ...updated,
                    steps: Array.isArray(updated.steps)
                      ? updated.steps
                      : s.steps,
                  }
                : s,
            ),
          }
        : prev,
    );
  }

  async function applyAccepted() {
    if (!run) return;
    setAdding(true);
    setError(null);
    try {
      const orgId = await getDefaultOrgId();
      await api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/ai-generate/runs/${run.id}/apply`,
        {
          method: 'POST',
          body: JSON.stringify({ folderId: folderId || null }),
        },
      );
      reset();
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        title={step === 'form' ? 'AI Generate' : 'Review suggestions'}
        size="xl"
        onClose={() => {
          reset();
          onClose();
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            {step === 'form' ? (
              <Button
                type="button"
                disabled={generating || busy}
                onClick={() => void startGenerate()}
              >
                {generating ? 'Queuing…' : 'Generate'}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={adding || acceptedCount === 0 || run?.status !== 'READY'}
                onClick={() => void applyAccepted()}
              >
                {adding ? 'Applying…' : `Apply ${acceptedCount} accepted`}
              </Button>
            )}
          </div>
        }
      >
        {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
        {step === 'form' ? (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted">
              Collect sources, then review ranked suggestions. Nothing is written
              until you Accept and Apply.
            </p>
            <label className="block text-xs text-muted">
              Prompt
              <textarea
                className={`${areaClass} mt-1 min-h-[100px]`}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the product, epic, or risk you want coverage for"
              />
            </label>
            <label className="block text-xs text-muted">
              Upload document
              <input
                className="mt-1 block text-xs"
                type="file"
                accept=".txt,.md,.csv,.json,.html"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <div>
              <div className="mb-1 text-xs text-muted">
                Jira tickets (multi-select)
                {ticketsLoading ? ' · loading…' : ''}
              </div>
              {!orgFlags.jiraConfigured ? (
                <p className="text-xs text-muted">
                  Connect Jira in Settings to include tickets.
                </p>
              ) : (
                <>
                  <input
                    className={`${fieldClass} mb-2`}
                    placeholder="Filter tickets"
                    value={ticketFilter}
                    onChange={(e) => setTicketFilter(e.target.value)}
                  />
                  <div className="max-h-40 overflow-auto rounded border border-border">
                    {visibleTickets.length === 0 ? (
                      <p className="p-2 text-xs text-muted">No tickets</p>
                    ) : (
                      visibleTickets.map((t) => (
                        <label
                          key={t.key}
                          className="flex items-start gap-2 border-b border-border px-2 py-1 text-xs last:border-b-0"
                        >
                          <input
                            type="checkbox"
                            disabled={!t.selectable}
                            checked={selectedKeys.has(t.key)}
                            onChange={(e) => {
                              setSelectedKeys((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(t.key);
                                else next.delete(t.key);
                                return next;
                              });
                            }}
                          />
                          <span>
                            <span className="font-medium">{t.key}</span>{' '}
                            {t.summary}
                            <span className="text-muted"> · {t.issueType}</span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={includeTcms}
                  onChange={(e) => setIncludeTcms(e.target.checked)}
                />
                Use QAForge cases for duplicates
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={includeXray}
                  disabled={!orgFlags.xrayConfigured}
                  onChange={(e) => setIncludeXray(e.target.checked)}
                />
                Include Xray library
                {!orgFlags.xrayConfigured ? ' (connect in Settings)' : ''}
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={includeTestrail}
                  disabled={!orgFlags.testrailConfigured}
                  onChange={(e) => setIncludeTestrail(e.target.checked)}
                />
                Include TestRail library
                {!orgFlags.testrailConfigured ? ' (connect in Settings)' : ''}
              </label>
            </div>
            <label className="block text-xs text-muted">
              Folder
              <select
                className={`${fieldClass} mt-1`}
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
              >
                <option value="">Default</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            {run?.status === 'PENDING' || run?.status === 'RUNNING' ? (
              <p className="text-xs text-muted">
                Orchestrator is analyzing coverage, duplicates, and quality…
              </p>
            ) : null}
            {run?.status === 'FAILED' ? (
              <p className="text-sm text-danger">{run.error ?? 'Generate failed'}</p>
            ) : null}
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={showDuplicates}
                onChange={(e) => setShowDuplicates(e.target.checked)}
              />
              Show duplicates (hidden by default)
            </label>
            <div className="max-h-[420px] space-y-2 overflow-auto">
              {visibleSuggestions.map((s) => (
                <div
                  key={s.id}
                  className="rounded border border-border p-2"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs uppercase text-muted">
                      {s.kind}
                    </span>
                    <span className="text-xs text-muted">
                      score {s.score.toFixed(2)}
                    </span>
                    {s.requirementKey ? (
                      <span className="text-xs">{s.requirementKey}</span>
                    ) : null}
                    <span className="ml-auto text-xs">{s.status}</span>
                  </div>
                  <div className="font-medium">{s.scenario}</div>
                  <p className="text-xs text-muted">{s.reason}</p>
                  {editingId === s.id ? (
                    <div className="mt-2 space-y-2">
                      <input
                        className={fieldClass}
                        value={editDraft.scenario}
                        onChange={(e) =>
                          setEditDraft((d) => ({
                            ...d,
                            scenario: e.target.value,
                          }))
                        }
                      />
                      <textarea
                        className={areaClass}
                        value={editDraft.steps}
                        onChange={(e) =>
                          setEditDraft((d) => ({ ...d, steps: e.target.value }))
                        }
                      />
                      <textarea
                        className={areaClass}
                        value={editDraft.expected}
                        onChange={(e) =>
                          setEditDraft((d) => ({
                            ...d,
                            expected: e.target.value,
                          }))
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          void patchSuggestion(s.id, {
                            status: 'accepted',
                            scenario: editDraft.scenario,
                            expected: editDraft.expected,
                            steps: editDraft.steps
                              .split('\n')
                              .map((x) => x.trim())
                              .filter(Boolean),
                          });
                          setEditingId(null);
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={s.kind === 'duplicate'}
                        onClick={() =>
                          void patchSuggestion(s.id, { status: 'accepted' })
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditingId(s.id);
                          setEditDraft({
                            scenario: s.scenario,
                            expected: s.expected,
                            steps: (s.steps ?? []).join('\n'),
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void patchSuggestion(s.id, { status: 'rejected' })
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
      <UpgradeModal
        open={Boolean(upgradeError)}
        error={upgradeError}
        onClose={() => setUpgradeError(null)}
      />
    </>
  );
}
