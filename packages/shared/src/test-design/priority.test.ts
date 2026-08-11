import { describe, expect, it } from 'vitest';
import {
  normalizePriorityLabel,
  sortCasesByPriority,
  suggestExecutionSelection,
} from './priority.js';
import {
  isLikelyProductionUrl,
  isUsableAppUrl,
  normalizeStoredAppUrl,
  openAppStep,
} from './environment.js';
import { groundCaseAgainstUi, groundCasesAgainstUi } from './ground-cases.js';

describe('priority execution order', () => {
  it('maps P0 to HIGH and P2 to LOW', () => {
    expect(normalizePriorityLabel('P0')).toBe('HIGH');
    expect(normalizePriorityLabel('medium')).toBe('MEDIUM');
    expect(normalizePriorityLabel('P2')).toBe('LOW');
  });

  it('sorts High then Medium then Low across features', () => {
    const ordered = sortCasesByPriority([
      { id: 'c', featureKey: 'FG-B', priorityLabel: 'LOW', externalId: 'TC-003' },
      { id: 'a', featureKey: 'FG-B', priorityLabel: 'HIGH', externalId: 'TC-002' },
      { id: 'b', featureKey: 'FG-A', priorityLabel: 'MEDIUM', externalId: 'TC-001' },
      { id: 'd', featureKey: 'FG-A', priorityLabel: 'HIGH', externalId: 'TC-004' },
    ]);
    expect(ordered.map((c) => c.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('sprint suggest picks only ready HIGH cases', () => {
    const { testCaseIds } = suggestExecutionSelection([
      { id: '1', readyForExecution: true, priorityLabel: 'HIGH' },
      { id: '2', readyForExecution: true, priorityLabel: 'MEDIUM' },
      { id: '3', readyForExecution: false, priorityLabel: 'HIGH' },
    ]);
    expect(testCaseIds).toEqual(['1']);
  });

  it('feature filter scopes ready cases to that feature or All', () => {
    const cases = [
      { id: 'a', readyForExecution: true, priorityLabel: 'HIGH', featureKey: 'FG-A', externalId: 'TC-001' },
      { id: 'b', readyForExecution: true, priorityLabel: 'HIGH', featureKey: 'FG-B', externalId: 'TC-002' },
      { id: 'c', readyForExecution: true, priorityLabel: 'MEDIUM', module: 'Login', externalId: 'TC-003' },
    ];
    expect(
      suggestExecutionSelection(cases, { runKind: 'REGRESSION', featureKey: 'FG-A' })
        .testCaseIds,
    ).toEqual(['a']);
    expect(
      suggestExecutionSelection(cases, { runKind: 'REGRESSION', featureKey: 'Login' })
        .testCaseIds,
    ).toEqual(['c']);
    expect(
      suggestExecutionSelection(cases, { runKind: 'REGRESSION' }).testCaseIds,
    ).toEqual(['a', 'b', 'c']);
  });

  it('regression suggest picks all ready in High→Low order', () => {
    const { testCaseIds } = suggestExecutionSelection(
      [
        { id: 'm', readyForExecution: true, priorityLabel: 'MEDIUM', externalId: 'TC-002' },
        { id: 'h', readyForExecution: true, priorityLabel: 'HIGH', externalId: 'TC-001' },
        { id: 'skip', readyForExecution: false, priorityLabel: 'HIGH' },
      ],
      { runKind: 'REGRESSION' },
    );
    expect(testCaseIds).toEqual(['h', 'm']);
  });
});

describe('environment helpers', () => {
  it('uses a generic open step when no URL is set', () => {
    expect(openAppStep(null)).toBe('Open the application under test');
    expect(openAppStep('https://')).toBe('Open the application under test');
    expect(openAppStep('https://qa.example.com/login')).toContain('qa.example.com');
  });

  it('treats empty and https:// as not a usable app URL', () => {
    expect(isUsableAppUrl('')).toBe(false);
    expect(isUsableAppUrl('https://')).toBe(false);
    expect(isUsableAppUrl('http://')).toBe(false);
    expect(normalizeStoredAppUrl('https://')).toBeNull();
    expect(normalizeStoredAppUrl('')).toBeNull();
    expect(normalizeStoredAppUrl('https://qa.shop.test')).toBe(
      'https://qa.shop.test',
    );
  });

  it('warns on production-looking hosts but not QA/UAT', () => {
    expect(isLikelyProductionUrl('https://www.shop.com')).toBe(true);
    expect(isLikelyProductionUrl('https://qa.shop.com')).toBe(false);
    expect(isLikelyProductionUrl('https://www.saucedemo.com')).toBe(false);
  });

  it('grounds generic open steps onto the live URL', () => {
    const grounded = groundCaseAgainstUi(
      {
        steps: ['Open the application under test', 'Enter a valid email', 'Click Login'],
        preconditions: 'Application under test is available (URL not provided yet — generic steps).',
        designMode: 'GENERIC',
      },
      {
        appUrl: 'https://qa.example.com',
        pages: [{ inputs: ['Email', 'Password'], buttons: ['Login'] }],
      },
    );
    expect(grounded.designMode).toBe('UI_GROUNDED');
    expect(grounded.steps[0]).toBe('Open https://qa.example.com');
    expect(grounded.steps.some((s) => /Login/.test(s))).toBe(true);
  });

  it('uses crawled type:name inputs and replaces a leftover URL', () => {
    const grounded = groundCaseAgainstUi(
      {
        steps: ['Open https://www.saucedemo.com', 'Enter a valid username', 'Click the Login button'],
        designMode: 'UI_GROUNDED',
      },
      {
        appUrl: 'https://qa.shop.test/login',
        pages: [{ inputs: ['text:user-name', 'password:password'], buttons: ['Login'] }],
      },
    );
    expect(grounded.steps[0]).toBe('Open https://qa.shop.test/login');
    expect(grounded.steps.join(' ')).toContain('user-name');
    expect(grounded.steps.join(' ')).toContain('Login');
  });

  it('re-grounds UI_GROUNDED cases that still point at a different URL', () => {
    const [next] = groundCasesAgainstUi(
      [
        {
          steps: ['Open https://www.saucedemo.com', 'Enter password'],
          designMode: 'UI_GROUNDED',
        },
      ],
      { appUrl: 'https://uat.app.test' },
    );
    expect(next?.steps[0]).toBe('Open https://uat.app.test');
  });
});
