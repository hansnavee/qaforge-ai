'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { STLC_PHASES } from '@qaforge/shared';
import { cn } from '@/lib/cn';
import { SHOW_AI_STLC_UI } from '@/lib/product-flags';
import { useOrgCaps } from '@/lib/use-org';
import { orgWorkspacePath } from '@/lib/org';
import { ThemeToggle } from './ThemeToggle';

const TCMS_TABS = [
  { id: 'cases', label: 'Cases' },
  { id: 'runs', label: 'Runs' },
  { id: 'results', label: 'Results' },
  { id: 'reports', label: 'Reports' },
  { id: 'automation', label: 'Automation' },
  { id: 'automation-results', label: 'Automation Results' },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { org } = useOrgCaps();
  const workspaceHref = org ? orgWorkspacePath(org.id) : '/app/orgs';
  const onProjects =
    pathname === '/app/projects' || pathname === '/app' || pathname === '/app/';
  const projectMatch = pathname.match(/^\/app\/projects\/([^/]+)/);
  const projectId =
    projectMatch && projectMatch[1] !== 'new' ? projectMatch[1] : null;
  const onRunPage = Boolean(projectId && pathname.includes('/runs/'));
  const tab =
    searchParams.get('tab') ?? (SHOW_AI_STLC_UI ? 'overview' : 'cases');
  const phaseParam = (searchParams.get('phase') ?? '').toUpperCase();
  const onSettings = pathname.startsWith('/app/settings');
  const onBilling = pathname.startsWith('/app/billing');
  const onWorkspace = pathname.includes('/workspace');
  const onOrgs = pathname.startsWith('/app/orgs') && !onWorkspace;

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border bg-bg-elevated/60 px-3 py-3 md:w-56 md:border-b-0 md:border-r md:py-4">
      <Link href={workspaceHref} className="mb-3 px-2 md:mb-6">
        <div className="text-sm font-semibold tracking-tight text-fg">
          QAForge
        </div>
        <div className="hidden text-[11px] text-muted md:block">
          {SHOW_AI_STLC_UI ? 'AI QA Engineer' : 'Test case management'}
        </div>
      </Link>

      <nav className="flex flex-row gap-1 overflow-x-auto md:flex-1 md:flex-col md:overflow-visible">
        <Link
          href={workspaceHref}
          className={cn(
            'whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition',
            onWorkspace
              ? 'bg-accent/10 text-accent'
              : 'text-muted hover:bg-surface hover:text-fg',
          )}
        >
          Workspace
        </Link>
        <Link
          href="/app/projects"
          className={cn(
            'whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition',
            onProjects
              ? 'bg-accent/10 text-accent'
              : 'text-muted hover:bg-surface hover:text-fg',
          )}
        >
          Projects
        </Link>

        <div className="mt-3 hidden px-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted md:block">
          {projectId
            ? SHOW_AI_STLC_UI
              ? 'STLC (this project)'
              : 'This project'
            : SHOW_AI_STLC_UI
              ? 'QA Workflow'
              : 'Projects'}
        </div>

        {projectId ? (
          SHOW_AI_STLC_UI ? (
            STLC_PHASES.map((p) => {
              const isRequirements = p.id === 'REQUIREMENTS';
              const href = isRequirements
                ? `/app/projects/${projectId}?tab=requirements&view=source`
                : `/app/projects/${projectId}?tab=stlc&phase=${p.id}`;
              const active = isRequirements
                ? tab !== 'overview' && tab !== 'stlc'
                : tab === 'stlc' &&
                  (phaseParam === p.id ||
                    (!phaseParam && p.id === 'PLANNING'));
              return (
                <Link
                  key={p.id}
                  href={href}
                  className={cn(
                    'whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition',
                    active
                      ? 'bg-accent/10 text-accent'
                      : 'text-muted hover:bg-surface hover:text-fg',
                  )}
                  title={p.description}
                >
                  <span className="mr-1.5 text-[10px] text-muted">
                    {p.index}.
                  </span>
                  {p.label.replace(/^Test /, '')}
                </Link>
              );
            })
          ) : (
            TCMS_TABS.map((t) => {
              const href = `/app/projects/${projectId}?tab=${t.id}`;
              const active =
                t.id === 'runs'
                  ? onRunPage || tab === 'runs'
                  : !onRunPage && tab === t.id;
              return (
                <Link
                  key={t.id}
                  href={href}
                  className={cn(
                    'whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition',
                    active
                      ? 'bg-accent/10 text-accent'
                      : 'text-muted hover:bg-surface hover:text-fg',
                  )}
                >
                  {t.label}
                </Link>
              );
            })
          )
        ) : (
          <Link
            href="/app/projects"
            className="whitespace-nowrap rounded-lg px-2.5 py-2 text-sm text-muted hover:bg-surface hover:text-fg"
          >
            {SHOW_AI_STLC_UI
              ? 'Open a project to start STLC'
              : 'Open a project'}
          </Link>
        )}

        <div className="mt-3 hidden border-t border-border pt-3 md:block" />

        <Link
          href="/app/orgs"
          className={cn(
            'whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition',
            onOrgs
              ? 'bg-accent/10 text-accent'
              : 'text-muted hover:bg-surface hover:text-fg',
          )}
        >
          Organizations
        </Link>
        <Link
          href="/app/settings"
          className={cn(
            'whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition',
            onSettings
              ? 'bg-accent/10 text-accent'
              : 'text-muted hover:bg-surface hover:text-fg',
          )}
        >
          Settings
        </Link>
        <Link
          href="/app/billing"
          className={cn(
            'whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition',
            onBilling
              ? 'bg-accent/10 text-accent'
              : 'text-muted hover:bg-surface hover:text-fg',
          )}
        >
          Billing
        </Link>
      </nav>

      <div className="mt-2 hidden border-t border-border pt-3 md:mt-auto md:block">
        <ThemeToggle />
      </div>
    </aside>
  );
}
