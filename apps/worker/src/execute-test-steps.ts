import type { ActionEntry } from '@qaforge/shared';

function push(log: ActionEntry[], entry: ActionEntry) {
  log.push(entry);
}

export async function executeTestSteps(
  page: import('playwright').Page,
  steps: string[],
  appUrl: string,
  testData?: Record<string, string> | null,
): Promise<ActionEntry[]> {
  const data = testData ?? {};
  const log: ActionEntry[] = [];

  for (const rawStep of steps) {
    let s = rawStep.trim();
    for (const [k, v] of Object.entries(data)) {
      s = s.split(`{{${k}}}`).join(v).split(`\${${k}}`).join(v);
    }
    const lower = s.toLowerCase();

    if (/^navigate|^open|^go to|^visit/i.test(s)) {
      const urlMatch = s.match(/https?:\/\/\S+/);
      const url = urlMatch?.[0] ?? appUrl;
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      push(log, {
        kind: 'goto',
        urlEnv: 'APP_URL',
        urlLiteral: url,
        comment: s.slice(0, 120),
        timeoutMs: 45_000,
      });
      continue;
    }

    if (/log\s?out|sign\s?out/i.test(lower)) {
      const menu = page.locator(
        '#react-burger-menu-btn, [data-test="open-menu"], button[aria-label*="Open Menu" i]',
      );
      if (await menu.first().isVisible().catch(() => false)) {
        await menu.first().click({ timeout: 8_000 });
        push(log, {
          kind: 'click',
          locator:
            "locator('#react-burger-menu-btn, [data-test=\"open-menu\"]').first()",
          timeoutMs: 8_000,
        });
        await page.waitForTimeout(300);
      }
      await page
        .locator(
          '#logout_sidebar_link, [data-test="logout"], a#logout_sidebar_link',
        )
        .or(page.getByRole('link', { name: /log\s?out|sign\s?out/i }))
        .first()
        .click({ timeout: 15_000 });
      push(log, {
        kind: 'click',
        locator:
          "locator('#logout_sidebar_link, [data-test=\"logout\"]').or(page.getByRole('link', { name: /log\\\\s?out|sign\\\\s?out/i })).first()",
        comment: s.slice(0, 120),
      });
      continue;
    }

    if (
      /(?:open|view|go to|click).*(?:cart|shopping cart)|shopping cart|cart icon|cart badge/i.test(
        lower,
      ) &&
      !/add to cart|remove/i.test(lower)
    ) {
      await page
        .locator(
          '[data-test="shopping-cart-link"], .shopping_cart_link, a.shopping_cart_link',
        )
        .or(page.getByRole('link', { name: /cart/i }))
        .first()
        .click({ timeout: 15_000 });
      push(log, {
        kind: 'click',
        locator:
          "locator('[data-test=\"shopping-cart-link\"], .shopping_cart_link').first()",
        comment: s.slice(0, 120),
      });
      continue;
    }

    if (/add to cart|add .* to (?:the )?cart|add item/i.test(lower)) {
      const quoted = s.match(/['"]([^'"]+)['"]/);
      if (quoted?.[1]) {
        const item = page
          .locator('.inventory_item')
          .filter({ hasText: new RegExp(quoted[1], 'i') })
          .first();
        await item
          .locator('[data-test^="add-to-cart"], button')
          .filter({ hasText: /add to cart/i })
          .first()
          .click({ timeout: 15_000 });
        push(log, {
          kind: 'click',
          locator: `locator('.inventory_item').filter({ hasText: /${quoted[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/i }).locator('[data-test^="add-to-cart"]').first()`,
          comment: s.slice(0, 120),
        });
      } else {
        await page
          .locator('[data-test^="add-to-cart"]')
          .or(page.getByRole('button', { name: /add to cart/i }))
          .first()
          .click({ timeout: 15_000 });
        push(log, {
          kind: 'click',
          locator: "locator('[data-test^=\"add-to-cart\"]').first()",
          comment: s.slice(0, 120),
        });
      }
      continue;
    }

    if (/remove from cart|remove .* cart/i.test(lower)) {
      await page
        .locator('[data-test^="remove"]')
        .or(page.getByRole('button', { name: /^remove$/i }))
        .first()
        .click({ timeout: 15_000 });
      push(log, {
        kind: 'click',
        locator: "locator('[data-test^=\"remove\"]').first()",
        comment: s.slice(0, 120),
      });
      continue;
    }

    if (/sort|order by|filter by|product.?sort/i.test(lower)) {
      const selectLoc =
        "locator('[data-test=\"product-sort-container\"], select.product_sort_container').first()";
      const select = page.locator(
        '[data-test="product-sort-container"], select.product_sort_container, .product_sort_container',
      );
      const option =
        s.match(/['"]([^'"]+)['"]/)?.[1] ??
        (/z\s*[-–]?\s*a|name.*desc/i.test(lower)
          ? 'za'
          : /low.*high|price.*asc/i.test(lower)
            ? 'lohi'
            : /high.*low|price.*desc/i.test(lower)
              ? 'hilo'
              : /a\s*[-–]?\s*z|name.*asc/i.test(lower)
                ? 'az'
                : null);
      if (option) {
        const valueMap: Record<string, string> = {
          az: 'az',
          'a to z': 'az',
          za: 'za',
          'z to a': 'za',
          lohi: 'lohi',
          'low to high': 'lohi',
          hilo: 'hilo',
          'high to low': 'hilo',
        };
        const mapped =
          valueMap[option.toLowerCase()] ??
          (option.length <= 4 ? option.toLowerCase() : null);
        if (mapped) {
          await select.first().selectOption({ value: mapped }, { timeout: 10_000 });
          push(log, {
            kind: 'select',
            locator: selectLoc,
            selectValue: mapped,
            comment: s.slice(0, 120),
          });
        } else {
          await select.first().selectOption({ label: option }, { timeout: 10_000 });
          push(log, {
            kind: 'select',
            locator: selectLoc,
            selectLabel: option,
            comment: s.slice(0, 120),
          });
        }
      } else {
        await select.first().click({ timeout: 10_000 });
        push(log, { kind: 'click', locator: selectLoc, comment: s.slice(0, 120) });
      }
      continue;
    }

    if (/check\s?out/i.test(lower) && !/information|info|overview/i.test(lower)) {
      await page
        .locator('[data-test="checkout"], #checkout')
        .or(page.getByRole('button', { name: /check\s?out/i }))
        .first()
        .click({ timeout: 15_000 });
      push(log, {
        kind: 'click',
        locator: "locator('[data-test=\"checkout\"], #checkout').first()",
        comment: s.slice(0, 120),
      });
      continue;
    }
    if (/continue shopping/i.test(lower)) {
      await page
        .locator('[data-test="continue-shopping"], #continue-shopping')
        .or(page.getByRole('button', { name: /continue shopping/i }))
        .first()
        .click({ timeout: 15_000 });
      push(log, {
        kind: 'click',
        locator:
          "locator('[data-test=\"continue-shopping\"], #continue-shopping').first()",
        comment: s.slice(0, 120),
      });
      continue;
    }
    if (/^continue$|click continue|press continue/i.test(lower)) {
      await page
        .locator('[data-test="continue"], #continue')
        .or(page.getByRole('button', { name: /^continue$/i }))
        .first()
        .click({ timeout: 15_000 });
      push(log, {
        kind: 'click',
        locator: "locator('[data-test=\"continue\"], #continue').first()",
        comment: s.slice(0, 120),
      });
      continue;
    }
    if (/finish|complete (?:the )?order|place order/i.test(lower)) {
      await page
        .locator('[data-test="finish"], #finish')
        .or(page.getByRole('button', { name: /finish|place order/i }))
        .first()
        .click({ timeout: 15_000 });
      push(log, {
        kind: 'click',
        locator: "locator('[data-test=\"finish\"], #finish').first()",
        comment: s.slice(0, 120),
      });
      continue;
    }
    if (/cancel/i.test(lower) && /click|press|select/i.test(lower)) {
      await page
        .locator('[data-test="cancel"], #cancel')
        .or(page.getByRole('button', { name: /^cancel$/i }))
        .first()
        .click({ timeout: 15_000 });
      push(log, {
        kind: 'click',
        locator: "locator('[data-test=\"cancel\"], #cancel').first()",
        comment: s.slice(0, 120),
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
        push(log, {
          kind: 'click',
          locator:
            "locator('[data-test=\"login-button\"], #login-button').first()",
          comment: s.slice(0, 120),
        });
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
      const safe = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      push(log, {
        kind: 'click',
        locator: `getByRole('button', { name: /${safe}/i }).or(page.getByRole('link', { name: /${safe}/i })).first()`,
        comment: s.slice(0, 120),
      });
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
      if (/first\s*name/i.test(lower)) {
        value = data.firstName ?? quoted[quoted.length - 1] ?? 'Jane';
        await page
          .locator('[data-test="firstName"], #first-name, input[name="firstName"]')
          .first()
          .fill(value, { timeout: 10_000 });
        push(log, {
          kind: 'fill',
          locator:
            "locator('[data-test=\"firstName\"], #first-name').first()",
          valueEnv: 'FIRST_NAME',
          valueLiteral: value === data.firstName ? undefined : value,
          comment: s.slice(0, 120),
        });
        continue;
      }
      if (/last\s*name/i.test(lower)) {
        value = data.lastName ?? quoted[quoted.length - 1] ?? 'Doe';
        await page
          .locator('[data-test="lastName"], #last-name, input[name="lastName"]')
          .first()
          .fill(value, { timeout: 10_000 });
        push(log, {
          kind: 'fill',
          locator: "locator('[data-test=\"lastName\"], #last-name').first()",
          valueEnv: 'LAST_NAME',
          valueLiteral: value === data.lastName ? undefined : value,
          comment: s.slice(0, 120),
        });
        continue;
      }
      if (/postal|zip/i.test(lower)) {
        value = data.postalCode ?? quoted[quoted.length - 1] ?? '12345';
        await page
          .locator(
            '[data-test="postalCode"], #postal-code, input[name="postalCode"]',
          )
          .first()
          .fill(value, { timeout: 10_000 });
        push(log, {
          kind: 'fill',
          locator:
            "locator('[data-test=\"postalCode\"], #postal-code').first()",
          valueEnv: 'POSTAL_CODE',
          valueLiteral: value === data.postalCode ? undefined : value,
          comment: s.slice(0, 120),
        });
        continue;
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
        push(log, {
          kind: 'fill',
          locator:
            "locator('[data-test=\"username\"], #username, #user-name').first()",
          valueEnv: 'APP_USER',
          comment: s.slice(0, 120),
        });
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
        push(log, {
          kind: 'fill',
          locator:
            "locator('[data-test=\"password\"], #password, input[type=\"password\"]').first()",
          valueEnv: 'APP_PASS',
          comment: s.slice(0, 120),
        });
        continue;
      }
      const fieldHint = quoted[0] && quoted.length > 1 ? quoted[0] : undefined;
      if (fieldHint) {
        await page
          .getByLabel(new RegExp(fieldHint, 'i'))
          .or(page.getByPlaceholder(new RegExp(fieldHint, 'i')))
          .first()
          .fill(value, { timeout: 10_000 });
        const safe = fieldHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        push(log, {
          kind: 'fill',
          locator: `getByLabel(/${safe}/i).first()`,
          valueLiteral: value,
          comment: s.slice(0, 120),
        });
      } else {
        await page.locator('input:visible').first().fill(value, {
          timeout: 10_000,
        });
        push(log, {
          kind: 'fill',
          locator: "locator('input:visible').first()",
          valueLiteral: value,
          comment: s.slice(0, 120),
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
        push(log, { kind: 'wait', timeoutMs: 400, comment: s.slice(0, 120) });
        continue;
      }
      if (
        /saucedemo/i.test(appUrl) &&
        /logged in|login success|successfully|inventory|products/i.test(text)
      ) {
        const loc =
          "locator('[data-test=\"inventory-container\"], [data-test=\"title\"], .inventory_list').first()";
        await page
          .locator(
            '[data-test="inventory-container"], [data-test="title"], .inventory_list, .inventory_item',
          )
          .or(page.getByText(/^products$/i))
          .first()
          .waitFor({ state: 'visible', timeout: 15_000 });
        push(log, {
          kind: 'waitFor',
          locator: loc,
          waitState: 'visible',
          timeoutMs: 15_000,
          comment: s.slice(0, 120),
        });
        continue;
      }
      if (/thank you|order (?:has been )?dispatched|complete/i.test(text)) {
        const loc =
          "locator('[data-test=\"complete-header\"], .complete-header').first()";
        await page
          .locator(
            '[data-test="complete-header"], .complete-header, #checkout_complete_container',
          )
          .or(page.getByText(/thank you for your order/i))
          .first()
          .waitFor({ state: 'visible', timeout: 15_000 });
        push(log, {
          kind: 'waitFor',
          locator: loc,
          waitState: 'visible',
          timeoutMs: 15_000,
          comment: s.slice(0, 120),
        });
        continue;
      }
      const safe = text.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await page
        .getByText(new RegExp(safe, 'i'))
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 });
      push(log, {
        kind: 'waitFor',
        locator: `getByText(/${safe}/i).first()`,
        waitState: 'visible',
        timeoutMs: 10_000,
        comment: s.slice(0, 120),
      });
      continue;
    }

    await page.waitForTimeout(400);
    push(log, { kind: 'wait', timeoutMs: 400, comment: s.slice(0, 120) });
  }

  return log;
}
