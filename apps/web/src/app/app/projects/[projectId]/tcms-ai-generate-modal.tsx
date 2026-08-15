'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError, api, apiForm } from '@/lib/api';
import { parsePlanLimitError } from '@/lib/plan';
import { getDefaultOrgId } from '@/lib/org';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { UpgradeModal } from '@/components/UpgradeModal';
import { fieldClass, areaClass } from './tcms-board';
import type { FolderOption } from './tcms-case-modal';

export type GeneratedPreviewCase = {
  scenario: string;
  preconditions: string;
  steps: string[];
  expected: string;
  type: string;
  designTechnique: string;
  requirementKey: string | null;
  priorityLabel: 'HIGH' | 'MEDIUM' | 'LOW';
  testData: Record<string, string> | null;
  module: string;
};

type GenerateResponse = {
  cases: GeneratedPreviewCase[];
  coverage: {
    requirementCount: number;
    caseCount: number;
    complete: boolean;
    requirementsWithMultiTechnique?: number;
    byRequirement?: Record<
      string,
      { techniques: string[]; missingTechniques: string[]; caseCount: number }
    >;
  };
  tokensUsed: number;
  requirementCount: number;
  skippedDuplicates?: number;
  pageMap?: {
    url: string;
    title: string;
    headings: string[];
    buttons: string[];
    inputs: Array<{ name: string; type: string; id: string; placeholder: string }>;
    links: string[];
    error?: string;
  } | null;
};

type PromptHistoryItem = {
  id: string;
  prompt: string;
  source: string;
  caseCount: number | null;
  createdAt: string;
};

export type AiGenerateModalDefaults = {
  prompt?: string;
  applyMode?: 'create' | 'update';
  reviewApplication?: boolean;
  source?: 'GENERATE' | 'UPDATE' | 'ENV_REFRESH';
  caseIds?: string[];
  intent?: 'generate' | 'gap';
  jiraEpicKey?: string;
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
  const [step, setStep] = useState<'form' | 'preview'>('form');
  const [mode, setMode] = useState<'prompt' | 'upload'>('prompt');
  const [applyMode, setApplyMode] = useState<'create' | 'update'>('create');
  const [prompt, setPrompt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [includeReqs, setIncludeReqs] = useState(true);
  const [reviewApp, setReviewApp] = useState(true);
  const [jiraEpicKey, setJiraEpicKey] = useState('');
  const [intent, setIntent] = useState<'generate' | 'gap'>('generate');
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<GenerateResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [upgradeError, setUpgradeError] = useState<ReturnType<typeof parsePlanLimitError>>(null);
  const [history, setHistory] = useState<PromptHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [applySource, setApplySource] = useState<
    'GENERATE' | 'UPDATE' | 'ENV_REFRESH'
  >('GENERATE');
  const [targetCaseIds, setTargetCaseIds] = useState<string[]>([]);

  const selectedCases = useMemo(
    () => (preview?.cases ?? []).filter((_, i) => selected.has(i)),
    [preview, selected],
  );

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const orgId = await getDefaultOrgId();
      const data = await api<{ items: PromptHistoryItem[] }>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/ai-prompts`,
      );
      setHistory(data.items ?? []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setFolderId(defaultFolderId);
    setApplyMode(defaults?.applyMode ?? 'create');
    setPrompt(defaults?.prompt ?? '');
    setReviewApp(defaults?.reviewApplication ?? true);
    setIntent(defaults?.intent ?? 'generate');
    setJiraEpicKey(defaults?.jiraEpicKey ?? '');
    setIncludeReqs(!defaults?.jiraEpicKey && defaults?.intent !== 'gap');
    setApplySource(defaults?.source ?? (defaults?.applyMode === 'update' ? 'UPDATE' : 'GENERATE'));
    setTargetCaseIds(defaults?.caseIds ?? []);
    setStep('form');
    setError(null);
    setPreview(null);
    setSelected(new Set());
    setClearConfirm(false);
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when modal opens / defaults change
  }, [open, projectId, defaultFolderId, defaults]);

  function reset() {
    setStep('form');
    setError(null);
    setPreview(null);
    setSelected(new Set());
    setGenerating(false);
    setAdding(false);
    setClearConfirm(false);
  }

  async function clearHistory() {
    try {
      const orgId = await getDefaultOrgId();
      await api(`/api/v1/orgs/${orgId}/projects/${projectId}/ai-prompts`, {
        method: 'DELETE',
      });
      setHistory([]);
      setPrompt('');
      setClearConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear history');
    }
  }

  async function generate() {
    setError(null);
    if (mode === 'prompt' && !prompt.trim() && !includeReqs && !reviewApp && !jiraEpicKey.trim()) {
      setError('Enter a Jira epic (e.g. KAN-1), paste requirements, or include project requirements');
      return;
    }
    if (mode === 'upload' && !file) {
      setError('Choose a requirements file');
      return;
    }
    setGenerating(true);
    try {
      const orgId = await getDefaultOrgId();
      let data: GenerateResponse;
      if (mode === 'upload' && file) {
        const form = new FormData();
        form.append('file', file);
        form.append('folderId', folderId);
        form.append('includeProjectRequirements', includeReqs ? 'true' : 'false');
        form.append('reviewApplication', reviewApp ? 'true' : 'false');
        if (jiraEpicKey.trim()) form.append('jiraEpicKey', jiraEpicKey.trim());
        form.append('gapOnly', intent === 'gap' ? 'true' : 'false');
        data = await apiForm<GenerateResponse>(
          `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/generate`,
          form,
        );
      } else {
        data = await api<GenerateResponse>(
          `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/generate`,
          {
            method: 'POST',
            body: JSON.stringify({
              prompt: prompt.trim(),
              folderId: folderId || null,
              includeProjectRequirements: includeReqs,
              reviewApplication: reviewApp,
              jiraEpicKey: jiraEpicKey.trim() || undefined,
              gapOnly: intent === 'gap',
            }),
          },
        );
      }
      setPreview(data);
      setSelected(new Set(data.cases.map((_, i) => i)));
      setStep('preview');
      void loadHistory();
    } catch (err) {
      const planErr =
        err instanceof ApiError ? parsePlanLimitError(err.body) : null;
      if (planErr) {
        setUpgradeError(planErr);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : 'Generate failed');
      }
    } finally {
      setGenerating(false);
    }
  }

  async function addSelected() {
    if (!selectedCases.length) {
      setError('Select at least one case');
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const orgId = await getDefaultOrgId();
      await api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/generate-apply`,
        {
          method: 'POST',
          body: JSON.stringify({
            mode: applyMode,
            // Avoid duplicate history after generate already saved the prompt
            prompt:
              applyMode === 'update' || applySource !== 'GENERATE'
                ? prompt.trim() || undefined
                : undefined,
            source: applySource,
            folderId: folderId || null,
            caseIds:
              applyMode === 'update' && targetCaseIds.length
                ? targetCaseIds
                : undefined,
            cases: selectedCases.map((c) => ({
              scenario: c.scenario,
              preconditions: c.preconditions,
              steps: c.steps,
              expected: c.expected,
              type: c.type,
              designTechnique: c.designTechnique,
              requirementKey: c.requirementKey,
              priorityLabel: c.priorityLabel,
              testData: c.testData,
              module: c.module,
              caseStatus: 'DRAFT',
            })),
          }),
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
      title={
        step === 'form'
          ? intent === 'gap'
            ? 'AI Gap'
            : applyMode === 'update'
              ? 'Update cases with AI'
              : 'AI Generate'
          : applyMode === 'update'
            ? 'Select cases to update'
            : 'Select cases to add'
      }
      size="xl"
      onClose={() => {
        reset();
        onClose();
      }}
      footer={
        step === 'form' ? (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={generating || busy}
              onClick={() => void generate()}
            >
              {generating ? 'Generating…' : 'Generate'}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setStep('form')}
            >
              Back
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={adding || !selectedCases.length}
              onClick={() => void addSelected()}
            >
              {adding
                ? applyMode === 'update'
                  ? 'Updating…'
                  : 'Adding…'
                : applyMode === 'update'
                  ? `Update ${selectedCases.length} matching`
                  : `Add ${selectedCases.length} as Draft`}
            </Button>
          </>
        )
      }
    >
      {step === 'form' ? (
        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <div className="space-y-3">
          <p className="text-xs text-muted">
            {intent === 'gap'
              ? 'Reads the Jira epic live, then shows only cases that are not already in this project.'
              : 'Reads the Jira epic live and generates cases. You do not need Import from Jira first.'}
          </p>
          <input
            className={fieldClass}
            placeholder="Jira epic or story key (e.g. KAN-1)"
            value={jiraEpicKey}
            onChange={(e) => setJiraEpicKey(e.target.value)}
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={applyMode === 'create' ? 'primary' : 'secondary'}
              onClick={() => {
                setApplyMode('create');
                setApplySource('GENERATE');
              }}
            >
              Add as Draft
            </Button>
            <Button
              type="button"
              size="sm"
              variant={applyMode === 'update' ? 'primary' : 'secondary'}
              onClick={() => {
                setApplyMode('update');
                setApplySource((s) => (s === 'GENERATE' ? 'UPDATE' : s));
              }}
            >
              Update matching
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === 'prompt' ? 'primary' : 'secondary'}
              onClick={() => setMode('prompt')}
            >
              Prompt
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'upload' ? 'primary' : 'secondary'}
              onClick={() => setMode('upload')}
            >
              Upload
            </Button>
          </div>
          {mode === 'prompt' ? (
            <textarea
              className={`${areaClass} min-h-[140px]`}
              placeholder="Example: Test login positive path on https://www.saucedemo.com/ with username standard_user and password secret_sauce. Verify the user is logged in successfully."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          ) : (
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md,.text"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          )}
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={includeReqs}
              onChange={(e) => setIncludeReqs(e.target.checked)}
            />
            Include project requirements
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={reviewApp}
              onChange={(e) => setReviewApp(e.target.checked)}
            />
            Review application URL
          </label>
          <label className="block space-y-1 text-xs text-muted">
            Folder
            <select
              className={fieldClass}
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
            >
              <option value="">Ungrouped</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          </div>
          <aside className="space-y-2 rounded-lg border border-border bg-panel/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-fg">Prompt history</p>
              {history.length ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setClearConfirm(true)}
                >
                  Clear
                </Button>
              ) : null}
            </div>
            {clearConfirm ? (
              <div className="space-y-2 rounded-md border border-border bg-bg-elevated p-2 text-xs text-muted">
                <p>
                  Clear prompt history only — existing test cases are not deleted.
                </p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => void clearHistory()}>
                    Confirm clear
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setClearConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
            {historyLoading ? (
              <p className="text-xs text-muted">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-xs text-muted">No prompts yet.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {history.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-bg-elevated"
                      onClick={() => {
                        setMode('prompt');
                        setPrompt(h.prompt);
                      }}
                      title={h.prompt}
                    >
                      <span className="line-clamp-2">{h.prompt}</span>
                      <span className="mt-0.5 block text-[10px] text-muted">
                        {h.source} · {new Date(h.createdAt).toLocaleString()}
                        {h.caseCount != null ? ` · ${h.caseCount} cases` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      ) : (
        <div className="space-y-3">
          {(() => {
            const modules = new Map<string, number>();
            const techniques = new Map<string, number>();
            for (const c of preview?.cases ?? []) {
              const mod = c.module || 'General';
              modules.set(mod, (modules.get(mod) ?? 0) + 1);
              const tech = c.designTechnique || 'OTHER';
              techniques.set(tech, (techniques.get(tech) ?? 0) + 1);
            }
            return (
              <>
                <p className="text-xs text-muted">
                  {preview?.cases.length ?? 0} cases
                  {preview?.coverage?.requirementCount
                    ? ` · ${preview.coverage.requirementCount} requirements`
                    : ''}
                  {preview?.skippedDuplicates
                    ? ` · skipped ${preview.skippedDuplicates} already in this project`
                    : ''}
                </p>
                {modules.size > 0 ? (
                  <p className="text-xs text-muted">
                    Modules:{' '}
                    {[...modules.entries()]
                      .map(([k, n]) => `${k} (${n})`)
                      .join(', ')}
                  </p>
                ) : null}
                {techniques.size > 0 ? (
                  <p className="text-xs text-muted">
                    Techniques:{' '}
                    {[...techniques.entries()]
                      .map(([k, n]) => `${k} (${n})`)
                      .join(', ')}
                  </p>
                ) : null}
              </>
            );
          })()}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                setSelected(new Set((preview?.cases ?? []).map((_, i) => i)))
              }
            >
              Select all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </Button>
          </div>
          <ul className="max-h-[360px] space-y-2 overflow-y-auto">
            {(preview?.cases ?? []).map((c, i) => (
              <li
                key={`${c.scenario}-${i}`}
                className="rounded-lg border border-border bg-panel/30 p-3"
              >
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(i)}
                    onChange={(e) => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(i);
                        else next.delete(i);
                        return next;
                      });
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-fg">
                      {c.scenario}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {c.module || 'General'} · {c.designTechnique || '—'} ·{' '}
                      {c.priorityLabel}
                    </span>
                    <span className="mt-1 block text-xs text-muted line-clamp-2">
                      {c.expected}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </Modal>
    <UpgradeModal
      open={Boolean(upgradeError)}
      error={upgradeError}
      onClose={() => setUpgradeError(null)}
    />
    </>
  );
}
