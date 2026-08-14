'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { api, ApiError } from '@/lib/api';
import { setSelectedOrgId, type OrgSummary } from '@/lib/org';

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

  useEffect(() => {
    if (org) setSelectedOrgId(org.id);
  }, [org]);

  useEffect(() => {
    if (!query.isLoading && query.data && !org) {
      router.replace('/app/orgs');
    }
  }, [query.isLoading, query.data, org, router]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
        <p className="mt-1 text-sm text-muted">
          {org
            ? `${org.name} - this org desk. Tools and the AI agent come next.`
            : 'This org desk. Tools and the AI agent come next.'}
        </p>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted">Loading workspace…</p>
      ) : null}

      <Card>
        <p className="text-sm text-muted">
          Pick a project to continue. Jira import, the AI QA Engineer, and
          BrowserStack run will land here in later steps.
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
