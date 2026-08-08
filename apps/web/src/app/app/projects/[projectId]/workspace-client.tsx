'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { api, ApiError, API_URL } from '@/lib/api';
import { cn } from '@/lib/cn';

type TabId =
  | 'overview'
  | 'requirements'
  | 'clarification'
  | 'test-board'
  | 'bugs'
  | 'results';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'clarification', label: 'Clarification' },
  { id: 'test-board', label: 'Test Board' },
  { id: 'bugs', label: 'Bugs' },
  { id: 'results', label: 'Results' },
];

const POLL_STATUSES = new Set([
  'RUNNING',
  'QUEUED',
  'AWAITING_CLARIFICATION',
  'AWAITING_LOGIN',
]);

type ClarificationQuestion = {
  id: string;
  question: string;
  reason?: string;
  required?: boolean;
};

type WorkspaceProject = {
  id: string;
  name: string;
  appUrl: string;
  organizationId?: string;
  loginUrl?: string | null;
  requirementText?: string | null;
  framework?: string | null;
  language?: string | null;
  environment?: string | null;
};

type LatestExecution = {
  id: string;
  status: string;
  phase?: string;
  errorSummary?: string | null;
  runMode?: string | null;
};

const STLC_STAGES = [
  'REQUIREMENTS',
  'CLARIFICATION',
  'TEST_STRATEGY',
  'TEST_DESIGN',
  'AUTHENTICATION',
  'DISCOVERY',
  'FUNCTIONAL',
  'API',
  'MANUAL_TEST',
  'BUG_ANALYSIS',
  'RETEST',
  'AUTOMATION',
  'EXECUTION',
  'REPORT',
  'QUALITY_ANALYSIS',
  'GITHUB',
  'DONE',
] as const;

type Workspace = {
  project: WorkspaceProject;
  latestExecution?: LatestExecution | null;
  requirementsClear?: boolean;
  requirementSnapshot?: { clear?: boolean; payload?: unknown } | null;
  requirementDocuments?: Array<{
    id: string;
    filename: string;
    mime: string;
    createdAt: string;
    hasParsedText: boolean;
  }>;
  openClarification?: {
    round: number;
    questions: unknown;
    executionId?: string | null;
  } | null;
  strategy?: {
    summary?: string;
    objectives?: string[];
    riskAreas?: string[];
  } | null;
  artifacts?: Array<{
    id: string;
    type: string;
    storageKey: string;
    mime: string;
    size?: number | null;
  }>;
  testCases: Array<{
    id: string;
    externalId: string;
    module?: string | null;
    scenario: string;
    expected: string;
    priority?: string | null;
    severity?: string | null;
    type?: string | null;
    testData?: Record<string, string> | null;
  }>;
  bugs: Array<{
    id: string;
    title: string;
    severity: string;
    status: string;
    description: string;
    stepsToReproduce?: string | null;
  }>;
  results: Array<{
    id: string;
    status: string;
    message?: string | null;
    durationMs?: number | null;
    testCase?: { externalId?: string; scenario?: string } | null;
  }>;
  counts: {
    testCases: number;
    documents?: number;
    bugs: number;
    results: number;
    passed: number;
    failed: number;
  };
};

function asQuestions(raw: unknown): ClarificationQuestion[] {
  if (!raw) return [];
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' &&
        raw !== null &&
        Array.isArray((raw as { questions?: unknown }).questions)
      ? ((raw as { questions: unknown[] }).questions ?? [])
      : [];

  const out: ClarificationQuestion[] = [];
  list.forEach((item, index) => {
    if (typeof item === 'string') {
      out.push({ id: `q-${index}`, question: item });
      return;
    }
    if (!item || typeof item !== 'object') return;
    const q = item as Record<string, unknown>;
    const question =
      typeof q.question === 'string'
        ? q.question
        : typeof q.text === 'string'
          ? q.text
          : typeof q.prompt === 'string'
            ? q.prompt
            : null;
    if (!question) return;
    out.push({
      id: typeof q.id === 'string' && q.id ? q.id : `q-${index}`,
      question,
      reason: typeof q.reason === 'string' ? q.reason : undefined,
      required: Boolean(q.required),
    });
  });
  return out;
}

function downloadUrl(
  projectId: string,
  kind: 'test-cases' | 'bugs' | 'results',
  format: string,
): string {
  const base = API_URL.replace(/\/$/, '');
  return `${base}/api/v1/projects/${projectId}/${kind}/download?format=${encodeURIComponent(format)}`;
}

function statusTone(
  status?: string | null,
): 'success' | 'danger' | 'warning' | 'accent' | 'default' {
  if (!status) return 'default';
  if (status === 'COMPLETED' || status === 'PASSED') return 'success';
  if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED')
    return 'danger';
  if (
    status === 'AWAITING_LOGIN' ||
    status === 'AWAITING_CLARIFICATION' ||
    status === 'QUEUED'
  )
    return 'warning';
  if (status === 'RUNNING') return 'accent';
  return 'default';
}

function DownloadLinks({
  projectId,
  kind,
  formats,
}: {
  projectId: string;
  kind: 'test-cases' | 'bugs' | 'results';
  formats: string[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {formats.map((format) => (
        <a
          key={format}
          href={downloadUrl(projectId, kind, format)}
          className="inline-flex"
        >
          <Button variant="secondary" size="sm" type="button">
            {format.toUpperCase()}
          </Button>
        </a>
      ))}
    </div>
  );
}

export default function ProjectWorkspacePage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const tabParam = searchParams.get('tab');
  const activeTab: TabId = useMemo(() => {
    const match = TABS.find((t) => t.id === tabParam);
    return match?.id ?? 'overview';
  }, [tabParam]);

  const [requirementText, setRequirementText] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const workspaceQuery = useQuery({
    queryKey: ['project-workspace', projectId],
    queryFn: async () => {
      try {
        return await api<Workspace>(
          `/api/v1/projects/${projectId}/workspace`,
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) return null;
        throw e;
      }
    },
    enabled: Boolean(projectId),
    refetchInterval: (q) => {
      const status = q.state.data?.latestExecution?.status;
      return status && POLL_STATUSES.has(status) ? 2500 : false;
    },
  });

  const workspace = workspaceQuery.data ?? null;
  const project = workspace?.project;
  const latest = workspace?.latestExecution ?? null;
  const questions = useMemo(
    () => asQuestions(workspace?.openClarification?.questions),
    [workspace?.openClarification?.questions],
  );

  useEffect(() => {
    if (project?.requirementText != null) {
      setRequirementText(project.requirementText);
    }
  }, [project?.requirementText]);

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

  const setTab = (tab: TabId) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', tab);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ['project-workspace', projectId],
    });

  const startPhase1 = useMutation({
    mutationFn: async () => {
      setActionError(null);
      return api(`/api/v1/projects/${projectId}/stlc/start`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      void invalidate();
      setTab('overview');
    },
    onError: (e) => {
      setActionError(
        e instanceof ApiError ? e.message : 'Failed to start STLC run',
      );
    },
  });

  const uploadRequirement = async (file: File) => {
    setActionError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(
        `${API_URL.replace(/\/$/, '')}/api/v1/projects/${projectId}/requirements/upload`,
        {
          method: 'POST',
          credentials: 'include',
          body: form,
        },
      );
      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!res.ok) {
        throw new ApiError(
          typeof data === 'object' &&
            data &&
            'message' in data &&
            typeof (data as { message: unknown }).message === 'string'
            ? (data as { message: string }).message
            : 'Upload failed',
          res.status,
          data,
        );
      }
      await invalidate();
    } catch (e) {
      setActionError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Upload failed',
      );
    } finally {
      setUploading(false);
    }
  };

  const saveRequirements = useMutation({
    mutationFn: async () => {
      setActionError(null);
      await api(`/api/v1/projects/${projectId}/requirements`, {
        method: 'PATCH',
        body: JSON.stringify({ requirementText }),
      });
    },
    onSuccess: () => {
      void invalidate();
    },
    onError: (e) => {
      setActionError(
        e instanceof ApiError ? e.message : 'Failed to save requirements',
      );
    },
  });

  const saveAndStart = useMutation({
    mutationFn: async () => {
      setActionError(null);
      await api(`/api/v1/projects/${projectId}/requirements`, {
        method: 'PATCH',
        body: JSON.stringify({ requirementText }),
      });
      return api(`/api/v1/projects/${projectId}/stlc/start`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      void invalidate();
      setTab('overview');
    },
    onError: (e) => {
      setActionError(
        e instanceof ApiError
          ? e.message
          : 'Failed to save requirements and start STLC',
      );
    },
  });

  const clarify = useMutation({
    mutationFn: async (opts: { skip?: boolean }) => {
      setActionError(null);
      return api(`/api/v1/projects/${projectId}/clarify`, {
        method: 'POST',
        body: JSON.stringify({
          skip: Boolean(opts.skip),
          answers: opts.skip ? {} : answers,
        }),
      });
    },
    onSuccess: () => {
      void invalidate();
      setTab('overview');
    },
    onError: (e) => {
      setActionError(
        e instanceof ApiError ? e.message : 'Failed to submit clarification',
      );
    },
  });

  const continueAfterLogin = useMutation({
    mutationFn: async () => {
      setActionError(null);
      if (!latest?.id) throw new Error('No execution to continue');
      let orgId = project?.organizationId;
      if (!orgId) {
        const orgs = await api<Array<{ id: string }>>('/api/v1/orgs');
        orgId = Array.isArray(orgs) ? orgs[0]?.id : undefined;
      }
      if (!orgId) throw new Error('No organization found');
      return api(
        `/api/v1/orgs/${orgId}/executions/${latest.id}/continue-after-login`,
        {
          method: 'POST',
          body: JSON.stringify({ executionId: latest.id }),
        },
      );
    },
    onSuccess: () => {
      void invalidate();
    },
    onError: (e) => {
      setActionError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to continue after login',
      );
    },
  });

  if (workspaceQuery.isLoading) {
    return <p className="text-sm text-muted">Loading workspace…</p>;
  }

  if (workspaceQuery.error && !workspace) {
    return (
      <Card>
        <p className="text-sm text-danger">
          {workspaceQuery.error instanceof ApiError
            ? workspaceQuery.error.message
            : 'Could not load project workspace.'}
        </p>
        <Link href="/app/projects" className="mt-4 inline-block">
          <Button variant="secondary" size="sm">
            Back to projects
          </Button>
        </Link>
      </Card>
    );
  }

  if (!project) {
    return (
      <Card>
        <p className="text-sm text-muted">Project not found.</p>
        <Link href="/app/projects" className="mt-4 inline-block">
          <Button variant="secondary" size="sm">
            Back to projects
          </Button>
        </Link>
      </Card>
    );
  }

  const awaitingLogin = latest?.status === 'AWAITING_LOGIN';
  const awaitingClarification =
    latest?.status === 'AWAITING_CLARIFICATION' ||
    Boolean(workspace?.openClarification);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Link href="/app/projects" className="hover:text-fg">
              Projects
            </Link>
            <span>/</span>
            <span className="text-fg">{project.name}</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {project.name}
          </h1>
          <p className="mt-1 font-mono text-xs text-muted">{project.appUrl}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {project.framework ? <Badge>{project.framework}</Badge> : null}
            {project.language ? <Badge>{project.language}</Badge> : null}
            {project.environment ? (
              <Badge tone="accent">{project.environment}</Badge>
            ) : null}
            {latest ? (
              <Badge tone={statusTone(latest.status)}>{latest.status}</Badge>
            ) : (
              <Badge>No runs yet</Badge>
            )}
            {workspace?.requirementsClear ? (
              <Badge tone="success">Requirements clear</Badge>
            ) : (
              <Badge tone="warning">Requirements unclear</Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {awaitingLogin ? (
            <Button
              onClick={() => continueAfterLogin.mutate()}
              disabled={continueAfterLogin.isPending}
            >
              {continueAfterLogin.isPending
                ? 'Continuing…'
                : 'Continue after login'}
            </Button>
          ) : null}
          <Button
            onClick={() => startPhase1.mutate()}
            disabled={startPhase1.isPending || POLL_STATUSES.has(latest?.status ?? '')}
          >
            {startPhase1.isPending ? 'Starting…' : 'Start STLC'}
          </Button>
        </div>
      </div>

      {actionError ? (
        <p className="text-sm text-danger">{actionError}</p>
      ) : null}

      {awaitingLogin ? (
        <Card className="border-warning/40 bg-warning/5">
          <h2 className="text-base font-semibold text-warning">
            Login required
          </h2>
          <p className="mt-2 text-sm text-muted">
            Complete login in the browser session
            {project.loginUrl ? (
              <>
                {' '}
                (
                <a
                  href={project.loginUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  open login URL
                </a>
                )
              </>
            ) : null}
            , then continue the STLC run.
          </p>
          <div className="mt-4">
            <Button
              onClick={() => continueAfterLogin.mutate()}
              disabled={continueAfterLogin.isPending}
            >
              {continueAfterLogin.isPending
                ? 'Continuing…'
                : 'Continue after login'}
            </Button>
          </div>
        </Card>
      ) : null}

      {awaitingClarification ? (
        <Card className="border-warning/40 bg-warning/5">
          <h2 className="text-base font-semibold text-warning">
            Clarification needed
          </h2>
          <p className="mt-2 text-sm text-muted">
            Answer open questions in the Clarification tab to continue STLC.
          </p>
          <div className="mt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setTab('clarification')}
            >
              Open clarification
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b border-border pb-px">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTab(tab.id)}
            className={cn(
              'rounded-t-lg px-3 py-2 text-sm transition',
              activeTab === tab.id
                ? 'border border-b-transparent border-border bg-surface text-fg'
                : 'text-muted hover:text-fg',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Test cases', value: workspace?.counts.testCases ?? 0 },
            { label: 'Bugs', value: workspace?.counts.bugs ?? 0 },
            { label: 'Passed', value: workspace?.counts.passed ?? 0 },
            { label: 'Failed', value: workspace?.counts.failed ?? 0 },
          ].map((item) => (
            <Card key={item.label}>
              <div className="text-xs uppercase tracking-wide text-muted">
                {item.label}
              </div>
              <div className="mt-2 text-3xl font-semibold tabular-nums">
                {item.value}
              </div>
            </Card>
          ))}
          <Card className="md:col-span-2 xl:col-span-4 space-y-3">
            <h2 className="text-base font-medium">STLC stage timeline</h2>
            <div className="flex flex-wrap gap-1.5">
              {STLC_STAGES.map((stage) => {
                const current = latest?.phase ?? 'INIT';
                const currentIdx = STLC_STAGES.indexOf(
                  current as (typeof STLC_STAGES)[number],
                );
                const stageIdx = STLC_STAGES.indexOf(stage);
                const done =
                  latest?.status === 'COMPLETED' ||
                  (currentIdx >= 0 && stageIdx < currentIdx);
                const active = current === stage;
                return (
                  <span
                    key={stage}
                    className={cn(
                      'rounded border px-2 py-1 text-[10px] font-medium tracking-wide',
                      active
                        ? 'border-accent bg-accent/10 text-accent'
                        : done
                          ? 'border-success/40 bg-success/10 text-success'
                          : 'border-border text-muted',
                    )}
                  >
                    {stage.replace(/_/g, ' ')}
                  </span>
                );
              })}
            </div>
          </Card>
          <Card className="md:col-span-2 xl:col-span-4">
            <h2 className="text-base font-medium">Latest execution</h2>
            {latest ? (
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(latest.status)}>
                    {latest.status}
                  </Badge>
                  {latest.phase ? <Badge>{latest.phase}</Badge> : null}
                  {latest.runMode ? <Badge>{latest.runMode}</Badge> : null}
                </div>
                <p className="font-mono text-xs text-muted">{latest.id}</p>
                {latest.errorSummary ? (
                  <p className="text-danger">{latest.errorSummary}</p>
                ) : null}
                <Link
                  href={`/app/executions/${latest.id}`}
                  className="inline-flex text-accent hover:underline"
                >
                  Open live execution
                </Link>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">
                No STLC run yet. Add requirements (text or PDF/DOCX/TXT), then
                start STLC.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                onClick={() => startPhase1.mutate()}
                disabled={
                  startPhase1.isPending ||
                  POLL_STATUSES.has(latest?.status ?? '')
                }
              >
                {startPhase1.isPending ? 'Starting…' : 'Start STLC'}
              </Button>
              {(workspace?.artifacts ?? []).some(
                (a) =>
                  a.type === 'STLC_FINAL_ZIP' || a.type === 'ZIP_PACKAGE',
              ) ? (
                <a
                  href={`${API_URL.replace(/\/$/, '')}/api/v1/projects/${projectId}/stlc/final-pack`}
                  className="inline-flex"
                >
                  <Button variant="secondary">Download final STLC pack</Button>
                </a>
              ) : null}
              {awaitingLogin ? (
                <Button
                  variant="secondary"
                  onClick={() => continueAfterLogin.mutate()}
                  disabled={continueAfterLogin.isPending}
                >
                  Continue after login
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => setTab('requirements')}
              >
                Edit requirements
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {activeTab === 'requirements' ? (
        <Card className="space-y-4">
          <div>
            <h2 className="text-base font-medium">Requirements</h2>
            <p className="mt-1 text-sm text-muted">
              Paste requirements text and/or upload PDF, DOCX, or TXT for the
              Requirement Agent.
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-border px-3 py-4">
            <label className="flex cursor-pointer flex-col gap-2 text-sm">
              <span className="font-medium">Upload PDF / DOCX / TXT</span>
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void uploadRequirement(file);
                }}
              />
              <span className="text-xs text-muted">
                {uploading
                  ? 'Uploading and parsing…'
                  : 'Parsed text is appended to the requirements field.'}
              </span>
            </label>
            {(workspace?.requirementDocuments ?? []).length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-muted">
                {(workspace?.requirementDocuments ?? []).map((d) => (
                  <li key={d.id}>
                    {d.filename}
                    {d.hasParsedText ? ' · parsed' : ' · stored'}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <textarea
            className="min-h-56 w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-fg outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
            value={requirementText}
            onChange={(e) => setRequirementText(e.target.value)}
            placeholder="Paste or write product requirements…"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => saveRequirements.mutate()}
              disabled={
                saveRequirements.isPending ||
                requirementText.trim().length === 0
              }
            >
              {saveRequirements.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              onClick={() => saveAndStart.mutate()}
              disabled={
                saveAndStart.isPending ||
                (requirementText.trim().length === 0 &&
                  (workspace?.requirementDocuments?.length ?? 0) === 0)
              }
            >
              {saveAndStart.isPending ? 'Starting…' : 'Save & start STLC'}
            </Button>
          </div>
        </Card>
      ) : null}

      {activeTab === 'clarification' ? (
        <Card className="space-y-4">
          <div>
            <h2 className="text-base font-medium">Clarification</h2>
            <p className="mt-1 text-sm text-muted">
              {workspace?.openClarification
                ? `Round ${workspace.openClarification.round}`
                : 'No open clarification questions.'}
            </p>
          </div>
          {questions.length === 0 ? (
            <p className="text-sm text-muted">
              When STLC needs more detail, questions will appear here.
            </p>
          ) : (
            <div className="space-y-4">
              {questions.map((q) => (
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
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => clarify.mutate({})}
                  disabled={clarify.isPending}
                >
                  {clarify.isPending ? 'Submitting…' : 'Submit answers'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => clarify.mutate({ skip: true })}
                  disabled={clarify.isPending}
                >
                  Skip
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {activeTab === 'test-board' ? (
        <div className="space-y-4">
          {workspace?.strategy ? (
            <Card className="space-y-2">
              <h2 className="text-base font-medium">Test strategy</h2>
              <p className="text-sm text-muted">
                {workspace.strategy.summary ?? 'Strategy generated for this run.'}
              </p>
              {workspace.strategy.objectives?.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                  {workspace.strategy.objectives.slice(0, 5).map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              ) : null}
              {workspace.strategy.riskAreas?.length ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {workspace.strategy.riskAreas.slice(0, 6).map((r) => (
                    <Badge key={r} tone="warning">
                      {r}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </Card>
          ) : null}
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-medium">Test Board</h2>
                <p className="mt-1 text-sm text-muted">
                  {workspace?.counts.testCases ?? 0} designed case
                  {(workspace?.counts.testCases ?? 0) === 1 ? '' : 's'} with data
                </p>
              </div>
              <DownloadLinks
                projectId={projectId}
                kind="test-cases"
                formats={['csv', 'xlsx', 'json']}
              />
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-bg-elevated text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">ID</th>
                    <th className="px-3 py-2 font-medium">Module</th>
                    <th className="px-3 py-2 font-medium">Scenario</th>
                    <th className="px-3 py-2 font-medium">Data</th>
                    <th className="px-3 py-2 font-medium">Priority</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {(workspace?.testCases ?? []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-6 text-center text-muted"
                      >
                        No test cases yet — strategy/design runs before login.
                      </td>
                    </tr>
                  ) : (
                    (workspace?.testCases ?? []).map((tc) => (
                      <tr
                        key={tc.id}
                        className="border-t border-border align-top"
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          {tc.externalId}
                        </td>
                        <td className="px-3 py-2 text-muted">
                          {tc.module ?? '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{tc.scenario}</div>
                          <div className="mt-1 text-xs text-muted line-clamp-2">
                            {tc.expected}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-muted">
                          {tc.testData
                            ? Object.entries(tc.testData)
                                .slice(0, 3)
                                .map(([k, v]) => `${k}=${v}`)
                                .join(' · ')
                            : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {tc.priority ? (
                            <Badge>{tc.priority}</Badge>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted">
                          {tc.type ?? '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {activeTab === 'bugs' ? (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">Bugs</h2>
              <p className="mt-1 text-sm text-muted">
                {workspace?.counts.bugs ?? 0} bug
                {(workspace?.counts.bugs ?? 0) === 1 ? '' : 's'}
              </p>
            </div>
            <DownloadLinks
              projectId={projectId}
              kind="bugs"
              formats={['csv', 'xlsx', 'json', 'html']}
            />
          </div>
          <div className="space-y-3">
            {(workspace?.bugs ?? []).length === 0 ? (
              <p className="text-sm text-muted">No bugs reported yet.</p>
            ) : (
              (workspace?.bugs ?? []).map((bug) => (
                <div
                  key={bug.id}
                  className="rounded-lg border border-border px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="font-medium">{bug.title}</div>
                    <div className="flex gap-2">
                      <Badge tone={statusTone(bug.severity)}>
                        {bug.severity}
                      </Badge>
                      <Badge>{bug.severity}</Badge>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-muted">{bug.description}</p>
                  {bug.stepsToReproduce ? (
                    <p className="mt-2 whitespace-pre-wrap text-xs text-muted">
                      {bug.stepsToReproduce}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Card>
      ) : null}

      {activeTab === 'results' ? (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">Results</h2>
              <p className="mt-1 text-sm text-muted">
                {workspace?.counts.passed ?? 0} passed ·{' '}
                {workspace?.counts.failed ?? 0} failed ·{' '}
                {workspace?.counts.results ?? 0} total
              </p>
              {(workspace?.artifacts ?? []).length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(workspace?.artifacts ?? [])
                    .filter((a) =>
                      [
                        'APPLICATION_MAP',
                        'FUNCTIONAL_FINDINGS',
                        'API_RESULTS',
                        'QUALITY_ANALYSIS_JSON',
                        'STLC_FINAL_ZIP',
                      ].includes(a.type),
                    )
                    .map((a) => (
                      <Badge key={a.id}>{a.type.replace(/_/g, ' ')}</Badge>
                    ))}
                </div>
              ) : null}
            </div>
            <DownloadLinks
              projectId={projectId}
              kind="results"
              formats={['csv', 'xlsx', 'json', 'html']}
            />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-bg-elevated text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Case</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                  <th className="px-3 py-2 font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {(workspace?.results ?? []).length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center text-muted"
                    >
                      No results yet.
                    </td>
                  </tr>
                ) : (
                  (workspace?.results ?? []).map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-border align-top"
                    >
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs text-muted">
                          {r.testCase?.externalId ?? '—'}
                        </div>
                        <div>{r.testCase?.scenario ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted">
                        {typeof r.durationMs === 'number'
                          ? `${r.durationMs} ms`
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {r.message ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
