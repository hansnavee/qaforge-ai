import { describe, expect, it } from 'vitest';
import { specFromActionLog } from './action-log.js';

describe('specFromActionLog', () => {
  it('emits env-based credentials and real actions', () => {
    const source = specFromActionLog({
      externalId: 'TC-001',
      scenario: 'Login',
      expected: 'Products visible',
      fallbackAppUrl: 'https://www.saucedemo.com',
      actions: [
        {
          kind: 'goto',
          urlEnv: 'APP_URL',
          urlLiteral: 'https://www.saucedemo.com',
        },
        {
          kind: 'fill',
          locator: "locator('[data-test=\"username\"]').first()",
          valueEnv: 'APP_USER',
        },
        {
          kind: 'fill',
          locator: "locator('[data-test=\"password\"]').first()",
          valueEnv: 'APP_PASS',
        },
        {
          kind: 'click',
          locator: "locator('[data-test=\"login-button\"]').first()",
        },
        {
          kind: 'waitFor',
          locator: "locator('[data-test=\"inventory-container\"]').first()",
          waitState: 'visible',
        },
      ],
    });
    expect(source).toContain("process.env.APP_USER");
    expect(source).toContain("process.env.APP_PASS");
    expect(source).not.toContain('secret_sauce');
    expect(source).toContain("locator('[data-test=\"login-button\"]').first()");
    expect(source).toContain('waitFor');
  });
});
