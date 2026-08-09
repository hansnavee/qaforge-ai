/**
 * Full STLC e2e smoke against live API.
 * Usage: node scripts/stlc-e2e-smoke.mjs [projectId]
 */
import { writeFileSync } from 'node:fs';

const API = process.env.API_URL ?? 'https://api-production-08317.up.railway.app';
const ORIGIN = process.env.APP_URL ?? 'https://qaforge-ai-tau.vercel.app';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@qaforge.ai';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Admin@QAForge123';
const PROJECT_ID = process.argv[2] ?? 'cmsln2l5k00qbs301mmvnwymc';
const ORG_ID = process.env.SMOKE_ORG_ID ?? 'cmsix2pjk0000pb01wzvtwj05';

const POLL_MS = Number(process.env.SMOKE_POLL_MS ?? 8000);
const MAX_POLLS = Number(process.env.SMOKE_MAX_POLLS ?? 90);

let cookie = '';

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function parseSetCookie(res) {
  const raw = typeof res.headers.getSetCookie === 'function'
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

async function login() {
  const res = await api('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`login failed ${res.status}: ${JSON.stringify(res.body)}`);
  }
  if (!cookie) throw new Error('login ok but no session cookie');
  log('login ok');
}

async function getProject() {
  const res = await api(`/api/v1/projects/${PROJECT_ID}`);
  if (!res.ok) throw new Error(`project ${res.status}`);
  return res.body;
}

async function getSummary() {
  const res = await api(`/api/v1/projects/${PROJECT_ID}/review-summary`);
  if (!res.ok) throw new Error(`review-summary ${res.status}`);
  return res.body;
}

async function getExecution(executionId) {
  const res = await api(`/api/v1/orgs/${ORG_ID}/executions/${executionId}`);
  if (!res.ok) throw new Error(`execution ${res.status}`);
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
  log(
    label,
    res.status,
    typeof res.body === 'object'
      ? res.body?.status ?? res.body?.message
      : res.body,
  );
  if (!res.ok) {
    throw new Error(`${label} failed ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function main() {
  log('STLC e2e start', { API, PROJECT_ID, ORG_ID });
  await login();

  const project = await getProject();
  log('project', project.name, 'analysis', project.analysisStatus, 'stlc', project.stlcStage);

  if (!project.appUrl) {
    const patched = await api(`/api/v1/projects/${PROJECT_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({
        appUrl: 'https://www.saucedemo.com',
        loginUrl: 'https://www.saucedemo.com',
      }),
    });
    log('patched appUrl', patched.status, patched.body?.appUrl);
  }

  let summary = await getSummary();
  log('handoff', summary.stlcHandoff);

  if (!summary.stlcHandoff?.canApprove) {
    log('clearing Step 2 blockers before approval');
    const qs = await api(`/api/v1/projects/${PROJECT_ID}/review-questions`);
    const open = (
      Array.isArray(qs.body) ? qs.body : qs.body?.items || []
    ).filter((q) => q.status === 'OPEN' && q.blocking && q.priority === 'CRITICAL');
    for (const q of open) {
      await postGate(
        `/api/v1/projects/${PROJECT_ID}/review-questions/${q.id}/answer`,
        `answer-${q.id}`,
        JSON.stringify({
          answer:
            'Confirmed for STLC e2e: use the stricter safe business rule; deny unauthorized access; fail closed and surface a recoverable error.',
        }),
      );
    }
    summary = await getSummary();
    log('handoff after answers', summary.stlcHandoff);
  }

  if (!summary.stlcHandoff?.canApprove) {
    throw new Error(
      `cannot approve requirements: ${(summary.stlcHandoff?.blockers ?? []).join('; ')}`,
    );
  }

  if (!summary.stlcHandoff?.approved) {
    await postGate(
      `/api/v1/projects/${PROJECT_ID}/approve-requirements`,
      'approve-requirements',
    );
    summary = await getSummary();
  } else {
    log('requirements already approved');
  }

  if (!summary.stlcHandoff?.canStartPlanning) {
    throw new Error(
      `cannot start planning: ${(summary.stlcHandoff?.blockers ?? []).join('; ')}`,
    );
  }

  const start = await api(`/api/v1/projects/${PROJECT_ID}/stlc/start`, {
    method: 'POST',
    body: '{}',
  });
  if (!start.ok) {
    throw new Error(`stlc/start ${start.status}: ${JSON.stringify(start.body)}`);
  }
  const executionId = start.body.id;
  log('started execution', executionId);

  const gates = [
    {
      // Strategy + design run continuously; only clarify may pause before Design.
      wait: ['AWAITING_CLARIFICATION', 'AWAITING_DESIGN_APPROVAL'],
      path: null,
      label: 'pre-design',
      resolve: async (status) => {
        if (status === 'AWAITING_CLARIFICATION') {
          await postGate(
            `/api/v1/orgs/${ORG_ID}/executions/${executionId}/clarify`,
            'clarify-skip',
            JSON.stringify({ skip: true, answers: {} }),
          );
          return false; // keep waiting for design approval
        }
        await postGate(
          `/api/v1/orgs/${ORG_ID}/executions/${executionId}/approve-test-design`,
          'approve-test-design',
        );
        return true;
      },
    },
    {
      wait: ['AWAITING_ENV_APPROVAL'],
      path: `/api/v1/orgs/${ORG_ID}/executions/${executionId}/approve-environment`,
      label: 'approve-environment',
    },
    {
      wait: ['AWAITING_DATA_APPROVAL'],
      path: `/api/v1/orgs/${ORG_ID}/executions/${executionId}/approve-test-data`,
      label: 'approve-test-data',
    },
    {
      wait: ['AWAITING_LOGIN'],
      path: `/api/v1/orgs/${ORG_ID}/executions/${executionId}/continue-after-login`,
      label: 'continue-after-login',
    },
    {
      wait: ['AWAITING_EXECUTION_APPROVAL'],
      path: `/api/v1/orgs/${ORG_ID}/executions/${executionId}/approve-test-execution`,
      label: 'approve-test-execution',
    },
    {
      wait: ['AWAITING_DEFECT_APPROVAL'],
      path: `/api/v1/orgs/${ORG_ID}/executions/${executionId}/approve-defects`,
      label: 'approve-defects',
    },
    {
      wait: ['AWAITING_AUTOMATION_APPROVAL'],
      path: `/api/v1/orgs/${ORG_ID}/executions/${executionId}/approve-automation`,
      label: 'approve-automation',
    },
    {
      wait: ['AWAITING_REPORT_APPROVAL'],
      path: `/api/v1/orgs/${ORG_ID}/executions/${executionId}/approve-report`,
      label: 'approve-report',
    },
    {
      wait: ['AWAITING_QA_SIGNOFF'],
      path: `/api/v1/orgs/${ORG_ID}/executions/${executionId}/approve-qa-signoff`,
      label: 'approve-qa-signoff',
    },
  ];

  for (const gate of gates) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const ex = await waitForStatus(executionId, gate.wait, gate.label);
      if (gate.resolve) {
        const done = await gate.resolve(ex.status);
        if (done) break;
        continue;
      }
      await postGate(gate.path, gate.label);
      break;
    }
  }

  const done = await waitForStatus(executionId, ['COMPLETED'], 'completed');
  const phases = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/stlc/phases`,
  );
  const designDoc = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/stlc/phases/DESIGN`,
  );
  const result = {
    executionId,
    status: done.status,
    phase: done.phase,
    scores: done.scores ?? null,
    stlcStage: (await getProject()).stlcStage,
    qaSignedOffAt: (await getProject()).qaSignedOffAt ?? null,
    stlcPhasesOk: phases.ok,
    designDocVersion: designDoc.body?.documentVersion ?? null,
    designDocStatus: designDoc.body?.status ?? null,
  };
  writeFileSync('stlc-e2e-result.json', JSON.stringify(result, null, 2));
  log('STLC e2e PASS', result);
}

main().catch((err) => {
  console.error('STLC e2e FAIL', err);
  process.exit(1);
});
