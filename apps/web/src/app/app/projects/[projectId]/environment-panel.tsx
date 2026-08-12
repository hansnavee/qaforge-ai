'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { Button } from '@/components/Button';

type ProjectEnv = {
  appUrl?: string | null;
  loginUrl?: string | null;
  browserMode?: string | null;
  credentialsConfigured?: boolean;
  environment?: string | null;
  testStrategy?: 'SPRINT' | 'KANBAN' | null;
  kanbanWipLimit?: number | null;
  healRequiresReview?: boolean;
  llmHealRequiresApproval?: boolean;
  allowExecuteQuarantined?: boolean;
};

export function EnvironmentPanel({
  projectId,
  canEdit,
  variant = 'environment',
}: {
  projectId: string;
  canEdit: boolean;
  variant?: 'design' | 'environment' | 'pre-exec';
}) {
  const qc = useQueryClient();
  const [appUrl, setAppUrl] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [browserMode, setBrowserMode] = useState<'HEADLESS' | 'HEADED'>(
    'HEADLESS',
  );
  const [confirmProduction, setConfirmProduction] = useState(false);
  const [testStrategy, setTestStrategy] = useState<'SPRINT' | 'KANBAN'>(
    'SPRINT',
  );
  const [kanbanWipLimit, setKanbanWipLimit] = useState('8');
  const [healRequiresReview, setHealRequiresReview] = useState(false);
  const [llmHealRequiresApproval, setLlmHealRequiresApproval] = useState(true);
  const [allowExecuteQuarantined, setAllowExecuteQuarantined] = useState(false);

  const [savedReady, setSavedReady] = useState(false);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<ProjectEnv>(`/api/v1/orgs/${orgId}/projects/${projectId}`);
    },
  });

  const project = projectQuery.data;

  useEffect(() => {
    if (!project) return;
    setAppUrl((v) => v || project.appUrl || '');
    setLoginUrl((v) => v || project.loginUrl || '');
    if (project.browserMode === 'HEADED' || project.browserMode === 'HEADLESS') {
      setBrowserMode(project.browserMode);
    }
    if (project.testStrategy === 'KANBAN' || project.testStrategy === 'SPRINT') {
      setTestStrategy(project.testStrategy);
    }
    if (project.kanbanWipLimit != null) {
      setKanbanWipLimit(String(project.kanbanWipLimit));
    }
    if (typeof project.healRequiresReview === 'boolean') {
      setHealRequiresReview(project.healRequiresReview);
    }
    if (typeof project.llmHealRequiresApproval === 'boolean') {
      setLlmHealRequiresApproval(project.llmHealRequiresApproval);
    }
    if (typeof project.allowExecuteQuarantined === 'boolean') {
      setAllowExecuteQuarantined(project.allowExecuteQuarantined);
    }
  }, [project]);

  const policyMutation = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      const wip = Number.parseInt(kanbanWipLimit, 10);
      return api(`/api/v1/orgs/${orgId}/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          testStrategy,
          kanbanWipLimit:
            testStrategy === 'KANBAN' && Number.isFinite(wip) && wip > 0
              ? wip
              : null,
          healRequiresReview,
          llmHealRequiresApproval,
          allowExecuteQuarantined,
        }),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      return api(`/api/v1/orgs/${orgId}/projects/${projectId}/environment`, {
        method: 'POST',
        body: JSON.stringify({
          appUrl: appUrl.trim(),
          loginUrl: loginUrl.trim() || undefined,
          username: username.trim() || undefined,
          password: password || undefined,
          browserMode,
          confirmProduction,
        }),
      });
    },
    onSuccess: async () => {
      setPassword('');
      setSavedReady(Boolean(appUrl.trim() && appUrl.trim() !== 'https://'));
      await qc.invalidateQueries({ queryKey: ['project', projectId] });
      await qc.invalidateQueries({ queryKey: ['stlc-phase', projectId] });
      await qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
    },
  });

  const title =
    variant === 'design'
      ? 'Where will these cases run? (optional)'
      : variant === 'pre-exec'
        ? 'Confirm environment before execution'
        : 'Test environment';
  const help =
    variant === 'design'
      ? 'Leave empty (or just https://) if the app is not ready — cases are written from requirements only. When a real QA/UAT URL is saved, AI rewrites steps onto the live UI for you to review.'
      : variant === 'pre-exec'
        ? 'A real QA/UAT URL is required to start the run. Saving it updates generic cases; review Ready on Design, pick All or one feature, then Accept.'
        : 'You can save with no URL. Accept Environment without a host. Add a real QA/UAT URL later — AI then updates cases and you review them before execution.';

  return (
    <div className="mt-5 space-y-3 rounded-lg border border-border bg-panel/40 p-4">
      <p className="text-sm font-medium text-fg">{title}</p>
      {project?.appUrl ? (
        <p className="text-xs text-muted">
          Current URL: {project.appUrl}
          {project.browserMode ? ` · ${project.browserMode}` : ''}
        </p>
      ) : (
        <p className="text-xs text-warning">
          No usable URL yet — cases stay requirement-based (generic steps).
        </p>
      )}
      <p className="text-xs text-muted">{help}</p>
      <label className="block space-y-1 text-xs text-muted">
        Application URL
        <input
          className="w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
          value={appUrl}
          onChange={(e) => setAppUrl(e.target.value)}
          placeholder="https://"
          disabled={!canEdit}
        />
      </label>
      <label className="block space-y-1 text-xs text-muted">
        Login URL (optional)
        <input
          className="w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
          value={loginUrl}
          onChange={(e) => setLoginUrl(e.target.value)}
          placeholder="Same as application URL if empty"
          disabled={!canEdit}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-xs text-muted">
          Username (non-prod)
          <input
            className="w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            disabled={!canEdit}
          />
        </label>
        <label className="block space-y-1 text-xs text-muted">
          Password (non-prod)
          <input
            type="password"
            className="w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder={
              project?.credentialsConfigured ? 'Stored — leave blank to keep' : ''
            }
            disabled={!canEdit}
          />
        </label>
      </div>
      <label className="block space-y-1 text-xs text-muted">
        Browser mode
        <select
          className="w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
          value={browserMode}
          onChange={(e) =>
            setBrowserMode(e.target.value as 'HEADLESS' | 'HEADED')
          }
          disabled={!canEdit}
        >
          <option value="HEADLESS">Headless</option>
          <option value="HEADED">Headed (visible browser)</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={confirmProduction}
          onChange={(e) => setConfirmProduction(e.target.checked)}
          disabled={!canEdit}
        />
        This is not production — or I confirm I still want to use this URL
      </label>
      {project?.credentialsConfigured ? (
        <p className="text-xs text-success">Non-prod credentials are stored.</p>
      ) : null}

      {variant === 'environment' ? (
        <div className="space-y-3 border-t border-border pt-3">
          <p className="text-sm font-medium text-fg">QA strategy & heal gates</p>
          <p className="text-xs text-muted">
            Sprint: AI Cycle proposes a full roster once. Kanban: each pull is a
            small WIP batch. Heal gates stay human — Complete the run is always
            a person.
          </p>
          <label className="block space-y-1 text-xs text-muted">
            Test strategy
            <select
              className="w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
              value={testStrategy}
              onChange={(e) =>
                setTestStrategy(e.target.value as 'SPRINT' | 'KANBAN')
              }
              disabled={!canEdit}
            >
              <option value="SPRINT">Sprint — fixed roster, nightly replay</option>
              <option value="KANBAN">Kanban — pull next batch by WIP</option>
            </select>
          </label>
          {testStrategy === 'KANBAN' ? (
            <label className="block space-y-1 text-xs text-muted">
              Kanban WIP limit
              <input
                className="w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
                value={kanbanWipLimit}
                onChange={(e) => setKanbanWipLimit(e.target.value)}
                inputMode="numeric"
                disabled={!canEdit}
              />
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={healRequiresReview}
              onChange={(e) => setHealRequiresReview(e.target.checked)}
              disabled={!canEdit}
            />
            Human must approve every heal (including rule-heal / P0)
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={llmHealRequiresApproval}
              onChange={(e) => setLlmHealRequiresApproval(e.target.checked)}
              disabled={!canEdit}
            />
            LLM healer requires approval before commit
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={allowExecuteQuarantined}
              onChange={(e) => setAllowExecuteQuarantined(e.target.checked)}
              disabled={!canEdit}
            />
            Allow Execute all to include quarantined scripts
          </label>
          {policyMutation.isError ? (
            <p className="text-sm text-danger">
              {policyMutation.error instanceof Error
                ? policyMutation.error.message
                : 'Policy save failed'}
            </p>
          ) : null}
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={policyMutation.isPending}
              onClick={() => policyMutation.mutate()}
            >
              {policyMutation.isPending ? 'Saving…' : 'Save strategy & gates'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {saveMutation.isError ? (
        <p className="text-sm text-danger">
          {saveMutation.error instanceof Error
            ? saveMutation.error.message
            : 'Save failed'}
        </p>
      ) : null}
      {canEdit ? (
        <Button
          type="button"
          size="sm"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending
            ? 'Saving…'
            : variant === 'environment'
              ? 'Save environment'
              : 'Save and update test steps'}
        </Button>
      ) : null}
      {savedReady ||
      (project?.appUrl &&
        project.appUrl.trim() &&
        project.appUrl.trim() !== 'https://') ? (
        <div className="rounded-md border border-border bg-bg-elevated p-3">
          <p className="text-xs text-muted">
            Environment URL is ready. Refresh cases from the live app and your
            prompt history (update matching cases — does not wipe existing ones).
          </p>
          <Link
            href={`/app/projects/${projectId}?tab=cases&ai=refresh`}
            className="mt-2 inline-flex"
          >
            <Button type="button" size="sm" variant="secondary">
              Refresh cases from app + prompt
            </Button>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
