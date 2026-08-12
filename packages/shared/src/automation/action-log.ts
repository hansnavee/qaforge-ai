export type ActionKind =
  | 'goto'
  | 'click'
  | 'fill'
  | 'select'
  | 'waitFor'
  | 'wait';

export type ActionEntry = {
  kind: ActionKind;
  /** Playwright locator expression without `page.` prefix, e.g. `locator('[data-test="login-button"]').first()` */
  locator?: string;
  /** For goto */
  urlEnv?: 'APP_URL' | 'LOGIN_URL';
  urlLiteral?: string;
  /** fill value source */
  valueEnv?: 'APP_USER' | 'APP_PASS' | 'FIRST_NAME' | 'LAST_NAME' | 'POSTAL_CODE';
  valueLiteral?: string;
  /** selectOption */
  selectValue?: string;
  selectLabel?: string;
  /** waitFor state */
  waitState?: 'visible' | 'hidden' | 'attached';
  timeoutMs?: number;
  comment?: string;
};

export function specFromActionLog(opts: {
  externalId: string;
  scenario: string;
  expected: string;
  actions: ActionEntry[];
  fallbackAppUrl?: string;
}): string {
  const lines: string[] = [];
  if (!opts.actions.length) {
    lines.push(
      `  await page.goto(process.env.APP_URL || ${JSON.stringify(opts.fallbackAppUrl || '/')});`,
    );
  }
  for (const a of opts.actions) {
    if (a.comment) lines.push(`  // ${a.comment.replace(/\r?\n/g, ' ').slice(0, 200)}`);
    const timeout = a.timeoutMs ?? 15_000;
    switch (a.kind) {
      case 'goto': {
        if (a.urlEnv === 'LOGIN_URL') {
          lines.push(
            `  await page.goto(process.env.LOGIN_URL || process.env.APP_URL || ${JSON.stringify(a.urlLiteral || '/')}, { waitUntil: 'domcontentloaded', timeout: ${timeout} });`,
          );
        } else {
          lines.push(
            `  await page.goto(process.env.APP_URL || ${JSON.stringify(a.urlLiteral || '/')}, { waitUntil: 'domcontentloaded', timeout: ${timeout} });`,
          );
        }
        break;
      }
      case 'click': {
        if (!a.locator) break;
        lines.push(
          `  await page.${a.locator}.click({ timeout: ${timeout} });`,
        );
        break;
      }
      case 'fill': {
        if (!a.locator) break;
        const value = a.valueEnv
          ? `process.env.${a.valueEnv} || ''`
          : JSON.stringify(a.valueLiteral ?? '');
        lines.push(
          `  await page.${a.locator}.fill(${value}, { timeout: ${timeout} });`,
        );
        break;
      }
      case 'select': {
        if (!a.locator) break;
        if (a.selectValue) {
          lines.push(
            `  await page.${a.locator}.selectOption({ value: ${JSON.stringify(a.selectValue)} }, { timeout: ${timeout} });`,
          );
        } else if (a.selectLabel) {
          lines.push(
            `  await page.${a.locator}.selectOption({ label: ${JSON.stringify(a.selectLabel)} }, { timeout: ${timeout} });`,
          );
        }
        break;
      }
      case 'waitFor': {
        if (!a.locator) break;
        lines.push(
          `  await page.${a.locator}.waitFor({ state: '${a.waitState ?? 'visible'}', timeout: ${timeout} });`,
        );
        break;
      }
      case 'wait': {
        lines.push(`  await page.waitForTimeout(${a.timeoutMs ?? 400});`);
        break;
      }
      default:
        break;
    }
  }
  if (opts.expected?.trim()) {
    lines.push(
      `  // Expected: ${opts.expected.replace(/\r?\n/g, ' ').slice(0, 400)}`,
    );
  }
  return `import { test, expect } from '@playwright/test';

test(${JSON.stringify(`${opts.externalId}: ${opts.scenario}`)}, async ({ page }) => {
${lines.join('\n')}
});
`;
}
