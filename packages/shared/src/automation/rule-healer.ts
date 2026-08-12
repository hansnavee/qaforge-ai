import type { ActionEntry } from './action-log.js';

export type RuleHealResult = {
  patched: ActionEntry[];
  applied: string[];
};

const SAUCE_FALLBACKS: Record<string, string> = {
  login: "locator('[data-test=\"login-button\"], #login-button').first()",
  cart: "locator('[data-test=\"shopping-cart-link\"], .shopping_cart_link').first()",
  checkout: "locator('[data-test=\"checkout\"], #checkout').first()",
  addCart: "locator('[data-test^=\"add-to-cart\"]').first()",
  sort: "locator('[data-test=\"product-sort-container\"], select.product_sort_container').first()",
};

/**
 * Rule-based healer — no LLM. Bump timeouts, insert waitFor, SauceDemo fallbacks.
 */
export function applyRuleHeal(
  actions: ActionEntry[],
  error?: string | null,
): RuleHealResult {
  const applied: string[] = [];
  const patched = actions.map((a) => ({ ...a }));
  const msg = (error ?? '').toLowerCase();

  for (const a of patched) {
    if ((a.kind === 'click' || a.kind === 'fill' || a.kind === 'waitFor') && (a.timeoutMs ?? 15_000) < 30_000) {
      a.timeoutMs = 30_000;
      if (!applied.includes('timeout-30s')) applied.push('timeout-30s');
    }
  }

  const hasWaitForLoad = patched.some(
    (a) => a.kind === 'wait' && (a.timeoutMs ?? 0) >= 400 && a.comment === 'rule-heal: settle',
  );
  if (!hasWaitForLoad && /timeout|not visible|waiting/i.test(msg)) {
    const firstClick = patched.findIndex((a) => a.kind === 'click');
    const insertAt = firstClick >= 0 ? firstClick : patched.length;
    patched.splice(insertAt, 0, {
      kind: 'wait',
      timeoutMs: 800,
      comment: 'rule-heal: settle',
    });
    applied.push('wait-settle');
  }

  for (const a of patched) {
    if (a.kind !== 'click' && a.kind !== 'fill' && a.kind !== 'select') continue;
    const loc = a.locator ?? '';
    if (/login-button|log.?in/i.test(loc + (a.comment ?? '')) && !loc.includes('data-test')) {
      a.locator = SAUCE_FALLBACKS.login;
      applied.push('saucedemo-login');
    }
    if (/shopping-cart|cart/i.test(loc + (a.comment ?? '')) && !loc.includes('shopping-cart-link')) {
      a.locator = SAUCE_FALLBACKS.cart;
      applied.push('saucedemo-cart');
    }
    if (/checkout/i.test(loc + (a.comment ?? '')) && !loc.includes('data-test="checkout"')) {
      a.locator = SAUCE_FALLBACKS.checkout;
      applied.push('saucedemo-checkout');
    }
    if (/add-to-cart|add to cart/i.test(loc + (a.comment ?? '')) && !loc.includes('add-to-cart')) {
      a.locator = SAUCE_FALLBACKS.addCart;
      applied.push('saucedemo-add-cart');
    }
    if (/product-sort|sort/i.test(loc + (a.comment ?? '')) && a.kind === 'select') {
      a.locator = SAUCE_FALLBACKS.sort;
      applied.push('saucedemo-sort');
    }
  }

  if (!applied.length) {
    applied.push('timeout-30s');
  }

  return { patched, applied };
}
