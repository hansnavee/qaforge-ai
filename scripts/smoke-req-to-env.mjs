/**
 * Smoke: wipe old demo projects, then Requirements → Design coverage →
 * mark Ready → save Environment (URL / creds / browser mode).
 *
 * Usage: node scripts/smoke-req-to-env.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const API = process.env.API_URL ?? 'https://api-production-08317.up.railway.app';
const ORIGIN = process.env.APP_URL ?? 'https://qaforge-ai-tau.vercel.app';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@qaforge.ai';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Admin@QAForge123';
const ORG_ID = process.env.SMOKE_ORG_ID ?? 'cmsix2pjk0000pb01wzvtwj05';
const POLL_MS = Number(process.env.SMOKE_POLL_MS ?? 8000);
const MAX_POLLS = Number(process.env.SMOKE_MAX_POLLS ?? 90);

/** Empty env is the default. A real host is only used when SMOKE_APP_URL is set. */
const EMPTY_ENV = {
  appUrl: 'https://',
  browserMode: 'HEADLESS',
};
const REAL_ENV = process.env.SMOKE_APP_URL
  ? {
      appUrl: process.env.SMOKE_APP_URL,
      loginUrl: process.env.SMOKE_LOGIN_URL || process.env.SMOKE_APP_URL,
      username: process.env.SMOKE_APP_USER || undefined,
      password: process.env.SMOKE_APP_PASS || undefined,
      browserMode: 'HEADLESS',
      confirmProduction: true,
    }
  : null;

const REQUIREMENTS = `Feature: User Login

The user should be able to log in using their email and password.
If the credentials are invalid, an error message should be displayed.
After successful login, the user should be redirected to the dashboard.
`;

const OUT_DIR = '.tmp/smoke-req-to-env';
mkdirSync(OUT_DIR, { recursive: true });

let cookie = '';
const report = {
  startedAt: new Date().toISOString(),
  cleaned: [],
  projectId: null,
  executionId: null,
  requirements: [],
  designCases: [],
  coverage: null,
  environment: null,
  groundedCases: [],
  ok: false,
};

function log(...a) {
  console.log(new Date().toISOString(), ...a);
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

function summarizeCase(tc) {
  return {
    id: tc.externalId,
    requirementKey: tc.requirementKey ?? null,
    designTechnique: tc.designTechnique ?? null,
    featureKey: tc.featureKey ?? null,
    designMode: tc.designMode ?? null,
    priorityLabel: tc.priorityLabel ?? tc.priority ?? null,
    readyForExecution: Boolean(tc.readyForExecution),
    module: tc.module,
    scenario: tc.scenario,
    preconditions: tc.preconditions,
    steps: tc.steps,
    expected: tc.expected,
  };
}

function coverageOf(cases) {
  const byReq = {};
  for (const c of cases) {
    const key = c.requirementKey || 'UNMAPPED';
    if (!byReq[key]) byReq[key] = { caseCount: 0, techniques: [] };
    byReq[key].caseCount += 1;
    if (c.designTechnique && !byReq[key].techniques.includes(c.designTechnique)) {
      byReq[key].techniques.push(c.designTechnique);
    }
  }
  return byReq;
}

function stepsBlob(cases) {
  return cases
    .flatMap((c) => [
      c.preconditions,
      ...(Array.isArray(c.steps) ? c.steps : [String(c.steps ?? '')]),
    ])
    .join('\n')
    .toLowerCase();
}

async function waitProject(projectId, pred, label) {
  for (let i = 1; i <= MAX_POLLS; i++) {
    const res = await api(`/api/v1/projects/${projectId}`);
    assert(res.ok, `project ${res.status}`);
    if (pred(res.body)) return res.body;
    log(`[${label}] poll ${i}`, res.body.analysisStatus, res.body.stlcStage);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`timeout ${label}`);
}

async function waitExecution(executionId, statuses, label) {
  const want = new Set(statuses);
  for (let i = 1; i <= MAX_POLLS; i++) {
    const res = await api(`/api/v1/orgs/${ORG_ID}/executions/${executionId}`);
    assert(res.ok, `execution ${res.status}`);
    log(`[${label}] poll ${i}/${MAX_POLLS}`, res.body.status, res.body.phase);
    if (res.body.status === 'FAILED') {
      throw new Error(`execution FAILED: ${res.body.errorSummary ?? 'unknown'}`);
    }
    if (want.has(res.body.status)) return res.body;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`timeout waiting for ${[...want].join('|')} (${label})`);
}

async function main() {
  log('smoke-req-to-env start', { API });

  const login = await api('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert(login.ok, `login ${login.status}`);

  const listed = await api('/api/v1/projects');
  assert(listed.ok, `list projects ${listed.status}`);
  const existing = Array.isArray(listed.body) ? listed.body : listed.body?.items ?? [];
  log('existing projects', existing.length);
  for (const p of existing) {
    const del = await api(`/api/v1/projects/${p.id}`, { method: 'DELETE' });
    report.cleaned.push({ id: p.id, name: p.name, status: del.status, ok: del.ok });
    log('deleted', p.name, p.id, del.status);
  }

  const created = await api('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: `Login BRD smoke ${new Date().toISOString().slice(0, 16)}`,
      description: 'Requirements → design coverage → ready → environment',
      requirementText: REQUIREMENTS,
    }),
  });
  assert(created.ok, `create ${created.status}: ${JSON.stringify(created.body)}`);
  const projectId = created.body.id;
  report.projectId = projectId;
  assert(!created.body.appUrl, 'new project must not have an app URL at Design');
  log('created', projectId);

  let res = await api(`/api/v1/projects/${projectId}/extract-requirements`, {
    method: 'POST',
    body: '{}',
  });
  assert(res.ok, `extract ${res.status}: ${JSON.stringify(res.body)}`);
  await waitProject(
    projectId,
    (p) =>
      (p.extractedRequirementCount ?? 0) > 0 ||
      p.analysisStatus === 'COMPLETED' ||
      p.analysisStatus === 'FAILED',
    'extract',
  );

  res = await api(`/api/v1/projects/${projectId}/review-requirements`, {
    method: 'POST',
    body: '{}',
  });
  log('review-kickoff', res.status);
  const analyzed = await waitProject(
    projectId,
    (p) => p.analysisStatus === 'COMPLETED' || p.analysisStatus === 'FAILED',
    'review',
  );
  assert(analyzed.analysisStatus === 'COMPLETED', `analysis ${analyzed.analysisStatus}`);

  const extracted = await api(`/api/v1/projects/${projectId}/extracted-requirements`);
  report.requirements = (Array.isArray(extracted.body) ? extracted.body : []).map((r) => ({
    requirementKey: r.requirementKey,
    title: r.title,
    description: r.description,
    reviewStatus: r.reviewStatus,
    featureGroup: r.featureGroup?.name ?? null,
  }));
  log('requirements', report.requirements.length);

  let summary = await api(`/api/v1/projects/${projectId}/review-summary`);
  if (!summary.body?.stlcHandoff?.canApprove) {
    const qs = await api(`/api/v1/projects/${projectId}/review-questions`);
    const open = (Array.isArray(qs.body) ? qs.body : qs.body?.items || []).filter(
      (q) => q.status === 'OPEN' && q.blocking,
    );
    for (const q of open) {
      await api(`/api/v1/projects/${projectId}/review-questions/${q.id}/answer`, {
        method: 'POST',
        body: JSON.stringify({
          answer:
            'Confirmed for this login-only BRD: invalid credentials fail closed with an error; valid login redirects to dashboard. No signup in scope.',
        }),
      });
    }
    summary = await api(`/api/v1/projects/${projectId}/review-summary`);
  }
  assert(
    summary.body?.stlcHandoff?.canApprove,
    `cannot approve: ${(summary.body?.stlcHandoff?.blockers ?? []).join('; ')}`,
  );
  res = await api(`/api/v1/projects/${projectId}/approve-requirements`, {
    method: 'POST',
    body: '{}',
  });
  assert(res.ok, `approve ${res.status}: ${JSON.stringify(res.body)}`);
  log('requirements approved');

  const start = await api(`/api/v1/projects/${projectId}/stlc/start`, {
    method: 'POST',
    body: '{}',
  });
  assert(start.ok, `stlc/start ${start.status}: ${JSON.stringify(start.body)}`);
  const executionId = start.body.id;
  report.executionId = executionId;
  log('stlc-start', executionId);

  for (;;) {
    const ex = await waitExecution(
      executionId,
      ['AWAITING_CLARIFICATION', 'AWAITING_DESIGN_APPROVAL', 'AWAITING_PLAN_APPROVAL'],
      'design',
    );
    if (ex.status === 'AWAITING_CLARIFICATION') {
      const skip = await api(
        `/api/v1/orgs/${ORG_ID}/executions/${executionId}/clarify`,
        { method: 'POST', body: JSON.stringify({ skip: true, answers: {} }) },
      );
      assert(skip.ok, `clarify ${skip.status}`);
      continue;
    }
    if (ex.status === 'AWAITING_PLAN_APPROVAL') {
      const plan = await api(
        `/api/v1/orgs/${ORG_ID}/executions/${executionId}/approve-test-plan`,
        { method: 'POST', body: '{}' },
      );
      assert(plan.ok, `plan ${plan.status}`);
      continue;
    }
    break;
  }

  const casesRes = await api(`/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases`);
  assert(casesRes.ok, `test-cases ${casesRes.status}`);
  assert(Array.isArray(casesRes.body) && casesRes.body.length > 0, 'no test cases');
  report.designCases = casesRes.body.map(summarizeCase);
  report.coverage = coverageOf(report.designCases);

  const blob = stepsBlob(report.designCases);
  assert(!blob.includes('saucedemo'), 'Design must not bake Sauce Demo into steps');
  assert(
    report.designCases.every((c) => (c.designMode ?? 'GENERIC') === 'GENERIC'),
    'Design cases must be GENERIC before Environment',
  );
  const multi = Object.values(report.coverage).filter((r) => r.techniques.length >= 2).length;
  log('design coverage', {
    caseCount: report.designCases.length,
    reqsWithMultiTechnique: multi,
    coverage: report.coverage,
  });

  const emptySave = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/environment`,
    { method: 'POST', body: JSON.stringify(EMPTY_ENV) },
  );
  assert(
    emptySave.ok,
    `empty environment ${emptySave.status}: ${JSON.stringify(emptySave.body)}`,
  );
  assert(!emptySave.body.appUrl, 'placeholder https:// must persist as null');
  assert(!emptySave.body.groundingQueued, 'must not crawl without a real URL');
  report.environment = { empty: emptySave.body };
  log('empty environment saved', emptySave.body);

  const acceptDesign = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/stlc/phases/DESIGN/accept`,
    { method: 'POST', body: '{}' },
  );
  assert(
    acceptDesign.ok,
    `accept design ${acceptDesign.status}: ${JSON.stringify(acceptDesign.body)}`,
  );
  log('design accepted');

  await waitExecution(executionId, ['AWAITING_ENV_APPROVAL'], 'env-gate');

  const acceptEnv = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/stlc/phases/ENVIRONMENT/accept`,
    { method: 'POST', body: '{}' },
  );
  assert(
    acceptEnv.ok,
    `accept env ${acceptEnv.status}: ${JSON.stringify(acceptEnv.body)}`,
  );
  log('environment accepted without a host');

  await waitExecution(executionId, ['AWAITING_DATA_APPROVAL'], 'data-gate');
  const stillGeneric = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases`,
  );
  assert(
    (stillGeneric.body ?? []).every(
      (c) => (c.designMode ?? 'GENERIC') === 'GENERIC',
    ),
    'cases must stay GENERIC until a real URL is saved',
  );

  if (REAL_ENV) {
    const envSave = await api(
      `/api/v1/orgs/${ORG_ID}/projects/${projectId}/environment`,
      { method: 'POST', body: JSON.stringify(REAL_ENV) },
    );
    assert(envSave.ok, `save real env ${envSave.status}: ${JSON.stringify(envSave.body)}`);
    report.environment.real = envSave.body;
    log('real environment saved', envSave.body);

    let grounded = [];
    for (let i = 1; i <= MAX_POLLS; i++) {
      const next = await api(
        `/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases`,
      );
      grounded = (next.body ?? []).map(summarizeCase);
      const ui = grounded.filter((c) => c.designMode === 'UI_GROUNDED').length;
      const hasUrl = stepsBlob(grounded).includes(REAL_ENV.appUrl.toLowerCase());
      log(`[ground] poll ${i}`, { ui, hasUrl, total: grounded.length });
      if (ui === grounded.length && hasUrl) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    report.groundedCases = grounded;
    assert(
      grounded.every((c) => c.designMode === 'UI_GROUNDED'),
      'not all cases grounded after real URL',
    );
    assert(
      grounded.every((c) => !c.readyForExecution),
      'Ready must be cleared after grounding so humans re-review',
    );
  }

  const preview = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/execution-preview?runKind=SPRINT`,
  );
  report.executionPreview = preview.ok ? preview.body : { error: preview.body };
  log('execution preview (High first)', preview.body?.testCaseIds?.length, preview.body?.order);

  report.ok = true;
  report.finishedAt = new Date().toISOString();
  report.projectUrl = `${ORIGIN}/app/projects/${projectId}?tab=stlc&phase=ENVIRONMENT`;
  writeFileSync(`${OUT_DIR}/result.json`, JSON.stringify(report, null, 2));
  log('DONE', {
    projectId,
    cleaned: report.cleaned.length,
    caseCount: report.designCases.length,
    coverage: report.coverage,
    environment: report.environment?.saved,
    projectUrl: report.projectUrl,
  });
}

main().catch((err) => {
  report.ok = false;
  report.error = String(err?.stack || err);
  report.finishedAt = new Date().toISOString();
  writeFileSync(`${OUT_DIR}/result.json`, JSON.stringify(report, null, 2));
  console.error('FAIL', err);
  process.exit(1);
});
