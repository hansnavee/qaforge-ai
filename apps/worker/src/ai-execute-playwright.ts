export function playwrightSpec(opts: {
  externalId: string;
  scenario: string;
  steps: string[];
  expected: string;
  appUrl: string;
  username?: string;
  password?: string;
}): string {
  const url = JSON.stringify(opts.appUrl);
  const user = JSON.stringify(opts.username || '');
  const pass = JSON.stringify(opts.password || '');
  const comments = opts.steps
    .map((s) => `  // ${String(s).replace(/\r?\n/g, ' ').slice(0, 240)}`)
    .join('\n');
  return `import { test, expect } from '@playwright/test';

test(${JSON.stringify(`${opts.externalId}: ${opts.scenario}`)}, async ({ page }) => {
  await page.goto(process.env.APP_URL || ${url});
${comments || '  // No steps recorded'}
  if (${user} && ${pass}) {
    await page.locator('[data-test="username"], #username, #user-name').first().fill(${user}).catch(() => undefined);
    await page.locator('[data-test="password"], #password').first().fill(${pass}).catch(() => undefined);
    await page.locator('[data-test="login-button"], #login-button').first().click().catch(() => undefined);
  }
  // Expected: ${opts.expected.replace(/\r?\n/g, ' ').slice(0, 400)}
});
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildAutomationHtml(opts: {
  projectName: string;
  runName: string;
  rows: Array<{
    externalId: string;
    scenario: string;
    priority: string;
    status: string;
    durationMs: number | null;
    message: string | null;
    thumbDataUrl?: string | null;
  }>;
}): string {
  const passed = opts.rows.filter((r) => r.status === 'PASSED').length;
  const failed = opts.rows.filter((r) => r.status === 'FAILED').length;
  const body = opts.rows
    .map(
      (r) => `<tr>
  <td>${escapeHtml(r.externalId)}</td>
  <td>${escapeHtml(r.scenario)}</td>
  <td>${escapeHtml(r.priority)}</td>
  <td class="${r.status === 'PASSED' ? 'ok' : r.status === 'FAILED' ? 'bad' : ''}">${escapeHtml(r.status)}</td>
  <td>${r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</td>
  <td>${escapeHtml(r.message ?? '')}</td>
  <td>${r.thumbDataUrl ? `<img src="${r.thumbDataUrl}" alt="" width="160" />` : '—'}</td>
</tr>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(opts.runName)} — Automation report</title>
  <style>
    body { font-family: Segoe UI, sans-serif; margin: 24px; color: #111; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    .meta { color: #555; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { border: 1px solid #ddd; padding: 8px; vertical-align: top; }
    th { background: #f4f4f5; text-align: left; }
    .ok { color: #15803d; font-weight: 600; }
    .bad { color: #b91c1c; font-weight: 600; }
    img { max-width: 160px; height: auto; }
  </style>
</head>
<body>
  <h1>${escapeHtml(opts.runName)}</h1>
  <p class="meta">${escapeHtml(opts.projectName)} · ${passed} passed · ${failed} failed · ${opts.rows.length} cases</p>
  <table>
    <thead>
      <tr>
        <th>ID</th><th>Title</th><th>Priority</th><th>Status</th><th>Duration</th><th>Error</th><th>Evidence</th>
      </tr>
    </thead>
    <tbody>
      ${body}
    </tbody>
  </table>
</body>
</html>`;
}

export async function tryLogin(
  page: import('playwright').Page,
  opts: {
    appUrl: string;
    loginUrl?: string | null;
    username?: string;
    password?: string;
  },
) {
  if (!opts.username || !opts.password) return;
  await page.goto(opts.loginUrl || opts.appUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  await page
    .locator(
      '[data-test="username"], #username, #user-name, input[name="username"], input[name="user-name"], input[type="email"], input[name*="user" i]',
    )
    .first()
    .fill(opts.username, { timeout: 10_000 });
  await page
    .locator('[data-test="password"], #password, input[type="password"]')
    .first()
    .fill(opts.password, { timeout: 10_000 });
  await page
    .locator('[data-test="login-button"], #login-button')
    .or(page.getByRole('button', { name: /log ?in|sign ?in/i }))
    .first()
    .click({ timeout: 8_000 });
  await page.waitForTimeout(800);
}
