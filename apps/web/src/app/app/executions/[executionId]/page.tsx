'use client';

import Link from 'next/link';
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
  projectId?: string;
  status: string;
  phase: string;
  scores?: Record<string, number> | null;
  project?: { id?: string; name?: string; appUrl?: string };
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

  const approvePlan = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      await api(
        `/api/v1/orgs/${orgId}/executions/${executionId}/approve-test-plan`,
        {
          method: 'POST',
          body: '{}',
        },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
    },
  });

  const approveDesign = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      await api(
        `/api/v1/orgs/${orgId}/executions/${executionId}/approve-test-design`,
        {
          method: 'POST',
          body: '{}',
        },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
    },
  });

  const approveEnvironment = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      await api(
        `/api/v1/orgs/${orgId}/executions/${executionId}/approve-environment`,
        {
          method: 'POST',
          body: '{}',
        },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
    },
  });

  const approveData = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      await api(
        `/api/v1/orgs/${orgId}/executions/${executionId}/approve-test-data`,
        {
          method: 'POST',
          body: '{}',
        },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
    },
  });

  const approveExecution = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      await api(
        `/api/v1/orgs/${orgId}/executions/${executionId}/approve-test-execution`,
        {
          method: 'POST',
          body: '{}',
        },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
    },
  });

  const approveDefects = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      await api(
        `/api/v1/orgs/${orgId}/executions/${executionId}/approve-defects`,
        {
          method: 'POST',
          body: '{}',
        },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
    },
  });

  const approveRegression = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      await api(
        `/api/v1/orgs/${orgId}/executions/${executionId}/approve-regression`,
        {
          method: 'POST',
          body: '{}',
        },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
    },
  });

  const approveAutomation = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      await api(
        `/api/v1/orgs/${orgId}/executions/${executionId}/approve-automation`,
        {
          method: 'POST',
          body: '{}',
        },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
    },
  });

  const approveReport = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      await api(
        `/api/v1/orgs/${orgId}/executions/${executionId}/approve-report`,
        {
          method: 'POST',
          body: '{}',
        },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
    },
  });

  const approveSignoff = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      await api(
        `/api/v1/orgs/${orgId}/executions/${executionId}/approve-qa-signoff`,
        {
          method: 'POST',
          body: '{}',
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
  const awaitingPlanApproval = liveStatus === 'AWAITING_PLAN_APPROVAL';
  const awaitingDesignApproval = liveStatus === 'AWAITING_DESIGN_APPROVAL';
  const awaitingEnvApproval = liveStatus === 'AWAITING_ENV_APPROVAL';
  const awaitingDataApproval = liveStatus === 'AWAITING_DATA_APPROVAL';
  const awaitingExecutionApproval =
    liveStatus === 'AWAITING_EXECUTION_APPROVAL';
  const awaitingDefectApproval = liveStatus === 'AWAITING_DEFECT_APPROVAL';
  const awaitingRegressionApproval =
    liveStatus === 'AWAITING_REGRESSION_APPROVAL';
  const awaitingAutomationApproval =
    liveStatus === 'AWAITING_AUTOMATION_APPROVAL';
  const awaitingReportApproval = liveStatus === 'AWAITING_REPORT_APPROVAL';
  const awaitingQaSignoff = liveStatus === 'AWAITING_QA_SIGNOFF';
  const awaitingLogin =
    liveStatus === 'AWAITING_LOGIN' ||
    (livePhase === 'AUTHENTICATION' &&
      !awaitingClarification &&
      !awaitingPlanApproval &&
      !awaitingDesignApproval &&
      !awaitingEnvApproval &&
      !awaitingDataApproval &&
      !awaitingExecutionApproval &&
      !awaitingDefectApproval &&
      !awaitingRegressionApproval &&
      !awaitingAutomationApproval &&
      !awaitingReportApproval &&
      !awaitingQaSignoff);
  const awaiting =
    awaitingClarification ||
    awaitingPlanApproval ||
    awaitingDesignApproval ||
    awaitingEnvApproval ||
    awaitingDataApproval ||
    awaitingExecutionApproval ||
    awaitingDefectApproval ||
    awaitingRegressionApproval ||
    awaitingAutomationApproval ||
    awaitingReportApproval ||
    awaitingQaSignoff ||
    awaitingLogin;

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

        {awaitingPlanApproval ? (
          <Card className="border-warning/40 bg-warning/5">
            <h2 className="text-lg font-semibold text-warning">
              Approve test plan
            </h2>
            <p className="mt-2 text-sm text-muted">
              Stage 2 Test Planning is ready. Review the strategy in the event
              log / artifacts, then approve to unlock Stage 3 Test Design.
            </p>
            <Button
              className="mt-4"
              size="lg"
              onClick={() => approvePlan.mutate()}
              disabled={approvePlan.isPending}
            >
              {approvePlan.isPending
                ? 'Approving…'
                : 'Approve test plan & continue'}
            </Button>
            {approvePlan.isError ? (
              <p className="mt-3 text-sm text-danger">
                Could not approve the test plan. Try again.
              </p>
            ) : null}
          </Card>
        ) : null}

        {awaitingDesignApproval ? (
          <Card className="border-warning/40 bg-warning/5">
            <h2 className="text-lg font-semibold text-warning">
              Approve test design
            </h2>
            <p className="mt-2 text-sm text-muted">
              Stage 3 Test Design is ready. Approve to unlock Stage 4 Environment
              Setup. Prefer the project STLC Docs tab to edit/download before Accept.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                size="lg"
                onClick={() => approveDesign.mutate()}
                disabled={approveDesign.isPending}
              >
                {approveDesign.isPending
                  ? 'Approving…'
                  : 'Approve test design & continue'}
              </Button>
              {execution?.projectId || execution?.project?.id ? (
                <Link
                  href={`/app/projects/${execution.projectId ?? execution.project?.id}?tab=cases`}
                >
                  <Button size="lg" variant="secondary">
                    Open Test Board
                  </Button>
                </Link>
              ) : null}
            </div>
            {approveDesign.isError ? (
              <p className="mt-3 text-sm text-danger">
                Could not approve the test design. Try again.
              </p>
            ) : null}
          </Card>
        ) : null}

        {awaitingEnvApproval ? (
          <Card className="border-warning/40 bg-warning/5">
            <h2 className="text-lg font-semibold text-warning">
              Approve environment
            </h2>
            <p className="mt-2 text-sm text-muted">
              Stage 4 Environment checklist is ready (URL, browser mode,
              credentials). Review in STLC Docs, then approve to unlock Test Data.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                size="lg"
                onClick={() => approveEnvironment.mutate()}
                disabled={approveEnvironment.isPending}
              >
                {approveEnvironment.isPending
                  ? 'Approving…'
                  : 'Approve environment & continue'}
              </Button>
              {execution?.projectId || execution?.project?.id ? (
                <Link
                  href={`/app/projects/${execution.projectId ?? execution.project?.id}?tab=cases`}
                >
                  <Button size="lg" variant="secondary">
                    Open STLC Docs
                  </Button>
                </Link>
              ) : null}
            </div>
            {approveEnvironment.isError ? (
              <p className="mt-3 text-sm text-danger">
                Could not approve the environment. Try again.
              </p>
            ) : null}
          </Card>
        ) : null}

        {awaitingDataApproval ? (
          <Card className="border-warning/40 bg-warning/5">
            <h2 className="text-lg font-semibold text-warning">
              Approve test data
            </h2>
            <p className="mt-2 text-sm text-muted">
              Stage 5 Test Data is ready for the designed cases. Review data on
              the Test Board / STLC Docs, then approve to unlock Test Execution.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                size="lg"
                onClick={() => approveData.mutate()}
                disabled={approveData.isPending}
              >
                {approveData.isPending
                  ? 'Approving…'
                  : 'Approve test data & continue'}
              </Button>
              {execution?.projectId || execution?.project?.id ? (
                <Link
                  href={`/app/projects/${execution.projectId ?? execution.project?.id}?tab=cases`}
                >
                  <Button size="lg" variant="secondary">
                    Open Test Board
                  </Button>
                </Link>
              ) : null}
            </div>
            {approveData.isError ? (
              <p className="mt-3 text-sm text-danger">
                Could not approve the test data. Try again.
              </p>
            ) : null}
          </Card>
        ) : null}

        {awaitingExecutionApproval ? (
          <Card className="border-warning/40 bg-warning/5">
            <h2 className="text-lg font-semibold text-warning">
              Approve test execution
            </h2>
            <p className="mt-2 text-sm text-muted">
              Stage 5 Test Execution finished (auth, discovery, functional/API,
              and manual suite). Review results in the event log, then approve
              to unlock Defect Management.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                size="lg"
                onClick={() => approveExecution.mutate()}
                disabled={approveExecution.isPending}
              >
                {approveExecution.isPending
                  ? 'Approving…'
                  : 'Approve execution & continue'}
              </Button>
              {execution?.projectId || execution?.project?.id ? (
                <Link
                  href={`/app/projects/${execution.projectId ?? execution.project?.id}?tab=cases`}
                >
                  <Button size="lg" variant="secondary">
                    Open Test Board
                  </Button>
                </Link>
              ) : null}
            </div>
            {approveExecution.isError ? (
              <p className="mt-3 text-sm text-danger">
                Could not approve the test execution. Try again.
              </p>
            ) : null}
          </Card>
        ) : null}

        {awaitingDefectApproval ? (
          <Card className="border-warning/40 bg-warning/5">
            <h2 className="text-lg font-semibold text-warning">
              Approve defects
            </h2>
            <p className="mt-2 text-sm text-muted">
              Stage 6 Defect Management finished. Review filed bugs in the
              event log, then approve to unlock Regression.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                size="lg"
                onClick={() => approveDefects.mutate()}
                disabled={approveDefects.isPending}
              >
                {approveDefects.isPending
                  ? 'Approving…'
                  : 'Approve defects & continue'}
              </Button>
              <Link href="/app/executions">
                <Button size="lg" variant="secondary">
                  Back to executions
                </Button>
              </Link>
            </div>
            {approveDefects.isError ? (
              <p className="mt-3 text-sm text-danger">
                Could not approve defects. Try again.
              </p>
            ) : null}
          </Card>
        ) : null}

        {awaitingRegressionApproval ? (
          <Card className="border-warning/40 bg-warning/5">
            <h2 className="text-lg font-semibold text-warning">
              Approve regression
            </h2>
            <p className="mt-2 text-sm text-muted">
              Stage 7 Regression finished (retest of failed cases, or skipped
              when none failed). Review results in the event log, then approve
              to unlock Automation.
            </p>
            <Button
              className="mt-4"
              size="lg"
              onClick={() => approveRegression.mutate()}
              disabled={approveRegression.isPending}
            >
              {approveRegression.isPending
                ? 'Approving…'
                : 'Approve regression & continue'}
            </Button>
            {approveRegression.isError ? (
              <p className="mt-3 text-sm text-danger">
                Could not approve regression. Try again.
              </p>
            ) : null}
          </Card>
        ) : null}

        {awaitingAutomationApproval ? (
          <Card className="border-warning/40 bg-warning/5">
            <h2 className="text-lg font-semibold text-warning">
              Approve automation
            </h2>
            <p className="mt-2 text-sm text-muted">
              Stage 8 Automation finished (framework generation + automated
              run). Review in STLC Docs, then approve to unlock Test Reporting.
            </p>
            <Button
              className="mt-4"
              size="lg"
              onClick={() => approveAutomation.mutate()}
              disabled={approveAutomation.isPending}
            >
              {approveAutomation.isPending
                ? 'Approving…'
                : 'Approve automation & continue'}
            </Button>
            {approveAutomation.isError ? (
              <p className="mt-3 text-sm text-danger">
                Could not approve automation. Try again.
              </p>
            ) : null}
          </Card>
        ) : null}

        {awaitingReportApproval ? (
          <Card className="border-warning/40 bg-warning/5">
            <h2 className="text-lg font-semibold text-warning">
              Approve test report
            </h2>
            <p className="mt-2 text-sm text-muted">
              Stage 9 Test Reporting is ready (HTML report + STLC pack). Review
              in STLC Docs, then approve to unlock Sign-off.
            </p>
            <Button
              className="mt-4"
              size="lg"
              onClick={() => approveReport.mutate()}
              disabled={approveReport.isPending}
            >
              {approveReport.isPending
                ? 'Approving…'
                : 'Approve report & continue'}
            </Button>
            {approveReport.isError ? (
              <p className="mt-3 text-sm text-danger">
                Could not approve the report. Try again.
              </p>
            ) : null}
          </Card>
        ) : null}

        {awaitingQaSignoff ? (
          <Card className="border-warning/40 bg-warning/5">
            <h2 className="text-lg font-semibold text-warning">
              QA Sign-off
            </h2>
            <p className="mt-2 text-sm text-muted">
              Stage 10 Sign-off scorecard is ready. AI recommends go/no-go;
              human Accept closes the STLC run.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                size="lg"
                onClick={() => approveSignoff.mutate()}
                disabled={approveSignoff.isPending}
              >
                {approveSignoff.isPending
                  ? 'Signing off…'
                  : 'Sign off & complete STLC'}
              </Button>
              <a
                href={
                  orgId
                    ? `${API_URL}/api/v1/orgs/${orgId}/executions/${executionId}/download-zip`
                    : undefined
                }
                className="inline-flex"
                aria-disabled={!orgId}
              >
                <Button size="lg" variant="secondary" disabled={!orgId}>
                  Download evidence pack
                </Button>
              </a>
            </div>
            {approveSignoff.isError ? (
              <p className="mt-3 text-sm text-danger">
                Could not complete QA sign-off. Try again.
              </p>
            ) : null}
            {approveSignoff.isSuccess ? (
              <p className="mt-3 text-sm text-success">
                QA sign-off recorded. Closing STLC run…
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
