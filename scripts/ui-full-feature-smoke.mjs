/**
 * Full feature UI smoke for STLC deliverables.
 * Usage: node scripts/ui-full-feature-smoke.mjs [projectId]
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
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../.tmp/ui-full');

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
  return [
    ...parsed.map((c) => ({ ...c, domain: apiHost })),
    ...parsed.map((c) => ({ ...c, domain: appHost })),
  ];
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const checks = [];
  const failedNet = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail });
    log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
  };

  const cookies = await apiLogin();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addCookies(cookies);
  const page = await context.newPage();
  page.on('response', (res) => {
    if (res.status() >= 400 && /\/api\/v1\//.test(res.url())) {
      failedNet.push({ status: res.status(), url: res.url().slice(0, 220) });
    }
  });

  // Design
  await page.goto(`${APP}/app/projects/${PROJECT_ID}?tab=stlc&phase=DESIGN`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, '01-design.png'), fullPage: true });
  const designVisible =
    (await page.getByText(/Documented test cases|Test Case Development|case\(s\)/i).count()) >
    0;
  check('UI Design panel', designVisible, { url: page.url() });
  const dlJson = page.getByRole('button', { name: /^JSON$/i });
  if (await dlJson.count()) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      dlJson.first().click(),
    ]);
    check('UI Design JSON download', Boolean(download), {
      file: download ? download.suggestedFilename() : null,
    });
  } else {
    check('UI Design JSON download', false, { note: 'button missing' });
  }

  // Defects
  await page.goto(`${APP}/app/projects/${PROJECT_ID}?tab=stlc&phase=DEFECTS`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, '02-defects.png'), fullPage: true });
  const defectsVisible =
    (await page.getByText(/defect|bug|severity|No defects/i).count()) > 0;
  check('UI Defects panel', defectsVisible, { url: page.url() });

  // Phase ticks strip
  const tickMarks = await page.locator('text=/[✓●○]/').count();
  check('UI phase ticks present', tickMarks > 0, { tickMarks });

  // Automation page
  await page.goto(`${APP}/app/automation`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, '03-automation.png'), fullPage: true });
  const autoBody = await page.locator('body').innerText();
  check(
    'UI Automation page',
    /playwright|framework|No frameworks|Automation/i.test(autoBody),
    { snippet: autoBody.slice(0, 200) },
  );

  // Reports list + detail
  await page.goto(`${APP}/app/reports`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, '04-reports.png'), fullPage: true });
  const reportLink = page.locator('a[href^="/app/reports/"]').first();
  const hasReport = (await reportLink.count()) > 0;
  check('UI Reports list', hasReport || /No reports/i.test(autoBody), {
    hasReport,
  });
  if (hasReport) {
    await reportLink.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(OUT, '05-report-detail.png'), fullPage: true });
    const iframe = page.locator('iframe[title*="report" i]');
    check('UI Report iframe/html', (await iframe.count()) > 0 || (await page.getByText(/No HTML report/i).count()) === 0, {
      iframes: await iframe.count(),
    });
    const zipBtn = page.getByRole('button', { name: /Download ZIP/i });
    if (await zipBtn.count()) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
        zipBtn.first().click(),
      ]);
      check('UI Report ZIP download', Boolean(download), {
        file: download ? download.suggestedFilename() : null,
      });
    }
  }

  // Cycle CTA / execution gate
  await page.goto(`${APP}/app/projects/${PROJECT_ID}?tab=stlc`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, '06-stlc.png'), fullPage: true });
  const body = await page.locator('body').innerText();
  check(
    'UI STLC docs loaded',
    /STLC|Planning|Design|Execution|Cycle/i.test(body),
    { snippet: body.slice(0, 250) },
  );

  const vercel404 = failedNet.filter((f) => f.url.includes('vercel.app'));
  check('No Vercel /api 404s', vercel404.length === 0, {
    vercel404,
    otherFails: failedNet.filter((f) => !f.url.includes('vercel.app')).slice(0, 5),
  });

  const summary = {
    passed: checks.filter((c) => c.ok).length,
    failed: checks.filter((c) => !c.ok).length,
    checks,
    failedNet,
  };
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
  if (summary.failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
