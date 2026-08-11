'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Modal({
  open,
  title,
  children,
  footer,
  wide,
  size,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  size?: 'md' | 'lg' | 'xl';
  onClose: () => void;
}) {
  if (!open) return null;
  const width =
    size === 'xl'
      ? 'max-w-4xl'
      : size === 'lg' || wide
        ? 'max-w-2xl'
        : 'max-w-md';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-10 flex max-h-[90vh] w-full flex-col rounded-xl border border-border bg-bg shadow-xl',
          width,
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm text-muted hover:bg-bg-elevated hover:text-fg"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
