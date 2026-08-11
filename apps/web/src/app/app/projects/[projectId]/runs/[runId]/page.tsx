'use client';

import { useParams } from 'next/navigation';
import { TcmsRunCockpit } from '../../tcms-run-cockpit';

export default function TcmsRunPage() {
  const params = useParams<{ projectId: string; runId: string }>();
  return (
    <TcmsRunCockpit projectId={params.projectId} runId={params.runId} />
  );
}
