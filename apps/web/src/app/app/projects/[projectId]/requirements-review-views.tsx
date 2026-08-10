'use client';

import { useMemo, useState } from 'react';
import { ActionMenu } from '@/components/ActionMenu';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { cn } from '@/lib/cn';

/* ─── shared shapes (compatible with workspace-client) ─── */

type ReviewFact = {
  text: string;
  status: string;
  source?: string | null;
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
};

type Relationship = {
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
};

export type RequirementDetailModel = {
  requirementKey: string;
  title: string;
  description: string;
  type: string;
  primaryType?: string | null;
  secondaryType?: string | null;
  businessImpact?: string | null;
  intentSource?: string | null;
  businessIntent?: string | null;
  acceptanceCriteria: string[];
  businessRules: string[];
  dependencies: string[];
  supportingInformation?: string[];
  sourcePage?: number | null;
  sourceSection?: string | null;
  sourceText?: string | null;
  sourceDocumentName?: string | null;
  relationships?: Relationship[];
  semantic?: {
    actor: string;
    entity: string;
    action: string;
    businessCapability: string;
    businessOutcome: string;
    crudOp?: string | null;
    confidence?: number | null;
    polarity?: string | null;
    uncertain?: boolean | null;
  } | null;
  featureGroup?: {
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
  businessReview?: {
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
  } | null;
  functionalReview?: {
    inputs: ReviewFact[];
    outputs: ReviewFact[];
    validations: ReviewFact[];
    successBehavior: ReviewFact[];
    failureBehavior: ReviewFact[];
    errorHandling: ReviewFact[];
    navigation: ReviewFact[];
    dataHandling: ReviewFact[];
  } | null;
  readinessScore?: number | null;
  reviewedAt?: string | null;
  questions?: ReviewQuestion[];
  analysisStale?: boolean;
};

export type FeatureGroupModel = {
  id: string;
  name: string;
  businessArea?: string | null;
  businessIntent?: string | null;
  featureRisk?: string | null;
  reviewStatus?: string | null;
  requirementCount: number;
  openQuestionCount?: number;
  questionCount: number;
  requirements: Array<{
    id: string;
    requirementKey: string;
    title: string;
    businessImpact?: string | null;
    reviewStatus?: string | null;
    openQuestionCount?: number;
    relationships?: Relationship[];
  }>;
};

export type ReviewSummaryModel = {
  total: number;
  reviewed: number;
  features?: number;
  duplicates?: number;
  businessReadinessPct: number;
  functionalReadinessPct: number;
  byReviewStatus: {
    readyForTestDesign: number;
    needsClarification: number;
    blocked: number;
    reviewRecommended: number;
  };
  questions: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
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
  analysisEngine?: string | null;
  analysisVersion?: string | null;
};

type ReviewConflict = {
  id: string;
  summary: string;
  requirementA: { requirementKey: string };
  requirementB: { requirementKey: string };
};

/* ─── helpers ─── */

function typeLabel(type: string) {
  if (type === 'NON_FUNCTIONAL') return 'Non-Functional';
  if (type === 'BUSINESS_RULE') return 'Business Rule';
  return 'Functional';
}

function reviewStatusLabel(status?: string | null) {
  if (!status) return 'Not reviewed';
  if (status === 'READY_FOR_TEST_DESIGN') return 'Ready';
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

function relationshipLabel(kind: string): string {
  switch (kind) {
    case 'DUPLICATE':
      return 'Duplicate';
    case 'POSSIBLE_DUPLICATE':
      return 'Possible duplicate';
    case 'BUSINESS_RULE_CONSTRAINT':
      return 'Business rule constraint';
    case 'SEQUENTIAL':
    case 'PRECEDES':
      return 'Sequential';
    case 'CONFLICT':
    case 'CONFLICTS_WITH':
      return 'Conflict';
    case 'DEPENDS_ON':
      return 'Dependency';
    case 'RELATED':
      return 'Related';
    default:
      return kind.replace(/_/g, ' ');
  }
}

function primaryRelationship(rels?: Relationship[]) {
  if (!rels?.length) return null;
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
                : 9;
  return [...positive].sort(
    (a, b) => rank(a.relationship) - rank(b.relationship),
  )[0];
}

function priorityTone(
  priority: string,
): 'success' | 'warning' | 'danger' | 'accent' | undefined {
  if (priority === 'CRITICAL') return 'danger';
  if (priority === 'HIGH') return 'warning';
  if (priority === 'MEDIUM') return 'accent';
  return undefined;
}

function CompactFacts({
  title,
  facts,
}: {
  title: string;
  facts: ReviewFact[] | null | undefined;
}) {
  if (!facts?.length) return null;
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">
        {title}
      </div>
      <ul className="mt-2 space-y-2">
        {facts.map((f, i) => (
          <li key={`${f.text}-${i}`} className="flex gap-2 text-sm">
            <span
              className={cn(
                'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                f.status === 'MISSING'
                  ? 'bg-warning'
                  : f.status === 'INFERRED'
                    ? 'bg-accent'
                    : 'bg-success',
              )}
              title={f.status}
            />
            <span className="leading-relaxed">{f.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-medium uppercase tracking-wide text-muted">
      {children}
    </div>
  );
}

function ReadinessStrip({ summary }: { summary: ReviewSummaryModel }) {
  const openQs =
    summary.questions.critical +
    summary.questions.high +
    summary.questions.medium +
    summary.questions.low;
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      <div className="rounded-lg border border-border/80 bg-bg/40 px-3 py-2.5">
        <div className="text-[11px] uppercase tracking-wide text-muted">
          Reviewed
        </div>
        <div className="mt-0.5 text-lg font-semibold tabular-nums">
          {summary.reviewed}
          <span className="text-sm font-normal text-muted">
            /{summary.total}
          </span>
        </div>
      </div>
      <div className="rounded-lg border border-border/80 bg-bg/40 px-3 py-2.5">
        <div className="text-[11px] uppercase tracking-wide text-muted">
          Ready for design
        </div>
        <div className="mt-0.5 text-lg font-semibold tabular-nums text-success">
          {summary.byReviewStatus.readyForTestDesign}
        </div>
      </div>
      <div className="rounded-lg border border-border/80 bg-bg/40 px-3 py-2.5">
        <div className="text-[11px] uppercase tracking-wide text-muted">
          Need clarification
        </div>
        <div className="mt-0.5 text-lg font-semibold tabular-nums text-warning">
          {summary.byReviewStatus.needsClarification +
            summary.byReviewStatus.blocked}
        </div>
      </div>
      <div className="rounded-lg border border-border/80 bg-bg/40 px-3 py-2.5">
        <div className="text-[11px] uppercase tracking-wide text-muted">
          Open questions
        </div>
        <div className="mt-0.5 text-lg font-semibold tabular-nums">
          {openQs}
          {summary.questions.critical > 0 ? (
            <span className="ml-1 text-sm font-normal text-danger">
              · {summary.questions.critical} critical
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ─── Dashboard (compact) ─── */

export function RequirementsReviewDashboard({
  summary,
  conflicts,
  reviewPending,
  onRerun,
  onOpenFeatures,
  onOpenList,
  error,
}: {
  summary: ReviewSummaryModel | null | undefined;
  conflicts: ReviewConflict[];
  reviewPending: boolean;
  onRerun: () => void;
  onOpenFeatures: () => void;
  onOpenList: () => void;
  error?: string | null;
}) {
  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Review readiness</h2>
          <p className="mt-1 text-sm text-muted">
            Answer open questions, then approve when requirements are ready for
            test design.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRerun}
            disabled={reviewPending || !summary?.total}
          >
            Re-run review
          </Button>
          <Button size="sm" onClick={onOpenFeatures}>
            Browse by feature
          </Button>
          <Button variant="secondary" size="sm" onClick={onOpenList}>
            Flat list
          </Button>
        </div>
      </div>

      {conflicts.length > 0 ? (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
          <div className="font-medium text-danger">
            {conflicts.length} open conflict
            {conflicts.length === 1 ? '' : 's'}
          </div>
          <ul className="mt-2 space-y-1 text-muted">
            {conflicts.slice(0, 4).map((c) => (
              <li key={c.id}>
                {c.requirementA.requirementKey} ↔{' '}
                {c.requirementB.requirementKey}: {c.summary}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary ? (
        <>
          <ReadinessStrip summary={summary} />
          <p className="text-sm text-muted">
            Business readiness {summary.businessReadinessPct}% · Functional{' '}
            {summary.functionalReadinessPct}%
            {summary.features != null
              ? ` · ${summary.features} feature groups`
              : ''}
            {summary.duplicates
              ? ` · ${summary.duplicates} confirmed duplicates`
              : ''}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">
          No review data yet. Run analysis from the extraction summary to start.
        </p>
      )}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </Card>
  );
}

/* ─── Features browse ─── */

export function RequirementsFeaturesView({
  features,
  summary,
  expanded,
  onToggle,
  onOpenDetail,
  onOpenDashboard,
  onOpenList,
  onDuplicateDecision,
  duplicatePending,
  onExport,
}: {
  features: FeatureGroupModel[];
  summary: ReviewSummaryModel | null | undefined;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onOpenDetail: (key: string) => void;
  onOpenDashboard: () => void;
  onOpenList: () => void;
  onDuplicateDecision: (opts: {
    requirementKey: string;
    decision: 'keep_both' | 'merge' | 'mark_not_duplicate';
  }) => void;
  duplicatePending: boolean;
  onExport?: (format: 'xlsx' | 'docx' | 'pdf') => void;
}) {
  const areas = useMemo(() => {
    return Object.entries(
      features.reduce<Record<string, FeatureGroupModel[]>>((acc, f) => {
        const area = f.businessArea ?? 'Other';
        (acc[area] ??= []).push(f);
        return acc;
      }, {}),
    );
  }, [features]);

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Requirements review</h2>
          <p className="mt-1 text-sm text-muted">
            Open a requirement to read it and answer clarifying questions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onExport ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onExport('xlsx')}
              >
                Excel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onExport('docx')}
              >
                Word
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onExport('pdf')}
              >
                PDF
              </Button>
            </>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onOpenDashboard}>
            Readiness
          </Button>
          <Button variant="secondary" size="sm" onClick={onOpenList}>
            Flat list
          </Button>
        </div>
      </div>

      {summary ? <ReadinessStrip summary={summary} /> : null}

      {features.length === 0 ? (
        <p className="text-sm text-muted">
          No feature groups yet. Run analysis to generate them.
        </p>
      ) : (
        <div className="space-y-6">
          {areas.map(([area, group]) => (
            <section key={area} className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
                {area}
              </h3>
              <div className="space-y-2">
                {group.map((f) => {
                  const open = expanded[f.id] ?? false;
                  const openQs = f.openQuestionCount ?? f.questionCount ?? 0;
                  return (
                    <div
                      key={f.id}
                      className="overflow-hidden rounded-xl border border-border bg-bg-elevated/20"
                    >
                      <button
                        type="button"
                        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition hover:bg-bg-elevated/40"
                        onClick={() => onToggle(f.id)}
                        aria-expanded={open}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-muted" aria-hidden>
                              {open ? '▾' : '▸'}
                            </span>
                            <span className="font-medium">{f.name}</span>
                          </div>
                          <p className="mt-1 pl-5 text-xs text-muted">
                            {f.requirementCount} requirement
                            {f.requirementCount === 1 ? '' : 's'}
                            {openQs > 0
                              ? ` · ${openQs} open question${openQs === 1 ? '' : 's'}`
                              : ''}
                          </p>
                          {open && f.businessIntent ? (
                            <p className="mt-2 pl-5 text-sm text-muted">
                              {f.businessIntent}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge tone={reviewStatusTone(f.reviewStatus)}>
                            {reviewStatusLabel(f.reviewStatus)}
                          </Badge>
                          {f.featureRisk &&
                          (f.featureRisk === 'CRITICAL' ||
                            f.featureRisk === 'HIGH') ? (
                            <Badge tone={impactTone(f.featureRisk)}>
                              {f.featureRisk} risk
                            </Badge>
                          ) : null}
                        </div>
                      </button>

                      {open ? (
                        <ul className="divide-y divide-border border-t border-border">
                          {f.requirements.map((r) => {
                            const rel = primaryRelationship(r.relationships);
                            const needsDupAction =
                              rel &&
                              (rel.relationship === 'DUPLICATE' ||
                                rel.relationship === 'POSSIBLE_DUPLICATE');
                            return (
                              <li key={r.id} className="px-4 py-3">
                                <button
                                  type="button"
                                  className="flex w-full items-start justify-between gap-3 text-left hover:opacity-90"
                                  onClick={() =>
                                    onOpenDetail(r.requirementKey)
                                  }
                                >
                                  <div className="min-w-0">
                                    <div className="font-mono text-[11px] text-muted">
                                      {r.requirementKey}
                                    </div>
                                    <div className="mt-0.5 text-sm font-medium">
                                      {r.title}
                                    </div>
                                    {(r.openQuestionCount ?? 0) > 0 ? (
                                      <div className="mt-1 text-xs text-warning">
                                        {r.openQuestionCount} question
                                        {r.openQuestionCount === 1 ? '' : 's'}{' '}
                                        to answer
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                    {r.businessImpact &&
                                    (r.businessImpact === 'CRITICAL' ||
                                      r.businessImpact === 'HIGH') ? (
                                      <Badge
                                        tone={impactTone(r.businessImpact)}
                                      >
                                        {r.businessImpact}
                                      </Badge>
                                    ) : null}
                                    <Badge
                                      tone={reviewStatusTone(r.reviewStatus)}
                                    >
                                      {reviewStatusLabel(r.reviewStatus)}
                                    </Badge>
                                  </div>
                                </button>
                                {needsDupAction ? (
                                  <div className="mt-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs">
                                    <div className="font-medium">
                                      {relationshipLabel(rel.relationship)}
                                    </div>
                                    <p className="mt-1 text-muted">
                                      {rel.targetRequirementId}
                                      {rel.reason
                                        ? ` — ${rel.reason.split('\n')[0]}`
                                        : ''}
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={duplicatePending}
                                        onClick={() =>
                                          onDuplicateDecision({
                                            requirementKey: r.requirementKey,
                                            decision: 'keep_both',
                                          })
                                        }
                                      >
                                        Keep both
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={duplicatePending}
                                        onClick={() =>
                                          onDuplicateDecision({
                                            requirementKey: r.requirementKey,
                                            decision: 'merge',
                                          })
                                        }
                                      >
                                        Merge as duplicate of
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={duplicatePending}
                                        onClick={() =>
                                          onDuplicateDecision({
                                            requirementKey: r.requirementKey,
                                            decision: 'mark_not_duplicate',
                                          })
                                        }
                                      >
                                        Not a duplicate
                                      </Button>
                                    </div>
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
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
  );
}

/* ─── Detail ─── */

type DetailTab = 'overview' | 'questions' | 'analysis';

export function RequirementDetailView({
  selected,
  hasConflict,
  analysisEngine,
  analysisVersion,
  answerDrafts,
  onAnswerDraft,
  onSubmitAnswer,
  answerPending,
  answerError,
  onBack,
  onEdit,
  onDelete,
  onReanalyze,
  reanalyzePending,
  analysisRunning,
  onOpenRelated,
  onDuplicateDecision,
  duplicatePending,
}: {
  selected: RequirementDetailModel;
  hasConflict: boolean;
  analysisEngine?: string | null;
  analysisVersion?: string | null;
  answerDrafts: Record<string, string>;
  onAnswerDraft: (id: string, value: string) => void;
  onSubmitAnswer: (questionId: string, answer: string) => void;
  answerPending: boolean;
  answerError?: string | null;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReanalyze: () => void;
  reanalyzePending: boolean;
  analysisRunning: boolean;
  onOpenRelated: (key: string) => void;
  onDuplicateDecision: (opts: {
    requirementKey: string;
    decision: 'keep_both' | 'merge' | 'mark_not_duplicate';
  }) => void;
  duplicatePending: boolean;
}) {
  const openQuestions = useMemo(() => {
    const qs = selected.questions ?? [];
    return [...qs]
      .filter((q) => q.status === 'OPEN')
      .sort((a, b) => {
        const biz =
          Number(isBusinessQuestionCategory(b.category)) -
          Number(isBusinessQuestionCategory(a.category));
        if (biz !== 0) return biz;
        const rank = (p: string) =>
          p === 'CRITICAL' ? 0 : p === 'HIGH' ? 1 : p === 'MEDIUM' ? 2 : 3;
        return rank(a.priority) - rank(b.priority);
      });
  }, [selected.questions]);

  const answeredQuestions = useMemo(
    () => (selected.questions ?? []).filter((q) => q.status === 'ANSWERED'),
    [selected.questions],
  );

  const [tab, setTab] = useState<DetailTab>(() =>
    openQuestions.length > 0 ? 'questions' : 'overview',
  );

  const rel = primaryRelationship(
    (selected.relationships ?? []).filter(
      (r) => r.relationship !== 'NOT_DUPLICATE',
    ),
  );
  const needsDupAction =
    rel &&
    (rel.relationship === 'DUPLICATE' ||
      rel.relationship === 'POSSIBLE_DUPLICATE');

  const ac = selected.acceptanceCriteria ?? [];
  const intent =
    selected.businessIntent ?? selected.businessReview?.intent?.text ?? null;

  const tabs: Array<{ id: DetailTab; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    {
      id: 'questions',
      label: 'Questions',
      count: openQuestions.length || undefined,
    },
    { id: 'analysis', label: 'Analysis' },
  ];

  return (
    <Card className="space-y-0 overflow-hidden p-0">
      {/* Sticky header */}
      <div className="sticky top-14 z-10 border-b border-border bg-bg/95 px-5 py-4 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="text-xs text-muted hover:text-fg"
            >
              ← Back to features
            </button>
            <div className="mt-2 font-mono text-xs text-muted">
              {selected.requirementKey}
              {selected.featureGroup
                ? ` · ${selected.featureGroup.businessArea ?? ''} / ${selected.featureGroup.name}`
                : ''}
            </div>
            <h2 className="mt-1 text-xl font-semibold leading-snug tracking-tight">
              {selected.title}
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={reviewStatusTone(selected.reviewStatus)}>
                {reviewStatusLabel(selected.reviewStatus)}
              </Badge>
              {selected.businessImpact ? (
                <Badge tone={impactTone(selected.businessImpact)}>
                  {selected.businessImpact} impact
                </Badge>
              ) : null}
              {selected.readinessScore != null ? (
                <Badge tone="accent">{selected.readinessScore}% ready</Badge>
              ) : null}
              <Badge>
                {typeLabel(selected.primaryType ?? selected.type)}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {openQuestions.length > 0 ? (
              <Button size="sm" onClick={() => setTab('questions')}>
                Answer {openQuestions.length} question
                {openQuestions.length === 1 ? '' : 's'}
              </Button>
            ) : null}
            <ActionMenu
              label="Requirement actions"
              items={[
                {
                  label: selected.reviewedAt ? 'Re-analyze' : 'Run analysis',
                  onClick: onReanalyze,
                  disabled: reanalyzePending || analysisRunning,
                },
                { label: 'Edit', onClick: onEdit },
                { label: 'Delete', onClick: onDelete, danger: true },
              ]}
            />
          </div>
        </div>

        {selected.analysisStale ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <span>Stale after edits — re-analyze to refresh review results.</span>
            <Button
              size="sm"
              onClick={onReanalyze}
              disabled={reanalyzePending}
            >
              Re-analyze
            </Button>
          </div>
        ) : null}

        <div
          className="mt-4 flex gap-1 border-b border-transparent"
          role="tablist"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition',
                tab === t.id
                  ? 'bg-accent/15 font-medium text-accent'
                  : 'text-muted hover:bg-bg-elevated hover:text-fg',
              )}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.count != null ? (
                <span className="ml-1.5 rounded-full bg-warning/20 px-1.5 py-0.5 text-[11px] text-warning">
                  {t.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        {hasConflict ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
            This requirement is in an open conflict. Resolve conflicting answers
            before approving.
          </div>
        ) : null}

        {needsDupAction && rel ? (
          <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
            <div className="font-medium">
              {relationshipLabel(rel.relationship)}
            </div>
            <p className="text-muted">
              Related to <span className="text-fg">{rel.targetRequirementId}</span>
              {rel.reason ? ` — ${rel.reason.split('\n')[0]}` : ''}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="secondary"
                disabled={duplicatePending}
                onClick={() =>
                  onDuplicateDecision({
                    requirementKey: selected.requirementKey,
                    decision: 'keep_both',
                  })
                }
              >
                Keep both
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={duplicatePending}
                onClick={() =>
                  onDuplicateDecision({
                    requirementKey: selected.requirementKey,
                    decision: 'merge',
                  })
                }
              >
                Merge as duplicate of
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={duplicatePending}
                onClick={() =>
                  onDuplicateDecision({
                    requirementKey: selected.requirementKey,
                    decision: 'mark_not_duplicate',
                  })
                }
              >
                Not a duplicate
              </Button>
            </div>
          </div>
        ) : null}

        {tab === 'overview' ? (
          <div className="space-y-6">
            {intent ? (
              <div>
                <SectionLabel>Business intent</SectionLabel>
                <p className="mt-2 leading-relaxed text-fg">{intent}</p>
              </div>
            ) : null}

            <div>
              <SectionLabel>Description</SectionLabel>
              <p className="mt-2 leading-relaxed">{selected.description}</p>
            </div>

            <div>
              <SectionLabel>Acceptance criteria</SectionLabel>
              {ac.length ? (
                <ul className="mt-2 space-y-2">
                  {ac.map((item, i) => (
                    <li
                      key={`${i}-${item.slice(0, 24)}`}
                      className="flex gap-2 text-sm leading-relaxed"
                    >
                      <span className="mt-0.5 text-accent" aria-hidden>
                        ✓
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted">
                  Not provided in source
                </p>
              )}
            </div>

            {(selected.businessRules?.length ?? 0) > 0 ? (
              <div>
                <SectionLabel>Business rules</SectionLabel>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {selected.businessRules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {(selected.dependencies?.length ?? 0) > 0 ? (
              <div>
                <SectionLabel>Dependencies</SectionLabel>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {selected.dependencies.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {(selected.relatedRequirements?.length ?? 0) > 0 ? (
              <div>
                <SectionLabel>Related requirements</SectionLabel>
                <ul className="mt-2 space-y-1.5">
                  {selected.relatedRequirements!.slice(0, 8).map((r) => (
                    <li key={`${r.relationType}-${r.requirementKey}`}>
                      <button
                        type="button"
                        className="text-left text-sm hover:underline"
                        onClick={() => onOpenRelated(r.requirementKey)}
                      >
                        <span className="text-muted">{r.relationType}</span>
                        {' · '}
                        <span className="font-mono text-xs">
                          {r.requirementKey}
                        </span>
                        {' — '}
                        {r.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {selected.sourceText || selected.sourceDocumentName ? (
              <details className="rounded-xl border border-border bg-bg-elevated/30 px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Source excerpt
                </summary>
                <div className="mt-3 space-y-1 text-sm text-muted">
                  {selected.sourceDocumentName ? (
                    <div>{selected.sourceDocumentName}</div>
                  ) : null}
                  {selected.sourcePage != null ? (
                    <div>Page {selected.sourcePage}</div>
                  ) : null}
                  {selected.sourceSection ? (
                    <div>Section: {selected.sourceSection}</div>
                  ) : null}
                  {selected.sourceText ? (
                    <p className="mt-2 rounded-lg border border-border bg-bg/60 p-3 text-fg">
                      “{selected.sourceText}”
                    </p>
                  ) : null}
                </div>
              </details>
            ) : null}

            {openQuestions.length > 0 ? (
              <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
                <p className="font-medium">
                  {openQuestions.length} clarifying question
                  {openQuestions.length === 1 ? '' : 's'} still open
                </p>
                <p className="mt-1 text-muted">
                  Answer them before approving requirements for test design.
                </p>
                <Button
                  className="mt-3"
                  size="sm"
                  onClick={() => setTab('questions')}
                >
                  Go to questions
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'questions' ? (
          <div className="space-y-4">
            {!selected.questions?.length ? (
              <p className="text-sm text-muted">
                {selected.reviewedAt
                  ? 'No clarifying questions for this requirement.'
                  : 'Run analysis to generate clarifying questions.'}
              </p>
            ) : (
              <>
                {openQuestions.length === 0 ? (
                  <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                    All questions answered for this requirement.
                  </div>
                ) : null}
                <ul className="space-y-3">
                  {[...openQuestions, ...answeredQuestions].map((q) => (
                    <li
                      key={q.id}
                      className={cn(
                        'rounded-xl border px-4 py-3',
                        q.status === 'OPEN'
                          ? 'border-border bg-bg-elevated/40'
                          : 'border-border/60 bg-bg/30 opacity-90',
                      )}
                    >
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={priorityTone(q.priority)}>
                          {q.priority}
                        </Badge>
                        {q.blocking ? (
                          <Badge tone="danger">Blocking</Badge>
                        ) : null}
                        <Badge
                          tone={
                            q.status === 'ANSWERED' ? 'success' : undefined
                          }
                        >
                          {q.status === 'ANSWERED' ? 'Answered' : 'Open'}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm font-medium leading-relaxed">
                        {q.question}
                      </p>
                      {q.reason ? (
                        <p className="mt-1 text-xs text-muted">{q.reason}</p>
                      ) : null}
                      {q.status === 'ANSWERED' && q.answer ? (
                        <p className="mt-3 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm">
                          {q.answer}
                        </p>
                      ) : null}
                      {q.status === 'OPEN' ? (
                        <div className="mt-3 space-y-2">
                          <textarea
                            className="min-h-[80px] w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none ring-accent/40 focus:ring-2"
                            placeholder="Type your answer…"
                            value={answerDrafts[q.id] ?? ''}
                            onChange={(e) =>
                              onAnswerDraft(q.id, e.target.value)
                            }
                          />
                          <Button
                            size="sm"
                            disabled={
                              answerPending ||
                              !(answerDrafts[q.id] ?? '').trim()
                            }
                            onClick={() =>
                              onSubmitAnswer(
                                q.id,
                                (answerDrafts[q.id] ?? '').trim(),
                              )
                            }
                          >
                            Submit answer
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {answerError ? (
              <p className="text-sm text-danger">{answerError}</p>
            ) : null}
          </div>
        ) : null}

        {tab === 'analysis' ? (
          <div className="space-y-6">
            {selected.semantic ? (
              <div>
                <SectionLabel>Who / what / outcome</SectionLabel>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  {[
                    ['Actor', selected.semantic.actor],
                    ['Action', selected.semantic.action],
                    ['Object', selected.semantic.entity],
                    ['Capability', selected.semantic.businessCapability],
                    ['Outcome', selected.semantic.businessOutcome],
                    selected.semantic.crudOp
                      ? ['CRUD', selected.semantic.crudOp]
                      : null,
                  ]
                    .filter(Boolean)
                    .map((pair) => {
                      const [k, v] = pair as [string, string];
                      return (
                        <div
                          key={k}
                          className="rounded-lg border border-border/70 bg-bg/40 px-3 py-2"
                        >
                          <dt className="text-[11px] uppercase tracking-wide text-muted">
                            {k}
                          </dt>
                          <dd className="mt-0.5 text-sm">{v}</dd>
                        </div>
                      );
                    })}
                </dl>
              </div>
            ) : (
              <p className="text-sm text-muted">
                Run analysis to populate semantic intelligence.
              </p>
            )}

            {selected.businessReview ? (
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Business analysis</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <CompactFacts
                    title="Actors"
                    facts={selected.businessReview.actors}
                  />
                  <CompactFacts
                    title="Rules"
                    facts={selected.businessReview.rules}
                  />
                  <CompactFacts
                    title="Preconditions"
                    facts={selected.businessReview.preconditions}
                  />
                  <CompactFacts
                    title="Flow"
                    facts={selected.businessReview.flow}
                  />
                  <CompactFacts
                    title="States"
                    facts={selected.businessReview.states}
                  />
                  <CompactFacts
                    title="Transitions"
                    facts={selected.businessReview.transitions}
                  />
                  <CompactFacts
                    title="Exceptions"
                    facts={selected.businessReview.exceptions}
                  />
                  <CompactFacts
                    title="Outcomes"
                    facts={selected.businessReview.outcomes}
                  />
                  <CompactFacts
                    title="Permissions"
                    facts={selected.businessReview.permissions}
                  />
                  <CompactFacts
                    title="Dependencies"
                    facts={selected.businessReview.dependencies}
                  />
                </div>
              </div>
            ) : null}

            {selected.functionalReview ? (
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Functional analysis</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <CompactFacts
                    title="Inputs"
                    facts={selected.functionalReview.inputs}
                  />
                  <CompactFacts
                    title="Outputs"
                    facts={selected.functionalReview.outputs}
                  />
                  <CompactFacts
                    title="Validations"
                    facts={selected.functionalReview.validations}
                  />
                  <CompactFacts
                    title="Success"
                    facts={selected.functionalReview.successBehavior}
                  />
                  <CompactFacts
                    title="Failure"
                    facts={selected.functionalReview.failureBehavior}
                  />
                  <CompactFacts
                    title="Errors"
                    facts={selected.functionalReview.errorHandling}
                  />
                  <CompactFacts
                    title="Navigation"
                    facts={selected.functionalReview.navigation}
                  />
                  <CompactFacts
                    title="Data"
                    facts={selected.functionalReview.dataHandling}
                  />
                </div>
              </div>
            ) : null}

            {(selected.supportingInformation?.length ?? 0) > 0 ? (
              <div>
                <SectionLabel>Supporting information</SectionLabel>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  {selected.supportingInformation!.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {rel?.semanticAnalysis ? (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">
                  Duplicate match details
                </summary>
                <p className="mt-2">
                  Engine {analysisEngine ?? 'semantic'} v
                  {analysisVersion ?? '—'}
                </p>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
