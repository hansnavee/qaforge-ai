'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export type ActionMenuItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
};

export function ActionMenu({
  items,
  label = 'Actions',
}: {
  items: ActionMenuItem[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted hover:bg-bg-elevated hover:text-fg"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⋮
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-lg border border-border bg-bg py-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              className={cn(
                'block w-full px-3 py-1.5 text-left text-sm hover:bg-bg-elevated disabled:opacity-40',
                item.danger && 'text-danger',
              )}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
