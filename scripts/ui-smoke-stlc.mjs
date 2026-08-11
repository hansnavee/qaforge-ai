/**
 * Browser UI smoke with API login cookie injection.
 * Usage: node scripts/ui-smoke-stlc.mjs [projectId]
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
const PROJECT_ID = process.argv[2] ?? 'cmsm2hox50005k4013l7emd35';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../.tmp/ui-smoke');

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function apiLogin() {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      Origin: APP,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [];
  if (!res.ok) {
    throw new Error(`API login failed ${res.status}`);
  }
  if (!setCookies.length) {
    throw new Error('API login ok but no Set-Cookie');
  }
  const apiHost = new URL(API).hostname;
  return setCookies.map((raw) => {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    // Session cookie is host-only on the API origin (cross-site from Vercel).
    return {
      name,
      value,
      domain: apiHost,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    };
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const cookies = await apiLogin();
  log('api login ok', cookies.map((c) => c.name));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.addCookies(cookies);
  const page = await context.newPage();
  page.setDefaultTimeout(45000);

  try {
    const projectUrl = `${APP}/app/projects/${PROJECT_ID}?tab=overview`;
    log('open project', projectUrl);
    await page.goto(projectUrl, { waitUntil: 'networkidle' });
    // If auth cookie domain mismatch, we'll bounce to login
    if (page.url().includes('/login')) {
      throw new Error(`Session not accepted by web app, landed on ${page.url()}`);
    }
    await page.waitForSelector('text=Sauce Demo Simple', { timeout: 45000 });
    await page.screenshot({ path: join(OUT, '01-overview.png'), fullPage: true });

    const reviewCases = page.getByRole('button', { name: /review test cases/i });
    const continueEnv = page.getByRole('button', { name: /continue:\s*environment/i });
    const continuePlanning = page.getByRole('button', {
      name: /continue to test planning/i,
    });

    // Wait for client hydration of CTAs
    await page.waitForTimeout(2000);
    let hasReview = await reviewCases.count();
    let hasEnv = await continueEnv.count();
    let hasPlanning = await continuePlanning.count();
    log('cta visibility', { hasReview, hasEnv, hasPlanning, bodySnippet: await page.locator('body').innerText().then((t) => t.slice(0, 500)) });

    if (!hasReview) {
      // Deploy may still be old — try Current phase + Design URL path
      log('Review CTA missing; probing via URL phase=DESIGN');
    } else {
      await reviewCases.first().click();
      await page.waitForTimeout(2500);
      log('after review click', page.url());
    }

    await page.goto(
      `${APP}/app/projects/${PROJECT_ID}?tab=stlc&phase=DESIGN`,
      { waitUntil: 'networkidle' },
    );
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(OUT, '02-design-attempt.png'), fullPage: true });
    log('design url', page.url());

    const redirectedAway = /phase=ENVIRONMENT/i.test(page.url());
    const designHeadingCount = await page
      .getByRole('heading', { name: /Test Case Development/i })
      .count();
    const casesLabelCount = await page.getByText(/Documented test cases/i).count();
    const envHeadingCount = await page
      .getByRole('heading', { name: /Test Environment Setup/i })
      .count();

    log('page state', {
      redirectedAway,
      designHeadingCount,
      casesLabelCount,
      envHeadingCount,
      url: page.url(),
    });

    if (redirectedAway && designHeadingCount === 0) {
      throw new Error(
        'UI still force-redirects DESIGN → ENVIRONMENT (web deploy missing 6a8d40f nav fix)',
      );
    }

    if (designHeadingCount === 0 && casesLabelCount === 0) {
      throw new Error('Design UI not visible');
    }

    const caseCountText =
      (await page.locator('text=/\\d+ case\\(s\\)/').count()) > 0
        ? await page.locator('text=/\\d+ case\\(s\\)/').first().textContent()
        : null;
    log('design visible', { caseCountText });

    const editBtn = page.getByRole('button', { name: /^Edit$/i }).first();
    if (await editBtn.count()) {
      await editBtn.click();
      await page.getByText(/Edit test case/i).waitFor({ timeout: 10000 });
      log('edit form opened');
      await page.getByRole('button', { name: /^Cancel$/i }).click();
    }

    await page.screenshot({ path: join(OUT, '03-design.png'), fullPage: true });

    await page.goto(
      `${APP}/app/projects/${PROJECT_ID}?tab=stlc&phase=ENVIRONMENT`,
      { waitUntil: 'networkidle' },
    );
    await page.waitForTimeout(2000);
    await page.getByRole('heading', { name: /Test Environment Setup/i }).waitFor({
      timeout: 20000,
    });
    log('environment visible', page.url());
    await page.screenshot({ path: join(OUT, '04-environment.png'), fullPage: true });

    // Re-check overview CTAs after deploy
    await page.goto(`${APP}/app/projects/${PROJECT_ID}?tab=overview`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(2000);
    hasReview = await reviewCases.count();
    hasEnv = await continueEnv.count();
    hasPlanning = await continuePlanning.count();
    log('overview cta final', { hasReview, hasEnv, hasPlanning });
    await page.screenshot({ path: join(OUT, '05-overview-final.png'), fullPage: true });

    writeFileSync(
      join(OUT, 'result.json'),
      JSON.stringify(
        {
          ok: true,
          url: page.url(),
          caseCountText,
          cta: { hasReview, hasEnv, hasPlanning },
          designStay: !redirectedAway || designHeadingCount > 0,
        },
        null,
        2,
      ),
    );
    log('UI SMOKE OK');
  } catch (err) {
    await page.screenshot({ path: join(OUT, 'error.png'), fullPage: true }).catch(() => {});
    writeFileSync(
      join(OUT, 'result.json'),
      JSON.stringify({ ok: false, error: String(err), url: page.url() }, null, 2),
    );
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
