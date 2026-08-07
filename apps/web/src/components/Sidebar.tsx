'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { href: '/app/projects', label: 'Projects' },
  { href: '/app/executions', label: 'Executions' },
  { href: '/app/reports', label: 'Reports' },
  { href: '/app/test-cases', label: 'Test Cases' },
  { href: '/app/automation', label: 'Automation' },
  { href: '/app/github', label: 'GitHub' },
  { href: '/app/settings', label: 'Settings' },
  { href: '/app/billing', label: 'Billing' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border bg-bg-elevated/60 px-3 py-3 md:w-56 md:border-b-0 md:border-r md:py-4">
      <Link href="/app/projects" className="mb-3 px-2 md:mb-6">
        <div className="text-sm font-semibold tracking-tight text-fg">
          QAForge <span className="text-accent">AI</span>
        </div>
        <div className="hidden text-[11px] text-muted md:block">
          Quality orchestration
        </div>
      </Link>

      <nav className="flex flex-row gap-1 overflow-x-auto md:flex-1 md:flex-col md:overflow-visible">
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition',
                active
                  ? 'bg-accent/10 text-accent'
                  : 'text-muted hover:bg-surface hover:text-fg',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-2 hidden border-t border-border pt-3 md:mt-auto md:block">
        <ThemeToggle />
      </div>
    </aside>
  );
}
