'use client';

import { useMemo, useState } from 'react';
import { normalizeCaseStatus } from '@qaforge/shared';
import { api, apiForm } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { areaClass, fieldClass } from './tcms-board';
import { TcmsSuitePicker } from './tcms-suite-picker';
import type { TestCaseRow, TcmsFolderRow } from './design-cases-panel';

type ProposedCase = TestCaseRow & { why?: string };

type ProposeResponse = {
  name: string;
  tokensUsed: number;
  readyCount: number;
  cases: ProposedCase[];
};

export function TcmsAiRunModal({
  open,
  projectId,
  folders,
  cases,
  readyCount,
  onClose,
  onApproved,
}: {
  open: boolean;
  projectId: string;
  folders: TcmsFolderRow[];
  cases: TestCaseRow[];
  readyCount: number;
  onClose: () => void;
  onApproved: (runId: string) => void;
}) {
  const [step, setStep] = useState<'form' | 'preview'>('form');
  const [mode, setMode] = useState<'prompt' | 'upload'>('prompt');
  const [prompt, setPrompt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [preview, setPreview] = useState<ProposeResponse | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const readyCases = useMemo(
    () =>
      cases.filter(
        (c) =>
          !c.deletedAt &&
          normalizeCaseStatus(c.caseStatus, c.readyForExecution) === 'READY',
      ),
    [cases],
  );

  function reset() {
    setStep('form');
    setError(null);
    setPreview(null);
    setPicked(new Set());
    setProposing(false);
    setApproving(false);
  }

  async function propose() {
    setError(null);
    if (!readyCount) {
      setError('No Ready cases to select. Mark cases Ready first.');
      return;
    }
    if (mode === 'prompt' && !prompt.trim()) {
      setError('Paste the requirements for this execution cycle');
      return;
    }
    if (mode === 'upload' && !file) {
      setError('Choose a requirements file');
      return;
    }
    setProposing(true);
    try {
      const orgId = await getDefaultOrgId();
      let data: ProposeResponse;
      if (mode === 'upload' && file) {
        const form = new FormData();
        form.append('file', file);
        if (name.trim()) form.append('name', name.trim());
        data = await apiForm<ProposeResponse>(
          `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/propose`,
          form,
        );
      } else {
        data = await api<ProposeResponse>(
          `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/propose`,
          {
            method: 'POST',
            body: JSON.stringify({
              prompt: prompt.trim(),
              name: name.trim() || undefined,
            }),
          },
        );
      }
      setPreview(data);
      setPicked(new Set(data.cases.map((c) => c.id)));
      if (!name.trim()) setName(data.name);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Propose failed');
    } finally {
      setProposing(false);
    }
  }

  async function approve() {
    if (!picked.size) {
      setError('Select at least one case');
      return;
    }
    setApproving(true);
    setError(null);
    try {
      const orgId = await getDefaultOrgId();
      const run = await api<{ id: string }>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim() || preview?.name || 'AI cycle',
            testCaseIds: [...picked],
            runKind: 'AUTOMATION',
            status: 'PENDING',
          }),
        },
      );
      reset();
      onApproved(run.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setApproving(false);
    }
  }

  const whyById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of preview?.cases ?? []) {
      if (c.why) map.set(c.id, c.why);
    }
    return map;
  }, [preview]);

  return (
    <Modal
      open={open}
      title={step === 'form' ? 'AI execution cycle' : 'Review proposed cases'}
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
              disabled={proposing || !readyCount}
              onClick={() => void propose()}
            >
              {proposing ? 'Selecting…' : 'Propose cases'}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Reject
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setStep('form')}
            >
              Back
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={approving || !picked.size}
              onClick={() => void approve()}
            >
              {approving ? 'Creating…' : `Approve ${picked.size} cases`}
            </Button>
          </>
        )
      }
    >
      {step === 'form' ? (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            AI picks Ready cases that match your requirements. You can edit the
            list before the cycle is created. Nothing runs until you approve.
          </p>
          {!readyCount ? (
            <p className="text-sm text-danger">
              No Ready cases in the library. Mark cases Ready first.
            </p>
          ) : null}
          <label className="block text-xs text-muted">
            Cycle name
            <input
              className={`${fieldClass} mt-1`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="AI cycle"
            />
          </label>
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
              placeholder="What should this cycle cover? AI will only choose existing Ready cases."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          ) : (
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          )}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Uncheck cases to drop them, or add more Ready cases from the suite
            picker. Approve creates a pending cycle — it will not start until
            you run it manually or with AI Executor.
          </p>
          <label className="block text-xs text-muted">
            Cycle name
            <input
              className={`${fieldClass} mt-1`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <TcmsSuitePicker
            folders={folders}
            cases={readyCases}
            picked={picked}
            onChange={setPicked}
          />
          {picked.size ? (
            <ul className="max-h-40 space-y-1 overflow-auto text-xs text-muted">
              {[...picked].map((id) => {
                const row = readyCases.find((c) => c.id === id);
                const why = whyById.get(id);
                if (!row) return null;
                return (
                  <li key={id}>
                    <span className="font-medium text-fg">{row.externalId}</span>{' '}
                    {row.scenario}
                    {why ? ` — ${why}` : ''}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
      )}
    </Modal>
  );
}
