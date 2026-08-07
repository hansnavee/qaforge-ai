import { cn } from '@/lib/cn';

export function Progress({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn(
        'h-1.5 w-full overflow-hidden rounded-full bg-border/60',
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-accent transition-all duration-500"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
