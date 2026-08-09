'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ThemeToggle } from './ThemeToggle';

const LOCKED = [
  'Test Design',
  'Manual Testing',
  'Bugs',
  'Automation',
  'Execution',
  'Reports',
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const onDashboard =
    pathname === '/app/projects' || pathname === '/app' || pathname === '/app/';
  const onRequirements =
    pathname.startsWith('/app/projects/') &&
    pathname !== '/app/projects/new' &&
    !pathname.endsWith('/new');
  const onSettings = pathname.startsWith('/app/settings');
  const onBilling = pathname.startsWith('/app/billing');

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border bg-bg-elevated/60 px-3 py-3 md:w-56 md:border-b-0 md:border-r md:py-4">
      <Link href="/app/projects" className="mb-3 px-2 md:mb-6">
        <div className="text-sm font-semibold tracking-tight text-fg">
          QAForge <span className="text-accent">AI</span>
        </div>
        <div className="hidden text-[11px] text-muted md:block">
          AI QA Engineer
        </div>
      </Link>

      <nav className="flex flex-row gap-1 overflow-x-auto md:flex-1 md:flex-col md:overflow-visible">
        <Link
          href="/app/projects"
          className={cn(
            'whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition',
            onDashboard
              ? 'bg-accent/10 text-accent'
              : 'text-muted hover:bg-surface hover:text-fg',
          )}
        >
          Dashboard
        </Link>

        <div className="mt-3 hidden px-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted md:block">
          QA Workflow
        </div>

        <Link
          href="/app/projects"
          className={cn(
            'whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition',
            onRequirements
              ? 'bg-accent/10 text-accent'
              : 'text-muted hover:bg-surface hover:text-fg',
          )}
          title="Open a project to work on requirements"
        >
          <span className="mr-1.5 text-success">✓</span>
          Requirements
        </Link>

        {LOCKED.map((label) => (
          <span
            key={label}
            aria-disabled="true"
            className="flex cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm text-muted/70"
            title="Coming in a later piece"
          >
            <span aria-hidden>🔒</span>
            {label}
          </span>
        ))}

        <div className="mt-3 hidden border-t border-border pt-3 md:block" />

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
