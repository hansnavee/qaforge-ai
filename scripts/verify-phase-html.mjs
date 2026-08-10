/**
 * Verify phase HTML uses tables (local renderer + live downloads).
 * Usage: node scripts/verify-phase-html.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'packages/shared/package.json'));
const { phaseDocumentToHtml } = require('./dist/stlc/phase-documents.js');
const pwRequire = createRequire(join(root, 'apps/worker/package.json'));
const { chromium } = pwRequire('playwright');

const APP = process.env.APP_URL ?? 'https://qaforge-ai-tau.vercel.app';
const API = process.env.API_URL ?? 'https://api-production-08317.up.railway.app';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@qaforge.ai';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Admin@QAForge123';
const ORG = process.env.SMOKE_ORG_ID ?? 'cmsix2pjk0000pb01wzvtwj05';
const PROJECT =
  process.env.SMOKE_PROJECT_ID ?? 'cmsmuy6i30001qh014k88iwbo';
const OUT = join(root, '.tmp/phase-html-verify');

const PHASES = [
  'DESIGN',
  'ENVIRONMENT',
  'EXECUTION',
  'DEFECTS',
  'AUTOMATION',
  'REPORTING',
  'SIGNOFF',
];

let cookie = '';
const results = [];

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
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
      Origin: APP,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });
  parseSetCookie(res);
  const ct = res.headers.get('content-type') || '';
  const cd = res.headers.get('content-disposition') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  if (ct.includes('json') && !/attachment/i.test(cd)) {
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      json = null;
    }
  }
  return {
    status: res.status,
    ok: res.ok,
    ct,
    cd,
    buf,
    text: buf.toString('utf8'),
    json,
  };
}

function analyzeHtml(html) {
  const hasTable = /<table[\s>]/i.test(html);
  const hasPreJson =
    /<pre[^>]*>[\s\S]*?\{[\s\S]*?"(testCases|bugs|checklist|scorecard)"/i.test(
      html,
    );
  const tableCount = (html.match(/<table[\s>]/gi) || []).length;
  const rowCount = (html.match(/<tr[\s>]/gi) || []).length;
  return { hasTable, hasPreJson, tableCount, rowCount, bytes: html.length };
}

mkdirSync(OUT, { recursive: true });

await api('/api/auth/sign-in/email', {
  method: 'POST',
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
check('login', Boolean(cookie), { cookieLen: cookie.length });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

for (const phase of PHASES) {
  const phaseRes = await api(
    `/api/v1/orgs/${ORG}/projects/${PROJECT}/stlc/phases/${phase}`,
  );
  const doc = phaseRes.json?.document ?? {};
  const validation = phaseRes.json?.validation ?? null;
  check(`${phase} phase fetch`, phaseRes.ok, {
    status: phaseRes.status,
    keys: Object.keys(doc).slice(0, 12),
  });

  // Local renderer (new code)
  const localHtml = phaseDocumentToHtml(phase, doc, validation);
  const localPath = join(OUT, `${phase}-local.html`);
  writeFileSync(localPath, localHtml, 'utf8');
  const localStats = analyzeHtml(localHtml);
  check(
    `${phase} local HTML tables`,
    localStats.hasTable && !localStats.hasPreJson,
    localStats,
  );

  await page.goto(`file://${localPath.replace(/\\/g, '/')}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.screenshot({
    path: join(OUT, `${phase}-local.png`),
    fullPage: true,
  });

  // Live download (may still be old until API deploy)
  const live = await api(
    `/api/v1/orgs/${ORG}/projects/${PROJECT}/stlc/phases/${phase}/download?format=html`,
  );
  const liveHtml = live.text;
  const livePath = join(OUT, `${phase}-live.html`);
  writeFileSync(livePath, liveHtml, 'utf8');
  const liveStats = analyzeHtml(liveHtml);
  const liveOk =
    live.ok &&
    live.ct.includes('html') &&
    liveStats.hasTable &&
    !liveStats.hasPreJson;
  check(`${phase} live HTML tables`, liveOk, {
    status: live.status,
    ct: live.ct,
    ...liveStats,
    note: liveOk
      ? 'deployed'
      : 'live still JSON-in-pre until API deploy with this fix',
  });
}

await browser.close();

writeFileSync(join(OUT, 'result.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
const localFails = failed.filter((r) => r.name.includes('local'));
const liveFails = failed.filter((r) => r.name.includes('live'));
log('summary', {
  total: results.length,
  failed: failed.length,
  localFails: localFails.length,
  liveFails: liveFails.length,
  out: OUT,
});
if (localFails.length) process.exitCode = 1;
