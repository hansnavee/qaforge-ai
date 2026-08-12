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
  const planExempt = Boolean(query.data?.planExempt);

  return {
    ...query,
    orgId: org?.id,
    plan,
    planExempt,
    features,
    billing: query.data,
    isFree: plan === 'FREE' && !planExempt,
    isPro: plan === 'PRO' || plan === 'ENTERPRISE' || planExempt,
    canCloudRunner: Boolean(features?.cloudRunner) || planExempt,
    canRuleHealer: Boolean(features?.ruleHealer) || planExempt,
    canLlmHealer: Boolean(features?.llmHealer) || planExempt,
    canExportsHtml: Boolean(features?.exportsHtml) || planExempt,
    canEmailNotify: Boolean(features?.emailNotify) || planExempt,
    canQaAgent: Boolean(features?.qaAgentFull) || planExempt,
  };
}
