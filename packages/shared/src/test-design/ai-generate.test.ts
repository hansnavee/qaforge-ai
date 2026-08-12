import { describe, expect, it } from 'vitest';
import {
  assembleGeneratedCases,
  compressSourceForGeneration,
  parseJsonFromLlm,
  requirementsFromSource,
} from './ai-generate.js';
import { rowsFromCsv, rowsFromJson } from './import-cases.js';
import { DESIGN_TECHNIQUES } from './techniques.js';

const SOURCE = `
The billing user can apply a discount code at checkout.
Valid codes reduce the order total. Invalid codes show an error.
The discount field accepts 3 to 12 characters.
`;

describe('ai generate pipeline', () => {
  it('compresses boilerplate without inventing text', () => {
    const out = compressSourceForGeneration(
      '# Title\n\n---\n\nUsers can reset a password via email OTP.\n',
    );
    expect(out).toContain('reset a password');
    expect(out).not.toMatch(/^# Title$/m);
  });

  it('does not invent cases when the model returns nothing', () => {
    const { cases } = assembleGeneratedCases({
      sourceText: SOURCE,
      llmCases: { cases: [] },
      techniques: [...DESIGN_TECHNIQUES],
    });
    expect(cases).toHaveLength(0);
  });

  it('keeps multiple LLM cases including extra HAPPY_PATH rows', () => {
    const { cases } = assembleGeneratedCases({
      sourceText: SOURCE,
      llmCases: {
        cases: [
          {
            scenario: 'Valid discount reduces the total',
            expected: 'Order total is reduced',
            steps: ['Open checkout', 'Enter a valid discount code'],
            designTechnique: 'HAPPY_PATH',
          },
          {
            scenario: 'Invalid discount shows an error',
            expected: 'An error is shown',
            steps: ['Open checkout', 'Enter an invalid discount code'],
            designTechnique: 'NEGATIVE',
          },
          {
            scenario: 'Discount at minimum length is accepted',
            expected: 'Code of 3 characters is accepted',
            steps: ['Open checkout', 'Enter a 3 character code'],
            designTechnique: 'BOUNDARY',
          },
        ],
      },
    });
    expect(cases.length).toBe(3);
    const blob = cases
      .map((c) => `${c.scenario} ${c.steps.join(' ')} ${c.expected}`)
      .join(' ')
      .toLowerCase();
    expect(blob).toMatch(/discount/);
    expect(blob).not.toMatch(/saucedemo|swag labs|demoqa/);
  });

  it('falls back to a single requirement when extract finds none', () => {
    const reqs = requirementsFromSource('Widget flux must stay below 12 units.');
    expect(reqs[0]?.description).toContain('Widget flux');
  });

  it('keeps login URL and credentials from LLM JSON', () => {
    const source =
      'Test login positive path on https://www.saucedemo.com/ with username standard_user and password secret_sauce. Verify the user is logged in successfully.';
    const { cases } = assembleGeneratedCases({
      sourceText: source,
      techniques: ['HAPPY_PATH', 'NEGATIVE'],
      llmCases: {
        cases: [
          {
            scenario: 'Valid user can log in',
            expected: 'User is logged in successfully',
            steps: [
              'Open https://www.saucedemo.com/',
              'Enter username "standard_user"',
              'Enter password "secret_sauce"',
              'Click Login',
            ],
            testData: {
              appUrl: 'https://www.saucedemo.com/',
              username: 'standard_user',
              password: 'secret_sauce',
            },
          },
          {
            scenario: 'Login fails with the wrong password',
            expected: 'An error is shown',
            steps: [
              'Open https://www.saucedemo.com/',
              'Enter username "standard_user"',
              'Enter password "wrong_pass"',
              'Click Login',
            ],
            designTechnique: 'NEGATIVE',
            testData: {
              appUrl: 'https://www.saucedemo.com/',
              username: 'standard_user',
              password: 'wrong_pass',
            },
          },
        ],
      },
    });
    expect(cases.length).toBe(2);
    const blob = cases
      .map(
        (c) =>
          `${c.scenario} ${c.steps.join(' ')} ${c.expected} ${JSON.stringify(c.testData)}`,
      )
      .join(' ')
      .toLowerCase();
    expect(blob).toMatch(/saucedemo/);
    expect(blob).toMatch(/standard_user/);
    expect(blob).toMatch(/secret_sauce/);
    expect(cases[0]?.steps.length).toBeGreaterThanOrEqual(4);
  });

  it('extracts cases JSON after model preamble', () => {
    const raw = `We need to produce JSON only.
{"cases":[{"scenario":"Valid login","expected":"Inventory shown","steps":["Open https://www.saucedemo.com/","Click Login"],"designTechnique":"HAPPY_PATH"}]}
`;
    const parsed = parseJsonFromLlm(raw) as { cases: unknown[] };
    expect(parsed.cases).toHaveLength(1);
  });
});

describe('case import parse', () => {
  it('parses csv rows', () => {
    const csv = `id,scenario,expected,steps
TC-001,Apply valid discount,Total is reduced,Open checkout | Enter code
`;
    const { rows, errors } = rowsFromCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0]?.scenario).toBe('Apply valid discount');
    expect(rows[0]?.steps).toEqual(['Open checkout', 'Enter code']);
  });

  it('parses json arrays', () => {
    const { rows } = rowsFromJson([
      { scenario: 'Invalid code', expected: 'Error shown', steps: ['Enter code'] },
    ]);
    expect(rows).toHaveLength(1);
  });
});
