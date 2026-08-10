/**
 * Smoke-test simplified requirements Step 2 UI.
 * Usage: node scripts/ui-smoke-requirements.mjs [projectId]
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
const PROJECT =
  process.argv[2] ??
  process.env.SMOKE_PROJECT_ID ??
  'cmsmuy6i30001qh014k88iwbo';
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../.tmp/ui-smoke-requirements',
);

const results = [];

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
}

async function loginCookies() {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { Origin: APP, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
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

mkdirSync(OUT, { recursive: true });
const cookies = await loginCookies();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
await context.addCookies(cookies);
const page = await context.newPage();
page.setDefaultTimeout(45000);

try {
  const featuresUrl = `${APP}/app/projects/${PROJECT}?tab=requirements&view=features`;
  log('open', featuresUrl);
  await page.goto(featuresUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const title = page.getByRole('heading', { name: /Requirements review/i });
  const readiness = page.getByText(/Ready for design|Open questions|Reviewed/i).first();
  const oldClutter = page.getByText('Requirement Intelligence');
  const oldFeatureTitle = page.getByRole('heading', { name: 'Feature review' });

  check(
    'Features heading',
    (await title.count()) > 0,
    { text: await title.first().textContent().catch(() => null) },
  );
  check(
    'Readiness strip visible',
    (await readiness.count()) > 0,
    { sample: await readiness.textContent().catch(() => null) },
  );
  check(
    'No old Feature review heading',
    (await oldFeatureTitle.count()) === 0,
  );
  check(
    'No Requirement Intelligence dump on features',
    (await oldClutter.count()) === 0,
  );

  await page.screenshot({
    path: join(OUT, '01-features.png'),
    fullPage: true,
  });

  // Expand first feature accordion if present
  const accordion = page.locator('button[aria-expanded]').first();
  if ((await accordion.count()) > 0) {
    const expanded = await accordion.getAttribute('aria-expanded');
    if (expanded !== 'true') await accordion.click();
    await page.waitForTimeout(500);
  }

  // Open first requirement detail from list item button with mono key look
  const reqButton = page
    .locator('li button')
    .filter({ has: page.locator('.font-mono') })
    .first();
  let openedDetail = false;
  if ((await reqButton.count()) > 0) {
    await reqButton.click();
    await page.waitForTimeout(1500);
    openedDetail = page.url().includes('view=detail');
  } else {
    // Fallback: navigate via any requirement-looking link/button
    const anyReq = page.getByText(/REQ-|TC-|FR-/i).first();
    if ((await anyReq.count()) > 0) {
      await anyReq.click();
      await page.waitForTimeout(1500);
      openedDetail = page.url().includes('view=detail');
    }
  }

  check('Opened requirement detail', openedDetail, { url: page.url() });

  if (openedDetail) {
    const overviewTab = page.getByRole('tab', { name: /Overview/i });
    const questionsTab = page.getByRole('tab', { name: /Questions/i });
    const analysisTab = page.getByRole('tab', { name: /Analysis/i });
    check('Overview tab', (await overviewTab.count()) > 0);
    check('Questions tab', (await questionsTab.count()) > 0);
    check('Analysis tab', (await analysisTab.count()) > 0);

    // Old detail chrome should be gone
    check(
      'No Re-analyze primary button row clutter',
      (await page.getByRole('button', { name: /^Re-analyze$/i }).count()) === 0 ||
        (await page.getByRole('button', { name: /^Run Analysis$/i }).count()) === 0
          ? true
          : (await page.locator('button', { hasText: 'Delete' }).count()) === 0,
      {
        note: 'Actions moved into menu; Delete should not be a primary button',
        deleteButtons: await page.getByRole('button', { name: /^Delete$/i }).count(),
      },
    );
    check(
      'Delete not a primary header button',
      (await page.getByRole('button', { name: /^Delete$/i }).count()) === 0,
    );

    await page.screenshot({
      path: join(OUT, '02-detail-overview.png'),
      fullPage: true,
    });

    if ((await questionsTab.count()) > 0) {
      await questionsTab.click();
      await page.waitForTimeout(400);
      await page.screenshot({
        path: join(OUT, '03-detail-questions.png'),
        fullPage: true,
      });
    }
    if ((await analysisTab.count()) > 0) {
      await analysisTab.click();
      await page.waitForTimeout(400);
      const intelligence = page.getByText('Requirement Intelligence');
      check(
        'Analysis tab has no old Intelligence heading',
        (await intelligence.count()) === 0,
      );
      const whoWhat = page.getByText(/Who \/ what \/ outcome|Actor|Business analysis/i);
      check(
        'Analysis content visible',
        (await whoWhat.count()) > 0 ||
          (await page.getByText(/Run analysis to populate/i).count()) > 0,
      );
      await page.screenshot({
        path: join(OUT, '04-detail-analysis.png'),
        fullPage: true,
      });
    }
  }

  // Readiness dashboard
  await page.goto(
    `${APP}/app/projects/${PROJECT}?tab=requirements&view=review-dashboard`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForTimeout(2000);
  check(
    'Readiness dashboard title',
    (await page.getByRole('heading', { name: /Review readiness/i }).count()) >
      0,
  );
  check(
    'No old Business + Functional Review title',
    (await page
      .getByRole('heading', { name: /Business \+ Functional Review/i })
      .count()) === 0,
  );
  await page.screenshot({
    path: join(OUT, '05-readiness.png'),
    fullPage: true,
  });
} catch (err) {
  check('smoke crashed', false, { error: String(err) });
  await page.screenshot({ path: join(OUT, 'error.png'), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  log('summary', { total: results.length, failed: failed.length, out: OUT });
  if (failed.length) process.exitCode = 1;
}
