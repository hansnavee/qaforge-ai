'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { api } from '@/lib/api';

type Project = { id: string; name: string };

/** Global Test Cases nav → pick a project (Phase 1 lives on the project). */
export default function TestCasesRedirectPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['projects-for-redirect'],
    queryFn: () => api<Project[]>('/api/v1/projects'),
  });

  const projects = data ?? [];

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Test Board</h1>
      <p className="text-sm text-muted">
        Test cases are scoped to each project. Open a project to manage cases.
      </p>
      <Card className="space-y-2">
        {isLoading ? <p className="text-sm text-muted">Loading…</p> : null}
        {!isLoading && projects.length === 0 ? (
          <Link href="/app/projects/new">
            <Button size="sm">Create a project</Button>
          </Link>
        ) : null}
        {projects.map((p) => (
          <Link
            key={p.id}
            href={`/app/projects/${p.id}?tab=cases`}
            className="block rounded-lg border border-border px-3 py-2 text-sm hover:border-accent/40"
          >
            {p.name}
          </Link>
        ))}
      </Card>
    </div>
  );
}
