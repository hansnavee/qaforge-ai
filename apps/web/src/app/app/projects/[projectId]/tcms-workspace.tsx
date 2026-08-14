'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import { api, ApiError } from '@/lib/api';
import { useOrgCaps } from '@/lib/use-org';
import { DesignCasesPanel } from './design-cases-panel';
import { TcmsProjectChrome, type TcmsTabId } from './tcms-chrome';
import { TcmsAutomationPanel } from './tcms-automation-panel';
import { TcmsAutomationResultsPanel } from './tcms-automation-results-panel';
import { TcmsReportsPanel } from './tcms-reports-panel';
import { TcmsResultsPanel } from './tcms-results-panel';
import { TcmsRunsPanel } from './tcms-runs-panel';

function parseTab(raw: string | null): TcmsTabId {
  if (
    raw === 'cases' ||
    raw === 'runs' ||
    raw === 'results' ||
    raw === 'reports' ||
    raw === 'automation' ||
    raw === 'automation-results'
  ) {
    return raw;
  }
  return 'cases';
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
