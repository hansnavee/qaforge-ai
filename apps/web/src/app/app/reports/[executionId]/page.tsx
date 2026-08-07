'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { ScoreRing } from '@/components/ScoreRing';
import { Button } from '@/components/Button';
import { api, ApiError, API_URL } from '@/lib/api';

type ReportPayload = {
  html?: string;
  htmlUrl?: string;
  scores?: Record<string, number>;
  summary?: { passed?: number; failed?: number; total?: number };
  projectName?: string;
};

export default function ReportDetailPage() {
  const { executionId } = useParams<{ executionId: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['report', executionId],
    queryFn: async () => {
      try {
        return await api<ReportPayload>(`/api/v1/reports/${executionId}`);
      } catch (e) {
        if (e instanceof ApiError) return null;
        throw e;
      }
    },
  });

  const htmlSrc =
    data?.htmlUrl ??
    (data?.html
      ? `data:text/html;charset=utf-8,${encodeURIComponent(data.html)}`
      : `${API_URL}/api/v1/executions/${executionId}/report.html`);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {data?.projectName ?? 'Report'}
          </h1>
          <p className="mt-1 font-mono text-xs text-muted">{executionId}</p>
        </div>
        <a
          href={`${API_URL}/api/v1/executions/${executionId}/download-zip`}
        >
          <Button variant="secondary">Download ZIP</Button>
        </a>
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
        ) : (
          <iframe
            title="QAForge HTML report"
            src={htmlSrc}
            className="h-[70vh] w-full bg-white"
          />
        )}
      </Card>
    </div>
  );
}
