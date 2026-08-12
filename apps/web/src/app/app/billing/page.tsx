'use client';

import { useMutation } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Progress } from '@/components/Progress';
import { api, API_URL } from '@/lib/api';
import {
  formatMeter,
  meterLabel,
  planDisplayName,
  type BillingSummary,
} from '@/lib/plan';
import { useOrgCaps } from '@/lib/use-org';
import type { UsageEventType } from '@qaforge/shared';

const METER_ORDER: UsageEventType[] = [
  'EXECUTION',
  'TCMS_RUN',
  'AI_GENERATE',
  'AI_PLAN_RUN',
  'AI_EXECUTOR_CASE',
  'SCRIPT_REPLAY',
  'LLM_HEAL',
];

export default function BillingPage() {
  const { caps, org } = useOrgCaps();
  const { data, refetch, isLoading } = useQuery({
    queryKey: ['billing', org?.id],
    enabled: Boolean(org?.id),
    queryFn: () => api<BillingSummary>(`/api/v1/orgs/${org!.id}/billing`),
  });

  const checkout = useMutation({
    mutationFn: (plan: 'PRO' | 'ENTERPRISE') =>
      api<{ url?: string; contactSales?: boolean }>('/api/v1/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ orgId: org!.id, plan }),
      }),
    onSuccess: (res) => {
      if (res.url) window.location.href = res.url;
    },
  });

  const plan = data?.plan ?? 'FREE';
  const status = data?.status ?? 'active';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted">
          Plan, usage meters, and subscription management.
        </p>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">{planDisplayName(plan)}</div>
            <p className="text-sm text-muted">Current subscription</p>
          </div>
          <Badge tone="accent">{status}</Badge>
        </div>

        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-md border border-border px-3 py-2">
            <div className="text-muted">Projects</div>
            <div className="font-medium">
              {data?.projects.used ?? 0}
              {data && data.projects.limit >= 0
                ? ` / ${data.projects.limit}`
                : ' / unlimited'}
            </div>
          </div>
          <div className="rounded-md border border-border px-3 py-2">
            <div className="text-muted">Seats</div>
            <div className="font-medium">
              {data?.seats.used ?? 0}
              {data && data.seats.limit >= 0
                ? ` / ${data.seats.limit}`
                : ' / unlimited'}
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted">Loading usage…</p>
          ) : (
            METER_ORDER.map((type) => {
              const meter = data?.usage?.[type];
              if (!meter) return null;
              const pct =
                meter.unlimited || meter.limit <= 0
                  ? meter.used > 0
                    ? 50
                    : 0
                  : (meter.used / meter.limit) * 100;
              return (
                <div key={type}>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-muted">{meterLabel(type)}</span>
                    <span className={meter.warning ? 'text-amber-600' : ''}>
                      {formatMeter(meter)}
                    </span>
                  </div>
                  {!meter.unlimited && meter.limit > 0 ? (
                    <Progress value={Math.min(pct, 100)} />
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {plan === 'FREE' && caps.canManageBilling ? (
            <Button
              disabled={checkout.isPending}
              onClick={() => checkout.mutate('PRO')}
            >
              Upgrade to Pro
            </Button>
          ) : null}
          {plan !== 'ENTERPRISE' && caps.canManageBilling ? (
            <Button
              variant="secondary"
              disabled={checkout.isPending}
              onClick={() => checkout.mutate('ENTERPRISE')}
            >
              Contact Enterprise
            </Button>
          ) : null}
          {caps.canManageBilling ? (
            <a
              href={`${API_URL}/api/v1/billing/portal?orgId=${org?.id ?? ''}`}
              className="inline-block"
            >
              <Button variant="secondary">Open customer portal</Button>
            </a>
          ) : (
            <p className="text-sm text-muted">
              Only the organization owner can change the plan.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">Plan comparison</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2 pr-4">Feature</th>
                <th className="py-2 pr-4">Free</th>
                <th className="py-2 pr-4">Pro</th>
                <th className="py-2">Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Script replay', '50/mo', 'Unlimited', 'Unlimited'],
                ['AI generate', '3/mo', '50/mo', 'Unlimited'],
                ['Rule healer', '—', 'Yes', 'Yes'],
                ['Cloud runner', '—', 'Yes', 'Yes'],
                ['Jira / Slack', '—', '—', 'Yes'],
              ].map(([feature, free, pro, ent]) => (
                <tr key={feature} className="border-b border-border/60">
                  <td className="py-2 pr-4">{feature}</td>
                  <td className="py-2 pr-4 text-muted">{free}</td>
                  <td className="py-2 pr-4">{pro}</td>
                  <td className="py-2">{ent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">
          Usage resets on the first day of each UTC month.{' '}
          <Link href="/app/billing" className="underline" onClick={() => refetch()}>
            Refresh
          </Link>
        </p>
      </Card>
    </div>
  );
}
