import { describe, expect, it } from 'vitest';
import {
  assembleGeneratedCases,
  compressSourceForGeneration,
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

  it('builds technique-complete drafts from the source only', () => {
    const { cases, coverage } = assembleGeneratedCases({
      sourceText: SOURCE,
      techniques: [...DESIGN_TECHNIQUES],
    });
    expect(cases.length).toBeGreaterThan(0);
    const blob = cases
      .map((c) => `${c.scenario} ${c.steps.join(' ')} ${c.expected}`)
      .join(' ')
      .toLowerCase();
    expect(blob).toMatch(/discount/);
    expect(blob).not.toMatch(/saucedemo|swag labs|demoqa/);
    expect(blob).not.toMatch(/invalid login error/);
    expect(coverage.requirementCount).toBeGreaterThan(0);
  });

  it('falls back to a single requirement when extract finds none', () => {
    const reqs = requirementsFromSource('Widget flux must stay below 12 units.');
    expect(reqs[0]?.description).toContain('Widget flux');
  });

  it('keeps login URL and credentials from a short prompt', () => {
    const { cases } = assembleGeneratedCases({
      sourceText:
        'Test login positive path on https://www.saucedemo.com/ with username standard_user and password secret_sauce. Verify the user is logged in successfully.',
      techniques: ['HAPPY_PATH'],
    });
    expect(cases.length).toBeGreaterThan(0);
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
