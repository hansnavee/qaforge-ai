'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { api, ApiError } from '@/lib/api';
import { setSelectedOrgId, type OrgSummary } from '@/lib/org';

type OrgDetail = {
  id: string;
  name: string;
  browserstackConfigured?: boolean;
  jiraConfigured?: boolean;
  jira?: {
    baseUrl: string;
    email: string;
    projectKey: string;
    issueType: string;
  } | null;
};

export default function OrgWorkspacePage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const router = useRouter();

  const query = useQuery({
    queryKey: ['orgs'],
    queryFn: async () => {
      try {
        return await api<OrgSummary[]>('/api/v1/orgs');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login');
          return [];
        }
        throw e;
      }
    },
  });

  const orgs = Array.isArray(query.data) ? query.data : [];
  const org = orgs.find((o) => o.id === orgId);

  const detailQuery = useQuery({
    queryKey: ['org', orgId],
    enabled: Boolean(orgId && org),
    queryFn: () => api<OrgDetail>(`/api/v1/orgs/${orgId}`),
  });

  useEffect(() => {
    if (org) setSelectedOrgId(org.id);
  }, [org]);

  useEffect(() => {
    if (!query.isLoading && query.data && !org) {
      router.replace('/app/orgs');
    }
  }, [query.isLoading, query.data, org, router]);

  const jiraOn = Boolean(detailQuery.data?.jiraConfigured);
  const bsOn = Boolean(detailQuery.data?.browserstackConfigured);
  const jiraMeta = detailQuery.data?.jira;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
        <p className="mt-1 text-sm text-muted">
          {org
            ? `${org.name} — connect tools here. Import and runs stay a human step.`
            : 'Connect tools here. Import and runs stay a human step.'}
        </p>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted">Loading workspace…</p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Tools
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">Jira</div>
                <p className="mt-1 text-xs text-muted">
                  Source of tickets. Connecting does not import anything.
                </p>
              </div>
              <Badge tone={jiraOn ? 'success' : 'default'}>
                {jiraOn ? 'Connected' : 'Not connected'}
              </Badge>
            </div>
            {jiraOn && jiraMeta ? (
              <p className="font-mono text-[11px] text-muted">
                {jiraMeta.projectKey} @ {jiraMeta.baseUrl}
              </p>
            ) : null}
            <Link href="/app/settings#jira">
              <Button size="sm" variant={jiraOn ? 'secondary' : 'primary'}>
                {jiraOn ? 'Settings' : 'Connect in Settings'}
              </Button>
            </Link>
          </Card>

          <Card className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">BrowserStack</div>
                <p className="mt-1 text-xs text-muted">
                  Cloud execution. Keys stay in Settings.
                </p>
              </div>
              <Badge tone={bsOn ? 'success' : 'default'}>
                {bsOn ? 'Connected' : 'Not connected'}
              </Badge>
            </div>
            <Link href="/app/settings#browserstack">
              <Button size="sm" variant={bsOn ? 'secondary' : 'primary'}>
                {bsOn ? 'Settings' : 'Connect in Settings'}
              </Button>
            </Link>
          </Card>
        </div>
      </section>

      <Card>
        <p className="text-sm text-muted">
          Next: pick a project for this cycle, then import tickets, generate
          cases, and run.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/app/projects">
            <Button size="sm">Projects</Button>
          </Link>
          <Link href="/app/orgs">
            <Button size="sm" variant="secondary">
              Organizations
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
