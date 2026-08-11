import os from 'node:os';
import { BrowserSessionManager } from '@qaforge/browser-session';
import {
  buildAutomationHtml,
  playwrightSpec,
  tryLogin,
} from './ai-execute-playwright.js';
import { executeTestSteps } from './execute-test-steps.js';

type LocalJob = {
  executionId: string;
  projectId: string;
  projectName: string;
  runName: string;
  appUrl: string;
  loginUrl?: string;
  username?: string;
  password?: string;
  browser: 'chromium' | 'firefox' | 'webkit';
  headless: boolean;
  cases: Array<{
    id: string;
    externalId: string;
    scenario: string;
    priorityLabel: string;
    steps: string[];
    expected: string;
    testData: Record<string, string>;
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
    await tryLogin(page, {
      appUrl: job.appUrl,
      loginUrl: job.loginUrl,
      username: job.username,
      password: job.password,
    }).catch(() => undefined);

    for (const tc of job.cases) {
      await beat();
      if (cancelled) break;
      const steps = Array.isArray(tc.steps) ? tc.steps.map(String) : [];
      const spec = playwrightSpec({
        externalId: tc.externalId,
        scenario: tc.scenario,
        steps,
        expected: tc.expected,
        appUrl: job.appUrl,
        username: job.username,
        password: job.password,
      });
      const testData: Record<string, string> = { ...(tc.testData ?? {}) };
      if (job.username) testData.username = job.username;
      if (job.password) testData.password = job.password;
      const started = Date.now();
      let status: 'PASSED' | 'FAILED' = 'PASSED';
      let message: string | null =
        'AI Executor: steps completed without hard failure';
      let screenshotBase64: string | undefined;
      let videoBase64: string | undefined;
      let thumb: string | null = null;

      try {
        await page.goto(job.appUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        });
        await executeTestSteps(page, steps, job.appUrl, testData);
      } catch (err) {
        status = 'FAILED';
        message = err instanceof Error ? err.message : String(err);
      }

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

      if (status === 'FAILED') {
        try {
          const video = await browserManager.captureFailureVideo(
            launched.sessionId,
            tc.externalId.replace(/[^a-zA-Z0-9_-]/g, '_'),
          );
          if (video && video.length < 4_000_000) {
            videoBase64 = video.toString('base64');
          }
        } catch {
          /* ignore */
        }
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
          spec,
          screenshotBase64,
          videoBase64,
        }),
      });
      console.log(`[local-runner] ${status} ${tc.externalId} ${tc.scenario}`);
    }
  } catch (err) {
    await client
      .request(`/runners/jobs/${job.executionId}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          status: cancelled ? 'CANCELLED' : 'FAILED',
          errorSummary: err instanceof Error ? err.message : String(err),
          passed,
          failed,
        }),
      })
      .catch(() => undefined);
    throw err;
  } finally {
    if (launched && !headless) {
      const hold = Math.max(
        0,
        Number(process.env.QAFORGE_HEADED_HOLD_MS ?? 15_000) || 15_000,
      );
      console.log(
        `[local-runner] Keeping headed Chromium open for ${hold}ms so you can see it`,
      );
      await new Promise((r) => setTimeout(r, hold));
    }
    if (launched) {
      await browserManager.destroy(launched.sessionId).catch(() => undefined);
    }
  }

  const html = htmlRows.length
    ? buildAutomationHtml({
        projectName: job.projectName,
        runName: job.runName,
        rows: htmlRows,
      })
    : undefined;
  await client.request(`/runners/jobs/${job.executionId}/complete`, {
    method: 'POST',
    body: JSON.stringify({
      status: cancelled ? 'CANCELLED' : 'COMPLETED',
      errorSummary: cancelled ? 'Stopped by user' : null,
      passed,
      failed,
      html,
    }),
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
  console.log('[local-runner] Headed Playwright will open on this machine when a Local job is claimed.');

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
