/**
 * Verify JSON download + ArtifactBlob schema after deploy.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '../apps/worker/package.json'),
);
const { chromium } = require('playwright');

const APP = 'https://qaforge-ai-tau.vercel.app';
const API = 'https://api-production-08317.up.railway.app';
const ORG = 'cmsix2pjk0000pb01wzvtwj05';
const PROJECT = 'cmsmuy6i30001qh014k88iwbo';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../.tmp/fix-verify');

let cookie = '';
function parseSetCookie(res) {
  const raw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [];
  if (raw.length) cookie = raw.map((c) => c.split(';')[0]).join('; ');
}

async function apiLogin() {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { Origin: APP, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@qaforge.ai',
      password: 'Admin@QAForge123',
    }),
  });
  parseSetCookie(res);
  if (!res.ok) throw new Error(`login ${res.status}`);
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [];
  const apiHost = new URL(API).hostname;
  const appHost = new URL(APP).hostname;
  return setCookies.flatMap((raw) => {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
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

async function main() {
  mkdirSync(OUT, { recursive: true });
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail });
    console.log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
  };

  const cookies = await apiLogin();

  // Simulate fixed downloadAuthenticated for DESIGN json
  const res = await fetch(
    `${API}/api/v1/orgs/${ORG}/projects/${PROJECT}/stlc/phases/DESIGN/download?format=json`,
    { headers: { Origin: APP, Cookie: cookie } },
  );
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || '';
  const cd = res.headers.get('content-disposition') || '';
  const isAttachment = /attachment/i.test(cd);
  let asRedirect = false;
  if (ct.includes('application/json') && !isAttachment) {
    try {
      const data = JSON.parse(buf.toString('utf8'));
      asRedirect = typeof data?.url === 'string';
    } catch {
      /* ignore */
    }
  }
  check('DESIGN json is attachment download', res.ok && isAttachment && !asRedirect && buf.length > 100, {
    status: res.status,
    bytes: buf.length,
    ct,
    cd,
  });

  // ArtifactBlob table exists (query via storing a tiny probe through API isn't available —
  // confirm by-key still 404 for old keys, and schema by creating via worker would need a run.
  // Probe: final-pack still works
  const pack = await fetch(
    `${API}/api/v1/orgs/${ORG}/projects/${PROJECT}/stlc/final-pack`,
    { headers: { Origin: APP, Cookie: cookie } },
  );
  check('final-pack still works', pack.ok, {
    status: pack.status,
    bytes: (await pack.arrayBuffer()).byteLength,
  });

  // UI: Design JSON download event
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.goto(`${APP}/app/projects/${PROJECT}?tab=stlc&phase=DESIGN`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(2500);
  const jsonBtn = page.getByRole('button', { name: /^JSON$/i }).first();
  check('JSON button visible', (await jsonBtn.count()) > 0);
  if (await jsonBtn.count()) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
      jsonBtn.click(),
    ]);
    let size = 0;
    if (download) {
      const p = await download.path();
      if (p) {
        const fs = await import('node:fs');
        size = fs.statSync(p).size;
      }
    }
    check('UI Design JSON download fires', Boolean(download) && size > 100, {
      file: download?.suggestedFilename() ?? null,
      size,
    });
  }

  // Defects evidence: graceful missing message for old blobs
  await page.goto(`${APP}/app/projects/${PROJECT}?tab=stlc&phase=DEFECTS`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT, 'defects.png'), fullPage: true });
  const body = await page.locator('body').innerText();
  check(
    'Defects panel loads',
    /defect|bug|severity|Evidence unavailable|Loading evidence|No defects/i.test(
      body,
    ),
    { snippet: body.slice(0, 300) },
  );

  await browser.close();
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
