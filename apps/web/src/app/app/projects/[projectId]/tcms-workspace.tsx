'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { api, ApiError } from '@/lib/api';
import { useOrgCaps } from '@/lib/use-org';
import { DesignCasesPanel } from './design-cases-panel';
import { TcmsProjectChrome, type TcmsTabId } from './tcms-chrome';
import { TcmsAutomationPanel } from './tcms-automation-panel';
import { TcmsAutomationResultsPanel } from './tcms-automation-results-panel';
import { TcmsReportsPanel } from './tcms-reports-panel';
import { TcmsResultsPanel } from './tcms-results-panel';
import { TcmsRunsPanel } from './tcms-runs-panel';

function TcmsProjectDashboard({ projectId }: { projectId: string }) {
  return (
    <div className="space-y-4 pt-2">
      <p className="text-sm text-muted">
        Analysis for this project. Live graphs and AI suggestions come in later
        steps.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <h2 className="text-sm font-medium">Progress</h2>
          <p className="mt-1 text-sm text-muted">
            Cases designed vs executed vs remaining will show here.
          </p>
        </Card>
        <Card>
          <h2 className="text-sm font-medium">Results</h2>
          <p className="mt-1 text-sm text-muted">
            Latest run and BrowserStack outcomes will show here.
          </p>
        </Card>
        <Card>
          <h2 className="text-sm font-medium">Graphs</h2>
          <p className="mt-1 text-sm text-muted">
            Pass/fail over time, coverage, and defect trend will show here.
          </p>
        </Card>
        <Card>
          <h2 className="text-sm font-medium">AI suggestions</h2>
          <p className="mt-1 text-sm text-muted">
            Coverage gaps, what to run next, and ship risk will show here.
          </p>
        </Card>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/app/projects/${projectId}?tab=cases`}>
          <Button size="sm" variant="secondary">
            Cases
          </Button>
        </Link>
        <Link href={`/app/projects/${projectId}?tab=runs`}>
          <Button size="sm" variant="secondary">
            Runs
          </Button>
        </Link>
      </div>
    </div>
  );
}

function parseTab(raw: string | null): TcmsTabId {
  if (
    raw === 'dashboard' ||
    raw === 'cases' ||
    raw === 'runs' ||
    raw === 'results' ||
    raw === 'reports' ||
    raw === 'automation' ||
    raw === 'automation-results'
  ) {
    return raw;
  }
  return 'dashboard';
}

export function TcmsWorkspace() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get('tab'));
  const { caps } = useOrgCaps();

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      try {
        return await api<{
          id: string;
          name: string;
          description?: string | null;
        }>(`/api/v1/projects/${projectId}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) return null;
        throw e;
      }
    },
    enabled: Boolean(projectId),
  });

  if (projectQuery.isLoading) {
    return <p className="text-sm text-muted">Loading project…</p>;
  }

  const project = projectQuery.data;
  if (projectQuery.error || !project) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-danger">
          {projectQuery.error instanceof ApiError
            ? projectQuery.error.message
            : 'Project not found.'}
        </p>
        <Link href="/app/projects">
          <Button variant="secondary" size="sm">
            Back to projects
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <TcmsProjectChrome
      projectId={projectId}
      projectName={project.name}
      description={project.description}
      active={tab}
    >
      {tab === 'dashboard' ? (
        <TcmsProjectDashboard projectId={projectId} />
      ) : null}
      {tab === 'cases' ? (
        <DesignCasesPanel projectId={projectId} canEdit={caps.canDesign} />
      ) : null}
      {tab === 'runs' ? (
        <TcmsRunsPanel projectId={projectId} canEdit={caps.canManageRuns} />
      ) : null}
      {tab === 'results' ? (
        <TcmsResultsPanel projectId={projectId} />
      ) : null}
      {tab === 'reports' ? <TcmsReportsPanel projectId={projectId} /> : null}
      {tab === 'automation' ? (
        <TcmsAutomationPanel
          projectId={projectId}
          canEdit={caps.canExecute}
        />
      ) : null}
      {tab === 'automation-results' ? (
        <TcmsAutomationResultsPanel projectId={projectId} />
      ) : null}
    </TcmsProjectChrome>
  );
}
