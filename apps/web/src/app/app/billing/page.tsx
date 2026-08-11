'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Progress } from '@/components/Progress';
import { api, ApiError, API_URL } from '@/lib/api';
import { useOrgCaps } from '@/lib/use-org';

type Billing = {
  plan?: string;
  status?: string;
  usage?: { used?: number; limit?: number };
  portalUrl?: string;
};

export default function BillingPage() {
  const { caps } = useOrgCaps();
  const { data } = useQuery({
    queryKey: ['billing'],
    queryFn: async () => {
      try {
        return await api<Billing>('/api/v1/billing');
      } catch (e) {
        if (e instanceof ApiError) {
          return {
            plan: 'FREE',
            status: 'active',
            usage: { used: 0, limit: 5 },
          } satisfies Billing;
        }
        throw e;
      }
    },
  });

  const used = data?.usage?.used ?? 0;
  const limit = data?.usage?.limit ?? 5;
  const pct = limit > 0 ? (used / limit) * 100 : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted">Plan, usage, and invoices.</p>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">{data?.plan ?? 'FREE'}</div>
            <p className="text-sm text-muted">Current subscription</p>
          </div>
          <Badge tone="accent">{data?.status ?? 'active'}</Badge>
        </div>
        <div className="mt-6">
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-muted">Runs this period</span>
            <span>
              {used} / {limit}
            </span>
          </div>
          <Progress value={pct} />
        </div>
        {caps.canManageBilling ? (
          <a
            href={data?.portalUrl ?? `${API_URL}/api/v1/billing/portal`}
            className="mt-6 inline-block"
          >
            <Button variant="secondary">Open customer portal</Button>
          </a>
        ) : (
          <p className="mt-6 text-sm text-muted">
            Only the organization owner can change the plan.
          </p>
        )}
      </Card>
    </div>
  );
}
