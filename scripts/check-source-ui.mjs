import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(
  join(root, 'apps/worker/package.json'),
)('playwright');

const API = 'https://api-production-08317.up.railway.app';
const APP = 'https://qaforge-ai-tau.vercel.app';
const PID = 'cmsnacgvz001rqc01ho041ju5';
const OUT = join(root, '.tmp/check-source-ui');
mkdirSync(OUT, { recursive: true });

const res = await fetch(`${API}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { Origin: APP, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'admin@qaforge.ai',
    password: 'Admin@QAForge123',
  }),
});
const setCookies =
  typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
const apiHost = new URL(API).hostname;
const appHost = new URL(APP).hostname;
const cookies = setCookies.flatMap((raw) => {
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

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 920 } });
await ctx.addCookies(cookies);
const page = await ctx.newPage();

const urls = [
  ['overview', `${APP}/app/projects/${PID}`],
  ['source', `${APP}/app/projects/${PID}?tab=requirements&view=source`],
  ['list', `${APP}/app/projects`],
];

const report = {};
for (const [name, url] of urls) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  const text = await page.locator('body').innerText();
  report[name] = {
    url,
    hasFeatureUserLogin: /Feature:\s*User Login/i.test(text),
    hasEmailPassword: /email and password/i.test(text),
    hasScriptDescription: /Requirements analysis flow/i.test(text),
    snippet: /Feature:\s*User Login/i.test(text)
      ? text.slice(text.search(/Feature:\s*User Login/i), text.search(/Feature:\s*User Login/i) + 300)
      : (text.match(/Requirements analysis flow[^\n]*/) || [text.slice(0, 500)])[0],
  };
  console.log(name, JSON.stringify(report[name], null, 2));
}

writeFileSync(join(OUT, 'result.json'), JSON.stringify(report, null, 2));
await browser.close();
