/**
 * Jira Cloud REST helpers for dual-write defects + requirements import.
 * TCMS remains canonical; Jira is an optional external provider.
 */

export type JiraConnectionConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  /** Defaults to Bug (for defect create) */
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

function jiraHeaders(config: JiraConnectionConfig): Record<string, string> {
  return {
    Authorization: authHeader(config.email, config.apiToken),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
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
  const email = typeof o.email === 'string' ? o.email.trim() : '';
  const apiToken =
    typeof o.apiToken === 'string'
      ? o.apiToken.trim().replace(/^["']|["']$/g, '')
      : '';
  const projectKey =
    typeof o.projectKey === 'string'
      ? normalizeJiraProjectKey(o.projectKey)
      : null;
  const issueType =
    typeof o.issueType === 'string' && o.issueType.trim()
      ? o.issueType.trim()
      : 'Bug';
  if (!baseUrl || !email || !apiToken || !projectKey) return null;
  return {
    baseUrl,
    email,
    apiToken,
    projectKey,
    issueType,
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
  const base = normalizeBaseUrl(config.baseUrl);
  const res = await fetch(`${base}/rest/api/3/search`, {
    method: 'POST',
    headers: jiraHeaders(config),
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
  const base = normalizeBaseUrl(config.baseUrl);
  const res = await fetch(`${base}/rest/api/3/issue`, {
    method: 'POST',
    headers: jiraHeaders(config),
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
