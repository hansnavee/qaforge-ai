'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { BillingSummary } from './plan';
import { useOrgCaps } from './use-org';

export function usePlan() {
  const { org } = useOrgCaps();
  const query = useQuery({
    queryKey: ['billing', org?.id],
    enabled: Boolean(org?.id),
    queryFn: () =>
      api<BillingSummary>(`/api/v1/orgs/${org!.id}/billing`),
    staleTime: 60_000,
  });

  const features = query.data?.features;
  const plan = query.data?.plan ?? 'FREE';

  return {
    ...query,
    orgId: org?.id,
    plan,
    features,
    billing: query.data,
    isFree: plan === 'FREE',
    isPro: plan === 'PRO' || plan === 'ENTERPRISE',
    canCloudRunner: Boolean(features?.cloudRunner),
    canRuleHealer: Boolean(features?.ruleHealer),
    canLlmHealer: Boolean(features?.llmHealer),
    canExportsHtml: Boolean(features?.exportsHtml),
    canEmailNotify: Boolean(features?.emailNotify),
    canQaAgent: Boolean(features?.qaAgentFull),
  };
}
