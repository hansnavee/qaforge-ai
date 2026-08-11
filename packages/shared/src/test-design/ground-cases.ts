import { openAppStep, isUsableAppUrl } from './environment.js';

export type UiPageMap = {
  url?: string;
  title?: string;
  buttons?: string[];
  inputs?: string[];
  forms?: unknown[];
  nav?: string[];
};

export type GroundableCase = {
  steps: string[];
  preconditions?: string | null;
  designMode?: string | null;
  scenario?: string;
  testData?: Record<string, string>;
};

function fieldName(raw: string): string {
  const idx = raw.indexOf(':');
  if (idx > 0 && idx < raw.length - 1) return raw.slice(idx + 1);
  return raw;
}

function firstMatch(haystack: string[], pattern: RegExp): string | null {
  const hit = haystack.find((x) => pattern.test(x));
  return hit ? fieldName(hit) : null;
}

function stepsMentionUrl(steps: string[] | undefined, appUrl: string): boolean {
  if (!Array.isArray(steps) || !appUrl) return false;
  return steps.some((s) => typeof s === 'string' && s.includes(appUrl));
}

/** Rewrite generic steps against a live URL + optional discovery map. */
export function groundCaseAgainstUi<T extends GroundableCase>(
  tc: T,
  opts: { appUrl: string; pages?: UiPageMap[] },
): T {
  if (!isUsableAppUrl(opts.appUrl)) return tc;
  const open = openAppStep(opts.appUrl);
  const inputs = (opts.pages ?? []).flatMap((p) => p.inputs ?? []);
  const buttons = (opts.pages ?? []).flatMap((p) => p.buttons ?? []);
  const emailField = firstMatch(inputs, /email|user/i);
  const passwordField = firstMatch(inputs, /pass/i);
  const submit = firstMatch(buttons, /log\s?in|sign\s?in|submit/i);

  const steps = (Array.isArray(tc.steps) ? tc.steps : []).map((step) => {
    let next = step
      .replace(/Open the application under test/gi, open.replace(/^Open /, 'Open '))
      .replace(/^Open https?:\/\/example\.com\S*/i, open)
      .replace(/^Open the application.*/i, open);
    if (/^Open /i.test(next) && !isUsableAppUrl(next.slice(5))) {
      next = open;
    }
    if (emailField && /email|username/i.test(next) && /enter/i.test(next)) {
      next = next.replace(
        /email\/username|email or username|email|username/i,
        emailField,
      );
    }
    if (passwordField && /password/i.test(next) && /enter/i.test(next)) {
      next = `Enter the ${passwordField}`;
    }
    if (submit && /click\b.*\b(log\s?in|sign\s?in|submit)/i.test(next)) {
      next = `Click ${submit}`;
    }
    return next;
  });

  if (steps[0] && !/^Open /i.test(steps[0])) {
    steps.unshift(open);
  } else if (steps[0]) {
    steps[0] = open;
  }

  const preconditions = (tc.preconditions ?? '').replace(
    /Application under test is available \(URL not provided yet[^.]*\)\.?/i,
    `Application at ${opts.appUrl} is available.`,
  );

  return {
    ...tc,
    steps,
    preconditions: preconditions || `Application at ${opts.appUrl} is available.`,
    designMode: 'UI_GROUNDED',
  };
}

export function groundCasesAgainstUi<T extends GroundableCase>(
  cases: T[],
  opts: { appUrl: string; pages?: UiPageMap[] },
): T[] {
  return cases.map((tc) =>
    tc.designMode === 'UI_GROUNDED' && stepsMentionUrl(tc.steps, opts.appUrl)
      ? tc
      : groundCaseAgainstUi(tc, opts),
  );
}
