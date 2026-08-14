'use client';

import { useQuery } from '@tanstack/react-query';
import { roleLabel, tcmsCapabilities } from '@qaforge/shared';
import { api } from './api';
import { pickOrg, type OrgSummary } from './org';

export function useOrgCaps() {
  const query = useQuery({
    queryKey: ['orgs'],
    queryFn: () => api<OrgSummary[]>('/api/v1/orgs'),
  });
  const org = Array.isArray(query.data) ? pickOrg(query.data) : undefined;
  return {
    ...query,
    org,
    caps: tcmsCapabilities(org?.role),
    roleLabel: roleLabel(org?.role ?? 'VIEWER'),
  };
}
