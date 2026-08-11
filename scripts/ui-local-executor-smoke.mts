/**
 * Live UI smoke: pair local runner from AI Executor and run headed
 * Playwright against the-internet (not Sauce Demo).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(REPO, 'apps/worker/package.json'));
const { chromium } = require('playwright') as typeof import('playwright');

const API = process.env.API_URL ?? 'https://api-production-08317.up.railway.app';
const ORIGIN = process.env.APP_URL ?? 'https://qaforge-ai-tau.vercel.app';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@qaforge.ai';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Admin@QAForge123';
const ORG_ID = process.env.SMOKE_ORG_ID ?? 'cmsix2pjk0000pb01wzvtwj05';
const APP = 'https://the-internet.herokuapp.com/login';
const APP_USER = 'tomsmith';
const APP_PASS = 'SuperSecretPassword!';
const OUT = path.join(REPO, '.tmp', 'ui-local-executor');

let cookie = '';
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  ok: false,
};

function log(...a: unknown[]) {
  console.log(new Date().toISOString(), ...a);
}

function parseSetCookie(res: Response) {
  const raw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [];
  if (raw.length) {
    cookie = raw.map((c) => c.split(';')[0]).join('; ');
    return;
  }
  const single = res.headers.get('set-cookie');
  if (single) {
    cookie = single
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split(';')[0]?.trim() ?? '')
      .filter(Boolean)
      .join('; ');
  }
}

async function api(p: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${p}`, {
    ...init,
    headers: {
      Origin: ORIGIN,
      Cookie: cookie,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  parseSetCookie(res);
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { ok: res.ok, status: res.status, body };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function seed() {
  const login = await api('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert(login.ok, `login ${login.status}`);
  const created = await api('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: `UI local runner ${new Date().toISOString().slice(0, 16)}`,
      description: 'Headed local-runner UI smoke — the-internet login',
      appUrl: APP,
      loginUrl: APP,
    }),
  });
  assert(created.ok, `create project ${created.status} ${JSON.stringify(created.body)}`);
  const projectId = (created.body as { id: string }).id;
  const tc = await api(`/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases`, {
    method: 'POST',
    body: JSON.stringify({
      scenario: 'Valid user can log in to the-internet',
      expected: 'You logged into a secure area',
      caseStatus: 'READY',
      priorityLabel: 'HIGH',
      steps: [
        `Go to ${APP}`,
        'Enter username "tomsmith"',
        'Enter password "SuperSecretPassword!"',
        'Click Login',
        'Verify You logged into a secure area',
      ],
    }),
  });
  assert(tc.ok, `create case ${tc.status} ${JSON.stringify(tc.body)}`);
  const caseId = (tc.body as { id: string }).id;
  const ready = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases/status`,
    { method: 'POST', body: JSON.stringify({ status: 'READY', ids: [caseId] }) },
  );
  assert(ready.ok, `ready ${ready.status}`);
  const run = await api(`/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/runs`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Local headed the-internet',
      testCaseIds: [caseId],
      status: 'PENDING',
    }),
  });
  assert(run.ok, `create run ${run.status} ${JSON.stringify(run.body)}`);
  const runId = (run.body as { id: string }).id;
  return { projectId, runId, caseId };
}

function startLocalRunner(token: string) {
  const child = spawn(
    'pnpm',
    [
      '--filter',
      '@qaforge/worker',
      'local-runner',
      '--api',
      API,
      '--token',
      token,
    ],
    {
      cwd: REPO,
      shell: true,
      env: { ...process.env, QAFORGE_FORCE_HEADED: 'true' },
    },
  );
  const lines: string[] = [];
  const onData = (buf: Buffer) => {
    const text = buf.toString();
    lines.push(text);
    process.stdout.write(`[runner] ${text}`);
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  return { child, lines };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const seedIds = await seed();
  report.projectId = seedIds.projectId;
  report.runId = seedIds.runId;
  log('seeded', seedIds);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 120,
    args: ['--start-maximized'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  let runner: { child: ChildProcess; lines: string[] } | null = null;

  try {
    await page.goto(`${ORIGIN}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"]').fill(EMAIL);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/app\//, { timeout: 30_000 });
    await page.screenshot({ path: path.join(OUT, '01-logged-in.png') });

    await page.goto(
      `${ORIGIN}/app/projects/${seedIds.projectId}/runs/${seedIds.runId}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.getByRole('heading', { name: /local headed/i }).waitFor({
      timeout: 20_000,
    });
    await page.screenshot({ path: path.join(OUT, '02-run.png') });

    await page.getByRole('button', { name: 'AI Executor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: 'AI Executor' }).waitFor();
    await page.screenshot({ path: path.join(OUT, '03-executor.png') });

    const replace = dialog.getByRole('button', { name: /replace token/i });
    if (await replace.isVisible().catch(() => false)) {
      page.once('dialog', (d) => d.accept());
      await replace.click();
    } else {
      await dialog.getByRole('button', { name: /create token/i }).click();
    }
    await dialog.locator('pre').waitFor({ timeout: 15_000 });
    const command = (await dialog.locator('pre').innerText()).trim();
    const token = command.match(/--token\s+"?([^\s"]+)/)?.[1];
    assert(token, `no token in command: ${command}`);
    report.commandHasApi = command.includes(API);
    log('token created');

    runner = startLocalRunner(token);
    await dialog
      .getByTestId('local-runner-status')
      .filter({ hasText: /^Online/ })
      .waitFor({ timeout: 45_000 });
    await page.screenshot({ path: path.join(OUT, '04-online.png') });

    await dialog.getByPlaceholder('https://qa.example.com').fill(APP);
    const loginUrl = dialog.locator('input').nth(1);
    await loginUrl.fill(APP);
    await dialog.locator('input').nth(2).fill(APP_USER);
    await dialog.locator('input[type="password"]').fill(APP_PASS);
    const prod = dialog.getByText(/this url is production/i);
    if (await prod.count()) {
      await dialog.locator('input[type="checkbox"]').last().check();
    }
    await page.screenshot({ path: path.join(OUT, '05-filled.png') });

    await dialog.getByRole('button', { name: 'Start AI Executor' }).click();
    await page
      .getByText(/waiting for the local runner|running/i)
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => undefined);
    await page.screenshot({ path: path.join(OUT, '06-started.png') });

    let status = 'PENDING';
    for (let i = 0; i < 40; i++) {
      const row = await api(
        `/api/v1/orgs/${ORG_ID}/projects/${seedIds.projectId}/tcms/runs/${seedIds.runId}`,
      );
      const body = row.body as {
        status?: string;
        errorSummary?: string | null;
        waitingForRunner?: boolean;
        counts?: { passed?: number; failed?: number };
      };
      status = body.status ?? status;
      log('run poll', i, status, body.errorSummary ?? '', body.counts);
      if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
        report.final = body;
        break;
      }
      await page.waitForTimeout(3000);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: path.join(OUT, '07-final.png') });
    report.runnerLog = runner.lines.join('').slice(-4000);
    report.status = status;
    report.ok = status === 'COMPLETED';
    assert(status === 'COMPLETED', `run ended ${status}: ${JSON.stringify(report.final)}`);
  } finally {
    if (runner?.child.pid) {
      runner.child.kill();
    }
    await browser.close().catch(() => undefined);
    await writeFile(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2));
  }
}

main()
  .then(() => {
    log('UI local executor PASS');
    process.exit(0);
  })
  .catch(async (err) => {
    report.ok = false;
    report.error = err instanceof Error ? err.message : String(err);
    await writeFile(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2)).catch(
      () => undefined,
    );
    console.error('[smoke] FAILED', err);
    process.exit(1);
  });
