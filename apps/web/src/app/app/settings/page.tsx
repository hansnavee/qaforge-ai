'use client';

import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { api, ApiError } from '@/lib/api';

export default function SettingsPage() {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      try {
        return await api<{
          organization?: { name?: string; slug?: string };
          user?: { name?: string; email?: string };
        }>('/api/v1/settings');
      } catch (e) {
        if (e instanceof ApiError) return null;
        throw e;
      }
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Organization and account preferences.
        </p>
      </div>

      <Card className="space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">
            Organization
          </div>
          <div className="mt-1 font-medium">
            {data?.organization?.name ?? '—'}
          </div>
          <div className="font-mono text-xs text-muted">
            {data?.organization?.slug ?? 'Connect API to load org'}
          </div>
        </div>
        <div className="border-t border-border pt-4">
          <div className="text-xs uppercase tracking-wide text-muted">
            Signed-in user
          </div>
          <div className="mt-1 font-medium">{data?.user?.name ?? '—'}</div>
          <div className="text-sm text-muted">
            {data?.user?.email ?? 'Session not loaded'}
          </div>
        </div>
      </Card>
    </div>
  );
}
