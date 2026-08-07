import { cn } from '@/lib/cn';

export function ScoreRing({
  label,
  value,
  size = 88,
}: {
  label: string;
  value?: number | null;
  size?: number;
}) {
  const score = value ?? 0;
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, score)) / 100) * c;
  const color =
    value == null
      ? 'var(--muted)'
      : score >= 85
        ? 'var(--success)'
        : score >= 70
          ? 'var(--warning)'
          : 'var(--danger)';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--border)"
            strokeWidth="6"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={value == null ? c : offset}
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold">
          {value == null ? '—' : Math.round(score)}
        </div>
      </div>
      <div className={cn('text-xs text-muted')}>{label}</div>
    </div>
  );
}
