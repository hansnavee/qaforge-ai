'use client';

import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PhaseTimeline } from '@/components/PhaseTimeline';
import { ScoreRing } from '@/components/ScoreRing';
import { api, ApiError, API_URL } from '@/lib/api';
import { useExecutionStore, type LiveEvent } from '@/store/execution';

type Execution = {
  id: string;
  status: string;
  phase: string;
  scores?: Record<string, number> | null;
  project?: { name?: string; appUrl?: string };
};

export default function ExecutionLivePage() {
  const { executionId } = useParams<{ executionId: string }>();
  const {
    status,
    phase,
    events,
    scores,
    setExecutionId,
    setStatus,
    setScores,
    appendEvents,
    reset,
  } = useExecutionStore();

  useEffect(() => {
    reset();
    setExecutionId(executionId);
  }, [executionId, reset, setExecutionId]);

  const { data: execution } = useQuery({
    queryKey: ['execution', executionId],
    queryFn: async () => {
      try {
        return await api<Execution>(`/api/v1/executions/${executionId}`);
      } catch (e) {
        if (e instanceof ApiError) return null;
        throw e;
      }
    },
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'COMPLETED' || s === 'FAILED' || s === 'CANCELLED'
        ? false
        : 2000;
    },
  });

  useEffect(() => {
    if (!execution) return;
    setStatus(execution.status, execution.phase);
    if (execution.scores) setScores(execution.scores);
  }, [execution, setStatus, setScores]);

  useQuery({
    queryKey: ['execution-events', executionId],
    queryFn: async () => {
      try {
        const res = await api<LiveEvent[] | { items: LiveEvent[] }>(
          `/api/v1/executions/${executionId}/events`,
        );
        const list = Array.isArray(res)
          ? res
          : res && 'items' in res
            ? res.items
            : [];
        appendEvents(list);
        return list;
      } catch {
        return [] as LiveEvent[];
      }
    },
    refetchInterval: 2000,
  });

  const cont = useMutation({
    mutationFn: async () => {
      await api(`/api/v1/executions/${executionId}/continue-after-login`, {
        method: 'POST',
        body: JSON.stringify({ executionId }),
      });
    },
  });

  const liveStatus = execution?.status ?? status;
  const livePhase = execution?.phase ?? phase;
  const liveScores = execution?.scores ?? scores;
  const awaiting = liveStatus === 'AWAITING_LOGIN';

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[280px_1fr]">
      <Card>
        <h2 className="mb-4 text-sm font-medium text-muted">Phase timeline</h2>
        <PhaseTimeline current={livePhase} status={liveStatus} />
      </Card>

      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {execution?.project?.name ?? 'Execution'}
            </h1>
            <p className="mt-1 font-mono text-xs text-muted">{executionId}</p>
            <div className="mt-3 flex gap-2">
              <Badge
                tone={
                  liveStatus === 'COMPLETED'
                    ? 'success'
                    : liveStatus === 'FAILED'
                      ? 'danger'
                      : awaiting
                        ? 'warning'
                        : 'accent'
                }
              >
                {liveStatus ?? 'UNKNOWN'}
              </Badge>
              {livePhase ? <Badge>{livePhase}</Badge> : null}
            </div>
          </div>
          <a
            href={`${API_URL}/api/v1/executions/${executionId}/download-zip`}
            className="inline-flex"
          >
            <Button variant="secondary">Download ZIP</Button>
          </a>
        </div>

        {awaiting ? (
          <Card className="border-warning/40 bg-warning/5">
            <h2 className="text-lg font-semibold text-warning">
              Continue after login
            </h2>
            <p className="mt-2 text-sm text-muted">
              A browser session is waiting. Log in manually in the launched
              browser — QAForge never collects passwords — then continue the
              pipeline.
            </p>
            <Button
              className="mt-4"
              size="lg"
              onClick={() => cont.mutate()}
              disabled={cont.isPending}
            >
              {cont.isPending ? 'Signaling…' : 'Continue after login'}
            </Button>
          </Card>
        ) : null}

        {liveScores ? (
          <Card>
            <h2 className="mb-4 text-sm font-medium text-muted">Scores</h2>
            <div className="flex flex-wrap gap-6">
              <ScoreRing label="Functional" value={liveScores.functional} />
              <ScoreRing
                label="Accessibility"
                value={liveScores.accessibility}
              />
              <ScoreRing label="Performance" value={liveScores.performance} />
              <ScoreRing label="Security" value={liveScores.security} />
              <ScoreRing label="UI/UX" value={liveScores.uiux} />
            </div>
          </Card>
        ) : null}

        <Card>
          <h2 className="mb-3 text-sm font-medium text-muted">Event log</h2>
          <div className="max-h-96 space-y-2 overflow-auto font-mono text-xs">
            {events.length === 0 ? (
              <p className="text-muted">Waiting for events…</p>
            ) : (
              events
                .slice()
                .reverse()
                .map((ev, i) => (
                  <div
                    key={`${ev.timestamp}-${i}`}
                    className="rounded-md border border-border/50 bg-bg-elevated/50 px-3 py-2"
                  >
                    <div className="text-muted">
                      {ev.timestamp} · {ev.type}
                      {ev.phase ? ` · ${ev.phase}` : ''}
                    </div>
                    <div className="mt-0.5 text-fg">{ev.message}</div>
                  </div>
                ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
