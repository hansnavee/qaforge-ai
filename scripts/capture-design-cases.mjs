/**
 * Create a login-only project, run extract → review → approve → STLC Design,
 * then print the AI-generated test cases.
 *
 * Usage: node scripts/capture-design-cases.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const API = process.env.API_URL ?? 'https://api-production-08317.up.railway.app';
const ORIGIN = process.env.APP_URL ?? 'https://qaforge-ai-tau.vercel.app';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@qaforge.ai';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Admin@QAForge123';
const ORG_ID = process.env.SMOKE_ORG_ID ?? 'cmsix2pjk0000pb01wzvtwj05';
const POLL_MS = Number(process.env.SMOKE_POLL_MS ?? 8000);
const MAX_POLLS = Number(process.env.SMOKE_MAX_POLLS ?? 90);

const REQUIREMENTS = `Feature: User Login

The user should be able to log in using their email and password.
If the credentials are invalid, an error message should be displayed.
After successful login, the user should be redirected to the dashboard.
`;

const OUT_DIR = '.tmp/design-cases';
mkdirSync(OUT_DIR, { recursive: true });

let cookie = '';
const report = {
  startedAt: new Date().toISOString(),
  projectId: null,
  executionId: null,
  requirements: [],
  cases: [],
  coverage: null,
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
  log('capture-design-cases start', { API });

  const login = await api('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert(login.ok, `login ${login.status}`);

  const created = await api('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: `Design techniques ${new Date().toISOString().slice(0, 16)}`,
      description: 'Capture technique-based Design cases for User Login',
      appUrl: undefined,
      loginUrl: undefined,
      requirementText: REQUIREMENTS,
    }),
  });
  assert(created.ok, `create ${created.status}: ${JSON.stringify(created.body)}`);
  const projectId = created.body.id;
  report.projectId = projectId;
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
  log('requirements', report.requirements.length, report.requirements.map((r) => r.requirementKey));

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
            'Confirmed for this login-only BRD: invalid credentials fail closed with an error; valid login redirects to dashboard.',
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
  log('approved');

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
        {
          method: 'POST',
          body: JSON.stringify({ skip: true, answers: {} }),
        },
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

  const cases = await api(`/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases`);
  assert(cases.ok, `test-cases ${cases.status}`);
  assert(Array.isArray(cases.body) && cases.body.length > 0, 'no test cases');

  report.cases = cases.body.map((tc) => ({
    id: tc.externalId,
    requirementKey: tc.requirementKey ?? null,
    designTechnique: tc.designTechnique ?? null,
    module: tc.module,
    scenario: tc.scenario,
    preconditions: tc.preconditions,
    steps: tc.steps,
    expected: tc.expected,
    priority: tc.priority,
    severity: tc.severity,
    type: tc.type,
    testData: tc.testData ?? null,
  }));

  const byReq = {};
  for (const c of report.cases) {
    const key = c.requirementKey || 'UNMAPPED';
    if (!byReq[key]) byReq[key] = { caseCount: 0, techniques: [] };
    byReq[key].caseCount += 1;
    if (c.designTechnique && !byReq[key].techniques.includes(c.designTechnique)) {
      byReq[key].techniques.push(c.designTechnique);
    }
  }
  report.coverage = byReq;
  report.ok = true;
  report.finishedAt = new Date().toISOString();
  report.projectUrl = `${ORIGIN}/app/projects/${projectId}?tab=stlc&phase=DESIGN`;

  writeFileSync(`${OUT_DIR}/result.json`, JSON.stringify(report, null, 2));
  log('DONE', {
    projectId,
    caseCount: report.cases.length,
    coverage: byReq,
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
