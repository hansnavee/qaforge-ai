'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function TcmsBoard({
  title,
  hint,
  tree,
  toolbar,
  children,
}: {
  title: string;
  hint?: string;
  tree: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-base font-semibold text-fg">{title}</h3>
          {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
        </div>
      </div>
      <div className="flex min-h-[min(38rem,calc(100vh-13rem))] flex-col lg:flex-row">
        <aside className="max-h-[28rem] w-full shrink-0 overflow-auto border-b border-border bg-panel/50 p-3 lg:max-h-none lg:min-h-[min(38rem,calc(100vh-13rem))] lg:w-72 lg:border-b-0 lg:border-r">
          {tree}
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          {toolbar ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel/30 px-3 py-2.5">
              {toolbar}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
        </section>
      </div>
    </div>
  );
}

export function TcmsTreeButton({
  active,
  indent = 0,
  children,
  onClick,
  chevron,
  count,
}: {
  active?: boolean;
  indent?: number;
  children: ReactNode;
  onClick: () => void;
  chevron?: ReactNode;
  count?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ paddingLeft: 8 + indent * 14 }}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-sm transition',
        active
          ? 'bg-accent/12 font-medium text-fg'
          : 'text-muted hover:bg-surface hover:text-fg',
      )}
    >
      <span className="w-4 shrink-0 text-center text-xs text-muted">
        {chevron ?? ''}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count ? (
        <span className="shrink-0 rounded-full bg-bg-elevated px-1.5 py-0.5 text-[10px] text-muted">
          {count}
        </span>
      ) : null}
    </button>
  );
}

export const fieldClass =
  'h-9 w-full rounded-lg border border-border bg-bg-elevated px-2.5 text-sm text-fg outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20';

export const areaClass =
  'w-full rounded-lg border border-border bg-bg-elevated px-2.5 py-2 text-sm text-fg outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20';
