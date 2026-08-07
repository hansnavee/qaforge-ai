import { cn } from '@/lib/cn';

const tones: Record<string, string> = {
  default: 'bg-surface text-muted border-border',
  accent: 'bg-accent/15 text-accent border-accent/25',
  success: 'bg-success/15 text-success border-success/25',
  warning: 'bg-warning/15 text-warning border-warning/25',
  danger: 'bg-danger/15 text-danger border-danger/25',
};

export function Badge({
  children,
  tone = 'default',
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof tones;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        tones[tone] ?? tones.default,
        className,
      )}
    >
      {children}
    </span>
  );
}
