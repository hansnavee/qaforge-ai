'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { roleLabel } from '@qaforge/shared';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { api, ApiError } from '@/lib/api';
import {
  orgWorkspacePath,
  pickOrg,
  setSelectedOrgId,
  type OrgSummary,
} from '@/lib/org';

export default function OrganizationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [orgName, setOrgName] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
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
  const selected = pickOrg(orgs);

  function enterOrg(org: OrgSummary) {
    setSelectedOrgId(org.id);
    void queryClient.invalidateQueries({ queryKey: ['orgs'] });
    router.push(orgWorkspacePath(org.id));
  }

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    const name = orgName.trim();
    if (name.length < 2) {
      setFormError('Organization name must be at least 2 characters.');
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      const org = await api<{ id: string; name: string }>('/api/v1/orgs', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setSelectedOrgId(org.id);
      setOrgName('');
      await queryClient.invalidateQueries({ queryKey: ['orgs'] });
      router.push(orgWorkspacePath(org.id));
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'Could not create organization.',
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Organizations
        </h1>
        <p className="mt-1 text-sm text-muted">
          Pick the company to work in, or create one. Workspace for that org
          comes next.
        </p>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted">Loading organizations…</p>
      ) : null}

      {query.error ? (
        <p className="text-sm text-danger">
          {query.error instanceof ApiError
            ? query.error.message
            : 'Could not load organizations.'}
        </p>
      ) : null}

      {!query.isLoading && orgs.length === 0 ? (
        <Card>
          <h2 className="font-medium">Create your organization</h2>
          <p className="mt-1 text-sm text-muted">
            This account is not in an organization yet.
          </p>
          <form className="mt-4 space-y-3" onSubmit={(e) => void createOrg(e)}>
            <Input
              label="Organization name"
              name="organizationName"
              required
              minLength={2}
              placeholder="Acme QA"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
            {formError ? (
              <p className="text-sm text-danger">{formError}</p>
            ) : null}
            <Button type="submit" size="sm" disabled={creating}>
              {creating ? 'Creating…' : 'Create organization'}
            </Button>
          </form>
        </Card>
      ) : (
        <div className="grid gap-2">
          {orgs.map((org) => {
            const isCurrent = org.id === selected?.id;
            return (
              <Card key={org.id} className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{org.name}</span>
                      {isCurrent ? <Badge tone="accent">Current</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {roleLabel(org.role ?? 'VIEWER')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={isCurrent ? 'secondary' : 'primary'}
                    onClick={() => enterOrg(org)}
                  >
                    {isCurrent ? 'Continue' : 'Select'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
