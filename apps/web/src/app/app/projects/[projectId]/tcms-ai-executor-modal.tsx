'use client';

import { useEffect, useState } from 'react';
import { isLikelyProductionUrl } from '@qaforge/shared';
import { API_BASE_URL, ApiError, api } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { parsePlanLimitError } from '@/lib/plan';
import { usePlan } from '@/lib/use-plan';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { ProFeatureNotice } from '@/components/UpgradeModal';
import { fieldClass } from './tcms-board';

const PAIR_STORAGE = 'qaforge-local-runner-pair';
const REPO_STORAGE = 'qaforge-repo-root';
const DEFAULT_REPO = 'D:\\auto-test-genration';

function readRepoDir() {
  try {
    const saved = localStorage.getItem(REPO_STORAGE)?.trim();
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_REPO;
}

function persistRepoDir(dir: string) {
  try {
    localStorage.setItem(REPO_STORAGE, dir.trim());
  } catch {
    /* ignore */
  }
}

function buildRunnerCommand(apiUrl: string, token: string, repoDir: string) {
  const flags = `--api ${apiUrl} --token ${token}`;
  const dir = repoDir.trim().replace(/[/\\]+$/, '').replace(/"/g, '');
  if (!dir) {
    return `cmd /c "pnpm --filter @qaforge/worker local-runner ${flags}"`;
  }
  return `cmd /c "cd /d ${dir} && pnpm --filter @qaforge/worker local-runner ${flags}"`;
}

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
    'HEADLESS',
  );
  const [executeMode, setExecuteMode] = useState<'RECORD' | 'REPLAY'>('RECORD');
  const [target, setTarget] = useState<'LOCAL' | 'CLOUD'>('LOCAL');
  const [confirmProduction, setConfirmProduction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runner, setRunner] = useState<RunnerStatus | null>(null);
  const [pair, setPair] = useState<RunnerToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [creatingToken, setCreatingToken] = useState(false);
  const [repoDir, setRepoDir] = useState(DEFAULT_REPO);
  const [browserstackConfigured, setBrowserstackConfigured] = useState(false);
  const { canCloudRunner } = usePlan();

  useEffect(() => {
    if (!canCloudRunner && target === 'CLOUD') {
      setTarget('LOCAL');
    }
  }, [canCloudRunner, target]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const orgId = await getDefaultOrgId();
      const dir = readRepoDir();
      setRepoDir(dir);
      try {
        const raw = sessionStorage.getItem(PAIR_STORAGE);
        if (raw) {
          const stored = JSON.parse(raw) as RunnerToken & { orgId?: string };
          if (stored.token && stored.orgId === orgId) {
            setPair({
              token: stored.token,
              apiUrl: stored.apiUrl,
              command: buildRunnerCommand(stored.apiUrl, stored.token, dir),
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
      try {
        const org = await api<{ browserstackConfigured?: boolean }>(
          `/api/v1/orgs/${orgId}`,
        );
        if (!cancelled) {
          setBrowserstackConfigured(Boolean(org.browserstackConfigured));
        }
      } catch {
        /* Cloud Start stays disabled until Settings keys load */
      }
      let nextUrl = '';
      let nextLogin = '';
      let nextUser = '';
      if (runId) {
        const run = await api<{
          cases?: Array<{
            id: string;
            testData?: Record<string, string> | null;
            steps?: unknown;
          }>;
        }>(`/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${runId}`);
        const wanted = testCaseIds?.length
          ? (run.cases ?? []).filter((c) => testCaseIds.includes(c.id))
          : (run.cases ?? []);
        for (const c of wanted) {
          const data = c.testData ?? {};
          if (!nextUrl && data.appUrl) nextUrl = data.appUrl;
          if (!nextLogin && data.loginUrl) nextLogin = data.loginUrl;
          if (!nextUser && data.username) nextUser = data.username;
          const steps = Array.isArray(c.steps) ? c.steps.map(String) : [];
          for (const step of steps) {
            const url = step.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
            if (!nextUrl && url) nextUrl = url;
            const user = step.match(/username\s+"([^"]+)"/i)?.[1];
            if (!nextUser && user && !/^a valid /i.test(user)) nextUser = user;
          }
        }
      }
      if (!nextUrl) nextUrl = project.appUrl || '';
      if (!nextLogin) nextLogin = project.loginUrl || '';
      if (cancelled) return;
      setAppUrl(nextUrl);
      setLoginUrl(nextLogin);
      setUsername(nextUser);
    })().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Could not load project');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, runId, testCaseIds]);

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

  async function createToken(force = false) {
    setError(null);
    setCreatingToken(true);
    try {
      const orgId = await getDefaultOrgId();
      const created = await api<RunnerToken>(
        `/api/v1/orgs/${orgId}/runners`,
        {
          method: 'POST',
          body: JSON.stringify({ name: 'Windows', force }),
        },
      );
      const next: RunnerToken = {
        token: created.token,
        apiUrl: created.apiUrl,
        command: buildRunnerCommand(created.apiUrl, created.token, repoDir),
      };
      setPair(next);
      setCopied(false);
      try {
        sessionStorage.setItem(
          PAIR_STORAGE,
          JSON.stringify({ ...next, orgId }),
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

  function replaceToken() {
    if (
      !window.confirm(
        'Replace token disconnects the runner that is Online. You must run the new command in a terminal. Continue?',
      )
    ) {
      return;
    }
    void createToken(true);
  }

  const displayCommand = pair
    ? buildRunnerCommand(pair.apiUrl, pair.token, repoDir)
    : '';

  function onRepoDirChange(value: string) {
    setRepoDir(value);
    persistRepoDir(value);
    setCopied(false);
  }

  async function copyCommand() {
    if (!displayCommand) return;
    try {
      await navigator.clipboard.writeText(displayCommand);
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
    const needsLocalRunner = target === 'LOCAL' && browserMode === 'HEADED';
    if (needsLocalRunner && !runner?.online) {
      setError(
        'Headed Local needs the local runner Online. Or switch Mode to Headless to run on the server.',
      );
      return;
    }
    if (target === 'CLOUD' && !browserstackConfigured) {
      setError('Add BrowserStack keys in Settings, then retry Cloud');
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
        executeMode,
        target,
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
  const needsLocalRunner = target === 'LOCAL' && browserMode === 'HEADED';
  const startDisabled =
    busy ||
    (needsLocalRunner && !online) ||
    (target === 'CLOUD' && !browserstackConfigured);

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
            disabled={startDisabled}
            title={
              needsLocalRunner && !online
                ? 'Headed Local needs the runner Online — or choose Headless'
                : target === 'CLOUD' && !browserstackConfigured
                  ? 'Add BrowserStack keys in Settings'
                  : undefined
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
          <strong>Headless</strong> runs on the server (no local runner required).{' '}
          <strong>Headed</strong> opens Chromium on this PC — create a token and
          wait until Online before Start. Cloud uses BrowserStack.
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
              {browserMode === 'HEADLESS' && target === 'LOCAL' ? (
                <span className="ml-1 font-normal text-muted">
                  (optional for Headless)
                </span>
              ) : null}
            </p>
            {online ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={creatingToken}
                onClick={() => replaceToken()}
              >
                {creatingToken ? 'Creating…' : 'Replace token…'}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={creatingToken}
                onClick={() => void createToken()}
              >
                {creatingToken ? 'Creating…' : 'Create token'}
              </Button>
            )}
          </div>
          {online ? (
            <p className="text-[11px] text-success">
              Connected. Leave the terminal as-is
              {needsLocalRunner
                ? ' and click Start AI Executor.'
                : '. Headless will use the server worker.'}
            </p>
          ) : browserMode === 'HEADLESS' && target === 'LOCAL' ? (
            <p className="text-[11px] text-muted">
              Headless does not need a local runner. Click Start AI Executor to
              queue on the server.
            </p>
          ) : null}
          {pair && needsLocalRunner ? (
            <>
              <label className="block text-[11px] text-muted">
                Repo folder on this PC
                <input
                  className={`${fieldClass} mt-1`}
                  value={repoDir}
                  onChange={(e) => onRepoDirChange(e.target.value)}
                  placeholder={DEFAULT_REPO}
                />
              </label>
              <p className="text-[11px] text-muted">
                Works in CMD or PowerShell from any folder (Desktop, C:\,
                etc.). Keep the window open. Needs pnpm on PATH.
              </p>
              <pre className="overflow-x-auto rounded-md border border-border bg-surface px-2 py-2 text-[11px] leading-snug">
                {displayCommand}
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
          ) : online || (browserMode === 'HEADLESS' && target === 'LOCAL') ? null : (
            <p className="text-[11px] text-muted">
              Create a token, then paste the command in CMD or PowerShell from
              any folder. API: {apiUrl}.
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
              onChange={(e) =>
                setBrowserMode(e.target.value as 'HEADLESS' | 'HEADED')
              }
            >
              <option value="HEADLESS">Headless (server)</option>
              <option value="HEADED">Headed (opens a browser on this PC)</option>
            </select>
          </label>
        </div>
        <label className="block text-xs text-muted">
          Script mode
          <select
            className={`${fieldClass} mt-1`}
            value={executeMode}
            onChange={(e) =>
              setExecuteMode(e.target.value as 'RECORD' | 'REPLAY')
            }
          >
            <option value="RECORD">Record (re-walk steps, refresh ActionLog)</option>
            <option value="REPLAY">Replay (use saved ActionLog when present)</option>
          </select>
        </label>
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
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={target === 'CLOUD'}
              disabled={!canCloudRunner}
              onChange={() => setTarget('CLOUD')}
            />
            Cloud (BrowserStack)
          </label>
        </fieldset>
        {!canCloudRunner ? (
          <ProFeatureNotice feature="Cloud runner">
            Run AI Executor in the cloud on Pro.
          </ProFeatureNotice>
        ) : null}
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
        {needsLocalRunner && !online ? (
          <p className="text-xs text-danger">
            Headed mode needs the local runner Online. Switch Mode to{' '}
            <strong>Headless (server)</strong> to run without a token, or create
            a token and start the runner.
          </p>
        ) : null}
        {target === 'CLOUD' ? (
          <p className="text-[11px] text-muted">
            {browserstackConfigured
              ? 'Cloud uses BrowserStack keys from Settings. Local runner is not required.'
              : 'Add BrowserStack username and access key in Settings before Cloud Start.'}
          </p>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
