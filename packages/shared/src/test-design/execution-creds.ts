import { isUsableAppUrl } from './environment.js';

export type CredsFields = {
  appUrl?: string;
  loginUrl?: string;
  username?: string;
  password?: string;
};

function fromTestData(raw: unknown): CredsFields {
  if (!raw || typeof raw !== 'object') return {};
  const data = raw as Record<string, unknown>;
  return {
    appUrl: typeof data.appUrl === 'string' ? data.appUrl : undefined,
    loginUrl: typeof data.loginUrl === 'string' ? data.loginUrl : undefined,
    username: typeof data.username === 'string' ? data.username : undefined,
    password: typeof data.password === 'string' ? data.password : undefined,
  };
}

function fromSteps(steps: unknown): CredsFields {
  const list = Array.isArray(steps) ? steps.map(String) : [];
  const out: CredsFields = {};
  for (const step of list) {
    const url = extractAppUrlFromText(step);
    if (!out.appUrl && url) out.appUrl = url;
    const user = step.match(/username\s+"([^"]+)"/i)?.[1];
    if (!out.username && user && !/^a valid /i.test(user)) out.username = user;
    const pass = step.match(/password\s+"([^"]+)"/i)?.[1];
    if (!out.password && pass && !/^a valid /i.test(pass)) out.password = pass;
  }
  return out;
}

/** Pull the first usable http(s) URL from free text (handles quotes around the URL). */
export function extractAppUrlFromText(text: string): string | undefined {
  if (!text?.trim()) return undefined;
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (!match?.[0]) return undefined;
  const cleaned = match[0].replace(/[),.;]+$/g, '');
  return isUsableAppUrl(cleaned) ? cleaned : undefined;
}

function firstFilled(
  layers: CredsFields[],
  key: keyof CredsFields,
): string | undefined {
  for (const layer of layers) {
    const value = layer[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** First non-empty wins per field. */
export function mergeCredsWaterfall(layers: CredsFields[]): CredsFields {
  return {
    appUrl: firstFilled(layers, 'appUrl'),
    loginUrl: firstFilled(layers, 'loginUrl'),
    username: firstFilled(layers, 'username'),
    password: firstFilled(layers, 'password'),
  };
}

export function credsFromCases(
  cases: Array<{ testData?: unknown; steps?: unknown }>,
  fallback: CredsFields = {},
): CredsFields {
  const fromCases: CredsFields = {};
  for (const tc of cases) {
    const data = fromTestData(tc.testData);
    const steps = fromSteps(tc.steps);
    if (!fromCases.appUrl) fromCases.appUrl = data.appUrl || steps.appUrl;
    if (!fromCases.loginUrl) fromCases.loginUrl = data.loginUrl;
    if (!fromCases.username) fromCases.username = data.username || steps.username;
    if (!fromCases.password) fromCases.password = data.password || steps.password;
  }
  return mergeCredsWaterfall([fallback, fromCases]);
}

export function caseStartUrl(
  testData: unknown,
  steps: unknown,
  fallback: string,
): string {
  const data = fromTestData(testData);
  if (isUsableAppUrl(data.appUrl)) return data.appUrl!;
  const stepped = fromSteps(steps).appUrl;
  if (isUsableAppUrl(stepped)) return stepped!;
  return fallback;
}
