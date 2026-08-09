import { cn } from '@/lib/cn';
import { ExecutionPhase } from '@qaforge/shared';

const PHASES = [
  ExecutionPhase.REQUIREMENTS,
  ExecutionPhase.CLARIFICATION,
  ExecutionPhase.TEST_STRATEGY,
  ExecutionPhase.TEST_DESIGN,
  ExecutionPhase.TEST_DATA,
  ExecutionPhase.AUTHENTICATION,
  ExecutionPhase.DISCOVERY,
  ExecutionPhase.FUNCTIONAL,
  ExecutionPhase.ACCESSIBILITY,
  ExecutionPhase.PERFORMANCE,
  ExecutionPhase.SECURITY,
  ExecutionPhase.TEST_CASES,
  ExecutionPhase.MANUAL_TEST,
  ExecutionPhase.BUG_ANALYSIS,
  ExecutionPhase.RETEST,
  ExecutionPhase.AUTOMATION,
  ExecutionPhase.EXECUTION,
  ExecutionPhase.FAILURE_ANALYSIS,
  ExecutionPhase.REPORT,
  ExecutionPhase.DONE,
] as const;

function label(phase: string): string {
  return phase
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function PhaseTimeline({
  current,
  status,
}: {
  current?: string | null;
  status?: string | null;
}) {
  const idx = current
    ? PHASES.findIndex((p) => p === current)
    : status === 'COMPLETED'
      ? PHASES.length - 1
      : -1;

  return (
    <ol className="space-y-2">
      {PHASES.map((phase, i) => {
        const done = idx > i || status === 'COMPLETED';
        const active = idx === i && status !== 'COMPLETED';
        return (
          <li key={phase} className="flex items-center gap-3 text-sm">
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-mono',
                done && 'border-accent/40 bg-accent/20 text-accent',
                active && 'border-accent bg-accent text-accent-fg animate-pulse',
                !done && !active && 'border-border text-muted',
              )}
            >
              {done ? '✓' : i + 1}
            </span>
            <span className={cn(active ? 'text-fg' : 'text-muted')}>
              {label(phase)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
