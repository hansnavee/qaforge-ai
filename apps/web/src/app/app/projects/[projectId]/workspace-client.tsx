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
import { api, ApiError, downloadAuthenticated } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SHOW_AI_STLC_UI } from '@/lib/product-flags';
import { StlcDocsPanel } from './stlc-docs-panel';
import { TcmsWorkspace } from './tcms-workspace';
import {
  RequirementDetailView,
  RequirementsFeaturesView,
  RequirementsReviewDashboard,
} from './requirements-review-views';
import {
  RequirementsPhaseShell,
  requirementsStepToView,
  viewToRequirementsStep,
  type RequirementsPhaseStep,
} from './requirements-phase-shell';

const REQUIREMENT_EXPORTS = [
  { format: 'xlsx', label: 'Excel spreadsheet', filename: 'requirements.xls' },
  { format: 'docx', label: 'Word document', filename: 'requirements.doc' },
  { format: 'pdf', label: 'PDF report', filename: 'requirements-report.html' },
] as const;

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
  rejected?: boolean;
  rejectionReason?: string | null;
  blockers: string[];
  checklist?: Array<{ id: string; label: string; done: boolean }>;
  counts: {
    total: number;
    blocked: number;
    needsClarification: number;
    reviewRecommended: number;
    readyForTestDesign: number;
    stale: number;
    openBlockingCriticalQuestions: number;
    openBlockingHighQuestions?: number;
    openConflicts?: number;
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
  requirementsRejectedAt?: string | null;
  requirementsRejectedBy?: string | null;
  requirementsRejectionReason?: string | null;
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
  requirementsRejectedAt?: string | null;
  requirementsRejectedBy?: string | null;
  requirementsRejectionReason?: string | null;
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
  if (status === 'REVIEW_RECOMMENDED') return 'Needs tester review';
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
  if (!SHOW_AI_STLC_UI) {
    return <TcmsWorkspace />;
  }
  return <AiStlcWorkspace />;
}

function AiStlcWorkspace() {
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

  const rejectRequirementsMutation = useMutation({
    mutationFn: async (reason: string) => {
      return api(`/api/v1/projects/${projectId}/reject-requirements`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
    },
    onSuccess: async () => {
      await invalidateReviewQueries();
      setView('features');
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
    onMutate: () => {
      // Navigate immediately so the click always feels responsive.
      router.replace('?tab=stlc&phase=PLANNING', { scroll: false });
    },
    onSuccess: async (execution) => {
      await invalidateReviewQueries();
      void queryClient.invalidateQueries({ queryKey: ['stlc-phases', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] });
      const status = execution?.status ?? '';
      const phaseName = execution?.phase ?? '';
      let phase = 'PLANNING';
      if (
        status === 'AWAITING_DESIGN_APPROVAL' ||
        phaseName === 'TEST_DESIGN'
      ) {
        phase = 'DESIGN';
      } else if (
        status === 'AWAITING_ENV_APPROVAL' ||
        phaseName === 'ENVIRONMENT'
      ) {
        phase = 'ENVIRONMENT';
      } else if (status === 'AWAITING_PLAN_APPROVAL') {
        phase = 'PLANNING';
      }
      router.replace(`?tab=stlc&phase=${phase}`, { scroll: false });
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
  const rejectionReason =
    (!requirementsApproved &&
      (stlcHandoff?.rejectionReason ||
        reviewSummaryQuery.data?.requirementsRejectionReason ||
        project.requirementsRejectionReason)) ||
    null;
  const workflowSteps = buildWorkflow({
    requirementsApproved,
    stlcStage:
      reviewSummaryQuery.data?.stlcStage ?? project.stlcStage ?? 'REQUIREMENTS',
  });
  const handoffBlockers = stlcHandoff?.blockers ?? [];
  const handoffChecklist = stlcHandoff?.checklist ?? [];
  const reqPhaseStep: RequirementsPhaseStep =
    view === 'approve' ? 'approve' : viewToRequirementsStep(view);
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
      : tab === 'stlc'
        ? (
            workflowSteps.find((s) => s.state === 'active')?.label ??
            'Current phase'
          ).replace(/^\d+\.\s*/, '')
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
                    ? 'Review requirements on this page, then Approve. You can browse every STLC tab; Accept stays on the current step.'
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
                ) : (() => {
                  const stage = (
                    reviewSummaryQuery.data?.stlcStage ??
                    project.stlcStage ??
                    'PLANNING'
                  ).toUpperCase();
                  const needsPlanningKickoff =
                    stage === 'REQUIREMENTS' || stage === 'PLANNING';
                  const currentPhaseId =
                    stage === 'REQUIREMENTS' ? 'PLANNING' : stage;
                  return (
                    <>
                      {needsPlanningKickoff ? (
                        <Button
                          size="sm"
                          onClick={() => startPlanningMutation.mutate()}
                          disabled={startPlanningMutation.isPending}
                        >
                          {startPlanningMutation.isPending
                            ? 'Starting…'
                            : 'Continue to Test Planning'}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() =>
                            router.replace(
                              `?tab=stlc&phase=${currentPhaseId}`,
                              { scroll: false },
                            )
                          }
                        >
                          Continue: {activeStep?.label.replace(/^\d+\.\s*/, '')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          router.replace('?tab=stlc&phase=DESIGN', {
                            scroll: false,
                          })
                        }
                      >
                        Review test cases
                      </Button>
                    </>
                  );
                })()}
              </div>

              {requirementsApproved ? (
                <p className="mt-3 text-xs text-muted">
                  {(
                    reviewSummaryQuery.data?.stlcStage ??
                    project.stlcStage ??
                    ''
                  ).toUpperCase() === 'ENVIRONMENT'
                    ? 'Environment = Test Environment Setup (browsers, URL, credentials). Planning and Design are already done — open Review test cases anytime, or Continue to Accept Environment.'
                    : (
                          reviewSummaryQuery.data?.stlcStage ??
                          project.stlcStage ??
                          'PLANNING'
                        ).toUpperCase() === 'PLANNING' ||
                        (
                          reviewSummaryQuery.data?.stlcStage ??
                          project.stlcStage ??
                          ''
                        ).toUpperCase() === 'REQUIREMENTS'
                      ? 'Continues AI Test Planning: generates the strategy, then designs technique-based test cases (not one case per requirement).'
                      : 'Open your current STLC step to Accept, or Review test cases to edit Design anytime.'}
                </p>
              ) : null}

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
        <RequirementsPhaseShell
          step={reqPhaseStep}
          onStepChange={(step) => {
            setView(
              requirementsStepToView(step, {
                hasExtracted: extracted.length > 0,
                hasReview: (reviewSummaryQuery.data?.reviewed ?? 0) > 0,
              }),
            );
          }}
          analysisLabel={analysisLabel(analysisStatus)}
          extractedCount={extractedCount}
          approved={requirementsApproved}
          canApprove={Boolean(stlcHandoff?.canApprove)}
          checklist={handoffChecklist}
          blockers={handoffBlockers}
          approvePending={approveRequirementsMutation.isPending}
          onApprove={() => approveRequirementsMutation.mutate()}
          rejectPending={rejectRequirementsMutation.isPending}
          onReject={(reason) => rejectRequirementsMutation.mutate(reason)}
          rejectionReason={rejectionReason}
          onContinuePlanning={() => startPlanningMutation.mutate()}
        >
        <Card className="sticky top-0 z-10 space-y-3 border-accent/30 bg-bg/95 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">{project.name}</h2>
              <p className="mt-1 text-sm text-muted">
                Requirements: {extractedCount} · Analysis:{' '}
                {analysisLabel(analysisStatus)}
              </p>
              <p className="mt-1 text-xs text-muted">
                Source text is never rewritten by analysis without your
                confirmation.
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
              {extracted.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {REQUIREMENT_EXPORTS.map((item) => (
                    <Button
                      key={item.format}
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void downloadAuthenticated(
                          `/api/v1/projects/${projectId}/extracted-requirements/export?format=${item.format}`,
                          item.filename,
                        ).catch((err) => {
                          setReviewError(
                            err instanceof Error
                              ? err.message
                              : 'Export failed',
                          );
                        });
                      }}
                    >
                      {item.format === 'xlsx'
                        ? 'Excel'
                        : item.format === 'docx'
                          ? 'Word'
                          : 'PDF'}
                    </Button>
                  ))}
                </div>
              ) : null}
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
        </RequirementsPhaseShell>
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
        <Card className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-success">
                Extraction complete
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">
                {summary.total} requirement
                {summary.total === 1 ? '' : 's'} ready to review
              </h2>
              <p className="mt-1 text-sm text-muted">
                From {summary.sourceDocument}. Next: open the list, run analysis,
                then answer clarifying questions.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {REQUIREMENT_EXPORTS.map((item) => (
                <Button
                  key={item.format}
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void downloadAuthenticated(
                      `/api/v1/projects/${projectId}/extracted-requirements/export?format=${item.format}`,
                      item.filename,
                    ).catch((err) => {
                      setReviewError(
                        err instanceof Error ? err.message : 'Export failed',
                      );
                    });
                  }}
                >
                  {item.format === 'xlsx'
                    ? 'Excel'
                    : item.format === 'docx'
                      ? 'Word'
                      : 'PDF'}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Total', value: summary.total },
              { label: 'Functional', value: summary.functional },
              { label: 'Non-functional', value: summary.nonFunctional },
              { label: 'Business rules', value: summary.businessRules },
            ].map((tile) => (
              <div
                key={tile.label}
                className="rounded-xl border border-border/80 bg-bg-elevated/30 px-4 py-3"
              >
                <div className="text-[11px] uppercase tracking-wide text-muted">
                  {tile.label}
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {tile.value}
                </div>
              </div>
            ))}
          </div>

          {(summary.merged != null && summary.merged > 0) ||
          (summary.rejected != null && summary.rejected > 0) ? (
            <p className="text-sm text-muted">
              Cleanup during extraction
              {summary.merged ? ` · ${summary.merged} merged` : ''}
              {summary.rejected ? ` · ${summary.rejected} rejected` : ''}
              {summary.retitled ? ` · ${summary.retitled} retitled` : ''}
            </p>
          ) : null}

          {extracted.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Preview
              </div>
              <ul className="space-y-2">
                {extracted.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="w-full rounded-xl border border-border bg-bg-elevated/20 px-4 py-3 text-left transition hover:border-accent/40 hover:bg-bg-elevated/40"
                      onClick={() => setView('detail', r.requirementKey)}
                    >
                      <div className="font-mono text-[11px] text-muted">
                        {r.requirementKey}
                      </div>
                      <div className="mt-0.5 font-medium">{r.title}</div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted">
                        {r.description}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setView('list')}>Browse requirements</Button>
            <Button
              variant="secondary"
              onClick={() => reviewMutation.mutate()}
              disabled={reviewMutation.isPending}
            >
              Run analysis
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
              Analysis finds gaps and clarifying questions — it does not invent
              business rules.
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
      view === 'approve' ? (
        <Card className="space-y-3">
          <h2 className="text-base font-medium">Approve baseline</h2>
          <p className="text-sm text-muted">
            Use the exit criteria above. Approving freezes this requirements
            pack for Planning — re-extract later will require re-approval.
          </p>
          {(reviewSummaryQuery.data?.reviewed ?? 0) > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setView('features')}
            >
              Review requirements first
            </Button>
          ) : null}
        </Card>
      ) : null}

      {tab !== 'overview' &&
      tab !== 'stlc' &&
      !extractMutation.isPending &&
      !reviewMutation.isPending &&
      view === 'review-dashboard' ? (
        <RequirementsReviewDashboard
          summary={reviewSummaryQuery.data}
          conflicts={conflictsQuery.data ?? []}
          reviewPending={reviewMutation.isPending}
          onRerun={() => reviewMutation.mutate()}
          onOpenFeatures={() => setView('features')}
          onOpenList={() => setView('list')}
          error={reviewError}
        />
      ) : null}

      {tab !== 'overview' &&
      tab !== 'stlc' &&
      !extractMutation.isPending &&
      !reviewMutation.isPending &&
      view === 'features' ? (
        <RequirementsFeaturesView
          features={featuresQuery.data ?? []}
          summary={reviewSummaryQuery.data}
          expanded={expandedFeatures}
          onToggle={(id) =>
            setExpandedFeatures((prev) => ({
              ...prev,
              [id]: !prev[id],
            }))
          }
          onOpenDetail={(key) => setView('detail', key)}
          onOpenDashboard={() => setView('review-dashboard')}
          onOpenList={() => setView('list')}
          onDuplicateDecision={(opts) => duplicateDecisionMutation.mutate(opts)}
          duplicatePending={duplicateDecisionMutation.isPending}
          onExport={(format) => {
            const filename =
              format === 'xlsx'
                ? 'requirements.xls'
                : format === 'docx'
                  ? 'requirements.doc'
                  : 'requirements-report.html';
            void downloadAuthenticated(
              `/api/v1/projects/${projectId}/extracted-requirements/export?format=${format}`,
              filename,
            ).catch((err) => {
              setReviewError(
                err instanceof Error ? err.message : 'Export failed',
              );
            });
          }}
        />
      ) : null}

      {tab !== 'overview' &&
      tab !== 'stlc' &&
      !extractMutation.isPending &&
      !reviewMutation.isPending &&
      view === 'detail' &&
      selected ? (
        <RequirementDetailView
          selected={selected}
          hasConflict={(conflictsQuery.data ?? []).some(
            (c) =>
              c.requirementA.requirementKey === selected.requirementKey ||
              c.requirementB.requirementKey === selected.requirementKey,
          )}
          analysisEngine={reviewSummaryQuery.data?.analysisEngine}
          analysisVersion={reviewSummaryQuery.data?.analysisVersion}
          answerDrafts={answerDrafts}
          onAnswerDraft={(id, value) =>
            setAnswerDrafts((prev) => ({ ...prev, [id]: value }))
          }
          onSubmitAnswer={(questionId, answer) =>
            answerMutation.mutate({ questionId, answer })
          }
          answerPending={answerMutation.isPending}
          answerError={answerError}
          onBack={() =>
            setView(
              (reviewSummaryQuery.data?.features ?? 0) > 0 ? 'features' : 'list',
            )
          }
          onEdit={() => openEditReq(selected)}
          onDelete={() => setDeleteReq(selected)}
          onReanalyze={() => reanalyzeMutation.mutate(selected.requirementKey)}
          reanalyzePending={reanalyzeMutation.isPending}
          analysisRunning={analysisStatus === 'RUNNING'}
          onOpenRelated={(key) => setView('detail', key)}
          onDuplicateDecision={(opts) => duplicateDecisionMutation.mutate(opts)}
          duplicatePending={duplicateDecisionMutation.isPending}
        />
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
                    Readiness
                  </Button>
                </>
              ) : null}
              {extracted.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {REQUIREMENT_EXPORTS.map((item) => (
                    <Button
                      key={item.format}
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void downloadAuthenticated(
                          `/api/v1/projects/${projectId}/extracted-requirements/export?format=${item.format}`,
                          item.filename,
                        ).catch((err) => {
                          setReviewError(
                            err instanceof Error
                              ? err.message
                              : 'Export failed',
                          );
                        });
                      }}
                    >
                      {item.format === 'xlsx'
                        ? 'Excel'
                        : item.format === 'docx'
                          ? 'Word'
                          : 'PDF'}
                    </Button>
                  ))}
                </div>
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

              <div className="space-y-2">
                {filtered.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
                    No requirements match your filters.
                  </div>
                ) : (
                  filtered.map((r) => (
                    <div
                      key={r.id}
                      className="group rounded-xl border border-border bg-bg-elevated/20 px-4 py-3 transition hover:border-accent/35 hover:bg-bg-elevated/40"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setView('detail', r.requirementKey)}
                        >
                          <div className="font-mono text-[11px] text-muted">
                            {r.requirementKey}
                          </div>
                          <div className="mt-0.5 text-sm font-medium leading-snug">
                            {r.title}
                          </div>
                          {r.description ? (
                            <p className="mt-1 line-clamp-2 text-sm text-muted">
                              {r.description}
                            </p>
                          ) : null}
                          {r.analysisStale ? (
                            <div className="mt-1 text-xs text-warning">
                              Stale — re-analyze after edits
                            </div>
                          ) : null}
                          {(r.openQuestionCount ?? 0) > 0 ? (
                            <div className="mt-1 text-xs text-warning">
                              {r.openQuestionCount} open question
                              {r.openQuestionCount === 1 ? '' : 's'}
                            </div>
                          ) : null}
                        </button>
                        <div className="flex shrink-0 items-start gap-2">
                          <div className="flex flex-wrap justify-end gap-1">
                            <Badge>
                              {typeLabel(r.primaryType ?? r.type)}
                            </Badge>
                            {r.businessImpact &&
                            (r.businessImpact === 'CRITICAL' ||
                              r.businessImpact === 'HIGH') ? (
                              <Badge tone={impactTone(r.businessImpact)}>
                                {impactLabel(r.businessImpact)}
                              </Badge>
                            ) : null}
                            <Badge tone={reviewStatusTone(r.reviewStatus)}>
                              {reviewStatusLabel(r.reviewStatus)}
                            </Badge>
                          </div>
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
                        </div>
                      </div>
                    </div>
                  ))
                )}
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
