/**
 * Fresh-data smoke for manual TCMS: wipe projects, login-only BRD →
 * Design cases → status/folder/run/results/automation pack.
 *
 * Usage: node scripts/smoke-tcms.mjs
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

const OUT_DIR = '.tmp/smoke-tcms';
mkdirSync(OUT_DIR, { recursive: true });

let cookie = '';
const report = {
  startedAt: new Date().toISOString(),
  cleaned: [],
  projectId: null,
  executionId: null,
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

async function main() {
  log('smoke-tcms start', { API });

  const login = await api('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert(login.ok, `login ${login.status}`);

  const listed = await api('/api/v1/projects');
  assert(listed.ok, `list projects ${listed.status}`);
  const existing = Array.isArray(listed.body) ? listed.body : listed.body?.items ?? [];
  for (const p of existing) {
    const del = await api(`/api/v1/projects/${p.id}`, { method: 'DELETE' });
    report.cleaned.push({ id: p.id, name: p.name, status: del.status });
    log('deleted', p.name, p.id, del.status);
  }

  const created = await api('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: `TCMS smoke ${new Date().toISOString().slice(0, 16)}`,
      description: 'Fresh TCMS board smoke — login-only BRD',
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
  assert(res.ok, `extract ${res.status}`);
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
  assert(res.ok, `approve ${res.status}`);

  const start = await api(`/api/v1/projects/${projectId}/stlc/start`, {
    method: 'POST',
    body: '{}',
  });
  assert(start.ok, `stlc/start ${start.status}`);
  const executionId = start.body.id;
  report.executionId = executionId;

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

  const casesRes = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases`,
  );
  assert(casesRes.ok, `test-cases ${casesRes.status}`);
  const cases = Array.isArray(casesRes.body) ? casesRes.body : [];
  assert(cases.length > 0, 'no test cases');
  const blob = cases
    .flatMap((c) => [c.scenario, ...(Array.isArray(c.steps) ? c.steps : [])])
    .join('\n')
    .toLowerCase();
  assert(!blob.includes('saucedemo'), 'cases must not include Sauce Demo');
  assert(
    cases.every((c) => (c.designMode ?? 'GENERIC') === 'GENERIC'),
    'cases must be GENERIC',
  );
  report.caseCount = cases.length;
  report.caseStatusSample = cases.slice(0, 3).map((c) => ({
    id: c.externalId,
    caseStatus: c.caseStatus,
    featureName: c.featureName,
    featureKey: c.featureKey,
  }));
  log('cases', cases.length, report.caseStatusSample);

  const ids = cases.slice(0, Math.min(4, cases.length)).map((c) => c.id);
  res = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases/status`,
    {
      method: 'POST',
      body: JSON.stringify({ status: 'READY', ids }),
    },
  );
  assert(res.ok, `status READY ${res.status}: ${JSON.stringify(res.body)}`);
  assert(res.body.updated >= 1, 'status update count');
  log('marked ready', res.body.updated);

  const folders = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/folders`,
  );
  assert(folders.ok, `folders ${folders.status}`);
  assert(Array.isArray(folders.body) && folders.body.length >= 1, 'folders list');

  res = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/folders`,
    { method: 'POST', body: JSON.stringify({ name: 'Custom Suite' }) },
  );
  assert(res.ok, `new folder ${res.status}: ${JSON.stringify(res.body)}`);
  report.customFolder = res.body;
  const folderId = res.body.id;
  assert(folderId, 'folder id');

  const renamed = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/folders/${folderId}`,
    { method: 'PATCH', body: JSON.stringify({ name: 'Custom Suite v2' }) },
  );
  assert(renamed.ok, `rename folder ${renamed.status}`);

  const sub = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/folders`,
    {
      method: 'POST',
      body: JSON.stringify({ name: 'Edge cases', parentId: folderId }),
    },
  );
  assert(sub.ok, `subfolder ${sub.status}: ${JSON.stringify(sub.body)}`);
  const subId = sub.body.id;

  const createdCase = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases`,
    {
      method: 'POST',
      body: JSON.stringify({
        scenario: 'Manual case under Custom Suite subfolder',
        expected: 'Case is saved in the subfolder',
        steps: ['Open the folder', 'Add a case'],
        folderId: subId,
        caseStatus: 'DRAFT',
      }),
    },
  );
  assert(createdCase.ok, `create case ${createdCase.status}`);
  assert(createdCase.body.folderId === subId, 'case folderId');

  const extra = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases`,
    {
      method: 'POST',
      body: JSON.stringify({
        scenario: 'Disposable bulk-delete case',
        expected: 'Deleted',
        steps: ['Ignore'],
        folderId,
      }),
    },
  );
  assert(extra.ok, `extra case ${extra.status}`);
  const delOne = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases/${createdCase.body.id}`,
    { method: 'DELETE' },
  );
  assert(delOne.ok, `delete one ${delOne.status}`);
  const delBulk = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases/bulk`,
    {
      method: 'DELETE',
      body: JSON.stringify({ ids: [extra.body.id] }),
    },
  );
  assert(delBulk.ok, `bulk delete ${delBulk.status}`);

  const moveId = cases[cases.length - 1]?.id;
  if (moveId) {
    const bulk = await api(
      `/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases/bulk`,
      {
        method: 'PATCH',
        body: JSON.stringify({ ids: [moveId], folderId }),
      },
    );
    assert(bulk.ok, `bulk move ${bulk.status}`);
    log('moved case into Custom Suite');
  }

  const run = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/runs`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'Login smoke cycle',
        testCaseIds: ids,
        runKind: 'MANUAL',
        browserMode: 'HEADLESS',
      }),
    },
  );
  assert(run.ok, `create run ${run.status}: ${JSON.stringify(run.body)}`);
  assert(run.body.runMode === 'MANUAL', 'runMode MANUAL');
  assert(run.body.status === 'RUNNING', `run status ${run.body.status}`);
  assert(run.body.name === 'Login smoke cycle', 'cycle name');
  report.runId = run.body.id;
  log('run', run.body.id);

  const fifth = cases[4]?.id;
  if (fifth) {
    await api(
      `/api/v1/orgs/${ORG_ID}/projects/${projectId}/test-cases/status`,
      {
        method: 'POST',
        body: JSON.stringify({ status: 'READY', ids: [fifth] }),
      },
    );
    const added = await api(
      `/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/runs/${run.body.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ addTestCaseIds: [fifth] }),
      },
    );
    assert(added.ok, `add case to cycle ${added.status}`);
    const removed = await api(
      `/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/runs/${run.body.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ removeTestCaseIds: [fifth] }),
      },
    );
    assert(removed.ok, `remove case from cycle ${removed.status}`);
  }

  const detail = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/runs/${run.body.id}`,
  );
  assert(detail.ok, `run detail ${detail.status}`);
  assert(detail.body.cases?.length >= 1, 'run has cases');
  assert(detail.body.counts?.total >= 1, 'cycle counts');

  const first = detail.body.cases[0];
  const second = detail.body.cases[1] ?? first;
  const pass = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/results`,
    {
      method: 'POST',
      body: JSON.stringify({
        executionId: run.body.id,
        testCaseId: first.id,
        status: 'PASSED',
        message: 'Manual pass from smoke',
      }),
    },
  );
  assert(pass.ok, `pass ${pass.status}: ${JSON.stringify(pass.body)}`);
  const fail = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/results`,
    {
      method: 'POST',
      body: JSON.stringify({
        executionId: run.body.id,
        testCaseId: second.id,
        status: 'FAILED',
        message: 'Manual fail from smoke',
      }),
    },
  );
  assert(fail.ok, `fail ${fail.status}`);
  log('results recorded', pass.body.status, fail.body.status);

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const shot = await fetch(
    `${API}/api/v1/orgs/${ORG_ID}/projects/${projectId}/results/${pass.body.id}/evidence`,
    {
      method: 'POST',
      headers: { Origin: ORIGIN, Cookie: cookie },
      body: (() => {
        const fd = new FormData();
        fd.append(
          'file',
          new Blob([png], { type: 'image/png' }),
          'shot.png',
        );
        return fd;
      })(),
    },
  );
  assert(shot.ok, `screenshot ${shot.status}`);

  const delFolder = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/folders/${subId}`,
    { method: 'DELETE', body: JSON.stringify({ deleteCases: false }) },
  );
  assert(delFolder.ok, `delete subfolder ${delFolder.status}`);

  const stack = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/automation`,
    {
      method: 'POST',
      body: JSON.stringify({ language: 'PYTHON', framework: 'SELENIUM' }),
    },
  );
  assert(stack.ok, `stack ${stack.status}: ${JSON.stringify(stack.body)}`);
  const auto = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/automation`,
  );
  assert(auto.ok, `automation list ${auto.status}`);
  assert(auto.body.language === 'PYTHON', `language ${auto.body.language}`);
  assert(auto.body.framework === 'SELENIUM', `framework ${auto.body.framework}`);
  assert(auto.body.readyCount >= 1, 'readyCount');
  assert(Array.isArray(auto.body.files) && auto.body.files.length >= 1, 'files');
  report.automation = {
    language: auto.body.language,
    framework: auto.body.framework,
    readyCount: auto.body.readyCount,
    files: auto.body.files.length,
  };
  log('automation', report.automation);

  const zip = await fetch(
    `${API}/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/automation/download`,
    { headers: { Origin: ORIGIN, Cookie: cookie } },
  );
  assert(zip.ok, `zip ${zip.status}`);
  const zipBuf = Buffer.from(await zip.arrayBuffer());
  assert(zipBuf.length > 20, 'zip too small');
  report.zipBytes = zipBuf.length;

  const stop = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/runs/${run.body.id}/complete`,
    { method: 'POST', body: '{}' },
  );
  assert(stop.ok, `complete ${stop.status}`);

  const locked = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${projectId}/results`,
    {
      method: 'POST',
      body: JSON.stringify({
        executionId: run.body.id,
        testCaseId: first.id,
        status: 'FAILED',
        message: 'should be rejected',
      }),
    },
  );
  assert(!locked.ok, `locked cycle still writable (${locked.status})`);

  const tcr = await fetch(
    `${API}/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/tcr?format=html`,
    { headers: { Origin: ORIGIN, Cookie: cookie } },
  );
  assert(tcr.ok, `tcr html ${tcr.status}`);
  const tcrHtml = await tcr.text();
  assert(/Test Cycle Report/i.test(tcrHtml), 'tcr title');
  const tcrDoc = await fetch(
    `${API}/api/v1/orgs/${ORG_ID}/projects/${projectId}/tcms/runs/${run.body.id}/tcr?format=docx`,
    { headers: { Origin: ORIGIN, Cookie: cookie } },
  );
  assert(tcrDoc.ok, `tcr docx ${tcrDoc.status}`);
  report.tcrBytes = tcrHtml.length;

  report.ok = true;
  report.finishedAt = new Date().toISOString();
  report.projectUrl = `${ORIGIN}/app/projects/${projectId}?tab=stlc&phase=DESIGN`;
  writeFileSync(`${OUT_DIR}/result.json`, JSON.stringify(report, null, 2));
  log('DONE', {
    projectId,
    caseCount: report.caseCount,
    runId: report.runId,
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
