export async function executeTestSteps(
  page: import('playwright').Page,
  steps: string[],
  appUrl: string,
  testData?: Record<string, string> | null,
): Promise<void> {
  const data = testData ?? {};
  for (const rawStep of steps) {
    let s = rawStep.trim();
    for (const [k, v] of Object.entries(data)) {
      s = s.split(`{{${k}}}`).join(v).split(`\${${k}}`).join(v);
    }
    const lower = s.toLowerCase();

    if (/^navigate|^open|^go to|^visit/i.test(s)) {
      const urlMatch = s.match(/https?:\/\/\S+/);
      await page.goto(urlMatch?.[0] ?? appUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      continue;
    }

    if (/click/i.test(lower)) {
      if (/log\s?in|sign\s?in/i.test(lower)) {
        await page
          .locator(
            '[data-test="login-button"], #login-button, input[type="submit"]',
          )
          .or(page.getByRole('button', { name: /log\s?in|sign\s?in/i }))
          .first()
          .click({ timeout: 15_000 });
        continue;
      }
      const quoted = s.match(/['"]([^'"]+)['"]/);
      const label = quoted?.[1] ?? s.replace(/click\s*/i, '').trim();
      const locator = page
        .getByRole('button', { name: new RegExp(label, 'i') })
        .or(page.getByRole('link', { name: new RegExp(label, 'i') }))
        .or(page.getByText(new RegExp(label, 'i')))
        .first();
      await locator.click({ timeout: 15_000 });
      continue;
    }

    if (/type|enter|fill|input/i.test(lower)) {
      const quoted = [...s.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
      let value = quoted[quoted.length - 1] ?? data.sampleInput ?? 'test';
      if (
        (lower.includes('user') || lower.includes('email')) &&
        data.username
      ) {
        value = data.username;
      }
      if (
        lower.includes('pass') &&
        data.password &&
        data.password !== '<<manual>>'
      ) {
        value = data.password;
      }
      if (lower.includes('user') || lower.includes('email')) {
        await page
          .locator(
            '[data-test="username"], #username, #user-name, input[name="username"], input[name="user-name"], input[id="user-name"], input[id="username"]',
          )
          .or(page.getByPlaceholder(/user|email/i))
          .or(page.getByLabel(/user|email/i))
          .first()
          .fill(value, { timeout: 10_000 });
        continue;
      }
      if (lower.includes('pass')) {
        await page
          .locator(
            '[data-test="password"], #password, input[type="password"]',
          )
          .or(page.getByPlaceholder(/pass/i))
          .or(page.getByLabel(/pass/i))
          .first()
          .fill(value, { timeout: 10_000 });
        continue;
      }
      const fieldHint = quoted[0] && quoted.length > 1 ? quoted[0] : undefined;
      if (fieldHint) {
        await page
          .getByLabel(new RegExp(fieldHint, 'i'))
          .or(page.getByPlaceholder(new RegExp(fieldHint, 'i')))
          .first()
          .fill(value, { timeout: 10_000 });
      } else {
        await page.locator('input:visible').first().fill(value, {
          timeout: 10_000,
        });
      }
      continue;
    }

    if (/assert|expect|verify|should|check/i.test(lower)) {
      const text = s
        .replace(/^(assert|expect|verify|should|check)\s*/i, '')
        .trim();
      if (
        !text ||
        /documented outcome|specified behavior|observe the/i.test(text)
      ) {
        await page.waitForTimeout(400);
        continue;
      }
      if (
        /saucedemo/i.test(appUrl) &&
        /logged in|login success|successfully|inventory|products/i.test(text)
      ) {
        await page
          .locator(
            '[data-test="inventory-container"], [data-test="title"], .inventory_list, .inventory_item',
          )
          .or(page.getByText(/^products$/i))
          .first()
          .waitFor({ state: 'visible', timeout: 15_000 });
        continue;
      }
      await page
        .getByText(
          new RegExp(
            text.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            'i',
          ),
        )
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 });
      continue;
    }

    await page.waitForTimeout(400);
  }
}
