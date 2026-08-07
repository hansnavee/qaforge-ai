import { api } from './api';

export type OrgSummary = {
  id: string;
  name: string;
  role?: string;
};

let cachedOrgId: string | null = null;
let inflight: Promise<string> | null = null;

/** First org for the signed-in user (cached for the session). */
export async function getDefaultOrgId(): Promise<string> {
  if (cachedOrgId) return cachedOrgId;
  if (inflight) return inflight;

  inflight = (async () => {
    const orgs = await api<OrgSummary[]>('/api/v1/orgs');
    const first = Array.isArray(orgs) ? orgs[0] : undefined;
    if (!first) {
      throw new Error('No organization found for this account');
    }
    cachedOrgId = first.id;
    return cachedOrgId;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

export function clearOrgCache() {
  cachedOrgId = null;
}
