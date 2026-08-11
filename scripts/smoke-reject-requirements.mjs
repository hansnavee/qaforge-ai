/**
 * Smoke: reject-requirements requires reason, locks planning, returns to loop.
 * Usage: node scripts/smoke-reject-requirements.mjs [projectId]
 */
const API = process.env.API_URL ?? 'https://api-production-08317.up.railway.app';
const ORIGIN = process.env.APP_URL ?? 'https://qaforge-ai-tau.vercel.app';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@qaforge.ai';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Admin@QAForge123';
const PROJECT =
  process.argv[2] ??
  process.env.SMOKE_PROJECT_ID ??
  'cmsnc6mqr0001n001j1kwox44';

let cookie = '';
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
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
}

await api('/api/auth/sign-in/email', {
  method: 'POST',
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});

const empty = await api(`/api/v1/projects/${PROJECT}/reject-requirements`, {
  method: 'POST',
  body: JSON.stringify({ reason: '   ' }),
});
check(
  'reject empty reason rejected',
  empty.status === 400,
  { status: empty.status, body: empty.body },
);

const reject = await api(`/api/v1/projects/${PROJECT}/reject-requirements`, {
  method: 'POST',
  body: JSON.stringify({
    reason: 'Login-only scope — do not include signup/registration coverage.',
  }),
});
check('reject with reason ok', reject.ok, {
  status: reject.status,
  analysisStatus: reject.body?.analysisStatus,
  stlcStage: reject.body?.stlcStage,
  rejected: reject.body?.stlcHandoff?.rejected,
});

const project = await api(`/api/v1/projects/${PROJECT}`);
check(
  'project stores rejection',
  Boolean(project.body?.requirementsRejectedAt) &&
    Boolean(project.body?.requirementsRejectionReason),
  {
    at: project.body?.requirementsRejectedAt,
    reason: project.body?.requirementsRejectionReason,
    analysisStatus: project.body?.analysisStatus,
    approvedAt: project.body?.requirementsApprovedAt,
  },
);

const handoff = await api(`/api/v1/projects/${PROJECT}/stlc-handoff`);
check(
  'planning locked after reject',
  handoff.body?.canStartPlanning === false &&
    handoff.body?.approved === false &&
    handoff.body?.rejected === true,
  handoff.body,
);

const start = await api(`/api/v1/projects/${PROJECT}/stlc/start`, {
  method: 'POST',
  body: '{}',
});
check(
  'stlc/start blocked without approve',
  !start.ok,
  { status: start.status, body: start.body },
);

const failed = results.filter((r) => !r.ok);
console.log(
  failed.length ? `\nFAILED ${failed.length}/${results.length}` : `\nOK ${results.length}/${results.length}`,
);
process.exit(failed.length ? 1 : 0);
