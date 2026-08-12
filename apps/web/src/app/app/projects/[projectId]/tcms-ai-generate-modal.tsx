'use client';

import { useMemo, useState } from 'react';
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

export function TcmsAiGenerateModal({
  open,
  projectId,
  folders,
  defaultFolderId,
  busy,
  onClose,
  onAdded,
}: {
  open: boolean;
  projectId: string;
  folders: FolderOption[];
  defaultFolderId: string;
  busy?: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [step, setStep] = useState<'form' | 'preview'>('form');
  const [mode, setMode] = useState<'prompt' | 'upload'>('prompt');
  const [prompt, setPrompt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [includeReqs, setIncludeReqs] = useState(true);
  const [reviewApp, setReviewApp] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<GenerateResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [upgradeError, setUpgradeError] = useState<ReturnType<typeof parsePlanLimitError>>(null);

  const selectedCases = useMemo(
    () => (preview?.cases ?? []).filter((_, i) => selected.has(i)),
    [preview, selected],
  );

  function reset() {
    setStep('form');
    setError(null);
    setPreview(null);
    setSelected(new Set());
    setGenerating(false);
    setAdding(false);
  }

  async function generate() {
    setError(null);
    if (mode === 'prompt' && !prompt.trim() && !includeReqs && !reviewApp) {
      setError('Paste requirements, or include project requirements / review the app URL');
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
            }),
          },
        );
      }
      setPreview(data);
      setSelected(new Set(data.cases.map((_, i) => i)));
      setStep('preview');
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
        `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/bulk-create`,
        {
          method: 'POST',
          body: JSON.stringify({
            folderId: folderId || null,
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
      setError(err instanceof Error ? err.message : 'Add failed');
    } finally {
      setAdding(false);
    }
  }

  return (
    <Modal
      open={open}
      title={step === 'form' ? 'Generate cases with AI' : 'Select cases to add'}
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
                ? 'Adding…'
                : `Add ${selectedCases.length} as Draft`}
            </Button>
          </>
        )
      }
    >
      {step === 'form' ? (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Describe what to test, include the app URL, and ask for coverage
            (e.g. Welcome + Login, 100% coverage). We review the live page when
            possible and return modules, techniques, and many executable cases —
            not one canned login row.
          </p>
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
      ) : (
        <div className="space-y-3">
          {(() => {
            const modules = new Map<string, number>();
            const techniques = new Map<string, number>();
            for (const c of preview?.cases ?? []) {
              const mod = c.module || 'General';
              modules.set(mod, (modules.get(mod) ?? 0) + 1);
              const tech = c.designTechnique || 'HAPPY_PATH';
              techniques.set(tech, (techniques.get(tech) ?? 0) + 1);
            }
            const moduleSummary = [...modules.entries()]
              .map(([k, v]) => `${k} (${v})`)
              .join(' · ');
            const techSummary = [...techniques.entries()]
              .map(([k, v]) => `${k} (${v})`)
              .join(' · ');
            return (
              <>
                <div className="rounded-md border border-border bg-surface/60 p-3 text-xs space-y-1.5">
                  <p className="font-medium text-fg">
                    {(preview?.cases ?? []).length} cases ·{' '}
                    {preview?.requirementCount ?? 0} requirement(s) · coverage{' '}
                    {preview?.coverage?.complete ? 'complete' : 'partial'}
                    {preview?.tokensUsed
                      ? ` · ${preview.tokensUsed} tokens`
                      : ''}
                  </p>
                  {moduleSummary ? (
                    <p className="text-muted">Modules: {moduleSummary}</p>
                  ) : null}
                  {techSummary ? (
                    <p className="text-muted">Techniques: {techSummary}</p>
                  ) : null}
                  {preview?.pageMap ? (
                    <p className="text-muted">
                      Observed UI:{' '}
                      {preview.pageMap.error
                        ? `could not review (${preview.pageMap.error})`
                        : `${preview.pageMap.title || preview.pageMap.url} — ${preview.pageMap.inputs?.length ?? 0} inputs, ${preview.pageMap.buttons?.length ?? 0} buttons`}
                    </p>
                  ) : null}
                  <p className="text-muted">
                    Uncheck anything you do not want. Added cases are Draft until
                    you review and approve.
                  </p>
                </div>
              </>
            );
          })()}
          <div className="flex gap-2">
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
              variant="secondary"
              onClick={() => setSelected(new Set())}
            >
              Select none
            </Button>
          </div>
          <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface text-xs text-muted">
                <tr>
                  <th className="p-2 w-8" />
                  <th className="p-2">Module</th>
                  <th className="p-2">Title</th>
                  <th className="p-2">Technique</th>
                  <th className="p-2">Steps</th>
                  <th className="p-2">Expected</th>
                </tr>
              </thead>
              <tbody>
                {(preview?.cases ?? []).map((c, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={selected.has(i)}
                        onChange={() => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="p-2 align-top text-xs text-muted">
                      {c.module || 'General'}
                    </td>
                    <td className="p-2 align-top font-medium">{c.scenario}</td>
                    <td className="p-2 align-top text-xs text-muted">
                      {c.designTechnique}
                    </td>
                    <td className="p-2 align-top text-xs text-muted">
                      {c.steps.slice(0, 5).map((s, si) => (
                        <div key={si}>{si + 1}. {s}</div>
                      ))}
                    </td>
                    <td className="p-2 align-top text-xs">{c.expected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <UpgradeModal
        open={Boolean(upgradeError)}
        error={upgradeError}
        onClose={() => setUpgradeError(null)}
      />
    </Modal>
  );
}
