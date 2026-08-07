import { Suspense } from 'react';
import ProjectWorkspacePage from './workspace-client';

export default function ProjectPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-muted">Loading workspace…</p>}
    >
      <ProjectWorkspacePage />
    </Suspense>
  );
}
