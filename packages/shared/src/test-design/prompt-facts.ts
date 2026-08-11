import { isUsableAppUrl } from './environment.js';

export type PromptFacts = {
  appUrl: string | null;
  username: string | null;
  password: string | null;
  expected: string | null;
  wantsLogin: boolean;
  wantsPositive: boolean;
};

function unquote(raw: string): string {
  return raw.replace(/^['"]|['"]$/g, '').replace(/[.,;]+$/, '').trim();
}

export function extractPromptFacts(sourceText: string): PromptFacts {
  const text = sourceText.replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();

  const urlMatch = text.match(/https?:\/\/[^\s)'"<>]+/i);
  let appUrl = urlMatch?.[0] ? unquote(urlMatch[0]) : null;
  if (appUrl) appUrl = appUrl.replace(/[.,;]+$/, '');
  if (!isUsableAppUrl(appUrl)) appUrl = null;

  const userMatch =
    text.match(/\busername\s*(?:is|:|=)?\s*['"]([^'"]+)['"]/i) ??
    text.match(/\busername\s+(?:is\s+|:\s*|=)?([A-Za-z0-9._@+-]+)/i) ??
    text.match(/\buser\s*[:=]\s*([A-Za-z0-9._@+-]+)/i);
  let username = userMatch?.[1] ? unquote(userMatch[1]) : null;
  if (username && /^(is|and|with|for|credentials|credential)$/i.test(username)) {
    username = null;
  }

  const passMatch =
    text.match(/password\s*(?:is|:|=)?\s*['"]([^'"]+)['"]/i) ??
    text.match(/password\s+(?:is\s+|:\s*|=)?(\S+)/i);
  let password = passMatch?.[1] ? unquote(passMatch[1]) : null;
  if (password && /^(is|and|with|for)$/i.test(password)) password = null;

  if (appUrl && /saucedemo/i.test(appUrl)) {
    if (!username && /\bstandard_user\b/i.test(text)) username = 'standard_user';
    if (!password && /\bsecret_sauce\b/i.test(text)) password = 'secret_sauce';
    if (!username && /credential|log\s?in|sign\s?in/i.test(lower)) {
      username = 'standard_user';
    }
    if (!password && username === 'standard_user') {
      password = 'secret_sauce';
    }
  }

  const expectedMatch = text.match(
    /verify\s+(.+?)(?:\.|$)/i,
  );
  const expected = expectedMatch?.[1]
    ? expectedMatch[1].trim().replace(/\s+/g, ' ').slice(0, 240)
    : /logged in/i.test(lower)
      ? 'User is logged into the application successfully'
      : null;

  const wantsLogin = /\b(log\s?in|sign\s?in|authenticate)\b/i.test(lower);
  const wantsPositive =
    /\b(positive|happy\s*path|valid user|successfully|success)\b/i.test(lower) ||
    (wantsLogin && !/\b(invalid|negative|wrong password)\b/i.test(lower));

  return {
    appUrl,
    username,
    password,
    expected,
    wantsLogin,
    wantsPositive,
  };
}

export function loginCaseFromFacts(
  facts: PromptFacts,
  requirementKey = 'REQ-001',
): {
  scenario: string;
  preconditions: string;
  steps: string[];
  expected: string;
  type: string;
  designTechnique: 'HAPPY_PATH';
  requirementKey: string;
  priorityLabel: 'HIGH';
  testData: Record<string, string>;
  module: string;
} | null {
  if (!facts.wantsLogin && !facts.appUrl) return null;
  if (!facts.wantsLogin && !facts.username) return null;
  const url = facts.appUrl || 'the application under test';
  const user = facts.username || 'a valid username';
  const pass = facts.password || 'a valid password';
  const expected =
    facts.expected ||
    'User is logged into the application successfully';
  return {
    scenario: 'Valid user can log in (positive path)',
    preconditions: `Application is available at ${url}. Use the provided valid credentials.`,
    steps: [
      facts.appUrl ? `Open ${facts.appUrl}` : 'Open the application under test',
      `Enter username "${user}" in the Username field`,
      `Enter password "${pass}" in the Password field`,
      'Click the Login button',
      `Verify ${expected}`,
    ],
    expected,
    type: 'functional',
    designTechnique: 'HAPPY_PATH',
    requirementKey,
    priorityLabel: 'HIGH',
    testData: {
      ...(facts.appUrl ? { appUrl: facts.appUrl } : {}),
      ...(facts.username ? { username: facts.username } : {}),
      ...(facts.password ? { password: facts.password } : {}),
    },
    module: 'Login',
  };
}
