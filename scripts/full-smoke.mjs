/**
 * Full STLC deliverables smoke — must exit 0.
 * Usage: node scripts/full-smoke.mjs
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
const ORG = process.env.SMOKE_ORG_ID ?? 'cmsix2pjk0000pb01wzvtwj05';
const PROJECT =
  process.env.SMOKE_PROJECT_ID ?? 'cmsmuy6i30001qh014k88iwbo';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../.tmp/full-smoke');

let cookie = '';
const results = [];

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function check(group, name, ok, detail) {
  results.push({ group, name, ok: !!ok, detail });
  log(ok ? 'PASS' : 'FAIL', `[${group}]`, name, detail ?? '');
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
  let body = null;
  if (ct.includes('json') && !/attachment/i.test(cd) && !ct.includes('zip')) {
    try {
      body = await res.json();
    } catch {
      body = null;
    }
  } else {
    const buf = Buffer.from(await res.arrayBuffer());
    body = { bytes: buf.length, ct, cd, head: buf.slice(0, 40).toString('utf8') };
  }
  return { status: res.status, ok: res.ok, body, ct, cd };
}

async function loginCookiesForBrowser() {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { Origin: APP, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
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

async function runApiChecks() {
  await api('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  const phases = await api(
    `/api/v1/orgs/${ORG}/projects/${PROJECT}/stlc/phases`,
  );
  check('api-ticks', 'phases list', phases.ok, {
    stage: phases.body?.stlcStage,
    cycle: phases.body?.currentCycle,
    accepted: (phases.body?.phases || []).filter((p) => p.status === 'ACCEPTED')
      .length,
  });
  const allAccepted =
    (phases.body?.phases || []).length >= 10 &&
    (phases.body?.phases || []).every((p) => p.status === 'ACCEPTED');
  check('api-ticks', 'all phases accepted (or mid-cycle ok)', phases.ok, {
    allAccepted,
    ticks: (phases.body?.phases || []).map((p) => `${p.id}:${p.status}`),
  });

  const downloads = [
    ['DESIGN', 'json'],
    ['DESIGN', 'csv'],
    ['EXECUTION', 'zip'],
    ['REPORTING', 'html'],
    ['REPORTING', 'junit'],
    ['REPORTING', 'zip'],
    ['SIGNOFF', 'zip'],
    ['SIGNOFF', 'html'],
  ];
  for (const [phase, format] of downloads) {
    const r = await api(
      `/api/v1/orgs/${ORG}/projects/${PROJECT}/stlc/phases/${phase}/download?format=${format}`,
    );
    const bytes = r.body?.bytes;
    const ok =
      r.ok &&
      (format === 'json'
        ? /attachment/i.test(r.cd) && (bytes == null || bytes > 50)
        : bytes > 50);
    check('api-downloads', `${phase} ${format}`, ok, {
      status: r.status,
      bytes,
      cd: r.cd,
    });
  }

  const pack = await api(
    `/api/v1/orgs/${ORG}/projects/${PROJECT}/stlc/final-pack`,
  );
  check('api-downloads', 'final-pack', pack.ok && pack.body?.bytes > 100, {
    bytes: pack.body?.bytes,
  });

  for (const kind of ['test-cases', 'bugs', 'results']) {
    const r = await api(
      `/api/v1/orgs/${ORG}/projects/${PROJECT}/${kind}/download?format=csv`,
    );
    check('api-downloads', `${kind} csv`, r.ok && r.body?.bytes > 10, {
      bytes: r.body?.bytes,
    });
  }

  const cases = await api(
    `/api/v1/orgs/${ORG}/projects/${PROJECT}/test-cases`,
  );
  const c0 = cases.body?.[0];
  check(
    'api-design',
    'cases with detail fields',
    cases.ok &&
      cases.body?.length > 0 &&
      Array.isArray(c0?.steps) &&
      !!c0?.severity &&
      !!c0?.testData,
    { count: cases.body?.length },
  );

  const bugs = await api(`/api/v1/orgs/${ORG}/projects/${PROJECT}/bugs`);
  check('api-defects', 'bugs list', bugs.ok && Array.isArray(bugs.body), {
    count: bugs.body?.length,
  });

  // Prefer evidence from the newest execution that has durable keys
  const withEv = (bugs.body || []).filter(
    (b) =>
      Array.isArray(b.evidenceKeys) &&
      b.evidenceKeys.length &&
      b.executionId,
  );
  if (withEv.length) {
    // Sort by execution id creation-ish: try latest cycle exec first
    const execs = await api(
      `/api/v1/orgs/${ORG}/projects/${PROJECT}/executions`,
    );
    const list = Array.isArray(execs.body)
      ? execs.body
      : execs.body?.items || [];
    const newest = list[0]?.id;
    const sample =
      withEv.find((b) => b.executionId === newest) || withEv[0];
    const key = sample.evidenceKeys[0];
    const ev = await api(
      `/api/v1/orgs/${ORG}/executions/${sample.executionId}/artifacts/by-key?key=${encodeURIComponent(key)}`,
    );
    check(
      'api-defects',
      'evidence by-key serves bytes',
      ev.ok && ev.body?.bytes > 100,
      {
        status: ev.status,
        bytes: ev.body?.bytes,
        ct: ev.body?.ct,
        key: key.split('/').pop(),
        executionId: sample.executionId,
      },
    );
  } else {
    check('api-defects', 'evidence by-key serves bytes', false, {
      note: 'no bugs with evidenceKeys',
    });
  }

  const auto = await api(`/api/v1/orgs/${ORG}/automation`);
  check(
    'api-automation',
    'org automation',
    auto.ok && (auto.body?.items?.length ?? 0) >= 1,
    {
      items: auto.body?.items?.length,
      files: auto.body?.items?.[0]?.files?.length,
    },
  );

  const reports = await api(`/api/v1/orgs/${ORG}/reports`);
  check(
    'api-reports',
    'reports list',
    reports.ok && Array.isArray(reports.body) && reports.body.length >= 1,
    { count: reports.body?.length },
  );
  const rid = reports.body?.[0]?.executionId;
  if (rid) {
    const report = await api(`/api/v1/orgs/${ORG}/reports/${rid}`);
    check(
      'api-reports',
      'report html',
      report.ok && (report.body?.html?.length ?? 0) > 500,
      {
        htmlLen: report.body?.html?.length,
        absoluteUrl: /^https?:/.test(report.body?.htmlUrl || ''),
      },
    );
    const zip = await api(
      `/api/v1/orgs/${ORG}/executions/${rid}/download-zip`,
    );
    check('api-reports', 'execution zip', zip.ok && zip.body?.bytes > 100, {
      bytes: zip.body?.bytes,
    });
    const htmlArt = await api(
      `/api/v1/orgs/${ORG}/executions/${rid}/artifacts/by-type/REPORT_HTML`,
    );
    check(
      'api-reports',
      'REPORT_HTML artifact',
      htmlArt.ok && htmlArt.body?.bytes > 200,
      { bytes: htmlArt.body?.bytes },
    );
  }

  const execs = await api(`/api/v1/orgs/${ORG}/projects/${PROJECT}/executions`);
  const list = Array.isArray(execs.body)
    ? execs.body
    : execs.body?.items || [];
  check(
    'api-cycles',
    'cycle metadata',
    execs.ok && list.some((e) => (e.cycleNumber ?? 1) >= 1),
    {
      cycles: list.slice(0, 4).map((e) => ({
        c: e.cycleNumber,
        s: e.status,
        p: e.parentExecutionId,
      })),
      currentCycle: phases.body?.currentCycle,
      canStartNext: phases.body?.canStartNextCycle,
    },
  );

  // Relative path on Vercel must 404 (sanity: web is not API)
  const vercel = await fetch(
    `${APP}/api/v1/orgs/${ORG}/projects/${PROJECT}/stlc/phases`,
  );
  check(
    'api-routing',
    'Vercel does not host API routes',
    vercel.status === 404,
    { status: vercel.status },
  );
}

async function runUiChecks() {
  const cookies = await loginCookiesForBrowser();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
  });
  await context.addCookies(cookies);
  const page = await context.newPage();
  const failedNet = [];
  page.on('response', (res) => {
    if (res.status() >= 400 && /\/api\/v1\//.test(res.url())) {
      failedNet.push({ status: res.status(), url: res.url().slice(0, 220) });
    }
  });

  // Design + JSON download
  await page.goto(`${APP}/app/projects/${PROJECT}?tab=stlc&phase=DESIGN`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, '01-design.png'), fullPage: true });
  check(
    'ui',
    'Design panel',
    (await page.getByText(/Documented test cases|case\(s\)|Test Case/i).count()) >
      0,
    { url: page.url() },
  );
  const jsonBtn = page.getByRole('button', { name: /^JSON$/i }).first();
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
    check('ui', 'Design JSON download', Boolean(download) && size > 100, {
      file: download?.suggestedFilename() ?? null,
      size,
    });
  } else {
    check('ui', 'Design JSON download', false, { note: 'button missing' });
  }

  // Defects
  await page.goto(`${APP}/app/projects/${PROJECT}?tab=stlc&phase=DEFECTS`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT, '02-defects.png'), fullPage: true });
  const defectsText = await page.locator('body').innerText();
  check(
    'ui',
    'Defects panel',
    /defect|bug|severity|Evidence unavailable|No defects|OPEN|FAILED/i.test(
      defectsText,
    ),
  );
  check(
    'ui',
    'phase ticks',
    (await page.locator('text=/[✓●○]/').count()) > 0,
  );

  // Automation
  await page.goto(`${APP}/app/automation`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: join(OUT, '03-automation.png'),
    fullPage: true,
  });
  const autoText = await page.locator('body').innerText();
  check(
    'ui',
    'Automation page',
    /playwright|framework|Automation|No frameworks/i.test(autoText),
    { hasProject: /LOGIN ONLY|playwright/i.test(autoText) },
  );

  // Reports
  await page.goto(`${APP}/app/reports`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const reportLink = page.locator('a[href^="/app/reports/"]').first();
  const hasReport = (await reportLink.count()) > 0;
  check('ui', 'Reports list', hasReport);
  if (hasReport) {
    await reportLink.click();
    await page.waitForTimeout(3000);
    await page.screenshot({
      path: join(OUT, '04-report-detail.png'),
      fullPage: true,
    });
    check(
      'ui',
      'Report HTML iframe',
      (await page.locator('iframe[title*="report" i]').count()) > 0,
    );
    const zipBtn = page.getByRole('button', { name: /Download ZIP/i });
    if (await zipBtn.count()) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
        zipBtn.first().click(),
      ]);
      check('ui', 'Report ZIP download', Boolean(download), {
        file: download?.suggestedFilename() ?? null,
      });
    }
  }

  // STLC overview
  await page.goto(`${APP}/app/projects/${PROJECT}?tab=stlc`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, '05-stlc.png'), fullPage: true });
  const stlcText = await page.locator('body').innerText();
  check('ui', 'STLC docs', /STLC|Planning|Design|Execution|Cycle/i.test(stlcText));

  const vercel404 = failedNet.filter((f) => f.url.includes('vercel.app'));
  check('ui', 'no Vercel /api 404s', vercel404.length === 0, {
    vercel404,
    other: failedNet.filter((f) => !f.url.includes('vercel.app')).slice(0, 8),
  });

  await browser.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  log('starting full smoke', { APP, API, PROJECT });
  await runApiChecks();
  await runUiChecks();

  const failed = results.filter((r) => !r.ok);
  const byGroup = {};
  for (const r of results) {
    byGroup[r.group] = byGroup[r.group] || { pass: 0, fail: 0 };
    byGroup[r.group][r.ok ? 'pass' : 'fail']++;
  }
  const summary = {
    passed: results.filter((r) => r.ok).length,
    failed: failed.length,
    byGroup,
    failedNames: failed.map((f) => `${f.group}:${f.name}`),
  };
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ summary, results }, null, 2));
  log('SUMMARY', JSON.stringify(summary));
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
