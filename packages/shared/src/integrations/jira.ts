/**
 * Jira Cloud REST helpers for dual-write defects + requirements import.
 * TCMS remains canonical; Jira is an optional external provider.
 */

export type JiraAuthMode = 'basic' | 'bearer';

export type JiraConnectionConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  /** Defaults to Bug (for defect create) */
  issueType?: string;
  /** Atlassian cloud id — required for scoped API tokens. */
  cloudId?: string;
  authMode?: JiraAuthMode;
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

/** Normalized ticket for browse / prompt / import UI. */
export type JiraTicketCandidate = {
  key: string;
  id: string;
  summary: string;
  description: string;
  issueType: string;
  status: string;
  parentKey: string | null;
  epicKey: string | null;
  url: string;
  /** True when type is Bug/Defect — skip for requirements import. */
  isBug: boolean;
  selectable: boolean;
};

export type JiraTicketSelectionMode = 'BROWSE' | 'PROMPT' | 'KEYS' | 'EPIC';

const ISSUE_FIELD_LIST = [
  'summary',
  'description',
  'issuetype',
  'status',
  'parent',
  'subtasks',
  'customfield_10014',
];

function normalizeBaseUrl(raw: string): string {
  return normalizeJiraSiteUrl(raw) ?? raw.trim().replace(/\/+$/, '');
}

/** Site origin only, with https if the user omitted the scheme. */
export function normalizeJiraSiteUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Project key (QA), not an issue key (QA-12). */
export function normalizeJiraProjectKey(raw: string): string | null {
  const t = raw.trim().toUpperCase().replace(/^["']|["']$/g, '');
  const m = t.match(/^([A-Z][A-Z0-9_]*)/);
  return m?.[1] ?? null;
}

function toBase64(value: string): string {
  const g = globalThis as {
    Buffer?: {
      from: (v: string, enc: string) => { toString: (enc: string) => string };
    };
  };
  if (typeof g.Buffer?.from === 'function') {
    return g.Buffer.from(value, 'utf8').toString('base64');
  }
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function normalizeJiraApiToken(raw: string): string {
  return raw.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, '');
}

function authHeader(email: string, apiToken: string): string {
  return `Basic ${toBase64(`${email.trim().toLowerCase()}:${normalizeJiraApiToken(apiToken)}`)}`;
}

function restHeaders(
  config: JiraConnectionConfig,
  mode: JiraAuthMode,
  withJsonBody: boolean,
): Record<string, string> {
  const token = normalizeJiraApiToken(config.apiToken);
  const headers: Record<string, string> = {
    Authorization:
      mode === 'bearer'
        ? `Bearer ${token}`
        : authHeader(config.email, token),
    Accept: 'application/json',
    'User-Agent': 'QAForge-AI',
  };
  if (withJsonBody) headers['Content-Type'] = 'application/json';
  return headers;
}

function siteOrigin(config: JiraConnectionConfig): string {
  return normalizeBaseUrl(config.baseUrl);
}

function gatewayOrigin(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}`;
}

function restUrl(origin: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${p}`;
}

async function jiraAuthedFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get('location');
    if (!loc) return res;
    const next = new URL(loc, current);
    if (next.origin !== new URL(current).origin) return res;
    current = next.toString();
  }
  return fetch(url, init);
}

export async function resolveJiraCloudId(
  site: string,
): Promise<string | null> {
  const res = await fetch(`${site}/_edge/tenant_info`, {
    headers: { Accept: 'application/json', 'User-Agent': 'QAForge-AI' },
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    cloudId?: unknown;
  } | null;
  return typeof data?.cloudId === 'string' && data.cloudId.trim()
    ? data.cloudId.trim()
    : null;
}

function isAuthFailure(res: Response): boolean {
  return res.status === 401 || res.status === 403;
}

function shouldTryNextAuth(res: Response): boolean {
  return isAuthFailure(res) || (res.status >= 300 && res.status < 400);
}

async function jiraApiFetch(
  config: JiraConnectionConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const withJsonBody = Boolean(init.body);
  const site = siteOrigin(config);
  const method = init.method ?? 'GET';

  const attempt = (origin: string, mode: JiraAuthMode) =>
    jiraAuthedFetch(restUrl(origin, path), {
      ...init,
      method,
      headers: {
        ...restHeaders(config, mode, withJsonBody),
        ...(init.headers as Record<string, string> | undefined),
      },
    });

  const remember = (cloudId: string | undefined, mode: JiraAuthMode) => {
    if (cloudId) config.cloudId = cloudId;
    config.authMode = mode;
  };

  const cloudId =
    config.cloudId ??
    (await resolveJiraCloudId(site).catch(() => null));

  const targets: { origin: string; cloudId?: string }[] = [];
  if (cloudId) {
    targets.push({ origin: gatewayOrigin(cloudId), cloudId });
  }
  targets.push({ origin: site });

  const modes: JiraAuthMode[] =
    config.authMode === 'bearer'
      ? ['bearer', 'basic']
      : ['basic', 'bearer'];

  let last: Response | null = null;
  for (const target of targets) {
    for (const mode of modes) {
      const res = await attempt(target.origin, mode);
      last = res;
      if (res.ok) {
        remember(target.cloudId, mode);
        return res;
      }
      if (!shouldTryNextAuth(res)) {
        if (target.cloudId) remember(target.cloudId, mode);
        return res;
      }
    }
  }
  return last ?? new Response('Jira unreachable', { status: 502 });
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

/** Flatten Atlassian Document Format (or string) to plain text. */
export function adfToPlainText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value !== 'object') return String(value);
  const node = value as { type?: string; text?: string; content?: unknown[] };
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  const parts = node.content.map((c) => adfToPlainText(c)).filter(Boolean);
  if (node.type === 'paragraph' || node.type === 'heading') {
    return `${parts.join('')}\n`;
  }
  if (node.type === 'listItem') return `- ${parts.join('')}\n`;
  return parts.join('');
}

export function isJiraBugType(issueType: string): boolean {
  const t = issueType.trim().toLowerCase();
  return (
    t === 'bug' ||
    t === 'defect' ||
    t === 'fault' ||
    t.includes('bug') ||
    t.includes('defect')
  );
}

export function isJiraEpicType(issueType: string): boolean {
  const t = issueType.trim().toLowerCase();
  return t === 'epic' || t === 'feature' || t.includes('epic');
}

export function parseJiraConnectionConfig(
  raw: unknown,
): JiraConnectionConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const baseUrl =
    typeof o.baseUrl === 'string' ? normalizeJiraSiteUrl(o.baseUrl) : null;
  const email = typeof o.email === 'string' ? o.email.trim().toLowerCase() : '';
  const apiToken =
    typeof o.apiToken === 'string' ? normalizeJiraApiToken(o.apiToken) : '';
  const projectKey =
    typeof o.projectKey === 'string'
      ? normalizeJiraProjectKey(o.projectKey)
      : null;
  const issueType =
    typeof o.issueType === 'string' && o.issueType.trim()
      ? o.issueType.trim()
      : 'Bug';
  const cloudId =
    typeof o.cloudId === 'string' && o.cloudId.trim()
      ? o.cloudId.trim()
      : undefined;
  const authMode: JiraAuthMode | undefined =
    o.authMode === 'bearer' || o.authMode === 'basic' ? o.authMode : undefined;
  if (!baseUrl || !email || !apiToken || !projectKey) return null;
  return {
    baseUrl,
    email,
    apiToken,
    projectKey,
    issueType,
    cloudId,
    authMode,
  };
}

function browseUrl(config: JiraConnectionConfig, key: string): string {
  return `${normalizeBaseUrl(config.baseUrl)}/browse/${key}`;
}

function mapIssue(
  config: JiraConnectionConfig,
  raw: Record<string, unknown>,
): JiraTicketCandidate | null {
  const key = typeof raw.key === 'string' ? raw.key : '';
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!key) return null;
  const fields =
    raw.fields && typeof raw.fields === 'object'
      ? (raw.fields as Record<string, unknown>)
      : {};
  const issueTypeObj =
    fields.issuetype && typeof fields.issuetype === 'object'
      ? (fields.issuetype as { name?: string })
      : {};
  const statusObj =
    fields.status && typeof fields.status === 'object'
      ? (fields.status as { name?: string })
      : {};
  const issueType = String(issueTypeObj.name ?? 'Task');
  const parent =
    fields.parent && typeof fields.parent === 'object'
      ? (fields.parent as { key?: string })
      : null;
  const epicLink =
    typeof fields.customfield_10014 === 'string'
      ? fields.customfield_10014
      : null;
  const parentKey = parent?.key ?? null;
  const isEpic = isJiraEpicType(issueType);
  const epicKey = isEpic ? key : epicLink;
  const isBug = isJiraBugType(issueType);
  return {
    key,
    id,
    summary: String(fields.summary ?? key).trim() || key,
    description: adfToPlainText(fields.description).trim(),
    issueType,
    status: String(statusObj.name ?? ''),
    parentKey,
    epicKey,
    url: browseUrl(config, key),
    isBug,
    selectable: !isBug,
  };
}

async function jiraSearch(
  config: JiraConnectionConfig,
  jql: string,
  maxResults = 50,
): Promise<JiraTicketCandidate[]> {
  const res = await jiraApiFetch(config, '/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({
      jql,
      maxResults: Math.min(Math.max(maxResults, 1), 50),
      fields: ISSUE_FIELD_LIST,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira search failed (${res.status}): ${text.slice(0, 240)}`);
  }
  const data = (await res.json()) as { issues?: Record<string, unknown>[] };
  const out: JiraTicketCandidate[] = [];
  const seen = new Set<string>();
  for (const issue of data.issues ?? []) {
    const mapped = mapIssue(config, issue);
    if (!mapped || seen.has(mapped.key)) continue;
    seen.add(mapped.key);
    out.push(mapped);
  }
  return out;
}

/** Recent non-bug issues in the connected project. */
export async function browseJiraProjectIssues(
  config: JiraConnectionConfig,
  maxResults = 50,
): Promise<JiraTicketCandidate[]> {
  const jql = `project = "${config.projectKey}" AND issuetype not in (Bug, Defect) ORDER BY updated DESC`;
  return jiraSearch(config, jql, maxResults);
}

/** Prompt → bounded text search in connected project. */
export async function searchJiraIssuesByPrompt(
  config: JiraConnectionConfig,
  prompt: string,
  maxResults = 50,
): Promise<JiraTicketCandidate[]> {
  const tokens = prompt
    .toLowerCase()
    .split(/\W+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2)
    .slice(0, 8);
  if (!tokens.length) {
    return browseJiraProjectIssues(config, maxResults);
  }
  const textClause = tokens
    .map((t) => `text ~ "${t.replace(/"/g, '\\"')}"`)
    .join(' OR ');
  const jql = `project = "${config.projectKey}" AND issuetype not in (Bug, Defect) AND (${textClause}) ORDER BY updated DESC`;
  try {
    return await jiraSearch(config, jql, maxResults);
  } catch {
    const summaryClause = tokens
      .map((t) => `summary ~ "${t.replace(/"/g, '\\"')}"`)
      .join(' OR ');
    return jiraSearch(
      config,
      `project = "${config.projectKey}" AND issuetype not in (Bug, Defect) AND (${summaryClause}) ORDER BY updated DESC`,
      maxResults,
    );
  }
}

/** Fetch exact keys (includes bugs so UI can mark them unselectable). */
export async function fetchJiraIssuesByKeys(
  config: JiraConnectionConfig,
  keys: string[],
): Promise<JiraTicketCandidate[]> {
  const cleaned = [
    ...new Set(
      keys
        .map((k) => k.trim().toUpperCase())
        .filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/i.test(k)),
    ),
  ].slice(0, 50);
  if (!cleaned.length) return [];
  const list = cleaned.map((k) => `"${k}"`).join(', ');
  return jiraSearch(config, `key in (${list}) ORDER BY key ASC`, cleaned.length);
}

/** Expand Epic/Feature: epic + children + sub-tasks. */
export async function expandJiraEpic(
  config: JiraConnectionConfig,
  epicKey: string,
): Promise<JiraTicketCandidate[]> {
  const key = epicKey.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]+-\d+$/i.test(key)) {
    throw new Error('Invalid Epic key');
  }
  const roots = await fetchJiraIssuesByKeys(config, [key]);
  const epic = roots[0];
  if (!epic) throw new Error(`Epic ${key} not found`);

  let children: JiraTicketCandidate[] = [];
  try {
    children = await jiraSearch(
      config,
      `project = "${config.projectKey}" AND (parent = ${key} OR "Epic Link" = ${key}) ORDER BY key ASC`,
      50,
    );
  } catch {
    children = await jiraSearch(
      config,
      `project = "${config.projectKey}" AND parent = ${key} ORDER BY key ASC`,
      50,
    );
  }

  const parentKeys = children.map((c) => c.key);
  let subtasks: JiraTicketCandidate[] = [];
  if (parentKeys.length) {
    const inList = parentKeys.map((k) => `"${k}"`).join(', ');
    try {
      subtasks = await jiraSearch(
        config,
        `project = "${config.projectKey}" AND parent in (${inList}) ORDER BY key ASC`,
        50,
      );
    } catch {
      subtasks = [];
    }
  }

  const byKey = new Map<string, JiraTicketCandidate>();
  for (const row of [epic, ...children, ...subtasks]) {
    byKey.set(row.key, row);
  }
  return [...byKey.values()];
}

export async function createJiraIssue(
  config: JiraConnectionConfig,
  input: JiraIssueInput,
): Promise<JiraIssueResult> {
  const res = await jiraApiFetch(config, '/rest/api/3/issue', {
    method: 'POST',
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
    url: `${siteOrigin(config)}/browse/${data.key}`,
  };
}

export async function verifyJiraConnection(
  config: JiraConnectionConfig,
): Promise<{
  ok: true;
  accountId?: string;
  cloudId?: string;
  authMode: JiraAuthMode;
}> {
  let accountId: string | undefined;
  const me = await jiraApiFetch(config, '/rest/api/3/myself');
  if (me.ok) {
    const meJson = (await me.json()) as { accountId?: string };
    accountId = meJson.accountId;
  }

  const project = await jiraApiFetch(
    config,
    `/rest/api/3/project/${encodeURIComponent(config.projectKey)}`,
  );
  if (project.ok) {
    return {
      ok: true,
      accountId,
      cloudId: config.cloudId,
      authMode: config.authMode ?? 'basic',
    };
  }
  if (isAuthFailure(project) || (project.status >= 300 && project.status < 400)) {
    throw new Error(
      `Jira still returned ${project.status} for project ${config.projectKey}. Create a classic API token (not only scoped), or a scoped token that includes read:jira-work. Email must match the Atlassian account that created the token.`,
    );
  }
  const text = await project.text().catch(() => '');
  throw new Error(
    `Jira project ${config.projectKey} not found (${project.status}): ${text.slice(0, 160)}`,
  );
}
