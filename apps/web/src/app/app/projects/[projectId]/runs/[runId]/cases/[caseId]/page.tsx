'use client';

import { useParams } from 'next/navigation';
import { TcmsExecuteView } from '../../../../tcms-execute-view';

export default function TcmsExecutePage() {
  const params = useParams<{
    projectId: string;
    runId: string;
    caseId: string;
  }>();
  return (
    <TcmsExecuteView
      projectId={params.projectId}
      runId={params.runId}
      caseId={params.caseId}
    />
  );
}
