'use client';

import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { parsePlanLimitError } from '@/lib/plan';
import { getDefaultOrgId } from '@/lib/org';
import { usePlan } from '@/lib/use-plan';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { ProFeatureNotice, UpgradeModal } from '@/components/UpgradeModal';
import { areaClass, fieldClass } from './tcms-board';
import type { FolderOption } from './tcms-case-modal';

type AgentPlan = {
  permissionLevel: 'SUGGEST' | 'EXECUTE';
  goal: string;
  steps: string[];
  caseCount: number;
};

type AgentCase = {
  scenario: string;
  module?: string;
  designTechnique?: string;
  expected: string;
  steps?: string[];
  priorityLabel?: string;
};

type AgentResponse = {
  permissionLevel: 'SUGGEST' | 'EXECUTE';
  applied: boolean;
  plan: AgentPlan;
  cases: AgentCase[];
  tokensUsed?: number;
  apply?: { created: number; updated: number };
};

export function TcmsAiAgentModal({
  open,
  projectId,
  folders,
  defaultFolderId,
  onClose,
  onApplied,
}: {
  open: boolean;
  projectId: string;
  folders: FolderOption[];
  defaultFolderId: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { canQaAgent } = usePlan();
  const [intent, setIntent] = useState('');
  const [permissionLevel, setPermissionLevel] = useState<'SUGGEST' | 'EXECUTE'>(
    'SUGGEST',
  );
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [reviewApp, setReviewApp] = useState(true);
  const [includeReqs, setIncludeReqs] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentResponse | null>(null);
  const [upgradeError, setUpgradeError] = useState<ReturnType<
    typeof parsePlanLimitError
  >>(null);

  async function run() {
    const text = intent.trim();
    if (!text) {
      setError('Describe what you want the AI QA Engineer to do.');
      return;
    }
    if (permissionLevel === 'EXECUTE' && !canQaAgent) {
      setUpgradeError({
        code: 'PLAN_FEATURE',
        feature: 'qaAgentFull',
        upgradeUrl: '/app/billing',
      });
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const orgId = await getDefaultOrgId();
      const data = await api<AgentResponse>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/ai-agent/run`,
        {
          method: 'POST',
          body: JSON.stringify({
            intent: text,
            permissionLevel,
            reviewApplication: reviewApp,
            includeProjectRequirements: includeReqs,
            folderId: folderId || null,
          }),
        },
      );
      setResult(data);
      if (data.applied) onApplied();
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
            : 'Agent run failed',
      );
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    setResult(null);
    setError(null);
    onClose();
  }

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title="AI QA Engineer"
        wide
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              Close
            </Button>
            <Button type="button" onClick={() => void run()} disabled={busy}>
              {busy
                ? 'Working…'
                : permissionLevel === 'EXECUTE'
                  ? 'Execute intent'
                  : 'Suggest plan'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-muted text-xs">
            Describe a QA goal. Suggest returns a plan and case preview. Execute
            generates and applies cases through the Internal TCMS tool provider.
          </p>
          {!canQaAgent ? (
            <ProFeatureNotice
              feature="Execute (write to TCMS)"
              planName="Enterprise"
            >
              Suggest (preview) stays available on your current plan.
            </ProFeatureNotice>
          ) : null}
          <label className="block text-xs text-muted">
            Intent
            <textarea
              className={`${areaClass} mt-1 min-h-[120px]`}
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="e.g. Prepare regression coverage for login and checkout before release"
              disabled={busy}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-muted">
              Permission
              <select
                className={`${fieldClass} mt-1`}
                value={permissionLevel}
                onChange={(e) =>
                  setPermissionLevel(e.target.value as 'SUGGEST' | 'EXECUTE')
                }
                disabled={busy}
              >
                <option value="SUGGEST">Suggest (preview only)</option>
                <option value="EXECUTE">Execute (write to TCMS)</option>
              </select>
            </label>
            <label className="block text-xs text-muted">
              Folder
              <select
                className={`${fieldClass} mt-1`}
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                disabled={busy}
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
          <div className="flex flex-wrap gap-4 text-xs text-muted">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={reviewApp}
                onChange={(e) => setReviewApp(e.target.checked)}
                disabled={busy}
              />
              Review live app UI
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeReqs}
                onChange={(e) => setIncludeReqs(e.target.checked)}
                disabled={busy}
              />
              Include project requirements
            </label>
          </div>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          {result ? (
            <div className="rounded-md border border-border bg-surface/40 p-3 space-y-2">
              <div className="text-xs font-medium">
                {result.applied
                  ? `Applied: ${result.apply?.created ?? 0} created, ${result.apply?.updated ?? 0} updated`
                  : 'Suggestion ready — nothing written'}
              </div>
              <ol className="list-decimal pl-4 text-xs text-muted space-y-1">
                {(result.plan?.steps ?? []).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <div className="max-h-48 overflow-auto space-y-2">
                {(result.cases ?? []).slice(0, 40).map((c, i) => (
                  <div key={`${c.scenario}-${i}`} className="text-xs border-t border-border pt-2">
                    <div className="font-medium">{c.scenario}</div>
                    <div className="text-muted">
                      {[c.module, c.designTechnique, c.priorityLabel]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
      <UpgradeModal
        open={Boolean(upgradeError)}
        onClose={() => setUpgradeError(null)}
        error={upgradeError}
      />
    </>
  );
}
