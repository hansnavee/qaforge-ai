'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionMenu } from '@/components/ActionMenu';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input } from '@/components/Input';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { StlcDocsPanel } from './stlc-docs-panel';

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
  primaryType?: string | null;
  secondaryType?: string | null;
  businessImpact?: string | null;
  intentSource?: string | null;
  businessIntent?: string | null;
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
  duplicateSimilarity?: number | null;
  duplicateKind?: string | null;
  duplicateReason?: string | null;
  relationships?: Array<{
    sourceRequirementId: string;
    targetRequirementId: string;
    relationship: string;
    reason: string;
    confidence?: number;
    semanticAnalysis?: {
      actorMatch: boolean;
      entityMatch: boolean;
      actionMatch: boolean;
      capabilityMatch: boolean;
      outcomeMatch: boolean;
      contextMatch: boolean;
    };
  }>;
  semantic?: {
    actor: string;
    entity: string;
    action: string;
    businessCapability: string;
    businessOutcome: string;
    channel?: string | null;
    crudOp?: string | null;
    confidence?: number | null;
    polarity?: string | null;
    uncertain?: boolean | null;
  } | null;
  featureGroup?: {
    id: string;
    featureKey: string;
    name: string;
    businessArea?: string | null;
  } | null;
  relatedRequirements?: Array<{
    relationType: string;
    requirementKey: string;
    title: string;
  }>;
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
  analysisStale?: boolean;
};

type StlcHandoff = {
  canApprove: boolean;
  canStartPlanning: boolean;
  approved: boolean;
  blockers: string[];
  counts: {
    total: number;
    blocked: number;
    needsClarification: number;
    reviewRecommended: number;
    readyForTestDesign: number;
    stale: number;
    openBlockingCriticalQuestions: number;
  };
};

type ReviewSummary = {
  total: number;
  reviewed: number;
  features?: number;
  duplicates?: number;
  analysisId?: string | null;
  analysisVersion?: string | null;
  analysisEngine?: string | null;
  analyzedAt?: string | null;
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
  impact?: {
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
  requirementsApprovedAt?: string | null;
  requirementsApprovedBy?: string | null;
  stlcStage?: string | null;
  stlcHandoff?: StlcHandoff;
};

type FeatureGroupView = {
  id: string;
  featureKey: string;
  name: string;
  businessArea?: string | null;
  businessCapability?: string | null;
  businessIntent?: string | null;
  businessImpact?: string | null;
  featureRisk?: string | null;
  featureRiskReason?: string | null;
  reviewStatus?: string | null;
  requirementCount: number;
  impactCounts?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  statusCounts?: {
    blocked: number;
    needsClarification: number;
    reviewRecommended: number;
    ready: number;
  };
  openQuestionCount?: number;
  criticalQuestions: number;
  highQuestions: number;
  questionCount: number;
  dependsOn?: string[];
  businessRules?: Array<{ text: string; source: string }>;
  actors?: string[];
  entities?: string[];
  duplicateRequirements: string[];
  requirements: Array<{
    id: string;
    requirementKey: string;
    title: string;
    type: string;
    primaryType?: string | null;
    businessImpact?: string | null;
    reviewStatus?: string | null;
    openQuestionCount?: number;
    criticalOpenCount?: number;
    highOpenCount?: number;
    possibleDuplicateOf?: string | null;
    duplicateSimilarity?: number | null;
    duplicateKind?: string | null;
    duplicateReason?: string | null;
    relationships?: Array<{
      sourceRequirementId: string;
      targetRequirementId: string;
      relationship: string;
      reason: string;
      confidence?: number;
      semanticAnalysis?: {
        actorMatch: boolean;
        entityMatch: boolean;
        actionMatch: boolean;
        capabilityMatch: boolean;
        outcomeMatch: boolean;
        contextMatch: boolean;
      };
    }>;
    semantic?: {
      actor: string;
      entity: string;
      action: string;
      businessCapability: string;
      businessOutcome: string;
      channel?: string | null;
      crudOp?: string | null;
      confidence?: number | null;
      polarity?: string | null;
      uncertain?: boolean | null;
    } | null;
  }>;
};

function relationshipLabel(kind: string): string {
  switch (kind) {
    case 'DUPLICATE':
      return 'DUPLICATE';
    case 'POSSIBLE_DUPLICATE':
      return 'POSSIBLE DUPLICATE';
    case 'BUSINESS_RULE_CONSTRAINT':
      return 'BUSINESS RULE CONSTRAINT';
    case 'SEQUENTIAL':
    case 'PRECEDES':
      return 'SEQUENTIAL';
    case 'CONFLICT':
    case 'CONFLICTS_WITH':
      return 'CONFLICT';
    case 'DEPENDS_ON':
      return 'DEPENDENCY';
    case 'RELATED':
      return 'RELATED';
    default:
      return kind.replace(/_/g, ' ');
  }
}

function primaryRelationship(
  rels?: ExtractedRequirement['relationships'],
) {
  if (!rels?.length) return null;
  // Missing edge = independent; ignore legacy NOT_DUPLICATE noise
  const positive = rels.filter((r) => r.relationship !== 'NOT_DUPLICATE');
  if (!positive.length) return null;
  const rank = (r: string) =>
    r === 'DUPLICATE'
      ? 0
      : r === 'BUSINESS_RULE_CONSTRAINT'
        ? 1
        : r === 'CONFLICT' || r === 'CONFLICTS_WITH'
          ? 2
          : r === 'SEQUENTIAL' || r === 'PRECEDES'
            ? 3
            : r === 'POSSIBLE_DUPLICATE'
              ? 4
              : r === 'RELATED' || r === 'DEPENDS_ON'
                ? 5
                : 6;
  return [...positive].sort(
    (a, b) => rank(a.relationship) - rank(b.relationship),
  )[0]!;
}

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
  description?: string | null;
  appUrl?: string | null;
  status?: string | null;
  createdAt: string;
  updatedAt?: string;
  analysisStatus?: string | null;
  analysisCompletedAt?: string | null;
  analysisError?: string | null;
  analysisId?: string | null;
  analysisVersion?: string | null;
  analysisEngine?: string | null;
  requirementsApprovedAt?: string | null;
  requirementsApprovedBy?: string | null;
  qaSignedOffAt?: string | null;
  stlcStage?: string | null;
  staleRequirementCount?: number;
  requirementCount?: number;  extractedRequirementCount?: number;
  questionCount?: number;
  featureGroupCount?: number;
  requirements?: RequirementDoc[];
  primaryRequirement?: RequirementDoc | null;
};

type WorkflowState = 'done' | 'active' | 'locked';

const STLC_WORKFLOW_ORDER = [
  'REQUIREMENTS',
  'PLANNING',
  'DESIGN',
  'ENVIRONMENT',
  'DATA',
  'EXECUTION',
  'DEFECTS',
  'AUTOMATION',
  'REPORTING',
  'SIGNOFF',
] as const;

function buildWorkflow(opts: {
  requirementsApproved: boolean;
  stlcStage?: string | null;
}): Array<{ id: string; label: string; state: WorkflowState; agent?: string }> {
  const stage = (opts.stlcStage ?? 'REQUIREMENTS').toUpperCase();
  const stageIdx =
    stage === 'DONE'
      ? STLC_WORKFLOW_ORDER.length
      : Math.max(
          0,
          STLC_WORKFLOW_ORDER.indexOf(
            stage as (typeof STLC_WORKFLOW_ORDER)[number],
          ),
        );

  const labels: Record<string, { label: string; agent: string }> = {
    REQUIREMENTS: {
      label: '1. Requirements',
      agent: 'AI Analyzer Agent',
    },
    PLANNING: {
      label: '2. Test Planning',
      agent: 'AI Test Strategy Agent',
    },
    DESIGN: {
      label: '3. Test Design',
      agent: 'AI Test Design Agent',
    },
    ENVIRONMENT: {
      label: '4. Environment',
      agent: 'AI Environment Agent',
    },
    DATA: { label: '5. Test Data', agent: 'AI Test Data Agent' },
    EXECUTION: {
      label: '6. Execution',
      agent: 'AI Test Executor Agent',
    },
    DEFECTS: {
      label: '7. Defects',
      agent: 'AI Bug Reporting Agent',
    },
    AUTOMATION: {
      label: '8. Automation',
      agent: 'AI Test Automation Agent',
    },
    REPORTING: {
      label: '9. Reporting',
      agent: 'AI Test Report Agent',
    },
    SIGNOFF: {
      label: '10. Sign-off',
      agent: 'AI Sign-off Agent',
    },
  };

  // After requirements Accept, Planning is the next active stage even if
  // stlcStage still says REQUIREMENTS (older API rows).
  let effectiveIdx = stageIdx;
  if (opts.requirementsApproved && stage === 'REQUIREMENTS') {
    effectiveIdx = STLC_WORKFLOW_ORDER.indexOf('PLANNING');
  }

  return STLC_WORKFLOW_ORDER.map((id, index) => {
    const meta = labels[id] ?? { label: id, agent: 'AI Agent' };
    let state: WorkflowState = 'locked';
    if (id === 'REQUIREMENTS') {
      state = opts.requirementsApproved
        ? 'done'
        : index <= effectiveIdx
          ? 'active'
          : 'locked';
    } else if (index < effectiveIdx || stage === 'DONE') {
      state = 'done';
    } else if (index === effectiveIdx) {
      state = 'active';
    }
    return { id: id.toLowerCase(), label: meta.label, state, agent: meta.agent };
  });
}

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

function formatDate(value?: string | null) {
  if (!value) return '—';
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

function analysisLabel(status?: string | null) {
  if (!status || status === 'NOT_STARTED') return 'Not Started';
  if (status === 'READY') return 'Ready';
  if (status === 'RUNNING') return 'Running';
  if (status === 'COMPLETED') return 'Completed';
  if (status === 'FAILED') return 'Failed';
  if (status === 'STALE') return 'Stale';
  return status;
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

function impactTone(
  impact?: string | null,
): 'success' | 'warning' | 'danger' | 'accent' | undefined {
  if (impact === 'CRITICAL') return 'danger';
  if (impact === 'HIGH') return 'warning';
  if (impact === 'MEDIUM') return 'accent';
  return undefined;
}

function impactLabel(impact?: string | null) {
  return impact ?? '—';
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
  const [expandedFeatures, setExpandedFeatures] = useState<
    Record<string, boolean>
  >({});
  const [debugDecisions, setDebugDecisions] = useState<ExtractionDecision[]>(
    [],
  );
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [addReqOpen, setAddReqOpen] = useState(false);
  const [editReq, setEditReq] = useState<ExtractedRequirement | null>(null);
  const [deleteReq, setDeleteReq] = useState<ExtractedRequirement | null>(null);
  const [projectForm, setProjectForm] = useState({ name: '', description: '' });
  const [reqForm, setReqForm] = useState({
    title: '',
    description: '',
    type: 'FUNCTIONAL',
  });
  const [menuOpenKey, setMenuOpenKey] = useState<string | null>(null);

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

  const featuresQuery = useQuery({
    queryKey: ['review-features', projectId],
    queryFn: async () => {
      try {
        return await api<FeatureGroupView[]>(
          `/api/v1/projects/${projectId}/review-features`,
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) return [] as FeatureGroupView[];
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

  const invalidateReviewQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    await queryClient.invalidateQueries({
      queryKey: ['extracted-requirements', projectId],
    });
    await queryClient.invalidateQueries({
      queryKey: ['review-summary', projectId],
    });
    await queryClient.invalidateQueries({
      queryKey: ['review-conflicts', projectId],
    });
    await queryClient.invalidateQueries({
      queryKey: ['review-features', projectId],
    });
  };

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
      await invalidateReviewQueries();
      router.replace(`?tab=requirements&view=features`, {
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

  const updateProjectMutation = useMutation({
    mutationFn: async (body: { name: string; description: string }) => {
      return api<ProjectDetail>(`/api/v1/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: body.name,
          description: body.description || null,
        }),
      });
    },
    onSuccess: async () => {
      setEditProjectOpen(false);
      await invalidateReviewQueries();
      const params = new URLSearchParams(searchParams.toString());
      params.delete('edit');
      router.replace(`?${params.toString()}`, { scroll: false });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async () => {
      return api(`/api/v1/projects/${projectId}`, { method: 'DELETE' });
    },
    onSuccess: async () => {
      setDeleteProjectOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      router.push('/app/projects');
    },
  });

  const createReqMutation = useMutation({
    mutationFn: async (body: {
      title: string;
      description: string;
      type: string;
    }) => {
      return api(
        `/api/v1/projects/${projectId}/extracted-requirements`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );
    },
    onSuccess: async () => {
      setAddReqOpen(false);
      setReqForm({ title: '', description: '', type: 'FUNCTIONAL' });
      await invalidateReviewQueries();
    },
  });

  const updateReqMutation = useMutation({
    mutationFn: async ({
      key,
      body,
    }: {
      key: string;
      body: { title: string; description: string; type: string };
    }) => {
      return api(
        `/api/v1/projects/${projectId}/extracted-requirements/${key}`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      );
    },
    onSuccess: async () => {
      setEditReq(null);
      await invalidateReviewQueries();
    },
  });

  const deleteReqMutation = useMutation({
    mutationFn: async (key: string) => {
      return api(
        `/api/v1/projects/${projectId}/extracted-requirements/${key}`,
        { method: 'DELETE' },
      );
    },
    onSuccess: async (_data, key) => {
      setDeleteReq(null);
      await invalidateReviewQueries();
      if (selectedKey === key) {
        router.replace(`?tab=requirements&view=list`, { scroll: false });
      }
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
      await invalidateReviewQueries();
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
      await queryClient.invalidateQueries({
        queryKey: ['review-features', projectId],
      });
    },
    onError: (e) => {
      setAnswerError(
        e instanceof ApiError ? e.message : 'Could not save the answer.',
      );
    },
  });

  const duplicateDecisionMutation = useMutation({
    mutationFn: async ({
      requirementKey,
      decision,
    }: {
      requirementKey: string;
      decision: 'keep_both' | 'mark_not_duplicate' | 'merge';
    }) => {
      return api(
        `/api/v1/projects/${projectId}/extracted-requirements/${requirementKey}/duplicate-decision`,
        {
          method: 'POST',
          body: JSON.stringify({ decision }),
        },
      );
    },
    onSuccess: async () => {
      await invalidateReviewQueries();
    },
  });

  const approveRequirementsMutation = useMutation({
    mutationFn: async () => {
      return api(`/api/v1/projects/${projectId}/approve-requirements`, {
        method: 'POST',
        body: '{}',
      });
    },
    onSuccess: async () => {
      await invalidateReviewQueries();
    },
  });

  const startPlanningMutation = useMutation({
    mutationFn: async () => {
      return api<{ id: string; status?: string; phase?: string }>(
        `/api/v1/projects/${projectId}/stlc/start`,
        {
          method: 'POST',
          body: '{}',
        },
      );
    },
    onSuccess: async (execution) => {
      await invalidateReviewQueries();
      void queryClient.invalidateQueries({ queryKey: ['stlc-phases', projectId] });
      if (!execution?.id) return;
      // If a run is already waiting for Approve, open that execution — not a stuck INIT job.
      if (execution.status?.startsWith('AWAITING_')) {
        router.push(`/app/executions/${execution.id}`);
        return;
      }
      router.replace('?tab=stlc&phase=PLANNING', { scroll: false });
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

  useEffect(() => {
    if (searchParams.get('edit') !== '1') return;
    if (!projectQuery.data) return;
    setProjectForm({
      name: projectQuery.data.name,
      description: projectQuery.data.description ?? '',
    });
    setEditProjectOpen(true);
    if ((searchParams.get('tab') ?? 'requirements') !== 'overview') {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', 'overview');
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [searchParams, projectQuery.data, router]);

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
  const analysisStatus = project.analysisStatus ?? 'NOT_STARTED';
  const extractedCount =
    project.extractedRequirementCount ?? extracted.length;
  const analysisBusy =
    reviewMutation.isPending ||
    extractMutation.isPending ||
    analysisStatus === 'RUNNING';
  const runAnalysis = () => {
    if (extracted.length > 0) reviewMutation.mutate();
    else extractMutation.mutate();
  };
  const analysisIsStaleEngine =
    Boolean(reviewSummaryQuery.data?.reviewed) &&
    (reviewSummaryQuery.data?.analysisVersion !== '2.6.0' ||
      reviewSummaryQuery.data?.analysisEngine !==
        'semantic-requirement-review');
  const stlcHandoff = reviewSummaryQuery.data?.stlcHandoff;
  const requirementsApproved = Boolean(
    stlcHandoff?.approved ||
      reviewSummaryQuery.data?.requirementsApprovedAt ||
      project.requirementsApprovedAt,
  );
  const workflowSteps = buildWorkflow({
    requirementsApproved,
    stlcStage:
      reviewSummaryQuery.data?.stlcStage ?? project.stlcStage ?? 'REQUIREMENTS',
  });
  const handoffBlockers = stlcHandoff?.blockers ?? [];
  const openEditProject = () => {
    setProjectForm({
      name: project.name,
      description: project.description ?? '',
    });
    setEditProjectOpen(true);
  };
  const openAddReq = () => {
    setReqForm({ title: '', description: '', type: 'FUNCTIONAL' });
    setAddReqOpen(true);
  };
  const openEditReq = (r: ExtractedRequirement) => {
    setReqForm({
      title: r.title,
      description: r.description,
      type: r.type || 'FUNCTIONAL',
    });
    setEditReq(r);
  };
  const breadcrumbTail =
    tab === 'overview'
      ? null
      : view === 'detail' && selected
        ? 'Detail'
        : 'Requirements';
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
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Link href="/app/projects" className="hover:text-fg">
              Projects
            </Link>
            <span>/</span>
            <button
              type="button"
              className="hover:text-fg"
              onClick={() =>
                router.replace('?tab=overview', { scroll: false })
              }
            >
              {project.name}
            </button>
            {breadcrumbTail ? (
              <>
                <span>/</span>
                <span className="text-fg">{breadcrumbTail}</span>
              </>
            ) : null}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {project.name}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="warning">Status: {status}</Badge>
            <Badge>Analysis: {analysisLabel(analysisStatus)}</Badge>
            {project.analysisVersion ? (
              <Badge tone="accent">
                Engine {project.analysisEngine ?? 'semantic'} v
                {project.analysisVersion}
              </Badge>
            ) : null}
            <Badge>
              {project.requirementCount ?? 0} Source Document
              {(project.requirementCount ?? 0) === 1 ? '' : 's'}
            </Badge>
            {extractedCount > 0 ? (
              <Badge tone="success">{extractedCount} Extracted</Badge>
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
          {(() => {
            const activeStep =
              workflowSteps.find((s) => s.state === 'active') ??
              workflowSteps[0];
            const onRequirements =
              !requirementsApproved || activeStep?.id === 'requirements';
            return (
              <>
                <Button
                  variant={
                    tab !== 'overview' && tab !== 'stlc' ? 'primary' : 'secondary'
                  }
                  size="sm"
                  onClick={() =>
                    setView(
                      (reviewSummaryQuery.data?.features ?? 0) > 0
                        ? 'features'
                        : extracted.length
                          ? 'list'
                          : 'source',
                    )
                  }
                >
                  Requirements
                </Button>
                <Button
                  variant={tab === 'stlc' ? 'primary' : 'secondary'}
                  size="sm"
                  disabled={onRequirements && !requirementsApproved}
                  onClick={() =>
                    router.replace(
                      `?tab=stlc&phase=${(activeStep?.id === 'requirements' ? 'planning' : activeStep?.id ?? 'planning').toUpperCase()}`,
                      { scroll: false },
                    )
                  }
                >
                  Current phase
                  {activeStep && activeStep.id !== 'requirements'
                    ? `: ${activeStep.label.replace(/^\d+\.\s*/, '')}`
                    : ''}
                </Button>
              </>
            );
          })()}
        </div>
      </div>

      <Card className="space-y-3">
        {(() => {
          const activeStep =
            workflowSteps.find((s) => s.state === 'active') ??
            workflowSteps.find((s) => s.state !== 'done') ??
            workflowSteps[0];
          const doneCount = workflowSteps.filter(
            (s) => s.state === 'done',
          ).length;
          const isComplete =
            (reviewSummaryQuery.data?.stlcStage ?? project.stlcStage) ===
              'DONE' || project.status === 'STLC_COMPLETE';
          const stepNum = Math.min(10, doneCount + (isComplete ? 0 : 1));

          return (
            <div className="rounded-xl border border-accent/30 bg-accent/10 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-accent">
                {isComplete ? 'Finished' : `Step ${stepNum} of 10`}
              </p>
              <p className="mt-1 text-xl font-semibold text-fg">
                {isComplete
                  ? 'All steps complete'
                  : activeStep?.label ?? '1. Requirements'}
              </p>
              <p className="mt-1 text-sm text-muted">
                {isComplete
                  ? 'Open executions to download reports.'
                  : !requirementsApproved
                    ? 'Review requirements on this page, then Approve. Next phases open one by one.'
                    : 'Open the current phase, wait for AI if needed, review, then Accept to move forward.'}
              </p>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{
                    width: `${isComplete ? 100 : Math.max(8, (stepNum / 10) * 100)}%`,
                  }}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {isComplete ? (
                  <Link href="/app/executions">
                    <Button size="sm">Open executions</Button>
                  </Link>
                ) : !requirementsApproved ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() =>
                        setView(
                          (reviewSummaryQuery.data?.features ?? 0) > 0
                            ? 'features'
                            : 'list',
                        )
                      }
                    >
                      Review requirements
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => approveRequirementsMutation.mutate()}
                      disabled={
                        !stlcHandoff?.canApprove ||
                        approveRequirementsMutation.isPending
                      }
                    >
                      {approveRequirementsMutation.isPending
                        ? 'Approving…'
                        : 'Approve →'}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      onClick={() => startPlanningMutation.mutate()}
                      disabled={
                        !stlcHandoff?.canStartPlanning ||
                        startPlanningMutation.isPending
                      }
                    >
                      {startPlanningMutation.isPending
                        ? 'Starting…'
                        : 'Start this phase'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        router.replace('?tab=stlc&phase=PLANNING', {
                          scroll: false,
                        })
                      }
                    >
                      Open current phase
                    </Button>
                  </>
                )}
              </div>

              {!requirementsApproved &&
              handoffBlockers.length > 0 &&
              !stlcHandoff?.canApprove ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-warning">
                  {handoffBlockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
              {approveRequirementsMutation.isError ? (
                <p className="mt-2 text-sm text-danger">
                  {approveRequirementsMutation.error instanceof ApiError
                    ? approveRequirementsMutation.error.message
                    : 'Could not approve requirements.'}
                </p>
              ) : null}
              {startPlanningMutation.isError ? (
                <p className="mt-2 text-sm text-danger">
                  {startPlanningMutation.error instanceof ApiError
                    ? startPlanningMutation.error.message
                    : 'Could not start phase.'}
                </p>
              ) : null}
            </div>
          );
        })()}
      </Card>

      {analysisIsStaleEngine ? (
        <Card className="border-warning/40 bg-warning/10 p-3 text-sm">
          Legacy analysis detected (missing engine v2.6.0). Stale “Possible
          duplicate (N%)” data can still appear until you run a fresh semantic
          analysis.
          <Button
            className="ml-3"
            size="sm"
            onClick={runAnalysis}
            disabled={analysisBusy || extracted.length === 0}
          >
            Run Fresh Analysis
          </Button>
        </Card>
      ) : null}

      {tab === 'stlc' ? (
        <Card className="space-y-3">
          <StlcDocsPanel projectId={projectId} />
        </Card>
      ) : null}

      {tab === 'overview' ? (
        <Card className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">Project Details</h2>
              <p className="mt-1 text-sm text-muted">
                Project metadata, requirement counts, and analysis status.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={openEditProject}>
                Edit Project
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => setDeleteProjectOpen(true)}
              >
                Delete Project
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
              setView(
                (reviewSummaryQuery.data?.features ?? 0) > 0
                  ? 'features'
                  : extracted.length
                    ? 'list'
                    : 'source',
              )
            }
              >
                Open Requirements
              </Button>
              <Button
                size="sm"
                onClick={runAnalysis}
                disabled={analysisBusy || (!sourceDoc?.originalContent && extracted.length === 0)}
              >
                {extracted.length > 0 ? 'Run Analysis' : 'Analyze first'}
              </Button>
            </div>
          </div>

          {editProjectOpen ? (
            <form
              className="space-y-3 rounded-lg border border-border bg-bg-elevated/40 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!projectForm.name.trim()) return;
                updateProjectMutation.mutate({
                  name: projectForm.name.trim(),
                  description: projectForm.description,
                });
              }}
            >
              <div>
                <label className="text-xs uppercase tracking-wide text-muted">
                  Name
                </label>
                <Input
                  className="mt-1"
                  value={projectForm.name}
                  onChange={(e) =>
                    setProjectForm((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted">
                  Description
                </label>
                <textarea
                  className="mt-1 min-h-[88px] w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                  value={projectForm.description}
                  onChange={(e) =>
                    setProjectForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    updateProjectMutation.isPending || !projectForm.name.trim()
                  }
                >
                  {updateProjectMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditProjectOpen(false)}
                  disabled={updateProjectMutation.isPending}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted">
                  Name
                </div>
                <div className="mt-1 font-medium">{project.name}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted">
                  Project status
                </div>
                <div className="mt-1 font-medium">{status}</div>
              </div>
              <div className="sm:col-span-2">
                <div className="text-xs uppercase tracking-wide text-muted">
                  Description
                </div>
                <p className="mt-1 text-sm text-muted">
                  {project.description?.trim() || 'No description'}
                </p>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted">
                  Created
                </div>
                <div className="mt-1 font-medium">
                  {formatDate(project.createdAt)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted">
                  Updated
                </div>
                <div className="mt-1 font-medium">
                  {formatDate(project.updatedAt)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted">
                  Source documents
                </div>
                <div className="mt-1 font-medium">
                  {project.requirementCount ?? 0}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted">
                  Extracted requirements
                </div>
                <div className="mt-1 font-medium">{extractedCount}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted">
                  Analysis status
                </div>
                <div className="mt-1 font-medium">
                  {analysisLabel(analysisStatus)}
                  {(project.staleRequirementCount ?? 0) > 0
                    ? ` · ${project.staleRequirementCount} stale`
                    : ''}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted">
                  Questions / features
                </div>
                <div className="mt-1 font-medium">
                  {project.questionCount ?? 0} questions ·{' '}
                  {project.featureGroupCount ?? 0} features
                </div>
              </div>
              {project.analysisCompletedAt ? (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted">
                    Analysis completed
                  </div>
                  <div className="mt-1 font-medium">
                    {formatDate(project.analysisCompletedAt)}
                  </div>
                </div>
              ) : null}
            </div>
          )}
          {analysisStatus === 'FAILED' && project.analysisError ? (
            <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
              <div className="font-medium text-danger">Analysis failed</div>
              <p className="mt-1 text-muted">{project.analysisError}</p>
              <Button
                className="mt-2"
                size="sm"
                onClick={runAnalysis}
                disabled={analysisBusy}
              >
                Retry
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {tab !== 'overview' &&
      tab !== 'stlc' &&
      !extractMutation.isPending &&
      !reviewMutation.isPending ? (
        <Card className="sticky top-0 z-10 space-y-3 border-accent/30 bg-bg/95 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">{project.name}</h2>
              <p className="mt-1 text-sm text-muted">
                Requirements: {extractedCount} · Analysis:{' '}
                {analysisLabel(analysisStatus)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={openAddReq}>
                Add Requirement
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setView('source')}
              >
                Import / Source
              </Button>
              <Button size="sm" onClick={runAnalysis} disabled={analysisBusy || (!sourceDoc?.originalContent && extracted.length === 0)}>
                {extracted.length > 0 ? 'Run Fresh Analysis' : 'Analyze first'}
              </Button>
            </div>
          </div>
          {analysisIsStaleEngine ? (
            <p className="text-sm text-warning">
              Analysis engine is outdated or missing. Run Fresh Analysis to
              activate semantic relationship detection (v2.6.0).
            </p>
          ) : null}
          {analysisStatus === 'STALE' ? (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              Analysis is stale — requirements changed since the last run.
              Re-run analysis to refresh review results.
            </div>
          ) : null}
          {analysisStatus === 'FAILED' ? (
            <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
              <div className="font-medium text-danger">Analysis failed</div>
              {project.analysisError ? (
                <p className="mt-1 text-muted">{project.analysisError}</p>
              ) : null}
              <Button
                className="mt-2"
                size="sm"
                onClick={runAnalysis}
                disabled={analysisBusy}
              >
                Retry
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {tab !== 'overview' &&
      tab !== 'stlc' && extractMutation.isPending ? (
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

      {tab !== 'overview' &&
      tab !== 'stlc' && !extractMutation.isPending && view === 'summary' && summary ? (
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
              Run Analysis
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

      {tab !== 'overview' &&
      tab !== 'stlc' && reviewMutation.isPending ? (
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
      tab !== 'stlc' &&
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
      tab !== 'stlc' &&
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
              {reviewSummaryQuery.data.features != null ? (
                <div className="text-sm text-muted">
                  {reviewSummaryQuery.data.features} feature groups ·{' '}
                  {reviewSummaryQuery.data.duplicates ?? 0} confirmed duplicates
                </div>
              ) : null}
              <Button size="sm" onClick={() => setView('features')}>
                Open Feature View
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted">
              No review data yet. Run Analysis from the extraction summary or
              requirements list to start a business review.
            </p>
          )}
          {reviewError ? (
            <p className="text-sm text-danger">{reviewError}</p>
          ) : null}
        </Card>
      ) : null}

      {tab !== 'overview' &&
      tab !== 'stlc' &&
      !extractMutation.isPending &&
      !reviewMutation.isPending &&
      view === 'features' ? (
        <Card className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">Feature review</h2>
              <p className="mt-1 text-sm text-muted">
                Business Area → Feature → Requirements
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setView('review-dashboard')}
              >
                Dashboard
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setView('list')}
              >
                Flat list
              </Button>
            </div>
          </div>

          {(featuresQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted">
              No feature groups yet. Run Analysis to generate feature groups.
            </p>
          ) : (
            <div className="space-y-6">
              {Object.entries(
                (featuresQuery.data ?? []).reduce<
                  Record<string, FeatureGroupView[]>
                >((acc, f) => {
                  const area = f.businessArea ?? 'Other';
                  (acc[area] ??= []).push(f);
                  return acc;
                }, {}),
              ).map(([area, features]) => (
                <section key={area} className="space-y-2">
                  <h3 className="text-sm font-medium tracking-wide text-muted">
                    {area}
                  </h3>
                  <div className="space-y-2">
                    {features.map((f) => {
                      const open = expandedFeatures[f.id] ?? false;
                      const impact = f.impactCounts ?? {
                        critical: 0,
                        high: 0,
                        medium: 0,
                        low: 0,
                      };
                      const status = f.statusCounts ?? {
                        blocked: 0,
                        needsClarification: 0,
                        reviewRecommended: 0,
                        ready: 0,
                      };
                      const openQs =
                        f.openQuestionCount ?? f.questionCount ?? 0;
                      return (
                        <div
                          key={f.id}
                          className="rounded-lg border border-border bg-bg-elevated/30"
                        >
                          <button
                            type="button"
                            className="flex w-full flex-wrap items-start justify-between gap-3 px-3 py-3 text-left text-sm"
                            onClick={() =>
                              setExpandedFeatures((prev) => ({
                                ...prev,
                                [f.id]: !open,
                              }))
                            }
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="font-medium">
                                {open ? '▼' : '▶'} {f.name}
                              </div>
                              <div className="text-xs text-muted">
                                {f.requirementCount} Requirements
                                {f.featureRisk
                                  ? ` · ${impactLabel(f.featureRisk)} Risk`
                                  : ''}
                                {openQs > 0
                                  ? ` · ${openQs} Question${openQs === 1 ? '' : 's'}`
                                  : ''}
                              </div>
                              <div className="text-xs text-muted">
                                {reviewStatusLabel(f.reviewStatus)}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              {f.featureRisk ? (
                                <Badge tone={impactTone(f.featureRisk)}>
                                  {impactLabel(f.featureRisk)} Risk
                                </Badge>
                              ) : null}
                              <Badge tone={reviewStatusTone(f.reviewStatus)}>
                                {reviewStatusLabel(f.reviewStatus)}
                              </Badge>
                            </div>
                          </button>
                          {open ? (
                            <div className="space-y-3 border-t border-border px-3 py-3 text-sm">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1 text-xs text-muted">
                                  <div>
                                    <span className="font-medium text-fg">
                                      Feature:
                                    </span>{' '}
                                    {f.name}
                                  </div>
                                  <div>
                                    <span className="font-medium text-fg">
                                      Business Area:
                                    </span>{' '}
                                    {f.businessArea ?? 'Other'}
                                  </div>
                                  {f.businessIntent ? (
                                    <div>
                                      <span className="font-medium text-fg">
                                        Business Intent:
                                      </span>{' '}
                                      {f.businessIntent}
                                    </div>
                                  ) : null}
                                  {(f.actors?.length ?? 0) > 0 ? (
                                    <div>
                                      <span className="font-medium text-fg">
                                        Actors:
                                      </span>{' '}
                                      {f.actors!.join(', ')}
                                    </div>
                                  ) : null}
                                  {(f.entities?.length ?? 0) > 0 ? (
                                    <div>
                                      <span className="font-medium text-fg">
                                        Entities:
                                      </span>{' '}
                                      {f.entities!.join(', ')}
                                    </div>
                                  ) : null}
                                  {(f.dependsOn?.length ?? 0) > 0 ? (
                                    <div>
                                      <span className="font-medium text-fg">
                                        Depends on:
                                      </span>{' '}
                                      {f.dependsOn!.join(', ')}
                                    </div>
                                  ) : null}
                                </div>
                                <div className="space-y-2 text-xs text-muted">
                                  <div>
                                    <div className="font-medium text-fg">
                                      Business Impact
                                    </div>
                                    <div>Critical: {impact.critical}</div>
                                    <div>High: {impact.high}</div>
                                    <div>Medium: {impact.medium}</div>
                                    <div>Low: {impact.low}</div>
                                  </div>
                                  <div>
                                    <div className="font-medium text-fg">
                                      Review
                                    </div>
                                    <div>Blocked: {status.blocked}</div>
                                    <div>
                                      Needs Clarification:{' '}
                                      {status.needsClarification}
                                    </div>
                                    <div>
                                      Review Recommended:{' '}
                                      {status.reviewRecommended}
                                    </div>
                                    <div>Ready: {status.ready}</div>
                                  </div>
                                  <div>
                                    Open Questions: {openQs}
                                    {f.featureRisk
                                      ? ` · Feature Risk: ${impactLabel(f.featureRisk)}`
                                      : ''}
                                  </div>
                                </div>
                              </div>
                              {(f.businessRules?.length ?? 0) > 0 ? (
                                <div className="text-xs text-muted">
                                  <div className="font-medium text-fg">
                                    Business Rules
                                  </div>
                                  <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                                    {f.businessRules!
                                      .slice(0, 5)
                                      .map((rule, idx) => (
                                        <li
                                          key={`${idx}-${rule.text.slice(0, 24)}`}
                                        >
                                          {rule.text}
                                          {rule.source === 'AI_INFERRED' ? (
                                            <span className="text-warning">
                                              {' '}
                                              (Suggested · AI_INFERRED)
                                            </span>
                                          ) : null}
                                        </li>
                                      ))}
                                  </ol>
                                </div>
                              ) : null}
                              <ul className="space-y-2">
                                {f.requirements.map((r) => (
                                  <li
                                    key={r.id}
                                    className="rounded-md border border-border/60 px-2 py-2"
                                  >
                                    <button
                                      type="button"
                                      className="flex w-full flex-wrap items-start justify-between gap-2 text-left hover:opacity-90"
                                      onClick={() =>
                                        setView('detail', r.requirementKey)
                                      }
                                    >
                                      <span>
                                        <span className="font-mono text-xs text-muted">
                                          {r.requirementKey}
                                        </span>{' '}
                                        <span className="font-medium">
                                          {r.title}
                                        </span>
                                        {r.semantic ? (
                                          <div className="mt-1 text-xs text-muted">
                                            Actor: {r.semantic.actor} · Entity:{' '}
                                            {r.semantic.entity} · Action:{' '}
                                            {r.semantic.action}
                                          </div>
                                        ) : null}
                                      </span>
                                      <span className="flex gap-1">
                                        <Badge
                                          tone={impactTone(r.businessImpact)}
                                        >
                                          {impactLabel(r.businessImpact)}
                                        </Badge>
                                        <Badge
                                          tone={reviewStatusTone(
                                            r.reviewStatus,
                                          )}
                                        >
                                          {reviewStatusLabel(r.reviewStatus)}
                                        </Badge>
                                      </span>
                                    </button>
                                    {(() => {
                                      const rel = primaryRelationship(
                                        r.relationships,
                                      );
                                      if (!rel) return null;
                                      return (
                                        <div className="mt-2 space-y-2 rounded-md border border-border bg-bg/40 p-2 text-xs">
                                          <div className="font-medium text-fg">
                                            {relationshipLabel(rel.relationship)}
                                          </div>
                                          <div>{rel.targetRequirementId}</div>
                                          {rel.reason ? (
                                            <div className="whitespace-pre-wrap text-muted">
                                              Why? {rel.reason}
                                            </div>
                                          ) : null}
                                          {rel.semanticAnalysis &&
                                          rel.relationship ===
                                            'POSSIBLE_DUPLICATE' ? (
                                            <div className="grid grid-cols-2 gap-1 text-muted">
                                              <div>
                                                Actor{' '}
                                                {rel.semanticAnalysis.actorMatch
                                                  ? '✓'
                                                  : '✕'}
                                              </div>
                                              <div>
                                                Entity{' '}
                                                {rel.semanticAnalysis.entityMatch
                                                  ? '✓'
                                                  : '✕'}
                                              </div>
                                              <div>
                                                Action{' '}
                                                {rel.semanticAnalysis.actionMatch
                                                  ? '✓'
                                                  : '✕'}
                                              </div>
                                              <div>
                                                Context{' '}
                                                {rel.semanticAnalysis
                                                  .contextMatch
                                                  ? '✓'
                                                  : '✕'}
                                              </div>
                                              <div>
                                                Outcome{' '}
                                                {rel.semanticAnalysis
                                                  .outcomeMatch
                                                  ? '✓'
                                                  : '✕'}
                                              </div>
                                              <div className="font-medium text-fg">
                                                AI Decision: {rel.relationship}
                                              </div>
                                            </div>
                                          ) : null}
                                          {(rel.relationship === 'DUPLICATE' ||
                                            rel.relationship ===
                                              'POSSIBLE_DUPLICATE') && (
                                            <div className="flex flex-wrap gap-2 pt-1">
                                              <Button
                                                size="sm"
                                                variant="secondary"
                                                disabled={
                                                  duplicateDecisionMutation.isPending
                                                }
                                                onClick={() =>
                                                  duplicateDecisionMutation.mutate(
                                                    {
                                                      requirementKey:
                                                        r.requirementKey,
                                                      decision: 'keep_both',
                                                    },
                                                  )
                                                }
                                              >
                                                Keep Both
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="secondary"
                                                disabled={
                                                  duplicateDecisionMutation.isPending
                                                }
                                                onClick={() =>
                                                  duplicateDecisionMutation.mutate(
                                                    {
                                                      requirementKey:
                                                        r.requirementKey,
                                                      decision: 'merge',
                                                    },
                                                  )
                                                }
                                              >
                                                Merge
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="secondary"
                                                disabled={
                                                  duplicateDecisionMutation.isPending
                                                }
                                                onClick={() =>
                                                  duplicateDecisionMutation.mutate(
                                                    {
                                                      requirementKey:
                                                        r.requirementKey,
                                                      decision:
                                                        'mark_not_duplicate',
                                                    },
                                                  )
                                                }
                                              >
                                                Mark Not Duplicate
                                              </Button>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {tab !== 'overview' &&
      tab !== 'stlc' &&
      !extractMutation.isPending &&
      !reviewMutation.isPending &&
      view === 'detail' &&
      selected ? (
        <Card className="space-y-4">
          <div className="sticky top-14 z-10 -mx-1 space-y-3 border-b border-border bg-bg/95 px-1 pb-3 backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-sm text-muted">
                  {selected.requirementKey}
                </div>
                <h2 className="mt-1 line-clamp-2 text-xl font-semibold">
                  {selected.title}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    reanalyzeMutation.mutate(selected.requirementKey)
                  }
                  disabled={
                    reanalyzeMutation.isPending || analysisStatus === 'RUNNING'
                  }
                >
                  {selected.reviewedAt ? 'Re-analyze' : 'Run Analysis'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openEditReq(selected)}
                >
                  Edit
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setDeleteReq(selected)}
                >
                  Delete
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setView(
                      (reviewSummaryQuery.data?.features ?? 0) > 0
                        ? 'features'
                        : 'list',
                    )
                  }
                >
                  Back
                </Button>
              </div>
            </div>
            {selected.analysisStale ? (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                This requirement is stale after edits. Re-analyze to refresh
                review results.
                <Button
                  className="ml-3"
                  size="sm"
                  onClick={() =>
                    reanalyzeMutation.mutate(selected.requirementKey)
                  }
                  disabled={reanalyzeMutation.isPending}
                >
                  Re-analyze
                </Button>
              </div>
            ) : null}
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
              <Badge tone={impactTone(selected.businessImpact)}>
                Impact: {impactLabel(selected.businessImpact)}
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
              <div className="mt-1">
                {typeLabel(selected.primaryType ?? selected.type)}
                {selected.secondaryType
                  ? ` · Secondary: ${typeLabel(selected.secondaryType)}`
                  : ''}
              </div>
            </div>
            {selected.featureGroup ? (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted">
                  Feature
                </div>
                <div className="mt-1">
                  {selected.featureGroup.businessArea} /{' '}
                  {selected.featureGroup.name}
                </div>
              </div>
            ) : null}
            {(selected.businessIntent ||
              selected.businessReview?.intent?.text) && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted">
                  Business Intent
                  {selected.intentSource
                    ? ` · ${selected.intentSource}`
                    : ''}
                </div>
                <p className="mt-1 leading-relaxed">
                  {selected.businessIntent ??
                    selected.businessReview?.intent?.text}
                </p>
              </div>
            )}
            <div className="rounded-lg border border-border bg-bg-elevated/40 p-3">
              <div className="text-xs uppercase tracking-wide text-muted">
                Requirement Intelligence
              </div>
              {selected.semantic ? (
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <span className="text-muted">Actor · </span>
                    {selected.semantic.actor}
                  </div>
                  <div>
                    <span className="text-muted">Action · </span>
                    {selected.semantic.action}
                  </div>
                  <div>
                    <span className="text-muted">Object · </span>
                    {selected.semantic.entity}
                  </div>
                  <div>
                    <span className="text-muted">Capability · </span>
                    {selected.semantic.businessCapability}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-muted">Business outcome · </span>
                    {selected.semantic.businessOutcome}
                  </div>
                  {selected.semantic.crudOp ? (
                    <div>
                      <span className="text-muted">CRUD · </span>
                      {selected.semantic.crudOp}
                    </div>
                  ) : null}
                  {'condition' in selected.semantic &&
                  selected.semantic.condition ? (
                    <div>
                      <span className="text-muted">Condition · </span>
                      {String(selected.semantic.condition)}
                    </div>
                  ) : null}
                  {'polarity' in selected.semantic &&
                  selected.semantic.polarity ? (
                    <div>
                      <span className="text-muted">Polarity · </span>
                      {String(selected.semantic.polarity)}
                    </div>
                  ) : null}
                  {'confidence' in selected.semantic &&
                  selected.semantic.confidence != null ? (
                    <div>
                      <span className="text-muted">Semantic confidence · </span>
                      {Math.round(Number(selected.semantic.confidence) * 100)}%
                      {selected.semantic.uncertain ? ' (uncertain)' : ''}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted">
                  Run analysis to populate actor / action / object intelligence.
                </p>
              )}
              {(selected.businessRules?.length ||
                selected.businessReview?.rules?.length) ? (
                <div className="mt-3 text-xs">
                  <div className="text-muted">Business rules</div>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {(selected.businessRules?.length
                      ? selected.businessRules
                      : (selected.businessReview?.rules ?? []).map(
                          (r) => r.text,
                        )
                    )
                      .slice(0, 4)
                      .map((rule) => (
                        <li key={rule}>{rule}</li>
                      ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-3 text-xs">
                <div className="text-muted">Review recommendation</div>
                <p className="mt-1">
                  {reviewStatusLabel(selected.reviewStatus)}
                  {selected.readinessScore != null
                    ? ` · readiness ${selected.readinessScore}%`
                    : ''}
                </p>
              </div>
            </div>
            {(() => {
              const positiveRels = (selected.relationships ?? []).filter(
                (r) => r.relationship !== 'NOT_DUPLICATE',
              );
              if (!positiveRels.length) {
                return (
                  <div className="rounded-lg border border-border bg-bg-elevated/40 p-3 text-sm text-muted">
                    No related requirements (independent).
                  </div>
                );
              }
              const rel = primaryRelationship(positiveRels);
              if (!rel) return null;
              return (
                <div
                  className={`space-y-2 rounded-lg border p-3 text-sm ${
                    rel.relationship === 'DUPLICATE' ||
                    rel.relationship === 'POSSIBLE_DUPLICATE' ||
                    rel.relationship === 'CONFLICT' ||
                    rel.relationship === 'CONFLICTS_WITH'
                      ? 'border-warning/40 bg-warning/10'
                      : 'border-border bg-bg-elevated/40'
                  }`}
                >
                  <div className="font-medium">
                    {relationshipLabel(rel.relationship)}
                  </div>
                  <div className="text-xs text-muted">
                    {positiveRels.length} related requirement
                    {positiveRels.length === 1 ? '' : 's'}
                  </div>
                  <div>{rel.targetRequirementId}</div>
                  {rel.reason ? (
                    <p className="whitespace-pre-wrap text-muted">
                      Why? {rel.reason}
                    </p>
                  ) : null}
                  {rel.semanticAnalysis ? (
                    <div className="grid gap-1 rounded-md border border-border/60 p-2 text-xs sm:grid-cols-2">
                      <div>
                        Actor {rel.semanticAnalysis.actorMatch ? '✓ Same' : '✕ Different'}
                      </div>
                      <div>
                        Entity{' '}
                        {rel.semanticAnalysis.entityMatch ? '✓ Same' : '✕ Different'}
                      </div>
                      <div>
                        Action{' '}
                        {rel.semanticAnalysis.actionMatch
                          ? '✓ Same'
                          : '✕ Different'}
                      </div>
                      <div>
                        Capability{' '}
                        {rel.semanticAnalysis.capabilityMatch
                          ? '✓ Related/Same'
                          : '✕ Different'}
                      </div>
                      <div>
                        Context{' '}
                        {rel.semanticAnalysis.contextMatch
                          ? '✓ Same'
                          : '✕ Different'}
                      </div>
                      <div>
                        Outcome{' '}
                        {rel.semanticAnalysis.outcomeMatch
                          ? '✓ Same'
                          : '✕ Different'}
                      </div>
                      <div className="font-medium text-fg sm:col-span-2">
                        AI Decision: {rel.relationship}
                      </div>
                    </div>
                  ) : null}
                  <p className="text-xs text-muted">
                    Original requirement IDs are preserved — nothing is deleted
                    automatically.
                  </p>
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer">
                      AI Analysis Details
                    </summary>
                    <p className="mt-1">
                      Decision comes from the semantic engine (
                      {reviewSummaryQuery.data?.analysisEngine ??
                        'semantic-requirement-review'}{' '}
                      v
                      {reviewSummaryQuery.data?.analysisVersion ?? '2.6.0'}).
                      Similarity percentage is not used as the primary signal.
                    </p>
                  </details>
                  {(rel.relationship === 'DUPLICATE' ||
                    rel.relationship === 'POSSIBLE_DUPLICATE') && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={duplicateDecisionMutation.isPending}
                        onClick={() =>
                          duplicateDecisionMutation.mutate({
                            requirementKey: selected.requirementKey,
                            decision: 'keep_both',
                          })
                        }
                      >
                        Keep Both
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={duplicateDecisionMutation.isPending}
                        onClick={() =>
                          duplicateDecisionMutation.mutate({
                            requirementKey: selected.requirementKey,
                            decision: 'merge',
                          })
                        }
                      >
                        Merge
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={duplicateDecisionMutation.isPending}
                        onClick={() =>
                          duplicateDecisionMutation.mutate({
                            requirementKey: selected.requirementKey,
                            decision: 'mark_not_duplicate',
                          })
                        }
                      >
                        Mark Not Duplicate
                      </Button>
                    </div>
                  )}
                </div>
              );
            })()}
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

          {(selected.relatedRequirements?.length ?? 0) > 0 ? (
            <div className="space-y-2 border-t border-border pt-4 text-sm">
              <h3 className="font-medium">Related Requirements</h3>
              <ul className="space-y-1">
                {selected.relatedRequirements!.slice(0, 12).map((r) => (
                  <li key={`${r.relationType}-${r.requirementKey}`}>
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => setView('detail', r.requirementKey)}
                    >
                      <Badge>{r.relationType}</Badge>{' '}
                      {r.requirementKey} — {r.title}
                    </button>
                  </li>
                ))}
              </ul>
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
      tab !== 'stlc' &&
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
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setView('features')}
                  >
                    Features
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setView('review-dashboard')}
                  >
                    Review Dashboard
                  </Button>
                </>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => reviewMutation.mutate()}
                disabled={extracted.length === 0 || reviewMutation.isPending}
              >
                Run Analysis
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

          {extracted.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <h3 className="text-sm font-medium">No requirements yet</h3>
              <p className="mt-1 text-sm text-muted">
                Add a requirement manually or import from a source document.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={openAddReq}>
                  Add Requirement
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setView('source')}
                >
                  Import / Source
                </Button>
              </div>
            </div>
          ) : (
            <>
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
                      <th className="px-3 py-2 font-medium">Business Impact</th>
                      <th className="px-3 py-2 font-medium">Review</th>
                      <th className="px-3 py-2 font-medium">Questions</th>
                      <th className="px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-3 py-6 text-center text-muted"
                        >
                          No requirements match your filters.
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
                            <div className="line-clamp-2 font-medium">
                              {r.title}
                            </div>
                            {r.description ? (
                              <div className="mt-0.5 line-clamp-2 text-xs text-muted">
                                {r.description}
                              </div>
                            ) : null}
                            {r.analysisStale ? (
                              <div className="text-xs text-warning">Stale</div>
                            ) : null}
                            {(() => {
                              const rel = primaryRelationship(r.relationships);
                              if (!rel) {
                                // Do not fall back to legacy possibleDuplicateOf + %
                                return null;
                              }
                              if (rel.relationship === 'NOT_DUPLICATE') {
                                return (
                                  <div className="text-xs text-muted">
                                    NO DUPLICATE · {rel.targetRequirementId}
                                  </div>
                                );
                              }
                              return (
                                <div className="text-xs text-muted">
                                  {rel.relationship === 'RELATED' ||
                                  rel.relationship === 'PRECEDES'
                                    ? 'RELATED to '
                                    : `${rel.relationship.replace(/_/g, ' ')} · `}
                                  {rel.targetRequirementId}
                                  {rel.reason
                                    ? ` — ${rel.reason.split('\n')[0]}`
                                    : ''}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2">
                            {typeLabel(r.primaryType ?? r.type)}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={impactTone(r.businessImpact)}>
                              {impactLabel(r.businessImpact)}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={reviewStatusTone(r.reviewStatus)}>
                              {reviewStatusLabel(r.reviewStatus)}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {(r.criticalOpenCount ?? 0) > 0
                              ? `🔴${r.criticalOpenCount}`
                              : (r.highOpenCount ?? 0) > 0
                                ? `🟠${r.highOpenCount}`
                                : '—'}
                          </td>
                          <td
                            className="px-3 py-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ActionMenu
                              items={[
                                {
                                  label: 'View',
                                  onClick: () =>
                                    setView('detail', r.requirementKey),
                                },
                                {
                                  label: 'Edit',
                                  onClick: () => openEditReq(r),
                                },
                                {
                                  label: 'Analyze',
                                  onClick: () =>
                                    reanalyzeMutation.mutate(r.requirementKey),
                                  disabled:
                                    reanalyzeMutation.isPending ||
                                    analysisStatus === 'RUNNING',
                                },
                                {
                                  label: 'Delete',
                                  danger: true,
                                  onClick: () => setDeleteReq(r),
                                },
                              ]}
                            />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {reviewError ? (
            <p className="text-sm text-danger">{reviewError}</p>
          ) : null}
        </Card>
      ) : null}

      {tab !== 'overview' &&
      tab !== 'stlc' &&
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

      <ConfirmDialog
        open={deleteProjectOpen}
        title="Delete Project?"
        danger
        confirmLabel="Delete Project"
        busy={deleteProjectMutation.isPending}
        onCancel={() => setDeleteProjectOpen(false)}
        onConfirm={() => deleteProjectMutation.mutate()}
      >
        <p>
          This will permanently remove <strong>{project.name}</strong> and all
          related data:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Source documents and extracted requirements</li>
          <li>Analysis results and review findings</li>
          <li>Clarifying questions and answers</li>
          <li>Feature groups and requirement relationships</li>
          <li>Conflicts and readiness scores</li>
        </ul>
        <p className="mt-2 font-medium text-danger">
          This action cannot be undone.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteReq)}
        title="Delete Requirement?"
        danger
        confirmLabel="Delete Requirement"
        busy={deleteReqMutation.isPending}
        onCancel={() => setDeleteReq(null)}
        onConfirm={() => {
          if (deleteReq) deleteReqMutation.mutate(deleteReq.requirementKey);
        }}
      >
        <p>
          Delete <strong>{deleteReq?.requirementKey}</strong> —{' '}
          {deleteReq?.title}? Related review data and questions for this
          requirement will also be removed.
        </p>
        <p className="mt-2 font-medium text-danger">
          This action cannot be undone.
        </p>
      </ConfirmDialog>

      {addReqOpen || editReq ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close dialog"
            onClick={() => {
              setAddReqOpen(false);
              setEditReq(null);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-md rounded-xl border border-border bg-bg p-5 shadow-xl"
          >
            <h2 className="text-base font-semibold">
              {editReq ? 'Edit Requirement' : 'Add Requirement'}
            </h2>
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!reqForm.title.trim()) return;
                const body = {
                  title: reqForm.title.trim(),
                  description: reqForm.description,
                  type: reqForm.type,
                };
                if (editReq) {
                  updateReqMutation.mutate({
                    key: editReq.requirementKey,
                    body,
                  });
                } else {
                  createReqMutation.mutate(body);
                }
              }}
            >
              <div>
                <label className="text-xs uppercase tracking-wide text-muted">
                  Title
                </label>
                <Input
                  className="mt-1"
                  value={reqForm.title}
                  onChange={(e) =>
                    setReqForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                  required
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted">
                  Description
                </label>
                <textarea
                  className="mt-1 min-h-[88px] w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                  value={reqForm.description}
                  onChange={(e) =>
                    setReqForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted">
                  Type
                </label>
                <select
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm"
                  value={reqForm.type}
                  onChange={(e) =>
                    setReqForm((prev) => ({ ...prev, type: e.target.value }))
                  }
                >
                  <option value="FUNCTIONAL">Functional</option>
                  <option value="NON_FUNCTIONAL">Non-Functional</option>
                  <option value="BUSINESS_RULE">Business Rule</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setAddReqOpen(false);
                    setEditReq(null);
                  }}
                  disabled={
                    createReqMutation.isPending || updateReqMutation.isPending
                  }
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    !reqForm.title.trim() ||
                    createReqMutation.isPending ||
                    updateReqMutation.isPending
                  }
                >
                  {createReqMutation.isPending || updateReqMutation.isPending
                    ? 'Saving…'
                    : editReq
                      ? 'Save'
                      : 'Add Requirement'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
