/**
 * Full STLC flow on a fresh login-only Sauce Demo project.
 * Usage: node scripts/login-stlc-full-flow.mjs
 */
import { writeFileSync } from 'node:fs';

const API = process.env.API_URL ?? 'https://api-production-08317.up.railway.app';
const ORIGIN = process.env.APP_URL ?? 'https://qaforge-ai-tau.vercel.app';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@qaforge.ai';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Admin@QAForge123';
const ORG_ID = process.env.SMOKE_ORG_ID ?? 'cmsix2pjk0000pb01wzvtwj05';
const POLL_MS = Number(process.env.SMOKE_POLL_MS ?? 10000);
const MAX_POLLS = Number(process.env.SMOKE_MAX_POLLS ?? 120);

const REQUIREMENTS = `# Sauce Demo — Login Only (v1)

App under test: https://www.saucedemo.com

## Feature: Login

### REQ-001: Valid Login
As a shopper, I want to log in with a valid username and password so that I can see the product inventory.

Acceptance Criteria:
1. User can enter username and password on the login page.
2. Valid credentials (standard_user / secret_sauce) redirect to the inventory page.
3. Password field masks entered characters.

Business Rules:
- Only registered users can log in.

### REQ-002: Invalid Login
As a shopper, I want clear feedback when login fails so that I know credentials were rejected.

Acceptance Criteria:
1. Invalid password shows an error message.
2. User remains on the login page.
3. Empty username or password must not allow login.
`;

let cookie = '';
const report = {
  startedAt: new Date().toISOString(),
  steps: [],
  projectId: null,
  executionId: null,
  cases: [],
  ok: false,
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function step(name, data) {
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
      ...(init.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
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
  assert(res.ok, `login failed ${res.status}`);
  step('login', { ok: true });
}

async function createProject() {
  const name = `Login Only Flow ${new Date().toISOString().slice(0, 16)}`;
  const res = await api('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description: 'Automated full-flow test — login requirements only',
      appUrl: 'https://www.saucedemo.com',
      loginUrl: 'https://www.saucedemo.com',
      requirementText: REQUIREMENTS,
    }),
  });
  assert(res.ok, `create project ${res.status}: ${JSON.stringify(res.body)}`);
  report.projectId = res.body.id;
  step('create-project', { id: res.body.id, name });
  return res.body.id;
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

async function extractAndReview(projectId) {
  let res = await api(`/api/v1/projects/${projectId}/extract-requirements`, {
    method: 'POST',
    body: '{}',
  });
  assert(res.ok, `extract ${res.status}: ${JSON.stringify(res.body)}`);
  step('extract', { status: res.status });

  await waitProject(
    projectId,
    (p) =>
      (p.extractedRequirementCount ?? 0) > 0 ||
      p.analysisStatus === 'COMPLETED' ||
      p.analysisStatus === 'FAILED',
    'extract-done',
  );

  res = await api(`/api/v1/projects/${projectId}/review-requirements`, {
    method: 'POST',
    body: '{}',
  });
  // review may already be running / completed
  step('review-kickoff', { status: res.status, body: res.body?.message ?? null });

  const project = await waitProject(
    projectId,
    (p) => p.analysisStatus === 'COMPLETED' || p.analysisStatus === 'FAILED',
    'analysis',
  );
  assert(project.analysisStatus === 'COMPLETED', `analysis ${project.analysisStatus}`);
  step('analysis-complete', {
    extracted: project.extractedRequirementCount,
  });
}

async function getSummary(projectId) {
  const res = await api(`/api/v1/projects/${projectId}/review-summary`);
  assert(res.ok, `summary ${res.status}`);
  return res.body;
}

async function approveRequirements(projectId) {
  let summary = await getSummary(projectId);
  step('handoff-before-approve', summary.stlcHandoff);

  if (!summary.stlcHandoff?.canApprove) {
    const qs = await api(`/api/v1/projects/${projectId}/review-questions`);
    const open = (Array.isArray(qs.body) ? qs.body : qs.body?.items || []).filter(
      (q) => q.status === 'OPEN' && q.blocking && q.priority === 'CRITICAL',
    );
    for (const q of open) {
      await api(`/api/v1/projects/${projectId}/review-questions/${q.id}/answer`, {
        method: 'POST',
        body: JSON.stringify({
          answer:
            'Confirmed for login e2e: deny unauthorized access; fail closed with a clear recoverable error.',
        }),
      });
    }
    summary = await getSummary(projectId);
  }

  assert(
    summary.stlcHandoff?.canApprove,
    `cannot approve: ${(summary.stlcHandoff?.blockers ?? []).join('; ')}`,
  );

  if (!summary.stlcHandoff?.approved) {
    const res = await api(`/api/v1/projects/${projectId}/approve-requirements`, {
      method: 'POST',
      body: '{}',
    });
    assert(res.ok, `approve ${res.status}: ${JSON.stringify(res.body)}`);
  }
  step('requirements-approved', { ok: true });
}

async function getExecution(executionId) {
  const res = await api(`/api/v1/orgs/${ORG_ID}/executions/${executionId}`);
  assert(res.ok, `execution ${res.status}`);
  return res.body;
}

async function waitForStatus(executionId, statuses, label) {
  const want = new Set(statuses);
  for (let i = 1; i <= MAX_POLLS; i++) {
    const ex = await getExecution(executionId);
    log(`[${label}] poll ${i}/${MAX_POLLS}`, ex.status, ex.phase);
    if (ex.status === 'FAILED') {
      throw new Error(`execution FAILED: ${ex.errorSummary ?? 'unknown'}`);
    }
    if (want.has(ex.status)) return ex;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`timeout waiting for ${[...want].join('|')} (${label})`);
}

async function postGate(path, label, body = '{}') {
  const res = await api(path, { method: 'POST', body });
  step(label, {
    status: res.status,
    executionStatus:
      typeof res.body === 'object' ? res.body?.status ?? null : null,
  });
  assert(res.ok, `${label} failed ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

function caseQuality(tc) {
  const steps = Array.isArray(tc.steps) ? tc.steps : [];
  return {
    id: tc.externalId,
    scenario: tc.scenario,
    preconditionsLen: (tc.preconditions ?? '').length,
    steps: steps.length,
    expectedLen: (tc.expected ?? '').length,
    detailed:
      (tc.preconditions ?? '').trim().length >= 20 &&
      steps.length >= 3 &&
      (tc.expected ?? '').trim().length >= 20,
  };
}

async function validateDesign(projectId) {
  const cases = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases`,
  );
  assert(cases.ok, `test-cases ${cases.status}`);
  assert(Array.isArray(cases.body) && cases.body.length > 0, 'no test cases');
  const quality = cases.body.map(caseQuality);
  report.cases = quality;
  const detailedCount = quality.filter((q) => q.detailed).length;
  step('design-cases', {
    count: quality.length,
    detailedCount,
    sample: quality.slice(0, 3),
  });
  assert(quality.length >= 2, 'expected at least 2 login cases');
  return quality;
}

async function main() {
  log('login-stlc-full-flow start', { API });
  await login();
  const projectId = await createProject();
  await extractAndReview(projectId);
  await approveRequirements(projectId);

  const start = await api(`/api/v1/projects/${projectId}/stlc/start`, {
    method: 'POST',
    body: '{}',
  });
  assert(start.ok, `stlc/start ${start.status}: ${JSON.stringify(start.body)}`);
  const executionId = start.body.id;
  report.executionId = executionId;
  step('stlc-start', { executionId, status: start.body.status });

  // Wait through strategy+design
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ex = await waitForStatus(
      executionId,
      ['AWAITING_CLARIFICATION', 'AWAITING_DESIGN_APPROVAL', 'AWAITING_PLAN_APPROVAL'],
      'pre-design',
    );
    if (ex.status === 'AWAITING_CLARIFICATION') {
      await postGate(
        `/api/v1/orgs/${ORG_ID}/executions/${executionId}/clarify`,
        'clarify-skip',
        JSON.stringify({ skip: true, answers: {} }),
      );
      continue;
    }
    if (ex.status === 'AWAITING_PLAN_APPROVAL') {
      await postGate(
        `/api/v1/orgs/${ORG_ID}/executions/${executionId}/approve-test-plan`,
        'approve-test-plan',
      );
      continue;
    }
    await validateDesign(projectId);
    await postGate(
      `/api/v1/orgs/${ORG_ID}/executions/${executionId}/approve-test-design`,
      'approve-test-design',
    );
    break;
  }

  const laterGates = [
    ['AWAITING_ENV_APPROVAL', 'approve-environment'],
    ['AWAITING_DATA_APPROVAL', 'approve-test-data'],
    ['AWAITING_LOGIN', 'continue-after-login'],
    ['AWAITING_EXECUTION_APPROVAL', 'approve-test-execution'],
    ['AWAITING_DEFECT_APPROVAL', 'approve-defects'],
    ['AWAITING_AUTOMATION_APPROVAL', 'approve-automation'],
    ['AWAITING_REPORT_APPROVAL', 'approve-report'],
    ['AWAITING_QA_SIGNOFF', 'approve-qa-signoff'],
  ];

  // If a continue-flag skipped ahead, land on the live gate instead of timing out.
  for (let i = 0; i < laterGates.length; ) {
    const remaining = laterGates.slice(i).map(([s]) => s);
    const ex = await waitForStatus(executionId, remaining, laterGates[i][1]);
    i += remaining.indexOf(ex.status);
    const [, action] = laterGates[i];
    await postGate(
      `/api/v1/orgs/${ORG_ID}/executions/${executionId}/${action}`,
      action,
    );
    i += 1;
  }

  const done = await waitForStatus(executionId, ['COMPLETED'], 'completed');
  const project = await api(`/api/v1/projects/${projectId}`);
  report.ok = true;
  report.finishedAt = new Date().toISOString();
  report.result = {
    executionId,
    status: done.status,
    phase: done.phase,
    stlcStage: project.body?.stlcStage,
    qaSignedOffAt: project.body?.qaSignedOffAt ?? null,
    caseCount: report.cases.length,
    detailedCases: report.cases.filter((c) => c.detailed).length,
    projectUrl: `${ORIGIN}/app/projects/${projectId}?tab=stlc&phase=DESIGN`,
  };
  writeFileSync('login-stlc-full-flow-result.json', JSON.stringify(report, null, 2));
  log('FULL FLOW PASS', report.result);
}

main().catch((err) => {
  report.ok = false;
  report.error = String(err?.stack || err);
  report.finishedAt = new Date().toISOString();
  writeFileSync('login-stlc-full-flow-result.json', JSON.stringify(report, null, 2));
  console.error('FULL FLOW FAIL', err);
  process.exit(1);
});
