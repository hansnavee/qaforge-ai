import os from 'node:os';
import { BrowserSessionManager } from '@qaforge/browser-session';
import { caseStartUrl, classifyAiFailureMessage, credsFromCases } from '@qaforge/shared';
import { buildAutomationHtml, playwrightSpec } from './ai-execute-playwright.js';
import { executeTestSteps } from './execute-test-steps.js';
import { parseActionLog } from './replay-action-log.js';
import { runFailurePipeline } from './failure-pipeline.js';

type LocalJob = {
  executionId: string;
  projectId: string;
  projectName: string;
  runName: string;
  runKind?: string;
  appUrl: string;
  loginUrl?: string;
  username?: string;
  password?: string;
  browser: 'chromium' | 'firefox' | 'webkit';
  headless: boolean;
  healRequiresReview?: boolean;
  llmHealRequiresApproval?: boolean;
  allowExecuteQuarantined?: boolean;
  cases: Array<{
    id: string;
    externalId: string;
    scenario: string;
    priorityLabel: string;
    steps: string[];
    expected: string;
    testData: Record<string, string>;
    actionLog?: unknown[];
    stabilityStatus?: string | null;
    healCount?: number;
  }>;
};

function arg(flag: string, envName: string) {
  const idx = process.argv.indexOf(`--${flag}`);
  const value = idx >= 0 ? process.argv[idx + 1] : undefined;
  if (value) return value;
  return process.env[envName] || '';
}

function apiRoot(raw: string) {
  return raw.replace(/\/$/, '').replace(/\/api\/v1$/i, '');
}

function forceHeadlessIfNoDisplay(requested: boolean) {
  if (process.env.QAFORGE_FORCE_HEADED === 'true') return false;
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    console.warn('[local-runner] No DISPLAY; using headless');
    return true;
  }
  return requested;
}

class RunnerClient {
  constructor(
    private readonly base: string,
    private readonly token: string,
  ) {}

  private url(path: string) {
    return `${this.base}/api/v1${path.startsWith('/') ? path : `/${path}`}`;
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.url(path), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const msg =
        data && typeof data === 'object' && 'message' in data
          ? String((data as { message: unknown }).message)
          : res.statusText;
      throw new Error(`${res.status} ${msg}`);
    }
    return data as T;
  }
}

async function finishLocalJob(
  client: RunnerClient,
  browserManager: BrowserSessionManager,
  launched: { sessionId: string } | null,
  opts: {
    executionId: string;
    status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
    errorSummary: string | null;
    passed: number;
    failed: number;
    html?: string;
    headless: boolean;
  },
) {
  let sessionVideoBase64: string | undefined;
  if (launched) {
    try {
      const files = await browserManager.flushAndCollectVideos(launched.sessionId);
      const session = files[0];
      if (session && session.body.length < 12_000_000) {
        sessionVideoBase64 = session.body.toString('base64');
      }
    } catch {
      /* ignore */
    }
    if (!opts.headless) {
      const hold = Math.max(
        0,
        Number(process.env.QAFORGE_HEADED_HOLD_MS ?? 15_000) || 15_000,
      );
      console.log(
        `[local-runner] Keeping headed Chromium open for ${hold}ms so you can see it`,
      );
      await new Promise((r) => setTimeout(r, hold));
    }
    await browserManager.destroy(launched.sessionId).catch(() => undefined);
  }
  await client
    .request(`/runners/jobs/${opts.executionId}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        status: opts.status,
        errorSummary: opts.errorSummary,
        passed: opts.passed,
        failed: opts.failed,
        html: opts.html,
        sessionVideoBase64,
      }),
    })
    .catch(() => undefined);
}

async function runJob(client: RunnerClient, job: LocalJob) {
  const headless = forceHeadlessIfNoDisplay(job.headless);
  console.log(
    `[local-runner] Starting ${job.executionId} ${job.runName} headed=${!headless} cases=${job.cases.length}`,
  );
  const browserManager = new BrowserSessionManager();
  let launched: { sessionId: string } | null = null;
  let cancelled = false;
  let passed = 0;
  let failed = 0;
  const htmlRows: Array<{
    externalId: string;
    scenario: string;
    priority: string;
    status: string;
    durationMs: number | null;
    message: string | null;
    thumbDataUrl?: string | null;
  }> = [];

  const beat = async () => {
    const res = await client.request<{ cancelled?: boolean }>('/runners/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        executionId: job.executionId,
        hostname: os.hostname(),
        userAgent: `qaforge-local-runner/${process.platform}`,
      }),
    });
    if (res.cancelled) cancelled = true;
  };

  try {
    await beat();
    launched = await browserManager.launch({
      executionId: job.executionId,
      startUrl: job.appUrl,
      headless,
      browser: job.browser,
    });
    const page = await browserManager.getPage(launched.sessionId);

    for (const tc of job.cases) {
      await beat();
      if (cancelled) break;
      if (
        tc.stabilityStatus === 'QUARANTINED' &&
        !job.allowExecuteQuarantined
      ) {
        console.log(`[local-runner] SKIP quarantined ${tc.externalId}`);
        continue;
      }
      const steps = Array.isArray(tc.steps) ? tc.steps.map(String) : [];
      const testData: Record<string, string> = { ...(tc.testData ?? {}) };
      const fromCase = credsFromCases([{ testData, steps }], {});
      if (!testData.username && fromCase.username) testData.username = fromCase.username;
      if (!testData.password && fromCase.password) testData.password = fromCase.password;
      if (!testData.username && job.username) testData.username = job.username;
      if (!testData.password && job.password) testData.password = job.password;
      const started = Date.now();
      let status: 'PASSED' | 'FAILED' = 'PASSED';
      let message: string | null =
        'AI Executor: steps completed without hard failure';
      let screenshotBase64: string | undefined;
      let thumb: string | null = null;
      let actions: Awaited<ReturnType<typeof executeTestSteps>> = [];
      let healPayload: Record<string, unknown> | undefined;
      let stabilityStatus: string | undefined;
      let consecutivePasses: number | undefined;
      let healCount: number | undefined;

      try {
        const startUrl = caseStartUrl(tc.testData, steps, job.appUrl);
        const recorded = parseActionLog(tc.actionLog);
        const preferReplay =
          job.runKind === 'AUTOMATION' && recorded.length > 0;
        const env = {
          appUrl: job.appUrl,
          loginUrl: job.loginUrl,
          username: testData.username || job.username,
          password: testData.password || job.password,
          firstName: testData.firstName,
          lastName: testData.lastName,
          postalCode: testData.postalCode,
        };
        if (preferReplay) {
          const pipeline = await runFailurePipeline({
            page,
            actions: recorded,
            env,
            startUrl,
            healAttempts: tc.healCount ?? 0,
            stabilityStatus: tc.stabilityStatus,
            healRequiresReview: Boolean(job.healRequiresReview),
            llmHealRequiresApproval: job.llmHealRequiresApproval !== false,
            isP0: (tc.priorityLabel ?? '').toUpperCase() === 'HIGH',
            gotoStart: async () => {
              await page.goto(startUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 45_000,
              });
            },
          });
          status = pipeline.status;
          message = pipeline.message;
          actions = pipeline.actions;
          if (pipeline.quarantined) stabilityStatus = 'QUARANTINED';
          else if (pipeline.committedHeal) {
            stabilityStatus = 'WATCH';
            healCount = (tc.healCount ?? 0) + 1;
          } else if (status === 'PASSED') {
            consecutivePasses = 1;
            stabilityStatus = 'STABLE';
          }
          if (
            pipeline.appliedRules.length ||
            pipeline.pendingReview ||
            pipeline.quarantined ||
            pipeline.committedHeal
          ) {
            healPayload = {
              healerKind: 'RULE',
              status: pipeline.quarantined
                ? 'QUARANTINED'
                : pipeline.pendingReview
                  ? 'PENDING_REVIEW'
                  : pipeline.committedHeal
                    ? 'COMMITTED'
                    : 'VERIFIED',
              applied: pipeline.appliedRules,
              verificationRuns: pipeline.verificationRuns,
              rationale: pipeline.decision.rationale,
              committed: pipeline.committedHeal,
              pendingReview: pipeline.pendingReview,
              patchedLog:
                pipeline.committedHeal || pipeline.pendingReview
                  ? (pipeline.patchedActions ?? pipeline.actions)
                  : undefined,
            };
          }
        } else {
          await page.goto(startUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 45_000,
          });
          actions = await executeTestSteps(page, steps, startUrl, testData);
        }
      } catch (err) {
        status = 'FAILED';
        const raw = err instanceof Error ? err.message : String(err);
        message = classifyAiFailureMessage(raw);
      }

      const spec = playwrightSpec({
        externalId: tc.externalId,
        scenario: tc.scenario,
        steps,
        expected: tc.expected,
        appUrl: job.appUrl,
        username: job.username,
        password: job.password,
        actions,
      });
      const recordScript = job.runKind !== 'AUTOMATION' || !tc.actionLog?.length;

      try {
        const shot = await browserManager.screenshot(
          launched.sessionId,
          `${status.toLowerCase()}-${tc.externalId}`,
        );
        if (shot.length < 400_000) {
          screenshotBase64 = shot.toString('base64');
          thumb = `data:image/png;base64,${screenshotBase64}`;
        }
      } catch {
        /* ignore */
      }

      const durationMs = Date.now() - started;
      if (status === 'PASSED') passed += 1;
      else failed += 1;
      htmlRows.push({
        externalId: tc.externalId,
        scenario: tc.scenario,
        priority: tc.priorityLabel ?? 'MEDIUM',
        status,
        durationMs,
        message,
        thumbDataUrl: thumb,
      });
      await client.request(`/runners/jobs/${job.executionId}/events`, {
        method: 'POST',
        body: JSON.stringify({
          testCaseId: tc.id,
          externalId: tc.externalId,
          status,
          message,
          durationMs,
          ...(recordScript
            ? { spec, actionLog: actions }
            : {}),
          screenshotBase64,
          ...(stabilityStatus ? { stabilityStatus } : {}),
          ...(healCount != null ? { healCount } : {}),
          ...(consecutivePasses != null ? { consecutivePasses } : {}),
          ...(healPayload ? { heal: healPayload } : {}),
        }),
      });
      console.log(`[local-runner] ${status} ${tc.externalId} ${tc.scenario}`);
    }
  } catch (err) {
    await finishLocalJob(client, browserManager, launched, {
      executionId: job.executionId,
      status: cancelled ? 'CANCELLED' : 'FAILED',
      errorSummary: err instanceof Error ? err.message : String(err),
      passed,
      failed,
      headless,
    });
    throw err;
  }

  const html = htmlRows.length
    ? buildAutomationHtml({
        projectName: job.projectName,
        runName: job.runName,
        rows: htmlRows,
      })
    : undefined;
  await finishLocalJob(client, browserManager, launched, {
    executionId: job.executionId,
    status: cancelled ? 'CANCELLED' : 'COMPLETED',
    errorSummary: cancelled ? 'Stopped by user' : null,
    passed,
    failed,
    html,
    headless,
  });
  console.log(
    `[local-runner] Finished ${job.executionId} passed=${passed} failed=${failed} cancelled=${cancelled}`,
  );
}

async function main() {
  const token = arg('token', 'QAFORGE_RUNNER_TOKEN');
  const api = apiRoot(arg('api', 'QAFORGE_API_URL'));
  if (!token || !api) {
    console.error(
      'Usage: pnpm --filter @qaforge/worker local-runner --api <API_URL> --token <TOKEN>',
    );
    console.error('Or set QAFORGE_API_URL and QAFORGE_RUNNER_TOKEN');
    process.exit(1);
  }

  const client = new RunnerClient(api, token);
  console.log(`[local-runner] Pairing with ${api}`);
  console.log(
    '[local-runner] Headed Playwright will open on this machine when a Local job is claimed.',
  );
  let readyLogged = false;

  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
    console.log('[local-runner] Stopping…');
  });
  process.on('SIGTERM', () => {
    stopping = true;
  });

  while (!stopping) {
    try {
      await client.request('/runners/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
          hostname: os.hostname(),
          userAgent: `qaforge-local-runner/${process.platform}`,
        }),
      });
      if (!readyLogged) {
        readyLogged = true;
        console.log('[local-runner] Connected — waiting for a Local job');
      }
      const next = await client.request<{ job: LocalJob | null }>(
        '/runners/jobs/next',
      );
      if (next.job) {
        await runJob(client, next.job);
        continue;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[local-runner] ${message}`);
      if (message.startsWith('401 ')) {
        process.exit(1);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
