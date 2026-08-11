'use client';

import { cycleResultCounts } from '@qaforge/shared';

export type CycleCounts = ReturnType<typeof cycleResultCounts>;

const SLICES: Array<{
  key: keyof Pick<
    CycleCounts,
    'passed' | 'failed' | 'blocked' | 'skipped' | 'pending'
  >;
  label: string;
  color: string;
}> = [
  { key: 'passed', label: 'Passed', color: '#10b981' },
  { key: 'failed', label: 'Failed', color: '#ef4444' },
  { key: 'blocked', label: 'Blocked', color: '#f59e0b' },
  { key: 'skipped', label: 'Skipped', color: '#64748b' },
  { key: 'pending', label: 'Pending', color: '#94a3b8' },
];

export function TcmsCycleChart({
  counts,
  compact,
}: {
  counts: CycleCounts;
  compact?: boolean;
}) {
  const total = Math.max(counts.total, 1);
  let angle = 0;
  const paths = SLICES.map((slice) => {
    const value = counts[slice.key];
    const sweep = (value / total) * 360;
    const start = angle;
    angle += sweep;
    return { ...slice, value, d: donutSlice(start, sweep) };
  }).filter((s) => s.value > 0);

  const bar = SLICES.map((slice) => ({
    ...slice,
    pct: (counts[slice.key] / total) * 100,
  }));

  return (
    <div className={compact ? 'flex items-center gap-3' : 'space-y-3'}>
      <svg viewBox="0 0 42 42" className={compact ? 'h-16 w-16' : 'h-28 w-28'}>
        {counts.total === 0 ? (
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="#334155" strokeWidth="4" />
        ) : (
          paths.map((p) => (
            <path
              key={p.key}
              d={p.d}
              fill="none"
              stroke={p.color}
              strokeWidth="4"
            />
          ))
        )}
        <text
          x="21"
          y="22.5"
          textAnchor="middle"
          className="fill-current"
          style={{ fontSize: '7px' }}
        >
          {counts.done}/{counts.total}
        </text>
      </svg>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex h-2 overflow-hidden rounded-full bg-bg-elevated">
          {bar.map((s) =>
            s.pct > 0 ? (
              <div
                key={s.key}
                style={{ width: `${s.pct}%`, background: s.color }}
              />
            ) : null,
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
          {SLICES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: s.color }}
              />
              {s.label} {counts[s.key]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutSlice(start: number, sweep: number) {
  if (sweep >= 359.99) {
    return 'M21 5.1 A15.9 15.9 0 1 1 20.99 5.1';
  }
  const s = polar(21, 21, 15.9, start);
  const e = polar(21, 21, 15.9, start + sweep);
  const large = sweep > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A 15.9 15.9 0 ${large} 1 ${e.x} ${e.y}`;
}
