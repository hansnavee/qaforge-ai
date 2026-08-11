import { writeFileSync, mkdirSync } from 'node:fs';

const APP = process.env.APP_URL ?? 'https://qaforge-ai-tau.vercel.app';
const API = process.env.API_URL ?? 'https://api-production-08317.up.railway.app';
const ORIGIN = APP;
const EMAIL = 'admin@qaforge.ai';
const PASSWORD = 'Admin@QAForge123';
const ORG = 'cmsix2pjk0000pb01wzvtwj05';
const PROJECT = 'cmsmuy6i30001qh014k88iwbo';

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

async function apiFetch(base, path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Origin: ORIGIN,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie && base.includes('railway') ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });
  parseSetCookie(res);
  return res;
}

async function main() {
  mkdirSync('.tmp', { recursive: true });
  const out = { checks: [], bundle: {} };

  // Login against API
  const login = await apiFetch(API, '/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  out.checks.push({ name: 'api-login', status: login.status, ok: login.ok });

  // Compare same path on API vs Vercel
  const paths = [
    `/api/v1/orgs/${ORG}/projects/${PROJECT}/stlc/phases`,
    `/api/v1/orgs/${ORG}/projects/${PROJECT}/stlc/final-pack`,
    `/api/v1/orgs/${ORG}/reports`,
    `/api/v1/orgs/${ORG}/automation`,
  ];
  for (const path of paths) {
    const a = await apiFetch(API, path);
    const v = await apiFetch(APP, path);
    out.checks.push({
      path,
      apiStatus: a.status,
      apiCt: a.headers.get('content-type'),
      vercelStatus: v.status,
      vercelCt: v.headers.get('content-type'),
    });
    // drain bodies
    await a.arrayBuffer();
    await v.arrayBuffer();
  }

  // Inspect Vercel JS for baked API URL
  const page = await fetch(`${APP}/app/projects/${PROJECT}?tab=stlc`);
  const html = await page.text();
  const scripts = [...html.matchAll(/\/_next\/static\/[^"']+\.js/g)].map(
    (m) => m[0],
  );
  out.bundle.pageStatus = page.status;
  out.bundle.scriptCount = scripts.length;
  const hits = {
    railway: 0,
    localhost4000: 0,
    downloadAuthenticated: 0,
    windowOpenApi: 0,
  };
  for (const s of scripts.slice(0, 25)) {
    const js = await (await fetch(`${APP}${s}`)).text();
    if (js.includes('api-production-08317')) hits.railway += 1;
    if (js.includes('localhost:4000')) hits.localhost4000 += 1;
    if (js.includes('downloadAuthenticated') || js.includes('Download failed'))
      hits.downloadAuthenticated += 1;
    if (js.includes("window.open('/api/v1") || js.includes('window.open(`/api/v1'))
      hits.windowOpenApi += 1;
  }
  out.bundle.hits = hits;
  out.bundle.sampleScripts = scripts.slice(0, 5);

  // Phase detail download URLs from API (relative?)
  const phase = await apiFetch(
    API,
    `/api/v1/orgs/${ORG}/projects/${PROJECT}/stlc/phases/REPORTING`,
  );
  const phaseJson = await phase.json();
  out.phaseDownloads = phaseJson.downloads;
  out.phaseStatus = phaseJson.status;

  writeFileSync('.tmp/live-404-diag.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
