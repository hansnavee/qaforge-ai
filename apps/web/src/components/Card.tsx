import { cn } from '@/lib/cn';
import type { HTMLAttributes, ReactNode } from 'react';

export function Card({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface/80 p-5',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
