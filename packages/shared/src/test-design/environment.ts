const LOWER_ENV_HINT =
  /(^|\.)(qa|uat|staging|stage|dev|test|local|preview|sandbox)(\.|$)/i;

export function isUsableAppUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw.trim()) return false;
  const s = raw.trim();
  if (/^https?:\/\/$/i.test(s)) return false;
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(s);
}

/** Empty, `https://`, or `http://` — not a real host. */
export function normalizeStoredAppUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || /^https?:\/\/$/i.test(s)) return null;
  return isUsableAppUrl(s) ? s : null;
}

function hostnameOf(raw: string): string | null {
  const m = raw.trim().match(/^https?:\/\/([^/?#]+)/i);
  return m?.[1]?.toLowerCase() ?? null;
}

/** True for localhost / RFC1918 hosts the cloud API cannot crawl. */
export function isPrivateAppUrl(raw: string): boolean {
  const host = hostnameOf(raw)?.replace(/:\d+$/, '') ?? null;
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host.endsWith('.local') || host.endsWith('.localhost')) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
  return false;
}

/** Generic open step when no environment URL exists yet. */
export function openAppStep(appUrl?: string | null): string {
  return isUsableAppUrl(appUrl)
    ? `Open ${String(appUrl).trim()}`
    : 'Open the application under test';
}

export function appAvailablePrecondition(
  appUrl: string | null | undefined,
  requirementKey?: string,
  title?: string,
): string {
  const grounded = requirementKey
    ? ` Grounded in ${requirementKey}${title ? `: ${title}` : ''}.`
    : '';
  if (isUsableAppUrl(appUrl)) {
    return `Application at ${String(appUrl).trim()} is available.${grounded}`;
  }
  return `Application under test is available (URL not provided yet — generic steps).${grounded}`;
}

export function isLikelyProductionUrl(raw: string): boolean {
  const host = hostnameOf(raw);
  if (!host) return false;
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.local') ||
    host.includes('saucedemo') ||
    host.includes('herokuapp') ||
    host.endsWith('.github.io') ||
    host.includes('the-internet')
  ) {
    return false;
  }
  if (LOWER_ENV_HINT.test(host)) return false;
  return true;
}

export const BROWSER_MODES = ['HEADLESS', 'HEADED'] as const;
export type BrowserMode = (typeof BROWSER_MODES)[number];

export function normalizeBrowserMode(raw: unknown): BrowserMode {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/CLOUD_/g, '');
  if (s === 'HEADED' || s === 'HEADFUL' || s === 'INTERACTIVE') return 'HEADED';
  return 'HEADLESS';
}
