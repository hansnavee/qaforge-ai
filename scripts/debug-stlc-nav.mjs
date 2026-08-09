/**
 * Live debug: Sauce Demo Simple STLC navigation + Design case CRUD.
 * Usage: node scripts/debug-stlc-nav.mjs [projectId]
 */
const API = process.env.API_URL ?? 'https://api-production-08317.up.railway.app';
const ORIGIN = process.env.APP_URL ?? 'https://qaforge-ai-tau.vercel.app';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@qaforge.ai';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Admin@QAForge123';
const ORG_ID = process.env.SMOKE_ORG_ID ?? 'cmsix2pjk0000pb01wzvtwj05';
const PROJECT_ID = process.argv[2] ?? 'cmsm2hox50005k4013l7emd35';

let cookie = '';

function log(...args) {
  console.log(new Date().toISOString(), ...args);
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

async function main() {
  log('debug-stlc-nav', { API, PROJECT_ID });
  const login = await api('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert(login.ok, `login failed ${login.status}`);

  const phases = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/stlc/phases`,
  );
  assert(phases.ok, `phases ${phases.status}`);
  log('gate', {
    stage: phases.body.stlcStage,
    current: phases.body.currentPhaseId,
    latestStatus: phases.body.latestExecutionStatus,
  });

  const byId = Object.fromEntries(
    (phases.body.phases ?? []).map((p) => [p.id, p.status]),
  );
  assert(byId.DESIGN !== 'LOCKED', `DESIGN should not be LOCKED, got ${byId.DESIGN}`);
  log('DESIGN status', byId.DESIGN);

  const design = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/stlc/phases/DESIGN`,
  );
  assert(design.ok, `design phase ${design.status}`);
  assert(
    design.body.permissions?.canManageCases === true,
    'DESIGN canManageCases should be true after accept',
  );
  log('design permissions', design.body.permissions);

  const cases = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/test-cases`,
  );
  assert(cases.ok, `test-cases ${cases.status}`);
  assert(Array.isArray(cases.body) && cases.body.length > 0, 'expected cases');
  log('cases', cases.body.length, cases.body.slice(0, 2).map((c) => c.externalId));

  const target = cases.body[0];
  const patchedScenario = `${target.scenario.replace(/ \[nav-test\]$/, '')} [nav-test]`;
  const patch = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/test-cases/${target.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ scenario: patchedScenario }),
    },
  );
  assert(patch.ok, `patch case ${patch.status} ${JSON.stringify(patch.body)}`);
  assert(patch.body.scenario === patchedScenario, 'scenario not updated');
  log('patched case', patch.body.externalId);

  // restore
  const restore = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/test-cases/${target.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        scenario: patchedScenario.replace(/ \[nav-test]$/, ''),
      }),
    },
  );
  assert(restore.ok, `restore ${restore.status}`);

  const start = await api(`/api/v1/projects/${PROJECT_ID}/stlc/start`, {
    method: 'POST',
    body: '{}',
  });
  assert(start.ok, `stlc/start ${start.status}`);
  log('stlc/start resumes', {
    id: start.body.id,
    status: start.body.status,
    phase: start.body.phase,
  });
  assert(
    start.body.status === 'AWAITING_ENV_APPROVAL' ||
      start.body.phase === 'ENVIRONMENT' ||
      start.body.status?.startsWith('AWAITING_'),
    'expected active gate resume (Environment on Sauce demo)',
  );

  // Explain Environment for operators
  const env = await api(
    `/api/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/stlc/phases/ENVIRONMENT`,
  );
  assert(env.ok, `env ${env.status}`);
  log('ENVIRONMENT meaning', {
    label: env.body.label,
    status: env.body.status,
    canAccept: env.body.permissions?.canAccept,
    summary: env.body.validation?.summary,
    description: env.body.description,
  });

  log('OK — Design browsable + editable; Environment is STLC phase 4 gate');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
