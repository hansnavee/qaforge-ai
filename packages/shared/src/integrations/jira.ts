/**
 * Jira Cloud REST helpers for dual-write defect sync.
 * TCMS remains canonical; Jira is an optional external sink.
 */

export type JiraConnectionConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  /** Defaults to Bug */
  issueType?: string;
};

export type JiraIssueInput = {
  title: string;
  description?: string;
  severity?: string;
  stepsToReproduce?: string;
};

export type JiraIssueResult = {
  key: string;
  id: string;
  url: string;
};

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function authHeader(email: string, apiToken: string): string {
  return `Basic ${toBase64(`${email}:${apiToken}`)}`;
}

function severityLabel(severity?: string): string {
  const s = (severity ?? 'medium').toLowerCase();
  if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') {
    return s;
  }
  return 'medium';
}

function buildDescription(input: JiraIssueInput): string {
  const parts = [
    input.description?.trim() || '',
    input.stepsToReproduce?.trim()
      ? `Steps to reproduce:\n${input.stepsToReproduce.trim()}`
      : '',
    `Severity: ${severityLabel(input.severity)}`,
    'Source: QAForge AI TCMS (dual-write)',
  ].filter(Boolean);
  return parts.join('\n\n');
}

export function parseJiraConnectionConfig(
  raw: unknown,
): JiraConnectionConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const baseUrl = typeof o.baseUrl === 'string' ? o.baseUrl.trim() : '';
  const email = typeof o.email === 'string' ? o.email.trim() : '';
  const apiToken = typeof o.apiToken === 'string' ? o.apiToken.trim() : '';
  const projectKey =
    typeof o.projectKey === 'string' ? o.projectKey.trim().toUpperCase() : '';
  const issueType =
    typeof o.issueType === 'string' && o.issueType.trim()
      ? o.issueType.trim()
      : 'Bug';
  if (!baseUrl || !email || !apiToken || !projectKey) return null;
  return { baseUrl: normalizeBaseUrl(baseUrl), email, apiToken, projectKey, issueType };
}

/** Create a Jira issue; returns key + browse URL. */
export async function createJiraIssue(
  config: JiraConnectionConfig,
  input: JiraIssueInput,
): Promise<JiraIssueResult> {
  const base = normalizeBaseUrl(config.baseUrl);
  const res = await fetch(`${base}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(config.email, config.apiToken),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        project: { key: config.projectKey },
        summary: input.title.trim().slice(0, 255),
        issuetype: { name: config.issueType || 'Bug' },
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: buildDescription(input).slice(0, 8000),
                },
              ],
            },
          ],
        },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Jira create issue failed (${res.status}): ${text.slice(0, 240)}`,
    );
  }
  const data = (await res.json()) as { id?: string; key?: string };
  if (!data.key || !data.id) {
    throw new Error('Jira create issue returned no key');
  }
  return {
    key: data.key,
    id: data.id,
    url: `${base}/browse/${data.key}`,
  };
}

/** Lightweight connectivity check (myself + project). */
export async function verifyJiraConnection(
  config: JiraConnectionConfig,
): Promise<{ ok: true; accountId?: string }> {
  const base = normalizeBaseUrl(config.baseUrl);
  const headers = {
    Authorization: authHeader(config.email, config.apiToken),
    Accept: 'application/json',
  };
  const me = await fetch(`${base}/rest/api/3/myself`, { headers });
  if (!me.ok) {
    const text = await me.text().catch(() => '');
    throw new Error(`Jira auth failed (${me.status}): ${text.slice(0, 160)}`);
  }
  const meJson = (await me.json()) as { accountId?: string };
  const project = await fetch(
    `${base}/rest/api/3/project/${encodeURIComponent(config.projectKey)}`,
    { headers },
  );
  if (!project.ok) {
    const text = await project.text().catch(() => '');
    throw new Error(
      `Jira project ${config.projectKey} not found (${project.status}): ${text.slice(0, 160)}`,
    );
  }
  return { ok: true, accountId: meJson.accountId };
}
