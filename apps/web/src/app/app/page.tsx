'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { pathAfterOrgs, type OrgSummary } from '@/lib/org';

export default function AppIndex() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const orgs = await api<OrgSummary[]>('/api/v1/orgs');
        if (cancelled) return;
        router.replace(pathAfterOrgs(Array.isArray(orgs) ? orgs : []));
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login');
          return;
        }
        router.replace('/app/orgs');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return <p className="text-sm text-muted">Opening workspace…</p>;
}
