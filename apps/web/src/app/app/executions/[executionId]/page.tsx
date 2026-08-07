'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PhaseTimeline } from '@/components/PhaseTimeline';
import { ScoreRing } from '@/components/ScoreRing';
import { api, ApiError, API_URL } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { useExecutionStore, type LiveEvent } from '@/store/execution';

type ClarificationQuestion = {
  id: string;
  question: string;
  reason?: string;
  required?: boolean;
};

type Execution = {
  id: string;
  status: string;
  phase: string;
  scores?: Record<string, number> | null;
  project?: { name?: string; appUrl?: string };
  clarificationQuestions?: {
    questions?: ClarificationQuestion[];
  } | null;
};

export default function ExecutionLivePage() {
  const { executionId } = useParams<{ executionId: string }>();
  const queryClient = useQueryClient();
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
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    reset();
    setExecutionId(executionId);
  }, [executionId, reset, setExecutionId]);

  const { data: execution } = useQuery({
    queryKey: ['execution', executionId],
    queryFn: async () => {
      try {
        const orgId = await getDefaultOrgId();
        return await api<Execution>(
          `/api/v1/orgs/${orgId}/executions/${executionId}`,
        );
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

  const questions = execution?.clarificationQuestions?.questions ?? [];

  useEffect(() => {
    if (questions.length === 0) return;
    setAnswers((prev) => {
      const next = { ...prev };
      for (const q of questions) {
        if (next[q.id] === undefined) next[q.id] = '';
      }
      return next;
    });
  }, [questions]);

  useQuery({
    queryKey: ['execution-events', executionId],
    queryFn: async () => {
      try {
        const orgId = await getDefaultOrgId();
        const res = await api<LiveEvent[] | { items: LiveEvent[] }>(
          `/api/v1/orgs/${orgId}/executions/${executionId}/events`,
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
      const orgId = await getDefaultOrgId();
      await api(
        `/api/v1/orgs/${orgId}/executions/${executionId}/continue-after-login`,
        {
          method: 'POST',
          body: JSON.stringify({ executionId }),
        },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
    },
  });

  const clarify = useMutation({
    mutationFn: async (opts: { skip?: boolean }) => {
      const orgId = await getDefaultOrgId();
      await api(`/api/v1/orgs/${orgId}/executions/${executionId}/clarify`, {
        method: 'POST',
        body: JSON.stringify({
          skip: Boolean(opts.skip),
          answers: opts.skip ? {} : answers,
        }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
    },
  });

  const { data: orgId } = useQuery({
    queryKey: ['default-org-id'],
    queryFn: () => getDefaultOrgId(),
  });

  const liveStatus = execution?.status ?? status;
  const livePhase = execution?.phase ?? phase;
  const liveScores = execution?.scores ?? scores;
  const awaitingClarification =
    liveStatus === 'AWAITING_CLARIFICATION' || livePhase === 'CLARIFICATION';
  const awaitingLogin =
    liveStatus === 'AWAITING_LOGIN' ||
    (livePhase === 'AUTHENTICATION' && !awaitingClarification);
  const awaiting = awaitingClarification || awaitingLogin;

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
            href={
              orgId
                ? `${API_URL}/api/v1/orgs/${orgId}/executions/${executionId}/download-zip`
                : undefined
            }
            className="inline-flex"
            aria-disabled={!orgId}
          >
            <Button variant="secondary" disabled={!orgId}>
              Download ZIP
            </Button>
          </a>
        </div>

        {awaitingClarification ? (
          <Card className="border-warning/40 bg-warning/5">
            <h2 className="text-lg font-semibold text-warning">
              Clarify requirements
            </h2>
            <p className="mt-2 text-sm text-muted">
              The agent found gaps in the requirements. Answer the questions
              below, or skip to continue with the current requirements.
            </p>
            <div className="mt-4 space-y-4">
              {questions.length === 0 ? (
                <p className="text-sm text-muted">Loading questions…</p>
              ) : (
                questions.map((q) => (
                  <label key={q.id} className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-fg">
                      {q.question}
                      {q.required ? (
                        <span className="text-danger"> *</span>
                      ) : null}
                    </span>
                    {q.reason ? (
                      <span className="text-xs text-muted">{q.reason}</span>
                    ) : null}
                    <textarea
                      className="min-h-20 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-fg outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
                      value={answers[q.id] ?? ''}
                      onChange={(e) =>
                        setAnswers((prev) => ({
                          ...prev,
                          [q.id]: e.target.value,
                        }))
                      }
                      placeholder="Your answer…"
                    />
                  </label>
                ))
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                size="lg"
                onClick={() => clarify.mutate({ skip: false })}
                disabled={clarify.isPending || questions.length === 0}
              >
                {clarify.isPending ? 'Submitting…' : 'Submit answers'}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => clarify.mutate({ skip: true })}
                disabled={clarify.isPending}
              >
                Skip clarification
              </Button>
            </div>
            {clarify.isError ? (
              <p className="mt-3 text-sm text-danger">
                Could not submit clarification. Try again.
              </p>
            ) : null}
          </Card>
        ) : null}

        {awaitingLogin ? (
          <Card className="border-warning/40 bg-warning/5">
            <h2 className="text-lg font-semibold text-warning">
              Continue after login
            </h2>
            <p className="mt-2 text-sm text-muted">
              QAForge never collects passwords. On the hosted worker the browser
              is headless (no live view) — click Continue to resume with the
              current page, or skip login for apps that do not need it.
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
