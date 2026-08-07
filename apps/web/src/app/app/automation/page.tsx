'use client';

import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { api, ApiError } from '@/lib/api';

type AutomationManifest = {
  executionId?: string;
  framework?: string;
  language?: string;
  files?: string[];
  baseUrl?: string;
};

export default function AutomationPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['automation'],
    queryFn: async () => {
      try {
        return await api<
          AutomationManifest | { items: AutomationManifest[] }
        >('/api/v1/automation');
      } catch (e) {
        if (e instanceof ApiError) return null;
        throw e;
      }
    },
  });

  const manifests: AutomationManifest[] = Array.isArray(data)
    ? data
    : data && 'items' in data
      ? data.items
      : data
        ? [data]
        : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Automation</h1>
        <p className="mt-1 text-sm text-muted">
          Generated Playwright POM frameworks ready to push.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : manifests.length === 0 ? (
        <Card className="border-dashed">
          <h2 className="font-medium">No frameworks generated</h2>
          <p className="mt-1 text-sm text-muted">
            Complete an execution through the automation phase to see files here.
          </p>
        </Card>
      ) : (
        manifests.map((m, i) => (
          <Card key={m.executionId ?? i}>
            <div className="flex flex-wrap gap-2">
              {m.framework ? <Badge tone="accent">{m.framework}</Badge> : null}
              {m.language ? <Badge>{m.language}</Badge> : null}
            </div>
            <p className="mt-3 font-mono text-xs text-muted">
              {m.baseUrl ?? m.executionId ?? 'Framework package'}
            </p>
            <ul className="mt-4 max-h-64 space-y-1 overflow-auto font-mono text-xs text-muted">
              {(m.files ?? []).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
