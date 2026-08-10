'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { ScoreRing } from '@/components/ScoreRing';
import { Button } from '@/components/Button';
import { api, ApiError, downloadAuthenticated } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';

type ReportPayload = {
  html?: string;
  htmlUrl?: string;
  scores?: Record<string, number>;
  summary?: { passed?: number; failed?: number; total?: number };
  projectName?: string;
  executionId?: string;
};

export default function ReportDetailPage() {
  const { executionId } = useParams<{ executionId: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['report', executionId],
    queryFn: async () => {
      try {
        const orgId = await getDefaultOrgId();
        return await api<ReportPayload>(
          `/api/v1/orgs/${orgId}/reports/${executionId}`,
        );
      } catch (e) {
        if (e instanceof ApiError) return null;
        throw e;
      }
    },
  });

  const htmlSrc = data?.html
    ? `data:text/html;charset=utf-8,${encodeURIComponent(data.html)}`
    : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {data?.projectName ?? 'Report'}
          </h1>
          <p className="mt-1 font-mono text-xs text-muted">{executionId}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void (async () => {
              const orgId = await getDefaultOrgId();
              await downloadAuthenticated(
                `/api/v1/orgs/${orgId}/executions/${executionId}/download-zip`,
                `report-${executionId}.zip`,
              );
            })();
          }}
        >
          Download ZIP
        </Button>
      </div>

      {data?.scores ? (
        <Card>
          <div className="flex flex-wrap gap-6">
            <ScoreRing label="Functional" value={data.scores.functional} />
            <ScoreRing
              label="Accessibility"
              value={data.scores.accessibility}
            />
            <ScoreRing label="Performance" value={data.scores.performance} />
            <ScoreRing label="Security" value={data.scores.security} />
            <ScoreRing label="UI/UX" value={data.scores.uiux} />
          </div>
          {data.summary ? (
            <p className="mt-4 text-sm text-muted">
              {data.summary.passed ?? 0} passed · {data.summary.failed ?? 0}{' '}
              failed · {data.summary.total ?? 0} total
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <p className="p-5 text-sm text-muted">Loading report…</p>
        ) : htmlSrc ? (
          <iframe
            title="QAForge HTML report"
            src={htmlSrc}
            className="h-[70vh] w-full bg-white"
          />
        ) : (
          <p className="p-5 text-sm text-muted">
            No HTML report artifact for this execution yet.
          </p>
        )}
      </Card>
    </div>
  );
}
