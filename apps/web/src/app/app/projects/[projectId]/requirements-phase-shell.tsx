'use client';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { cn } from '@/lib/cn';

export type RequirementsPhaseStep =
  | 'source'
  | 'extract'
  | 'review'
  | 'approve';

const STEPS: Array<{ id: RequirementsPhaseStep; label: string; hint: string }> =
  [
    {
      id: 'source',
      label: '1. Source',
      hint: 'Provide the real application requirements',
    },
    {
      id: 'extract',
      label: '2. Extract',
      hint: 'Pull testable requirements from the source only',
    },
    {
      id: 'review',
      label: '3. Review',
      hint: 'Answer gaps — we do not invent missing rules',
    },
    {
      id: 'approve',
      label: '4. Approve',
      hint: 'Confirm exit criteria, then unlock Planning',
    },
  ];

const DOS = [
  'Upload or paste the real BRD / SRS / tickets for this application',
  'Keep examples, credentials placeholders, and acceptance criteria as the author wrote them',
  'Answer clarifying questions when something is ambiguous',
  'Approve only when blocking questions and conflicts are cleared',
];

const DONTS = [
  'Do not ask the AI to invent product behavior that is not in your source',
  'Do not treat inferred analysis as confirmed business rules',
  'Do not edit requirement text silently during analysis — confirm changes first',
  'Do not Approve with open CRITICAL/HIGH blocking questions or conflicts',
];

export function RequirementsPhaseShell({
  step,
  onStepChange,
  analysisLabel,
  extractedCount,
  approved,
  canApprove,
  checklist,
  blockers,
  onApprove,
  approvePending,
  onContinuePlanning,
  children,
}: {
  step: RequirementsPhaseStep;
  onStepChange: (step: RequirementsPhaseStep) => void;
  analysisLabel: string;
  extractedCount: number;
  approved: boolean;
  canApprove: boolean;
  checklist?: Array<{ id: string; label: string; done: boolean }>;
  blockers?: string[];
  onApprove?: () => void;
  approvePending?: boolean;
  onContinuePlanning?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <Card className="space-y-4 border-accent/25 bg-accent/5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-accent">
              STLC Phase 1 · Requirement Analysis
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">
              Analyze only what the application requires
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              We extract and question from your source. We do not rewrite your
              requirements, examples, or data without your confirmation.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge>{extractedCount} extracted</Badge>
            <Badge tone="accent">Analysis: {analysisLabel}</Badge>
            {approved ? <Badge tone="success">Approved</Badge> : null}
          </div>
        </div>

        <nav className="flex flex-wrap gap-1" aria-label="Requirements substeps">
          {STEPS.map((s) => {
            const active = step === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onStepChange(s.id)}
                className={cn(
                  'rounded-lg px-3 py-2 text-left text-sm transition',
                  active
                    ? 'bg-accent/15 font-medium text-accent'
                    : 'text-muted hover:bg-bg-elevated hover:text-fg',
                )}
                title={s.hint}
              >
                {s.label}
              </button>
            );
          })}
        </nav>
      </Card>

      {step === 'source' ? (
        <Card className="space-y-4">
          <div>
            <h3 className="text-sm font-medium">Before you add a source</h3>
            <p className="mt-1 text-sm text-muted">
              Better source quality → concise, application-specific analysis —
              not broad generic results.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-success/30 bg-success/5 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-success">
                Do
              </div>
              <ul className="mt-2 space-y-1.5 text-sm">
                {DOS.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-success">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-danger">
                Don&apos;t
              </div>
              <ul className="mt-2 space-y-1.5 text-sm">
                {DONTS.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-danger">×</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      ) : null}

      {step === 'approve' ? (
        <Card className="space-y-4">
          <div>
            <h3 className="text-sm font-medium">Exit criteria</h3>
            <p className="mt-1 text-sm text-muted">
              Same checklist a QA lead uses before releasing requirements to
              Planning.
            </p>
          </div>
          {checklist?.length ? (
            <ul className="space-y-2">
              {checklist.map((c) => (
                <li
                  key={c.id}
                  className="flex items-start gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm"
                >
                  <span
                    className={cn(
                      'mt-0.5',
                      c.done ? 'text-success' : 'text-warning',
                    )}
                  >
                    {c.done ? '✓' : '○'}
                  </span>
                  <span className={c.done ? 'text-fg' : 'text-muted'}>
                    {c.label}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              Run analysis first to build the exit checklist.
            </p>
          )}
          {blockers && blockers.length > 0 ? (
            <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <div className="font-medium text-warning">Blocked</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!approved ? (
              <Button
                size="sm"
                disabled={!canApprove || approvePending}
                onClick={onApprove}
              >
                Approve requirements
              </Button>
            ) : (
              <Button size="sm" onClick={onContinuePlanning}>
                Continue to Planning →
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onStepChange('review')}
            >
              Back to review
            </Button>
          </div>
        </Card>
      ) : null}

      {children}
    </div>
  );
}

/** Map legacy view query to phase substep */
export function viewToRequirementsStep(
  view: string,
): RequirementsPhaseStep {
  if (view === 'source') return 'source';
  if (view === 'summary') return 'extract';
  if (view === 'review-dashboard' || view === 'approve') return 'approve';
  if (
    view === 'features' ||
    view === 'list' ||
    view === 'detail' ||
    view === 'debug'
  ) {
    return 'review';
  }
  return extractedDefaultStep(view);
}

function extractedDefaultStep(_view: string): RequirementsPhaseStep {
  return 'source';
}

export function requirementsStepToView(
  step: RequirementsPhaseStep,
  opts: { hasExtracted: boolean; hasReview: boolean },
): string {
  if (step === 'source') return 'source';
  if (step === 'extract') return opts.hasExtracted ? 'summary' : 'source';
  if (step === 'approve') return 'approve';
  if (opts.hasReview) return 'features';
  if (opts.hasExtracted) return 'list';
  return 'source';
}
