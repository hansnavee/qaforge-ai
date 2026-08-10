/**
 * Verify requirements Excel/Word/PDF exports.
 * Usage: node scripts/verify-requirements-export.mjs [projectId]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  '../.tmp/requirements-export',
);

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

async function login() {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { Origin: APP, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  parseSetCookie(res);
  if (!res.ok) throw new Error(`login ${res.status}`);
}

async function download(format) {
  const res = await fetch(
    `${API}/api/v1/projects/${PROJECT}/extracted-requirements/export?format=${format}`,
    { headers: { Origin: APP, Cookie: cookie } },
  );
  parseSetCookie(res);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || '';
  const cd = res.headers.get('content-disposition') || '';
  return { status: res.status, ok: res.ok, buf, ct, cd, text: buf.toString('utf8') };
}

mkdirSync(OUT, { recursive: true });
await login();
check('login', Boolean(cookie));

for (const format of ['xlsx', 'docx', 'pdf', 'csv']) {
  const r = await download(format);
  writeFileSync(
    join(OUT, `export.${format === 'xlsx' ? 'xls' : format === 'docx' ? 'doc' : format === 'pdf' ? 'html' : 'csv'}`),
    r.buf,
  );
  const looksJson = /^\s*[\{\[]/.test(r.text) && r.ct.includes('json');
  const hasTableOrReq =
    /Requirement|REQ-|Acceptance|Workbook|QAForge/i.test(r.text);
  check(`${format} export`, r.ok && r.buf.length > 100 && !looksJson && hasTableOrReq, {
    status: r.status,
    bytes: r.buf.length,
    ct: r.ct,
    cd: r.cd,
    head: r.text.slice(0, 80).replace(/\s+/g, ' '),
  });
}

writeFileSync(join(OUT, 'result.json'), JSON.stringify(results, null, 2));
const failed = results.filter((x) => !x.ok);
log('summary', { failed: failed.length, out: OUT });
if (failed.length) process.exitCode = 1;
