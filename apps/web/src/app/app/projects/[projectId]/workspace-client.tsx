'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

type RequirementDoc = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize?: number | null;
  sourceType: string;
  originalContent?: string | null;
  createdAt: string;
};

type ReviewFact = {
  text: string;
  status: string;
  source?: string | null;
};

type BusinessReviewPayload = {
  intent: ReviewFact | null;
  actors: ReviewFact[];
  rules: ReviewFact[];
  preconditions: ReviewFact[];
  flow: ReviewFact[];
  states: ReviewFact[];
  transitions: ReviewFact[];
  exceptions: ReviewFact[];
  outcomes: ReviewFact[];
  dependencies: ReviewFact[];
  permissions: ReviewFact[];
};

type FunctionalReviewPayload = {
  inputs: ReviewFact[];
  outputs: ReviewFact[];
  validations: ReviewFact[];
  successBehavior: ReviewFact[];
  failureBehavior: ReviewFact[];
  errorHandling: ReviewFact[];
  navigation: ReviewFact[];
  dataHandling: ReviewFact[];
};

type ReviewQuestion = {
  id: string;
  questionKey: string;
  category: string;
  priority: string;
  question: string;
  reason: string;
  blocking: boolean;
  status: string;
  answer?: string | null;
  answeredAt?: string | null;
};

type ExtractedRequirement = {
  id: string;
  requirementKey: string;
  title: string;
  description: string;
  type: string;
  priority?: string | null;
  status: string;
  sourcePage?: number | null;
  sourceSection?: string | null;
  sourceText?: string | null;
  sourceDocumentName?: string | null;
  acceptanceCriteria: string[];
  businessRules: string[];
  dependencies: string[];
  supportingInformation?: string[];
  possibleDuplicateOf?: string | null;
  reviewStatus?: string | null;
  businessReadiness?: string | null;
  functionalCompleteness?: string | null;
  businessReview?: BusinessReviewPayload | null;
  functionalReview?: FunctionalReviewPayload | null;
  readinessScore?: number | null;
  reviewedAt?: string | null;
  openQuestionCount?: number;
  criticalOpenCount?: number;
  highOpenCount?: number;
  questions?: ReviewQuestion[];
};

type ReviewSummary = {
  total: number;
  reviewed: number;
  business: {
    ready: number;
    needsClarification: number;
    blocked: number;
  };
  functional: {
    complete: number;
    partial: number;
    incomplete: number;
  };
  questions: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  openConflicts: number;
  businessReadinessPct: number;
  functionalReadinessPct: number;
  byReviewStatus: {
    blocked: number;
    needsClarification: number;
    reviewRecommended: number;
    readyForTestDesign: number;
  };
};

type ReviewConflict = {
  id: string;
  summary: string;
  detail: string;
  status: string;
  requirementA: { requirementKey: string; title: string };
  requirementB: { requirementKey: string; title: string };
};

type ExtractionSummary = {
  total: number;
  functional: number;
  nonFunctional: number;
  businessRules: number;
  possibleDuplicates: number;
  sourceDocument: string;
  rejected?: number;
  merged?: number;
  retitled?: number;
  reclassified?: number;
  previousCount?: number;
  tables?: number;
};

type ExtractionDecision = {
  decision: string;
  reason?: string;
  source?: string;
  aiCandidate?: string;
  sourceElementType?: string;
  parentKey?: string;
  parentTitle?: string;
  type?: string;
  requirementKey?: string;
  title?: string;
  intoKey?: string;
  intoTitle?: string;
  detail?: string;
};

const SHOW_EXTRACTION_DEBUG =
  process.env.NODE_ENV === 'development' ||
  process.env.NEXT_PUBLIC_EXTRACTION_DEBUG === 'true';

type ProjectDetail = {
  id: string;
  name: string;
  appUrl?: string | null;
  status?: string | null;
  createdAt: string;
  requirementCount?: number;
  extractedRequirementCount?: number;
  requirements?: RequirementDoc[];
  primaryRequirement?: RequirementDoc | null;
};

const WORKFLOW = [
  { id: 'project', label: 'Project', state: 'done' as const },
  { id: 'requirements', label: 'Requirements', state: 'active' as const },
  { id: 'test-design', label: 'Test Design', state: 'locked' as const },
  { id: 'manual', label: 'Manual Testing', state: 'locked' as const },
  { id: 'bugs', label: 'Bug Management', state: 'locked' as const },
  { id: 'automation', label: 'Automation', state: 'locked' as const },
  { id: 'execution', label: 'Execution', state: 'locked' as const },
  { id: 'reports', label: 'Reports', state: 'locked' as const },
];

const EXTRACT_STEPS = [
  'Requirement document loaded',
  'Requirement content read',
  'Identifying individual requirements',
  'Identifying acceptance criteria',
  'Structuring requirements',
];

const REVIEW_STEPS = [
  'Business intent',
  'Business rules',
  'Actors & permissions',
  'States & transitions',
  'Functional completeness',
  'Clarifying questions',
];

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return value;
  }
}

function typeLabel(type: string) {
  if (type === 'NON_FUNCTIONAL') return 'Non-Functional';
  if (type === 'BUSINESS_RULE') return 'Business Rule';
  return 'Functional';
}

function emptyField(values: string[] | null | undefined) {
  if (!values || values.length === 0) return 'Not provided in source';
  return values.join('\n');
}

function reviewStatusLabel(status?: string | null) {
  if (!status) return 'Not reviewed';
  if (status === 'READY_FOR_TEST_DESIGN') return 'Ready for test design';
  if (status === 'NEEDS_CLARIFICATION') return 'Needs clarification';
  if (status === 'REVIEW_RECOMMENDED') return 'Review recommended';
  if (status === 'BLOCKED') return 'Blocked';
  return status;
}

function reviewStatusTone(
  status?: string | null,
): 'success' | 'warning' | 'danger' | 'accent' | undefined {
  if (!status) return undefined;
  if (status === 'READY_FOR_TEST_DESIGN') return 'success';
  if (status === 'BLOCKED') return 'danger';
  if (status === 'NEEDS_CLARIFICATION') return 'warning';
  return 'accent';
}

function factStatusTone(
  status: string,
): 'success' | 'warning' | 'danger' | 'accent' | undefined {
  if (status === 'CONFIRMED' || status === 'DERIVED_FROM_USER_ANSWER') {
    return 'success';
  }
  if (status === 'INFERRED') return 'accent';
  if (status === 'MISSING') return 'warning';
  return undefined;
}

function isBusinessQuestionCategory(category: string) {
  return [
    'BUSINESS_RULE',
    'BUSINESS_FLOW',
    'ACTOR',
    'ROLE_PERMISSION',
    'PRECONDITION',
    'STATE',
    'STATE_TRANSITION',
    'EXCEPTION',
    'BUSINESS_OUTCOME',
  ].includes(category);
}

function FactList({
  title,
  facts,
}: {
  title: string;
  facts: ReviewFact[] | null | undefined;
}) {
  if (!facts || facts.length === 0) {
    return (
      <div>
        <div className="text-xs uppercase tracking-wide text-muted">{title}</div>
        <p className="mt-1 text-muted">None identified</p>
      </div>
    );
  }
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">{title}</div>
      <ul className="mt-1 space-y-1.5">
        {facts.map((f, i) => (
          <li key={`${f.text}-${i}`} className="flex flex-wrap items-start gap-2">
            <Badge tone={factStatusTone(f.status)}>{f.status}</Badge>
            <span>{f.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ProjectWorkspacePage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const tab = searchParams.get('tab') ?? 'requirements';
  const view = searchParams.get('view') ?? 'source';
  const selectedKey = searchParams.get('req');

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [progressStep, setProgressStep] = useState(0);
  const [reviewProgressStep, setReviewProgressStep] = useState(0);
  const [summary, setSummary] = useState<ExtractionSummary | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [debugDecisions, setDebugDecisions] = useState<ExtractionDecision[]>(
    [],
  );

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      try {
        return await api<ProjectDetail>(`/api/v1/projects/${projectId}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) return null;
        throw e;
      }
    },
    enabled: Boolean(projectId),
  });

  const extractedQuery = useQuery({
    queryKey: ['extracted-requirements', projectId],
    queryFn: async () => {
      try {
        return await api<ExtractedRequirement[]>(
          `/api/v1/projects/${projectId}/extracted-requirements`,
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) return [] as ExtractedRequirement[];
        throw e;
      }
    },
    enabled: Boolean(projectId),
  });

  const debugQuery = useQuery({
    queryKey: ['extraction-debug', projectId],
    queryFn: async () => {
      try {
        return await api<{
          decisions: ExtractionDecision[];
          stats: Record<string, number> | null;
        }>(`/api/v1/projects/${projectId}/extraction-debug`);
      } catch {
        return { decisions: [], stats: null };
      }
    },
    enabled: Boolean(projectId) && SHOW_EXTRACTION_DEBUG,
  });

  const reviewSummaryQuery = useQuery({
    queryKey: ['review-summary', projectId],
    queryFn: async () => {
      try {
        return await api<ReviewSummary>(
          `/api/v1/projects/${projectId}/review-summary`,
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) return null;
        throw e;
      }
    },
    enabled: Boolean(projectId),
  });

  const conflictsQuery = useQuery({
    queryKey: ['review-conflicts', projectId],
    queryFn: async () => {
      try {
        return await api<ReviewConflict[]>(
          `/api/v1/projects/${projectId}/review-conflicts`,
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) return [] as ReviewConflict[];
        throw e;
      }
    },
    enabled: Boolean(projectId),
  });

  const project = projectQuery.data;
  const sourceDoc = useMemo(() => {
    if (!project) return null;
    return project.primaryRequirement ?? project.requirements?.[0] ?? null;
  }, [project]);

  const extracted = extractedQuery.data ?? [];

  const filtered = useMemo(() => {
    return extracted.filter((r) => {
      if (typeFilter !== 'ALL' && r.type !== typeFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        r.requirementKey.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
      );
    });
  }, [extracted, search, typeFilter]);

  const selected = useMemo(
    () => extracted.find((r) => r.requirementKey === selectedKey) ?? null,
    [extracted, selectedKey],
  );

  const extractMutation = useMutation({
    mutationFn: async () => {
      setExtractError(null);
      setSummary(null);
      setProgressStep(0);
      return api<{
        ok: boolean;
        summary: ExtractionSummary;
        requirements: ExtractedRequirement[];
        debug?: { decisions: ExtractionDecision[] };
      }>(`/api/v1/projects/${projectId}/extract-requirements`, {
        method: 'POST',
        body: '{}',
      });
    },
    onSuccess: async (data) => {
      setProgressStep(EXTRACT_STEPS.length);
      setSummary(data.summary);
      if (data.debug?.decisions) setDebugDecisions(data.debug.decisions);
      await queryClient.invalidateQueries({
        queryKey: ['extracted-requirements', projectId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['extraction-debug', projectId],
      });
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      router.replace(`?tab=requirements&view=summary`, { scroll: false });
    },
    onError: (e) => {
      setExtractError(
        e instanceof ApiError
          ? e.message
          : 'We couldn\'t extract the requirements.',
      );
    },
  });

  useEffect(() => {
    if (!extractMutation.isPending) return;
    setProgressStep(0);
    const timers = [
      window.setTimeout(() => setProgressStep(1), 400),
      window.setTimeout(() => setProgressStep(2), 900),
      window.setTimeout(() => setProgressStep(3), 1500),
      window.setTimeout(() => setProgressStep(4), 2200),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [extractMutation.isPending]);

  const reviewMutation = useMutation({
    mutationFn: async () => {
      setReviewError(null);
      setReviewProgressStep(0);
      return api<{ ok: boolean; summary: ReviewSummary }>(
        `/api/v1/projects/${projectId}/review-requirements`,
        { method: 'POST', body: '{}' },
      );
    },
    onSuccess: async () => {
      setReviewProgressStep(REVIEW_STEPS.length);
      await queryClient.invalidateQueries({
        queryKey: ['extracted-requirements', projectId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['review-summary', projectId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['review-conflicts', projectId],
      });
      router.replace(`?tab=requirements&view=review-dashboard`, {
        scroll: false,
      });
    },
    onError: (e) => {
      setReviewError(
        e instanceof ApiError
          ? e.message
          : 'Business review could not be completed.',
      );
    },
  });

  const reanalyzeMutation = useMutation({
    mutationFn: async (requirementKey: string) => {
      return api<{ ok: boolean }>(
        `/api/v1/projects/${projectId}/extracted-requirements/${requirementKey}/review`,
        { method: 'POST', body: '{}' },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['extracted-requirements', projectId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['review-summary', projectId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['review-conflicts', projectId],
      });
    },
  });

  const answerMutation = useMutation({
    mutationFn: async ({
      questionId,
      answer,
    }: {
      questionId: string;
      answer: string;
    }) => {
      setAnswerError(null);
      return api(
        `/api/v1/projects/${projectId}/review-questions/${questionId}/answer`,
        {
          method: 'POST',
          body: JSON.stringify({ answer }),
        },
      );
    },
    onSuccess: async (_data, vars) => {
      setAnswerDrafts((prev) => {
        const next = { ...prev };
        delete next[vars.questionId];
        return next;
      });
      await queryClient.invalidateQueries({
        queryKey: ['extracted-requirements', projectId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['review-summary', projectId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['review-conflicts', projectId],
      });
    },
    onError: (e) => {
      setAnswerError(
        e instanceof ApiError ? e.message : 'Could not save the answer.',
      );
    },
  });

  useEffect(() => {
    if (!reviewMutation.isPending) return;
    setReviewProgressStep(0);
    const timers = REVIEW_STEPS.map((_, idx) =>
      window.setTimeout(() => setReviewProgressStep(idx + 1), 350 * (idx + 1)),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [reviewMutation.isPending]);

  const setView = (next: string, req?: string | null) => {
    const params = new URLSearchParams();
    params.set('tab', 'requirements');
    params.set('view', next);
    if (req) params.set('req', req);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  if (projectQuery.isLoading) {
    return <p className="text-sm text-muted">Loading project…</p>;
  }

  if (projectQuery.error || !project) {
    return (
      <Card>
        <p className="text-sm text-danger">
          {projectQuery.error instanceof ApiError
            ? projectQuery.error.message
            : 'Project not found.'}
        </p>
        <Link href="/app/projects" className="mt-4 inline-block">
          <Button variant="secondary" size="sm">
            Back to dashboard
          </Button>
        </Link>
      </Card>
    );
  }

  const status = project.status ?? 'DRAFT';
  const progressPct = Math.min(
    100,
    Math.round(
      ((extractMutation.isPending
        ? Math.max(progressStep, 1)
        : EXTRACT_STEPS.length) /
        EXTRACT_STEPS.length) *
        100,
    ),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Link href="/app/projects" className="hover:text-fg">
              Dashboard
            </Link>
            <span>/</span>
            <span className="text-fg">{project.name}</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {project.name}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="warning">Status: {status}</Badge>
            <Badge>
              {project.requirementCount ?? 0} Source Document
              {(project.requirementCount ?? 0) === 1 ? '' : 's'}
            </Badge>
            {(project.extractedRequirementCount ?? extracted.length) > 0 ? (
              <Badge tone="success">
                {project.extractedRequirementCount ?? extracted.length} Extracted
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={tab === 'overview' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => router.replace('?tab=overview', { scroll: false })}
          >
            Overview
          </Button>
          <Button
            variant={tab !== 'overview' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setView(extracted.length ? 'list' : 'source')}
          >
            Requirements
          </Button>
        </div>
      </div>

      <Card className="space-y-3">
        <h2 className="text-sm font-medium">QA Workflow</h2>
        <div className="flex flex-wrap gap-2">
          {WORKFLOW.map((step) => (
            <span
              key={step.id}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs',
                step.state === 'done' &&
                  'border-success/40 bg-success/10 text-success',
                step.state === 'active' &&
                  'border-accent/40 bg-accent/10 text-accent',
                step.state === 'locked' && 'border-border text-muted',
              )}
            >
              {step.state === 'done'
                ? '✓'
                : step.state === 'active'
                  ? '●'
                  : '🔒'}{' '}
              {step.label}
            </span>
          ))}
        </div>
      </Card>

      {tab === 'overview' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <div className="text-xs uppercase tracking-wide text-muted">
              Project
            </div>
            <div className="mt-2 font-medium">{project.name}</div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide text-muted">
              Source
            </div>
            <div className="mt-2 font-medium">
              {project.requirementCount ?? 0} Document
              {(project.requirementCount ?? 0) === 1 ? '' : 's'}
            </div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide text-muted">
              Extracted
            </div>
            <div className="mt-2 font-medium">
              {project.extractedRequirementCount ?? extracted.length}
            </div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide text-muted">
              Created
            </div>
            <div className="mt-2 font-medium">
              {formatDate(project.createdAt)}
            </div>
          </Card>
        </div>
      ) : null}

      {tab !== 'overview' && extractMutation.isPending ? (
        <Card className="space-y-4">
          <div>
            <h2 className="text-base font-medium">AI QA Engineer</h2>
            <p className="mt-1 text-sm text-muted">Extracting requirements…</p>
          </div>
          <ul className="space-y-2 text-sm">
            {EXTRACT_STEPS.map((label, idx) => {
              const done = progressStep > idx;
              const active = progressStep === idx;
              return (
                <li key={label} className="flex items-center gap-2">
                  <span
                    className={cn(
                      done && 'text-success',
                      active && 'text-accent',
                      !done && !active && 'text-muted',
                    )}
                  >
                    {done ? '✓' : active ? '●' : '○'}
                  </span>
                  <span className={cn(!done && !active && 'text-muted')}>
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="text-2xl font-semibold tabular-nums">{progressPct}%</div>
        </Card>
      ) : null}

      {tab !== 'overview' && !extractMutation.isPending && view === 'summary' && summary ? (
        <Card className="space-y-4">
          <h2 className="text-base font-medium text-success">
            ✓ Requirement Extraction Complete
          </h2>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div>Requirements Extracted</div>
            <div className="font-medium">{summary.total}</div>
            <div>Functional</div>
            <div className="font-medium">{summary.functional}</div>
            <div>Non-Functional</div>
            <div className="font-medium">{summary.nonFunctional}</div>
            <div>Business Rules</div>
            <div className="font-medium">{summary.businessRules}</div>
            {summary.rejected != null ? (
              <>
                <div>Rejected Candidates</div>
                <div className="font-medium">{summary.rejected}</div>
              </>
            ) : null}
            {summary.merged != null ? (
              <>
                <div>Merged Duplicates</div>
                <div className="font-medium">{summary.merged}</div>
              </>
            ) : null}
            {summary.retitled != null ? (
              <>
                <div>Titles Regenerated</div>
                <div className="font-medium">{summary.retitled}</div>
              </>
            ) : null}
            {summary.reclassified != null ? (
              <>
                <div>Types Reclassified</div>
                <div className="font-medium">{summary.reclassified}</div>
              </>
            ) : null}
            <div>Source Document</div>
            <div className="font-medium">{summary.sourceDocument}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setView('list')}>View Requirements</Button>
            <Button
              variant="secondary"
              onClick={() => reviewMutation.mutate()}
              disabled={reviewMutation.isPending}
            >
              Start Business Review
            </Button>
            {SHOW_EXTRACTION_DEBUG ? (
              <Button variant="secondary" onClick={() => setView('debug')}>
                Extraction Debug
              </Button>
            ) : null}
          </div>
          {reviewError ? (
            <p className="text-sm text-danger">{reviewError}</p>
          ) : (
            <p className="text-xs text-muted">
              Business review analyzes intent, rules, actors, states, and
              functional gaps — it does not invent confirmed business rules.
            </p>
          )}
        </Card>
      ) : null}

      {tab !== 'overview' && reviewMutation.isPending ? (
        <Card className="space-y-4">
          <div>
            <h2 className="text-base font-medium">Business + Functional Review</h2>
            <p className="mt-1 text-sm text-muted">
              Analyzing extracted requirements…
            </p>
          </div>
          <ul className="space-y-2 text-sm">
            {REVIEW_STEPS.map((label, idx) => {
              const done = reviewProgressStep > idx;
              const active = reviewProgressStep === idx;
              return (
                <li key={label} className="flex items-center gap-2">
                  <span
                    className={cn(
                      done && 'text-success',
                      active && 'text-accent',
                      !done && !active && 'text-muted',
                    )}
                  >
                    {done ? '✓' : active ? '●' : '○'}
                  </span>
                  <span className={cn(!done && !active && 'text-muted')}>
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {tab !== 'overview' &&
      !extractMutation.isPending &&
      view === 'debug' &&
      SHOW_EXTRACTION_DEBUG ? (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">Extraction Debug</h2>
              <p className="mt-1 text-sm text-muted">
                Source → candidate → validation decision (dev only)
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setView('list')}>
              Back to list
            </Button>
          </div>
          <ul className="max-h-[32rem] space-y-3 overflow-y-auto text-sm">
            {(debugDecisions.length
              ? debugDecisions
              : debugQuery.data?.decisions ?? []
            ).map((d, i) => (
              <li
                key={`${d.decision}-${i}`}
                className="rounded-lg border border-border bg-bg-elevated/40 p-3"
              >
                <div className="font-mono text-xs uppercase tracking-wide text-muted">
                  {d.decision}
                  {d.reason ? ` · ${d.reason}` : ''}
                  {d.type ? ` · ${d.type}` : ''}
                </div>
                {d.source ? (
                  <div className="mt-2">
                    <div className="text-xs text-muted">SOURCE</div>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-fg">
                      {d.source}
                    </pre>
                  </div>
                ) : null}
                {d.aiCandidate ? (
                  <div className="mt-2">
                    <div className="text-xs text-muted">AI CANDIDATE</div>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-fg">
                      {d.aiCandidate}
                    </pre>
                  </div>
                ) : null}
                {d.decision === 'SAVE' ? (
                  <div className="mt-2 text-success">
                    FINAL: {d.requirementKey} {d.title}
                  </div>
                ) : null}
                {d.decision === 'MERGE' ? (
                  <div className="mt-2">
                    MERGED INTO: {d.intoKey} {d.intoTitle}
                  </div>
                ) : null}
                {d.decision === 'ATTACH_TO_PARENT' ? (
                  <div className="mt-2">
                    PARENT: {d.parentKey} {d.parentTitle}
                  </div>
                ) : null}
                {d.detail ? (
                  <div className="mt-1 text-xs text-muted">{d.detail}</div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {tab !== 'overview' &&
      !extractMutation.isPending &&
      !reviewMutation.isPending &&
      view === 'review-dashboard' ? (
        <Card className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">
                Business + Functional Review
              </h2>
              <p className="mt-1 text-sm text-muted">
                Readiness across extracted requirements (no test design yet)
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => reviewMutation.mutate()}
                disabled={reviewMutation.isPending || extracted.length === 0}
              >
                Re-run Review
              </Button>
              <Button size="sm" onClick={() => setView('list')}>
                View Requirements
              </Button>
            </div>
          </div>

          {(conflictsQuery.data?.length ?? 0) > 0 ? (
            <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
              <div className="font-medium text-danger">
                {conflictsQuery.data!.length} open conflict
                {conflictsQuery.data!.length === 1 ? '' : 's'}
              </div>
              <ul className="mt-2 space-y-1 text-muted">
                {conflictsQuery.data!.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    {c.requirementA.requirementKey} ↔{' '}
                    {c.requirementB.requirementKey}: {c.summary}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {reviewSummaryQuery.data ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted">
                    Reviewed
                  </div>
                  <div className="mt-1 text-xl font-semibold">
                    {reviewSummaryQuery.data.reviewed}/
                    {reviewSummaryQuery.data.total}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted">
                    Business readiness
                  </div>
                  <div className="mt-1 text-xl font-semibold">
                    {reviewSummaryQuery.data.businessReadinessPct}%
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted">
                    Functional readiness
                  </div>
                  <div className="mt-1 text-xl font-semibold">
                    {reviewSummaryQuery.data.functionalReadinessPct}%
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted">
                    Ready for test design
                  </div>
                  <div className="mt-1 text-xl font-semibold">
                    {reviewSummaryQuery.data.byReviewStatus.readyForTestDesign}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 text-sm">
                  <h3 className="font-medium">Business readiness</h3>
                  <div className="grid grid-cols-3 gap-2">
                    <div>Ready: {reviewSummaryQuery.data.business.ready}</div>
                    <div>
                      Needs clarification:{' '}
                      {reviewSummaryQuery.data.business.needsClarification}
                    </div>
                    <div>Blocked: {reviewSummaryQuery.data.business.blocked}</div>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <h3 className="font-medium">Functional completeness</h3>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      Complete: {reviewSummaryQuery.data.functional.complete}
                    </div>
                    <div>
                      Partial: {reviewSummaryQuery.data.functional.partial}
                    </div>
                    <div>
                      Incomplete:{' '}
                      {reviewSummaryQuery.data.functional.incomplete}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <h3 className="font-medium">Open questions by priority</h3>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="danger">
                    Critical {reviewSummaryQuery.data.questions.critical}
                  </Badge>
                  <Badge tone="warning">
                    High {reviewSummaryQuery.data.questions.high}
                  </Badge>
                  <Badge tone="accent">
                    Medium {reviewSummaryQuery.data.questions.medium}
                  </Badge>
                  <Badge>
                    Low {reviewSummaryQuery.data.questions.low}
                  </Badge>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">
              No review data yet. Start Business Review from the extraction
              summary or requirements list.
            </p>
          )}
          {reviewError ? (
            <p className="text-sm text-danger">{reviewError}</p>
          ) : null}
        </Card>
      ) : null}

      {tab !== 'overview' &&
      !extractMutation.isPending &&
      !reviewMutation.isPending &&
      view === 'detail' &&
      selected ? (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-mono text-sm text-muted">
                {selected.requirementKey}
              </div>
              <h2 className="mt-1 text-xl font-semibold">{selected.title}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {selected.reviewedAt ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    reanalyzeMutation.mutate(selected.requirementKey)
                  }
                  disabled={reanalyzeMutation.isPending}
                >
                  Re-analyze
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setView('list')}
              >
                Back to list
              </Button>
            </div>
          </div>

          {(conflictsQuery.data ?? []).filter(
            (c) =>
              c.requirementA.requirementKey === selected.requirementKey ||
              c.requirementB.requirementKey === selected.requirementKey,
          ).length > 0 ? (
            <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
              Open conflicts involve this requirement. Resolve conflicting
              answers manually — nothing is auto-resolved.
            </div>
          ) : null}

          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone="accent">Extracted</Badge>
              <Badge tone={reviewStatusTone(selected.reviewStatus)}>
                {reviewStatusLabel(selected.reviewStatus)}
              </Badge>
              {selected.businessReadiness ? (
                <Badge>Business: {selected.businessReadiness}</Badge>
              ) : null}
              {selected.functionalCompleteness ? (
                <Badge>Functional: {selected.functionalCompleteness}</Badge>
              ) : null}
              {selected.readinessScore != null ? (
                <Badge tone="accent">
                  Readiness {selected.readinessScore}%
                </Badge>
              ) : null}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">
                Type
              </div>
              <div className="mt-1">{typeLabel(selected.type)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">
                Description
              </div>
              <p className="mt-1 leading-relaxed">{selected.description}</p>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">
                Acceptance Criteria
              </div>
              <p className="mt-1 whitespace-pre-wrap text-muted">
                {emptyField(selected.acceptanceCriteria)}
              </p>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">
                Supporting Information
              </div>
              <p className="mt-1 whitespace-pre-wrap text-muted">
                {emptyField(selected.supportingInformation)}
              </p>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">
                Business Rules (from extraction)
              </div>
              <p className="mt-1 whitespace-pre-wrap text-muted">
                {emptyField(selected.businessRules)}
              </p>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">
                Dependencies
              </div>
              <p className="mt-1 whitespace-pre-wrap text-muted">
                {emptyField(selected.dependencies)}
              </p>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">
                Source
              </div>
              <div className="mt-1 space-y-1 text-muted">
                <div>{selected.sourceDocumentName ?? 'Source document'}</div>
                {selected.sourcePage != null ? (
                  <div>Page {selected.sourcePage}</div>
                ) : null}
                {selected.sourceSection ? (
                  <div>Section: {selected.sourceSection}</div>
                ) : null}
                {selected.sourceText ? (
                  <p className="mt-2 rounded-lg border border-border bg-bg-elevated/50 p-3 text-fg">
                    “{selected.sourceText}”
                  </p>
                ) : null}
              </div>
            </div>
            {selected.possibleDuplicateOf ? (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                ⚠ Possible Duplicate of {selected.possibleDuplicateOf}
              </div>
            ) : null}
          </div>

          {selected.businessReview ? (
            <div className="space-y-3 border-t border-border pt-4 text-sm">
              <h3 className="font-medium">Business Review</h3>
              {selected.businessReview.intent ? (
                <div className="flex flex-wrap items-start gap-2">
                  <Badge
                    tone={factStatusTone(selected.businessReview.intent.status)}
                  >
                    {selected.businessReview.intent.status}
                  </Badge>
                  <span>
                    <span className="text-muted">Intent:</span>{' '}
                    {selected.businessReview.intent.text}
                  </span>
                </div>
              ) : null}
              <FactList title="Actors" facts={selected.businessReview.actors} />
              <FactList title="Rules" facts={selected.businessReview.rules} />
              <FactList
                title="Preconditions"
                facts={selected.businessReview.preconditions}
              />
              <FactList title="Flow" facts={selected.businessReview.flow} />
              <FactList title="States" facts={selected.businessReview.states} />
              <FactList
                title="Transitions"
                facts={selected.businessReview.transitions}
              />
              <FactList
                title="Exceptions"
                facts={selected.businessReview.exceptions}
              />
              <FactList
                title="Outcomes"
                facts={selected.businessReview.outcomes}
              />
              <FactList
                title="Permissions"
                facts={selected.businessReview.permissions}
              />
              <FactList
                title="Dependencies"
                facts={selected.businessReview.dependencies}
              />
            </div>
          ) : null}

          {selected.functionalReview ? (
            <div className="space-y-3 border-t border-border pt-4 text-sm">
              <h3 className="font-medium">Functional Review</h3>
              <FactList
                title="Inputs"
                facts={selected.functionalReview.inputs}
              />
              <FactList
                title="Outputs"
                facts={selected.functionalReview.outputs}
              />
              <FactList
                title="Validations"
                facts={selected.functionalReview.validations}
              />
              <FactList
                title="Success behavior"
                facts={selected.functionalReview.successBehavior}
              />
              <FactList
                title="Failure behavior"
                facts={selected.functionalReview.failureBehavior}
              />
              <FactList
                title="Error handling"
                facts={selected.functionalReview.errorHandling}
              />
              <FactList
                title="Navigation"
                facts={selected.functionalReview.navigation}
              />
              <FactList
                title="Data handling"
                facts={selected.functionalReview.dataHandling}
              />
            </div>
          ) : null}

          <div className="space-y-3 border-t border-border pt-4 text-sm">
            <h3 className="font-medium">Questions</h3>
            {!selected.questions?.length ? (
              <p className="text-muted">
                {selected.reviewedAt
                  ? 'No open clarification questions.'
                  : 'Run Business Review to generate clarifying questions.'}
              </p>
            ) : (
              <ul className="space-y-4">
                {[...selected.questions]
                  .sort((a, b) => {
                    const biz =
                      Number(isBusinessQuestionCategory(b.category)) -
                      Number(isBusinessQuestionCategory(a.category));
                    if (biz !== 0) return biz;
                    const rank = (p: string) =>
                      p === 'CRITICAL'
                        ? 0
                        : p === 'HIGH'
                          ? 1
                          : p === 'MEDIUM'
                            ? 2
                            : 3;
                    return rank(a.priority) - rank(b.priority);
                  })
                  .map((q) => (
                    <li
                      key={q.id}
                      className="rounded-lg border border-border bg-bg-elevated/40 p-3"
                    >
                      <div className="flex flex-wrap gap-2">
                        <Badge tone="accent">{q.questionKey}</Badge>
                        <Badge
                          tone={
                            q.priority === 'CRITICAL'
                              ? 'danger'
                              : q.priority === 'HIGH'
                                ? 'warning'
                                : 'accent'
                          }
                        >
                          {q.priority}
                        </Badge>
                        <Badge>{q.category}</Badge>
                        <Badge
                          tone={q.status === 'ANSWERED' ? 'success' : undefined}
                        >
                          {q.status}
                        </Badge>
                        {q.blocking ? <Badge tone="danger">Blocking</Badge> : null}
                      </div>
                      <p className="mt-2 font-medium">{q.question}</p>
                      <p className="mt-1 text-xs text-muted">{q.reason}</p>
                      {q.status === 'ANSWERED' && q.answer ? (
                        <p className="mt-2 rounded-md border border-success/30 bg-success/10 p-2">
                          Answer: {q.answer}
                        </p>
                      ) : null}
                      {q.status === 'OPEN' ? (
                        <div className="mt-3 space-y-2">
                          <textarea
                            className="min-h-[72px] w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                            placeholder="Your answer…"
                            value={answerDrafts[q.id] ?? ''}
                            onChange={(e) =>
                              setAnswerDrafts((prev) => ({
                                ...prev,
                                [q.id]: e.target.value,
                              }))
                            }
                          />
                          <Button
                            size="sm"
                            disabled={
                              answerMutation.isPending ||
                              !(answerDrafts[q.id] ?? '').trim()
                            }
                            onClick={() =>
                              answerMutation.mutate({
                                questionId: q.id,
                                answer: (answerDrafts[q.id] ?? '').trim(),
                              })
                            }
                          >
                            Submit answer
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
              </ul>
            )}
            {answerError ? (
              <p className="text-sm text-danger">{answerError}</p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {tab !== 'overview' &&
      !extractMutation.isPending &&
      !reviewMutation.isPending &&
      (view === 'list' || (view === 'detail' && !selected)) ? (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">Requirements</h2>
              <p className="mt-1 text-sm text-muted">
                {extracted.length} Requirement
                {extracted.length === 1 ? '' : 's'} Extracted
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setView('source')}
              >
                Source
              </Button>
              {(reviewSummaryQuery.data?.reviewed ?? 0) > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setView('review-dashboard')}
                >
                  Review Dashboard
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => reviewMutation.mutate()}
                disabled={extracted.length === 0 || reviewMutation.isPending}
              >
                Start Business Review
              </Button>
              <Button
                size="sm"
                onClick={() => extractMutation.mutate()}
                disabled={!sourceDoc?.originalContent}
              >
                Re-run Extraction
              </Button>
            </div>
          </div>

          {(conflictsQuery.data?.length ?? 0) > 0 ? (
            <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
              {conflictsQuery.data!.length} open review conflict
              {conflictsQuery.data!.length === 1 ? '' : 's'} — open the review
              dashboard for details.
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <div className="min-w-[200px] flex-1">
              <Input
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="h-10 rounded-lg border border-border bg-bg-elevated px-3 text-sm"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="ALL">All</option>
              <option value="FUNCTIONAL">Functional</option>
              <option value="NON_FUNCTIONAL">Non-Functional</option>
              <option value="BUSINESS_RULE">Business Rule</option>
            </select>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-bg-elevated text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Requirement</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Review</th>
                  <th className="px-3 py-2 font-medium">Open C/H</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-muted"
                    >
                      No extracted requirements yet.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer border-t border-border hover:bg-bg-elevated/60"
                      onClick={() => setView('detail', r.requirementKey)}
                    >
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.requirementKey.replace('-', '')}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.title}</div>
                        {r.possibleDuplicateOf ? (
                          <div className="text-xs text-warning">
                            Possible duplicate of {r.possibleDuplicateOf}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{typeLabel(r.type)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={reviewStatusTone(r.reviewStatus)}>
                          {reviewStatusLabel(r.reviewStatus)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {(r.criticalOpenCount ?? 0) + (r.highOpenCount ?? 0) > 0
                          ? `${r.criticalOpenCount ?? 0}/${r.highOpenCount ?? 0}`
                          : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {reviewError ? (
            <p className="text-sm text-danger">{reviewError}</p>
          ) : null}
        </Card>
      ) : null}

      {tab !== 'overview' &&
      !extractMutation.isPending &&
      view === 'source' ? (
        <Card className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">Requirements</h2>
              <p className="mt-1 text-sm text-muted">
                Original requirement source for {project.name}
              </p>
            </div>
            <Badge tone="warning">Status: {status}</Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_1fr]">
            <div className="rounded-lg border border-border bg-bg-elevated/50 p-4">
              <h3 className="text-sm font-medium">Requirement Source</h3>
              {sourceDoc ? (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="font-medium text-fg">
                    {sourceDoc.sourceType === 'PASTE'
                      ? 'Pasted requirements'
                      : sourceDoc.fileName}
                  </div>
                  <div className="text-muted">
                    {sourceDoc.sourceType === 'UPLOAD'
                      ? 'Uploaded'
                      : 'Entered manually'}
                  </div>
                  <div className="text-xs text-muted">
                    {formatDate(sourceDoc.createdAt)}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  No requirement document saved yet.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border p-4">
              <h3 className="text-sm font-medium">Requirement Details</h3>
              <p className="mt-1 text-xs uppercase tracking-wide text-muted">
                Original Requirement
              </p>
              {sourceDoc?.originalContent ? (
                <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">
                  {sourceDoc.originalContent}
                </pre>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  Original content is not available for this document.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 border-t border-border pt-4">
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => extractMutation.mutate()}
                disabled={
                  !sourceDoc?.originalContent || extractMutation.isPending
                }
              >
                Analyze Requirements
              </Button>
              {extracted.length > 0 ? (
                <Button variant="secondary" onClick={() => setView('list')}>
                  View Extracted ({extracted.length})
                </Button>
              ) : null}
            </div>
            {extractError ? (
              <div className="space-y-2">
                <p className="text-sm text-danger">{extractError}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => extractMutation.mutate()}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted">
                Extracts individual requirements from the original source. Does
                not invent acceptance criteria or assumptions.
              </p>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
