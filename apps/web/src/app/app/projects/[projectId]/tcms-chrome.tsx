'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Badge } from '@/components/Badge';
import { cn } from '@/lib/cn';
import { useOrgCaps } from '@/lib/use-org';

export const TCMS_TABS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'cases', label: 'Cases' },
  { id: 'runs', label: 'Runs' },
  { id: 'results', label: 'Results' },
  { id: 'reports', label: 'Reports' },
  { id: 'automation', label: 'Automation' },
  { id: 'automation-results', label: 'Automation Results' },
] as const;

export type TcmsTabId = (typeof TCMS_TABS)[number]['id'];

export function TcmsProjectChrome({
  projectId,
  projectName,
  description,
  active,
  crumb,
  children,
}: {
  projectId: string;
  projectName: string;
  description?: string | null;
  active: TcmsTabId;
  crumb?: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  const { roleLabel } = useOrgCaps();

  return (
    <div className="space-y-5">
      <header>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Link href="/app/projects" className="hover:text-fg">
            Projects
          </Link>
          <span>/</span>
          <Link
            href={`/app/projects/${projectId}?tab=workspace`}
            className="hover:text-fg"
          >
            {projectName}
          </Link>
          {crumb ? (
            <>
              <span>/</span>
              <span className="text-fg">{crumb}</span>
            </>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {projectName}
          </h1>
          <Badge>{roleLabel}</Badge>
        </div>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>
        ) : null}
      </header>

      <nav className="flex gap-1 border-b border-border">
        {TCMS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() =>
              router.push(`/app/projects/${projectId}?tab=${t.id}`)
            }
            className={cn(
              '-mb-px border-b-2 px-3.5 py-2.5 text-sm transition',
              active === t.id
                ? 'border-accent font-medium text-fg'
                : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {children}
    </div>
  );
}
