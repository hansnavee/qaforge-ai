import { api } from './api';

export type OrgSummary = {
  id: string;
  name: string;
  role?: string;
};

const STORAGE_KEY = 'qaforge.orgId';

let cachedOrgId: string | null = null;
let inflight: Promise<string> | null = null;

function readStoredOrgId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

export function setSelectedOrgId(orgId: string) {
  cachedOrgId = orgId;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, orgId);
  } catch {
    /* private mode / blocked storage */
  }
}

export function orgWorkspacePath(orgId: string) {
  return `/app/orgs/${orgId}/workspace`;
}

export function pickOrg(orgs: OrgSummary[]): OrgSummary | undefined {
  if (orgs.length === 0) return undefined;
  const stored = readStoredOrgId();
  return (stored ? orgs.find((o) => o.id === stored) : undefined) ?? orgs[0];
}

/** One org → its Workspace. Zero or many → org picker. */
export function pathAfterOrgs(orgs: OrgSummary[]): string {
  if (orgs.length === 1) {
    setSelectedOrgId(orgs[0].id);
    return orgWorkspacePath(orgs[0].id);
  }
  return '/app/orgs';
}

/** Selected org for the signed-in user (localStorage, then first org). */
export async function getDefaultOrgId(): Promise<string> {
  if (cachedOrgId) return cachedOrgId;
  if (inflight) return inflight;

  inflight = (async () => {
    const orgs = await api<OrgSummary[]>('/api/v1/orgs');
    const list = Array.isArray(orgs) ? orgs : [];
    const chosen = pickOrg(list);
    if (!chosen) {
      throw new Error('No organization found for this account');
    }
    setSelectedOrgId(chosen.id);
    return chosen.id;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

export function clearOrgCache() {
  cachedOrgId = null;
}
