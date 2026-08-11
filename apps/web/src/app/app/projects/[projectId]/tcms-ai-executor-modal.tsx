'use client';

import { useEffect, useState } from 'react';
import { isLikelyProductionUrl } from '@qaforge/shared';
import { API_BASE_URL, api } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { fieldClass } from './tcms-board';

const PAIR_STORAGE = 'qaforge-local-runner-pair';

type ProjectEnv = {
  appUrl?: string | null;
  loginUrl?: string | null;
  browserMode?: string | null;
  credentialsConfigured?: boolean;
};

type RunnerStatus = {
  hasRunner: boolean;
  online: boolean;
  lastSeenAt?: string | null;
  name?: string | null;
  apiUrl?: string;
};

type RunnerToken = {
  token: string;
  command: string;
  apiUrl: string;
};

export function TcmsAiExecutorModal({
  open,
  projectId,
  runId,
  testCaseIds,
  onClose,
  onStarted,
}: {
  open: boolean;
  projectId: string;
  runId?: string | null;
  testCaseIds?: string[];
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const [appUrl, setAppUrl] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [browser, setBrowser] = useState<'chromium' | 'firefox' | 'webkit'>(
    'chromium',
  );
  const [browserMode, setBrowserMode] = useState<'HEADLESS' | 'HEADED'>(
    'HEADED',
  );
  const [target, setTarget] = useState<'LOCAL' | 'CLOUD'>('LOCAL');
  const [confirmProduction, setConfirmProduction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runner, setRunner] = useState<RunnerStatus | null>(null);
  const [pair, setPair] = useState<RunnerToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [creatingToken, setCreatingToken] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const orgId = await getDefaultOrgId();
      try {
        const raw = sessionStorage.getItem(PAIR_STORAGE);
        if (raw) {
          const stored = JSON.parse(raw) as RunnerToken & { orgId?: string };
          if (stored.command && stored.token && stored.orgId === orgId) {
            setPair({
              token: stored.token,
              command: stored.command,
              apiUrl: stored.apiUrl,
            });
          }
        }
      } catch {
        /* ignore */
      }
      const project = await api<ProjectEnv>(
        `/api/v1/orgs/${orgId}/projects/${projectId}`,
      );
      if (cancelled) return;
      setAppUrl(project.appUrl || '');
      setLoginUrl(project.loginUrl || '');
      const url = project.appUrl || '';
      if (/saucedemo/i.test(url)) {
        setUsername((u) => u || 'standard_user');
      }
    })().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Could not load project');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function loadStatus() {
      try {
        const orgId = await getDefaultOrgId();
        const status = await api<RunnerStatus>(
          `/api/v1/orgs/${orgId}/runners/status`,
        );
        if (cancelled) return;
        setRunner(status);
        if (status.online) {
          setBrowserMode((mode) => (mode === 'HEADLESS' ? 'HEADED' : mode));
        }
      } catch {
        /* keep last known status */
      }
    }
    void loadStatus();
    const timer = setInterval(() => void loadStatus(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open]);

  async function createToken() {
    setError(null);
    setCreatingToken(true);
    try {
      const orgId = await getDefaultOrgId();
      const created = await api<RunnerToken>(
        `/api/v1/orgs/${orgId}/runners`,
        { method: 'POST', body: JSON.stringify({ name: 'Windows' }) },
      );
      setPair(created);
      setCopied(false);
      try {
        sessionStorage.setItem(
          PAIR_STORAGE,
          JSON.stringify({ ...created, orgId }),
        );
      } catch {
        /* ignore */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create token');
    } finally {
      setCreatingToken(false);
    }
  }

  async function copyCommand() {
    if (!pair?.command) return;
    try {
      await navigator.clipboard.writeText(pair.command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function submit() {
    setError(null);
    if (!appUrl.trim()) {
      setError('Environment URL is required');
      return;
    }
    if (target === 'CLOUD') {
      setError('Cloud execution is coming soon. Use Local for now.');
      return;
    }
    if (!runner?.online) {
      setError('Start the local runner on your PC, then retry');
      return;
    }
    setBusy(true);
    try {
      const orgId = await getDefaultOrgId();
      const payload = {
        appUrl: appUrl.trim(),
        loginUrl: loginUrl.trim() || undefined,
        username: username.trim() || undefined,
        password: password || undefined,
        browser,
        browserMode,
        target: 'LOCAL' as const,
        confirmProduction,
        testCaseIds: testCaseIds?.length ? testCaseIds : undefined,
      };
      const result = await api<{ id: string }>(
        runId
          ? `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${runId}/ai-execute`
          : `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/automation/scripts/execute`,
        { method: 'POST', body: JSON.stringify(payload) },
      );
      setPassword('');
      onStarted(result.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI Executor failed');
    } finally {
      setBusy(false);
    }
  }

  const online = Boolean(runner?.online);
  const apiUrl = pair?.apiUrl || runner?.apiUrl || API_BASE_URL;

  return (
    <Modal
      open={open}
      title="AI Executor"
      onClose={onClose}
      footer={
        <>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !online}
            title={
              online
                ? undefined
                : 'Local runner is offline until you run the token command on this PC'
            }
            onClick={() => void submit()}
          >
            {busy ? 'Starting…' : 'Start AI Executor'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Local opens Chromium on <strong>this PC</strong>. Create a token, keep
          the runner command running in a terminal, wait until the runner is
          connected, then Start Headed. Closing the terminal or clicking New
          token stops the runner.
        </p>
        <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium">
              Local runner:{' '}
              <span
                data-testid="local-runner-status"
                className={online ? 'text-success' : 'text-muted'}
              >
                {online
                  ? `Online${runner?.name ? ` (${runner.name})` : ''}`
                  : 'Offline'}
              </span>
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={creatingToken}
              onClick={() => void createToken()}
            >
              {creatingToken
                ? 'Creating…'
                : pair
                  ? 'New token (restarts runner)'
                  : 'Create token'}
            </Button>
          </div>
          {pair ? (
            <>
              <p className="text-[11px] text-muted">
                Keep this terminal open. New token invalidates the previous one.
              </p>
              <pre className="overflow-x-auto rounded-md border border-border bg-surface px-2 py-2 text-[11px] leading-snug">
                {pair.command}
              </pre>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void copyCommand()}
                >
                  {copied ? 'Copied' : 'Copy command'}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-muted">
              Create a token, then run{' '}
              <code>pnpm --filter @qaforge/worker local-runner --api {apiUrl} --token …</code>{' '}
              on this PC. Status turns Online within a few seconds.
            </p>
          )}
        </div>
        <label className="block text-xs text-muted">
          Environment URL
          <input
            className={`${fieldClass} mt-1`}
            value={appUrl}
            onChange={(e) => setAppUrl(e.target.value)}
            placeholder="https://qa.example.com"
          />
        </label>
        <label className="block text-xs text-muted">
          Login URL (optional)
          <input
            className={`${fieldClass} mt-1`}
            value={loginUrl}
            onChange={(e) => setLoginUrl(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-muted">
            Username (optional)
            <input
              className={`${fieldClass} mt-1`}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="block text-xs text-muted">
            Password (optional)
            <input
              className={`${fieldClass} mt-1`}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-muted">
            Browser
            <select
              className={`${fieldClass} mt-1`}
              value={browser}
              onChange={(e) =>
                setBrowser(e.target.value as 'chromium' | 'firefox' | 'webkit')
              }
            >
              <option value="chromium">Chromium</option>
              <option value="firefox">Firefox</option>
              <option value="webkit">WebKit</option>
            </select>
          </label>
          <label className="block text-xs text-muted">
            Mode
            <select
              className={`${fieldClass} mt-1`}
              value={browserMode}
              disabled={!online}
              onChange={(e) =>
                setBrowserMode(e.target.value as 'HEADLESS' | 'HEADED')
              }
            >
              <option value="HEADED">Headed (opens a browser)</option>
              <option value="HEADLESS">Headless</option>
            </select>
          </label>
        </div>
        <fieldset className="space-y-1 text-xs text-muted">
          <legend>Target</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={target === 'LOCAL'}
              onChange={() => setTarget('LOCAL')}
            />
            Local (this computer)
          </label>
          <label className="flex items-center gap-2 opacity-60">
            <input type="radio" disabled checked={false} readOnly />
            Cloud (coming soon)
          </label>
        </fieldset>
        {isLikelyProductionUrl(appUrl) ? (
          <p className="text-xs text-danger">
            This URL is treated as production. Check the box below or Start will
            fail.
          </p>
        ) : null}
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={confirmProduction}
            onChange={(e) => setConfirmProduction(e.target.checked)}
          />
          This URL is production and I want to proceed
        </label>
        {!online ? (
          <p className="text-xs text-danger">
            Runner is Offline. Create a token and run the command in this repo
            before Start.
          </p>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
