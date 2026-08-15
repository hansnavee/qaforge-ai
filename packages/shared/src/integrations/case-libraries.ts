import type { LibraryCase } from '../test-design/ai-orchestrate.js';

export async function listXrayLibraryCases(cfg: {
  clientId: string;
  clientSecret: string;
}): Promise<LibraryCase[]> {
  try {
    const tokenRes = await fetch(
      'https://xray.cloud.getxray.app/api/v2/authenticate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!tokenRes.ok) return [];
    const token = (await tokenRes.text()).replace(/"/g, '');
    const gql = await fetch('https://xray.cloud.getxray.app/api/v2/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query:
          '{ getTests(limit: 50) { results { issueId jira(fields: ["summary","key"]) } } }',
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!gql.ok) return [];
    const data = (await gql.json()) as {
      data?: {
        getTests?: {
          results?: Array<{
            issueId?: string;
            jira?: { summary?: string; key?: string };
          }>;
        };
      };
    };
    return (data.data?.getTests?.results ?? []).map((row, i) => ({
      id: `xray:${row.issueId ?? i}`,
      scenario: String(row.jira?.summary ?? row.issueId ?? `Xray ${i}`),
      requirementKey: row.jira?.key ?? null,
      source: 'xray' as const,
      steps: [],
      expected: '',
    }));
  } catch {
    return [];
  }
}

export async function listTestrailLibraryCases(cfg: {
  baseUrl: string;
  email: string;
  apiKey: string;
  projectId: string;
}): Promise<LibraryCase[]> {
  try {
    const origin = cfg.baseUrl.replace(/\/+$/, '');
    const bytes = new TextEncoder().encode(`${cfg.email}:${cfg.apiKey}`);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const auth = btoa(binary);
    const res = await fetch(
      `${origin}/index.php?/api/v2/get_cases/${encodeURIComponent(cfg.projectId)}`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as
      | Array<{ id?: number; title?: string }>
      | { cases?: Array<{ id?: number; title?: string }> };
    const rows = Array.isArray(data) ? data : data.cases ?? [];
    return rows.slice(0, 80).map((row) => ({
      id: `testrail:${row.id}`,
      scenario: String(row.title ?? row.id),
      source: 'testrail' as const,
      steps: [],
      expected: '',
    }));
  } catch {
    return [];
  }
}
