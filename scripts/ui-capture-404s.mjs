/**
 * Capture failing network requests from the live STLC UI.
 * Usage: node scripts/ui-capture-404s.mjs [projectId]
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '../apps/worker/package.json'),
);
const { chromium } = require('playwright');

const APP = process.env.APP_URL ?? 'https://qaforge-ai-tau.vercel.app';
const API = process.env.API_URL ?? 'https://api-production-08317.up.railway.app';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@qaforge.ai';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Admin@QAForge123';
const PROJECT_ID = process.argv[2] ?? 'cmsmuy6i30001qh014k88iwbo';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../.tmp/ui-404');

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function apiLogin() {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { Origin: APP, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [];
  if (!res.ok) throw new Error(`login ${res.status}`);
  if (!setCookies.length) throw new Error('no Set-Cookie');
  const apiHost = new URL(API).hostname;
  const appHost = new URL(APP).hostname;
  const parsed = setCookies.map((raw) => {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    return {
      name: pair.slice(0, eq),
      value: pair.slice(eq + 1),
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    };
  });
  // Cookie must be on API host for API calls; also try app host for any same-origin leftovers
  return [
    ...parsed.map((c) => ({ ...c, domain: apiHost })),
    ...parsed.map((c) => ({ ...c, domain: appHost })),
  ];
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const failed = [];
  const interesting = [];

  const cookies = await apiLogin();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addCookies(cookies);
  const page = await context.newPage();

  page.on('response', async (res) => {
    const url = res.url();
    const status = res.status();
    if (status >= 400) {
      failed.push({ status, url: url.slice(0, 300), method: res.request().method() });
    }
    if (/\/api\/v1\//.test(url)) {
      interesting.push({ status, url: url.slice(0, 260), host: new URL(url).host });
    }
  });

  const visits = [
    `${APP}/app/projects/${PROJECT_ID}?tab=stlc&phase=DESIGN`,
    `${APP}/app/projects/${PROJECT_ID}?tab=stlc&phase=DEFECTS`,
    `${APP}/app/projects/${PROJECT_ID}?tab=stlc&phase=REPORTING`,
    `${APP}/app/projects/${PROJECT_ID}?tab=stlc&phase=AUTOMATION`,
    `${APP}/app/automation`,
    `${APP}/app/reports`,
  ];

  for (const url of visits) {
    log('goto', url);
    await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(2500);
    const name = url.split('phase=')[1] || url.split('/').pop();
    await page.screenshot({
      path: join(OUT, `${String(name).replace(/[^a-z0-9_-]/gi, '_')}.png`),
      fullPage: true,
    });

    // Click first Download button if present
    const dl = page.getByRole('button', { name: /^(JSON|CSV|HTML|ZIP|MD|JUNIT)$/i });
    const n = await dl.count();
    if (n > 0) {
      log('click download', await dl.first().innerText());
      page.once('download', (d) => log('got download', d.suggestedFilename()));
      await dl.first().click().catch((e) => log('download click err', e.message));
      await page.waitForTimeout(2000);
    }
  }

  // Reports detail if list has a link
  const reportLink = page.locator('a[href^="/app/reports/"]').first();
  if (await reportLink.count()) {
    await reportLink.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(OUT, 'report-detail.png'), fullPage: true });
  }

  const summary = {
    failed,
    apiCalls: interesting,
    failedCount: failed.length,
    uniqueFailed: [...new Set(failed.map((f) => `${f.status} ${f.url}`))],
  };
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
