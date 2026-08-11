import { describe, expect, it } from 'vitest';
import { caseStartUrl, credsFromCases, mergeCredsWaterfall } from './execution-creds.js';

describe('execution creds waterfall', () => {
  it('prefers modal fields over case testData', () => {
    const merged = mergeCredsWaterfall([
      { username: 'from-modal', appUrl: 'https://modal.example/' },
      { username: 'from-case', appUrl: 'https://case.example/', password: 'secret' },
    ]);
    expect(merged.username).toBe('from-modal');
    expect(merged.appUrl).toBe('https://modal.example/');
    expect(merged.password).toBe('secret');
  });

  it('reads URL and creds from case steps when testData is empty', () => {
    const creds = credsFromCases(
      [
        {
          testData: {},
          steps: [
            'Open https://www.saucedemo.com/',
            'Enter username "standard_user"',
            'Enter password "secret_sauce"',
          ],
        },
      ],
      {},
    );
    expect(creds.appUrl).toBe('https://www.saucedemo.com/');
    expect(creds.username).toBe('standard_user');
    expect(creds.password).toBe('secret_sauce');
  });

  it('ignores placeholder credentials in steps', () => {
    const creds = credsFromCases(
      [
        {
          steps: [
            'Enter username "a valid username"',
            'Enter password "a valid password"',
          ],
        },
      ],
      {},
    );
    expect(creds.username).toBeUndefined();
    expect(creds.password).toBeUndefined();
  });

  it('uses the case URL for goto, not the job default', () => {
    const url = caseStartUrl(
      { appUrl: 'https://the-internet.herokuapp.com/login' },
      ['Open https://ignored.example/'],
      'https://job-default.example/',
    );
    expect(url).toBe('https://the-internet.herokuapp.com/login');
  });
});
