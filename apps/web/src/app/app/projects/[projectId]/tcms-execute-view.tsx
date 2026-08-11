'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { useOrgCaps } from '@/lib/use-org';
import { formatDuration } from '@/lib/format-duration';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { TcmsEvidence } from './tcms-evidence';
import { areaClass } from './tcms-board';
import { TcmsProjectChrome } from './tcms-chrome';
import {
  caseHref,
  isPendingCase,
  resultTone,
  runHref,
  type ResultStatus,
  type TcmsRunCase,
  type TcmsRunDetail,
} from './tcms-types';

function stepsOf(steps: unknown): string[] {
  if (Array.isArray(steps)) return steps.map(String).filter(Boolean);
  if (typeof steps === 'string') {
    return steps
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function stepStorageKey(runId: string, caseId: string) {
  return `tcms-steps:${runId}:${caseId}`;
}

export function TcmsExecuteView({
  projectId,
  runId,
  caseId,
}: {
  projectId: string;
  runId: string;
  caseId: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { caps, isLoading: orgLoading } = useOrgCaps();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [help, setHelp] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const startedRef = useRef<number>(Date.now());
  const extraRef = useRef(0);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () =>
      api<{ name: string; description?: string | null }>(
        `/api/v1/projects/${projectId}`,
      ),
  });

  const runQuery = useQuery({
    queryKey: ['tcms-run', projectId, runId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<TcmsRunDetail>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/runs/${runId}`,
      );
    },
  });

  const run = runQuery.data;
  const cases = run?.cases ?? [];
  const index = cases.findIndex((c) => c.id === caseId);
  const current = index >= 0 ? cases[index] : undefined;
  const cycleLocked = Boolean(
    run?.locked || run?.status === 'COMPLETED' || run?.status === 'CANCELLED',
  );
  const locked = cycleLocked || (!orgLoading && !caps.canExecute);
  const storedMs = current?.result?.durationMs ?? 0;
  const untested = Boolean(current && isPendingCase(current));

  useEffect(() => {
    setComment(current?.result?.message ?? '');
    setError(null);
    try {
      const raw = localStorage.getItem(stepStorageKey(runId, caseId));
      const ids = raw ? (JSON.parse(raw) as number[]) : [];
      setChecked(new Set(ids));
    } catch {
      setChecked(new Set());
    }
  }, [caseId, runId, current?.result?.message]);

  useEffect(() => {
    const key = `tcms-timer:${runId}:${caseId}`;
    extraRef.current = storedMs;
    if (untested && !locked) {
      const saved = Number(sessionStorage.getItem(key) || 0);
      startedRef.current = saved || Date.now();
      if (!saved) sessionStorage.setItem(key, String(startedRef.current));
      setPaused(false);
      setElapsed(Date.now() - startedRef.current);
    } else {
      startedRef.current = Date.now();
      setPaused(true);
      setElapsed(storedMs);
    }
  }, [caseId, runId, locked, untested, storedMs]);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setElapsed(extraRef.current + (Date.now() - startedRef.current));
    }, 250);
    return () => window.clearInterval(id);
  }, [paused]);

  function togglePause() {
    if (locked) return;
    if (paused) {
      startedRef.current = Date.now();
      setPaused(false);
    } else {
      extraRef.current = extraRef.current + (Date.now() - startedRef.current);
      setPaused(true);
    }
  }

  const prev = index > 0 ? cases[index - 1] : undefined;
  const next = index >= 0 && index < cases.length - 1 ? cases[index + 1] : undefined;
  const nextUntested = cases.find(
    (c, i) => i > index && isPendingCase(c),
  ) ?? cases.find((c, i) => i < index && isPendingCase(c));

  const groups = useMemo(() => {
    const map = new Map<string, TcmsRunCase[]>();
    for (const c of cases) {
      const key = c.folderName?.trim() || 'Ungrouped';
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [cases]);

  const saveMutation = useMutation({
    mutationFn: async (status: ResultStatus) => {
      if ((status === 'FAILED' || status === 'BLOCKED') && !comment.trim()) {
        throw new Error('A comment is required for Fail and Blocked');
      }
      const orgId = await getDefaultOrgId();
      const durationMs = paused
        ? extraRef.current
        : extraRef.current + (Date.now() - startedRef.current);
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/results`,
        {
          method: 'POST',
          body: JSON.stringify({
            executionId: runId,
            testCaseId: caseId,
            status,
            message: comment.trim() || null,
            durationMs,
          }),
        },
      );
    },
    onSuccess: async (_res, status) => {
      extraRef.current = paused
        ? extraRef.current
        : extraRef.current + (Date.now() - startedRef.current);
      setPaused(true);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['tcms-run', projectId, runId] }),
        qc.invalidateQueries({ queryKey: ['tcms-runs', projectId] }),
      ]);
      if (status === 'PASSED' || status === 'SKIPPED') {
        const target =
          cases.find((c, i) => i > index && isPendingCase(c)) ??
          cases.find((c) => c.id !== caseId && isPendingCase(c));
        if (target) router.push(caseHref(projectId, runId, target.id));
      }
    },
    onError: (e) => {
      setError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not save',
      );
    },
  });

  function save(status: ResultStatus) {
    setError(null);
    if ((status === 'FAILED' || status === 'BLOCKED') && !comment.trim()) {
      setError('A comment is required for Fail and Blocked');
      commentRef.current?.focus();
      return;
    }
    saveMutation.mutate(status);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '?') {
        setHelp((v) => !v);
        return;
      }
      if (locked) {
        if (e.key === 'n' || e.key === 'N') {
          const target = e.shiftKey ? prev : nextUntested ?? next;
          if (target) router.push(caseHref(projectId, runId, target.id));
        }
        return;
      }
      if (e.key === 'p' || e.key === 'P') save('PASSED');
      if (e.key === 'f' || e.key === 'F') save('FAILED');
      if (e.key === 'b' || e.key === 'B') save('BLOCKED');
      if (e.key === 's' || e.key === 'S') save('SKIPPED');
      if (e.key === 'n' || e.key === 'N') {
        const target = e.shiftKey ? prev : nextUntested ?? next;
        if (target) router.push(caseHref(projectId, runId, target.id));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    locked,
    prev?.id,
    next?.id,
    nextUntested?.id,
    projectId,
    runId,
    comment,
    caseId,
    router,
  ]);

  function toggleStep(i: number) {
    setChecked((prevSet) => {
      const nextSet = new Set(prevSet);
      if (nextSet.has(i)) nextSet.delete(i);
      else nextSet.add(i);
      localStorage.setItem(
        stepStorageKey(runId, caseId),
        JSON.stringify([...nextSet]),
      );
      return nextSet;
    });
  }

  if (runQuery.isLoading || projectQuery.isLoading) {
    return <p className="text-sm text-muted">Loading case…</p>;
  }
  if (runQuery.error || !run || !current || !projectQuery.data) {
    return (
      <p className="text-sm text-danger">
        {runQuery.error instanceof ApiError
          ? runQuery.error.message
          : 'Case not found in this run.'}
      </p>
    );
  }

  const steps = stepsOf(current.steps);
  const progress = cases.length
    ? Math.round(((index + 1) / cases.length) * 100)
    : 0;

  return (
    <TcmsProjectChrome
      projectId={projectId}
      projectName={projectQuery.data.name}
      active="runs"
      crumb={`${run.name ?? 'Run'} / ${current.externalId}`}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-muted">
            <Link href={runHref(projectId, runId)} className="hover:text-fg">
              {run.name}
            </Link>
            <span className="mx-1">/</span>
            <span className="text-fg">{current.externalId}</span>
            <span className="ml-2 text-xs">
              {index + 1} of {cases.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!prev}
              onClick={() =>
                prev && router.push(caseHref(projectId, runId, prev.id))
              }
            >
              Prev
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!nextUntested}
              onClick={() =>
                nextUntested &&
                router.push(caseHref(projectId, runId, nextUntested.id))
              }
            >
              Next untested
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!next}
              onClick={() =>
                next && router.push(caseHref(projectId, runId, next.id))
              }
            >
              Next
            </Button>
          </div>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-panel">
          <div
            className="h-full bg-accent"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="grid min-h-[32rem] gap-3 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
          <aside className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-panel/40 p-2">
            {groups.map(([suite, rows]) => (
              <div key={suite} className="mb-3">
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {suite}
                </p>
                {rows.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      router.push(caseHref(projectId, runId, c.id))
                    }
                    className={cn(
                      'mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs',
                      c.id === caseId
                        ? 'bg-accent/15 text-fg'
                        : 'text-muted hover:bg-surface hover:text-fg',
                    )}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        c.result?.status === 'PASSED' && 'bg-emerald-500',
                        c.result?.status === 'FAILED' && 'bg-red-500',
                        c.result?.status === 'BLOCKED' && 'bg-amber-500',
                        c.result?.status === 'SKIPPED' && 'bg-slate-500',
                        !c.result?.status && 'bg-border',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{c.externalId}</span>
                  </button>
                ))}
              </div>
            ))}
          </aside>

          <section className="space-y-4 rounded-xl border border-border bg-surface p-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={resultTone(current.result?.status)}>
                  {current.result?.status ?? 'Untested'}
                </Badge>
                {current.priorityLabel ? (
                  <Badge>{current.priorityLabel}</Badge>
                ) : null}
              </div>
              <h2 className="mt-2 text-xl font-semibold">{current.scenario}</h2>
            </div>
            {current.preconditions ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Preconditions
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {current.preconditions}
                </p>
              </div>
            ) : null}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Steps
              </p>
              {steps.length ? (
                <ol className="mt-2 space-y-2">
                  {steps.map((step, i) => (
                    <li key={`${step}-${i}`}>
                      <label className="flex cursor-pointer items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={checked.has(i)}
                          onChange={() => toggleStep(i)}
                        />
                        <span
                          className={
                            checked.has(i) ? 'text-muted line-through' : ''
                          }
                        >
                          {step.replace(/^\d+\.\s*/, '')}
                        </span>
                      </label>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1 text-sm text-muted">No steps recorded.</p>
              )}
            </div>
            <div className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
                Expected
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {current.expected}
              </p>
            </div>
          </section>

          <aside className="space-y-4 rounded-xl border border-border bg-surface p-4">
            <div className="text-center">
              <p className="text-[11px] uppercase tracking-wide text-muted">
                Timer
              </p>
              <p className="font-mono text-3xl tabular-nums">
                {formatDuration(elapsed)}
              </p>
              {!locked ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-1"
                  onClick={togglePause}
                >
                  {paused ? 'Resume' : 'Pause'}
                </Button>
              ) : null}
            </div>
            {!locked ? (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  onClick={() => save('PASSED')}
                  disabled={saveMutation.isPending}
                >
                  Pass
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => save('FAILED')}
                  disabled={saveMutation.isPending}
                >
                  Fail
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => save('BLOCKED')}
                  disabled={saveMutation.isPending}
                >
                  Blocked
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => save('SKIPPED')}
                  disabled={saveMutation.isPending}
                >
                  Skip
                </Button>
              </div>
            ) : null}
            <label className="block space-y-1 text-xs text-muted">
              Comment
              <textarea
                ref={commentRef}
                className={`${areaClass} min-h-24`}
                value={comment}
                disabled={locked}
                placeholder="Required for Fail and Blocked"
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Evidence
              </p>
              <TcmsEvidence
                projectId={projectId}
                executionId={runId}
                resultId={current.result?.id}
                keys={
                  Array.isArray(current.result?.evidenceKeys)
                    ? current.result.evidenceKeys.filter(
                        (k): k is string => typeof k === 'string',
                      )
                    : []
                }
                canEdit={!locked}
                dropzone
                onUploaded={() =>
                  void qc.invalidateQueries({
                    queryKey: ['tcms-run', projectId, runId],
                  })
                }
              />
            </div>
            {help ? (
              <p className="text-[11px] text-muted">
                P pass · F fail · B blocked · S skip · N next untested · Shift+N
                prev · ? hide
              </p>
            ) : (
              <p className="text-[11px] text-muted">Press ? for shortcuts</p>
            )}
          </aside>
        </div>
      </div>
    </TcmsProjectChrome>
  );
}
