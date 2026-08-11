/**
 * Wipe requirements on a project (or create fresh), run extract+review once,
 * capture Requirements phase UI screenshots.
 *
 * Usage: node scripts/fresh-requirements-ui.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '../apps/worker/package.json'),
);
const { chromium } = require('playwright');

const API = process.env.API_URL ?? 'https://api-production-08317.up.railway.app';
const ORIGIN = process.env.APP_URL ?? 'https://qaforge-ai-tau.vercel.app';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@qaforge.ai';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Admin@QAForge123';
const EXISTING = process.env.SMOKE_PROJECT_ID ?? '';
const POLL_MS = Number(process.env.SMOKE_POLL_MS ?? 8000);
const MAX_POLLS = Number(process.env.SMOKE_MAX_POLLS ?? 90);
const OUT = '.tmp/fresh-req-ui';

const REQUIREMENTS = `Feature: User Login

The user should be able to log in using their email and password.
If the credentials are invalid, an error message should be displayed.
After successful login, the user should be redirected to the dashboard.
`;

mkdirSync(OUT, { recursive: true });

let cookie = '';
const report = {
  startedAt: new Date().toISOString(),
  projectId: null,
  steps: [],
  shots: [],
  summary: null,
  ok: false,
};

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}
function step(name, data = {}) {
  report.steps.push({ at: new Date().toISOString(), name, ...data });
  log(name, data);
}

function parseSetCookie(res) {
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
      .map((c) => c.split(';')[0].trim())
      .join('; ');
  }
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
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
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { ok: res.ok, status: res.status, body };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function login() {
  const res = await api('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert(res.ok, `login ${res.status}`);
  step('login');
}

async function clearOrCreate() {
  let projectId = EXISTING;
  if (projectId) {
    const clear = await api(`/api/v1/projects/${projectId}/clear-requirements`, {
      method: 'POST',
      body: '{}',
    });
    if (clear.ok) {
      step('clear-requirements', clear.body?.removed ?? clear.body);
      const paste = await api(`/api/v1/projects/${projectId}/requirements`, {
        method: 'POST',
        body: JSON.stringify({ originalContent: REQUIREMENTS }),
      });
      assert(
        paste.ok,
        `paste failed ${paste.status}: ${JSON.stringify(paste.body)}`,
      );
      step('paste', { docId: paste.body?.id ?? null });
      report.projectId = projectId;
      return projectId;
    }
    step('clear-skipped', { status: clear.status, body: clear.body });
  }

  const name = `User Login Req ${new Date().toISOString().slice(0, 16)}`;
  const create = await api('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description: 'Feature: User Login',
      appUrl: 'https://www.saucedemo.com',
      loginUrl: 'https://www.saucedemo.com',
      requirementText: REQUIREMENTS,
    }),
  });
  assert(create.ok, `create ${create.status}: ${JSON.stringify(create.body)}`);
  projectId = create.body.id;
  step('create-project', { id: projectId, name });
  report.projectId = projectId;
  return projectId;
}

async function waitProject(projectId, pred, label) {
  for (let i = 1; i <= MAX_POLLS; i++) {
    const res = await api(`/api/v1/projects/${projectId}`);
    assert(res.ok, `project ${res.status}`);
    if (pred(res.body)) return res.body;
    log(`[${label}] poll ${i}`, res.body.analysisStatus, {
      extracted: res.body.extractedRequirementCount,
    });
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`timeout ${label}`);
}

async function extractAndReview(projectId) {
  let res = await api(`/api/v1/projects/${projectId}/extract-requirements`, {
    method: 'POST',
    body: '{}',
  });
  assert(res.ok, `extract ${res.status}: ${JSON.stringify(res.body)}`);
  step('extract', {
    status: res.status,
    summary: res.body?.summary ?? null,
  });

  await waitProject(
    projectId,
    (p) =>
      (p.extractedRequirementCount ?? 0) > 0 &&
      (p.analysisStatus === 'READY' ||
        p.analysisStatus === 'COMPLETED' ||
        p.analysisStatus === 'FAILED'),
    'extract-done',
  );

  res = await api(`/api/v1/projects/${projectId}/review-requirements`, {
    method: 'POST',
    body: '{}',
  });
  step('review-kickoff', {
    status: res.status,
    message: res.body?.message ?? null,
    ok: res.body?.ok ?? null,
  });
  assert(res.ok, `review ${res.status}: ${JSON.stringify(res.body)}`);

  const project = await waitProject(
    projectId,
    (p) => p.analysisStatus === 'COMPLETED' || p.analysisStatus === 'FAILED',
    'analysis',
  );
  assert(
    project.analysisStatus === 'COMPLETED',
    `analysis ${project.analysisStatus}`,
  );

  const extracted = await api(
    `/api/v1/projects/${projectId}/extracted-requirements`,
  );
  const features = await api(
    `/api/v1/projects/${projectId}/requirement-features`,
  );
  const questions = await api(
    `/api/v1/projects/${projectId}/review-questions`,
  );
  const reqList = extracted.body?.requirements ?? extracted.body ?? [];
  report.summary = {
    extractedCount: project.extractedRequirementCount,
    analysisStatus: project.analysisStatus,
    stlcStage: project.stlcStage,
    requirements: (Array.isArray(reqList) ? reqList : []).slice(0, 12).map((r) => ({
      key: r.requirementKey ?? r.key,
      title: r.title,
      status: r.status,
      priority: r.priority,
      type: r.type,
      feature: r.featureName ?? r.featureGroup?.name ?? r.feature,
      acCount: Array.isArray(r.acceptanceCriteria)
        ? r.acceptanceCriteria.length
        : null,
    })),
    featureCount: Array.isArray(features.body)
      ? features.body.length
      : features.body?.features?.length ?? null,
    openQuestions: Array.isArray(questions.body)
      ? questions.body.filter((q) => q.status === 'OPEN').length
      : questions.body?.questions?.filter?.((q) => q.status === 'OPEN')
          ?.length ?? null,
  };
  step('analysis-complete', report.summary);
}

function browserCookiesFromHeader() {
  const apiHost = new URL(API).hostname;
  const appHost = new URL(ORIGIN).hostname;
  return cookie.split('; ').flatMap((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) return [];
    const base = {
      name: pair.slice(0, eq),
      value: pair.slice(eq + 1),
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    };
    return [
      { ...base, domain: apiHost },
      { ...base, domain: appHost },
    ];
  });
}

async function captureUi(projectId) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 920 },
  });
  await context.addCookies(browserCookiesFromHeader());
  const page = await context.newPage();
  page.setDefaultTimeout(45000);

  async function shot(name, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(2200);
    const path = `${OUT}/${name}.png`;
    await page.screenshot({ path, fullPage: true });
    const title = await page.title();
    const bodyText = (await page.locator('body').innerText()).slice(0, 1500);
    report.shots.push({ name, path, title, preview: bodyText });
    step('shot', { name, path, title });
  }

  const base = `${ORIGIN}/app/projects/${projectId}?tab=requirements`;
  await shot('01-source', `${base}&view=source`);
  await shot('02-extract', `${base}&view=extract`);
  await shot('03-review', `${base}&view=review`);
  await shot('04-features', `${base}&view=features`);
  await shot('05-approve', `${base}&view=approve`);

  await page.goto(`${base}&view=features`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForTimeout(1500);
  const accordion = page.locator('button[aria-expanded]').first();
  if ((await accordion.count()) > 0) {
    if ((await accordion.getAttribute('aria-expanded')) !== 'true') {
      await accordion.click().catch(() => {});
      await page.waitForTimeout(800);
    }
    const reqLink = page.getByText(/REQ-\d+/i).first();
    if ((await reqLink.count()) > 0) {
      await reqLink.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
    await page.screenshot({
      path: `${OUT}/06-review-detail.png`,
      fullPage: true,
    });
    report.shots.push({
      name: '06-review-detail',
      path: `${OUT}/06-review-detail.png`,
      preview: (await page.locator('body').innerText()).slice(0, 1500),
    });
    step('shot', { name: '06-review-detail' });
  }

  await browser.close();
}

async function main() {
  await login();
  const projectId = await clearOrCreate();
  await extractAndReview(projectId);
  await captureUi(projectId);
  report.ok = true;
  report.finishedAt = new Date().toISOString();
  report.uiUrl = `${ORIGIN}/app/projects/${projectId}?tab=requirements&view=review`;
  writeFileSync(`${OUT}/result.json`, JSON.stringify(report, null, 2));
  console.log('\nOK', report.uiUrl);
  console.log('Shots:', report.shots.map((s) => s.path).join(', '));
  console.log('Summary:', JSON.stringify(report.summary, null, 2));
}

main().catch((err) => {
  report.ok = false;
  report.error = String(err?.stack || err);
  writeFileSync(`${OUT}/result.json`, JSON.stringify(report, null, 2));
  console.error(err);
  process.exit(1);
});
