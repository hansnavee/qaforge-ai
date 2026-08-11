'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { Button } from '@/components/Button';
import type { TestCaseRow } from './design-cases-panel';

type Preview = {
  runKind: string;
  testCaseIds: string[];
  cases: Array<{
    id: string;
    externalId: string;
    featureKey: string | null;
    priorityLabel: string;
    scenario: string;
    readyForExecution: boolean;
  }>;
};

const RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const ALL = 'ALL';

function featureOf(c: { featureKey?: string | null; module?: string | null }) {
  return c.featureKey?.trim() || c.module?.trim() || 'General';
}

export function ExecutionPickerPanel({
  projectId,
  canSelect,
  defaultRunKind = 'SPRINT',
  onSelectionChange,
}: {
  projectId: string;
  canSelect: boolean;
  defaultRunKind?: 'SPRINT' | 'REGRESSION' | 'SYSTEM';
  onSelectionChange?: (payload: {
    testCaseIds: string[];
    runKind: 'SPRINT' | 'REGRESSION' | 'SYSTEM';
    featureKey: string | null;
  }) => void;
}) {
  const [runKind, setRunKind] = useState<'SPRINT' | 'REGRESSION' | 'SYSTEM'>(
    defaultRunKind,
  );
  const [featureKey, setFeatureKey] = useState<string>(ALL);
  const [picked, setPicked] = useState<Set<string> | null>(null);

  useEffect(() => {
    setRunKind(defaultRunKind);
    setPicked(null);
  }, [defaultRunKind]);

  const casesQuery = useQuery({
    queryKey: ['test-cases', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<TestCaseRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases`,
      );
    },
  });

  const previewFeature = featureKey === ALL ? '' : featureKey;
  const previewQuery = useQuery({
    queryKey: ['execution-preview', projectId, runKind, previewFeature],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      const q = new URLSearchParams({ runKind });
      if (previewFeature) q.set('featureKey', previewFeature);
      return api<Preview>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/execution-preview?${q}`,
      );
    },
  });

  const readyAll = (casesQuery.data ?? []).filter((c) => c.readyForExecution);
  const features = useMemo(() => {
    const keys = new Set<string>();
    for (const c of casesQuery.data ?? []) keys.add(featureOf(c));
    return [...keys].sort((a, b) => a.localeCompare(b));
  }, [casesQuery.data]);

  const ready = useMemo(() => {
    if (featureKey === ALL) return readyAll;
    return readyAll.filter((c) => featureOf(c) === featureKey);
  }, [readyAll, featureKey]);

  const suggested = previewQuery.data?.testCaseIds ?? [];
  const suggestedKey = suggested.join(',');
  const effectivePicked = picked ?? new Set(suggested);

  useEffect(() => {
    if (picked !== null || !suggestedKey) return;
    onSelectionChange?.({
      testCaseIds: suggestedKey.split(',').filter(Boolean),
      runKind,
      featureKey: featureKey === ALL ? null : featureKey,
    });
  }, [picked, suggestedKey, runKind, featureKey, onSelectionChange]);

  const ordered = useMemo(() => {
    const selected = ready.filter((c) => effectivePicked.has(c.id));
    return [...selected].sort((a, b) => {
      const ra = RANK[a.priorityLabel ?? 'MEDIUM'] ?? 1;
      const rb = RANK[b.priorityLabel ?? 'MEDIUM'] ?? 1;
      if (ra !== rb) return ra - rb;
      return a.externalId.localeCompare(b.externalId);
    });
  }, [ready, effectivePicked]);

  function emit(next: Set<string>, kind = runKind, feature = featureKey) {
    onSelectionChange?.({
      testCaseIds: [...next],
      runKind: kind,
      featureKey: feature === ALL ? null : feature,
    });
  }

  return (
    <div className="mt-5 space-y-3 rounded-lg border border-border bg-panel/40 p-4">
      <p className="text-sm font-medium text-fg">What to execute</p>
      <p className="text-xs text-muted">
        Choose All features or one feature. AI runs selected ready cases High →
        Medium → Low. Unready cases are skipped.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
          value={featureKey}
          disabled={!canSelect}
          onChange={(e) => {
            setFeatureKey(e.target.value);
            setPicked(null);
          }}
          aria-label="Feature"
        >
          <option value={ALL}>All features</option>
          {features.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
          value={runKind}
          disabled={!canSelect}
          onChange={(e) => {
            const next = e.target.value as typeof runKind;
            setRunKind(next);
            setPicked(null);
          }}
        >
          <option value="SPRINT">Cycle 1 — sprint (AI suggests HIGH)</option>
          <option value="REGRESSION">Full regression (all ready)</option>
          <option value="SYSTEM">Cycle 2+ — system / post-fix</option>
        </select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!canSelect}
          onClick={() => {
            const next = new Set(suggested);
            setPicked(next);
            emit(next);
          }}
        >
          Use AI suggestion
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!canSelect}
          onClick={() => {
            const next = new Set(ready.map((c) => c.id));
            setPicked(next);
            emit(next, 'REGRESSION');
            setRunKind('REGRESSION');
          }}
        >
          Select all ready
        </Button>
      </div>
      <ul className="max-h-56 space-y-1 overflow-auto text-sm">
        {ready.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={effectivePicked.has(c.id)}
              disabled={!canSelect}
              onChange={(e) => {
                const next = new Set(effectivePicked);
                if (e.target.checked) next.add(c.id);
                else next.delete(c.id);
                setPicked(next);
                emit(next);
              }}
            />
            <span>
              <span className="font-mono text-xs text-muted">
                {c.externalId}
              </span>{' '}
              <span className="text-xs text-accent">
                {c.priorityLabel ?? 'MEDIUM'}
              </span>{' '}
              <span className="text-xs text-muted">{featureOf(c)}</span>{' '}
              {c.scenario}
            </span>
          </li>
        ))}
        {ready.length === 0 ? (
          <li className="text-muted">
            No cases marked ready
            {featureKey !== ALL ? ` for ${featureKey}` : ''}. Open Design and
            tick Ready first.
          </li>
        ) : null}
      </ul>
      {ordered.length ? (
        <p className="text-xs text-muted">
          Run order: {ordered.map((c) => c.externalId).join(' → ')}
        </p>
      ) : null}
    </div>
  );
}
