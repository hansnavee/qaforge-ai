'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { api, ApiError } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';

type ReportRow = {
  id: string;
  executionId?: string;
  status?: string;
  projectName?: string;
  createdAt?: string;
};

export default function ReportsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['reports'],
    queryFn: async () => {
      try {
        const orgId = await getDefaultOrgId();
        return await api<ReportRow[]>(`/api/v1/orgs/${orgId}/reports`);
      } catch (e) {
        if (e instanceof ApiError) return [] as ReportRow[];
        throw e;
      }
    },
  });

  const items = Array.isArray(data) ? data : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-1 text-sm text-muted">
          Executive HTML reports from completed executions.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <Card className="border-dashed">
          <h2 className="font-medium">No reports yet</h2>
          <p className="mt-1 text-sm text-muted">
            Reports appear after an execution reaches the report phase.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((r) => {
            const id = r.executionId ?? r.id;
            return (
              <Link key={id} href={`/app/reports/${id}`}>
                <Card className="hover:border-accent/40">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">
                        {r.projectName ?? `Execution ${id}`}
                      </div>
                      <div className="mt-1 font-mono text-xs text-muted">
                        {id}
                      </div>
                    </div>
                    {r.status ? <Badge tone="success">{r.status}</Badge> : null}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
