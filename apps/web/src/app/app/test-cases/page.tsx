'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { api, ApiError } from '@/lib/api';

type TestCase = {
  id: string;
  module?: string;
  scenario?: string;
  priority?: string;
  type?: string;
  automationCandidate?: boolean;
};

export default function TestCasesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['test-cases'],
    queryFn: async () => {
      try {
        return await api<
          TestCase[] | { items: TestCase[]; testCases?: TestCase[] }
        >('/api/v1/test-cases');
      } catch (e) {
        if (e instanceof ApiError) return [] as TestCase[];
        throw e;
      }
    },
  });

  const items = Array.isArray(data)
    ? data
    : data && 'testCases' in data && Array.isArray(data.testCases)
      ? data.testCases
      : data && 'items' in data
        ? data.items
        : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Test Cases</h1>
        <p className="mt-1 text-sm text-muted">
          Generated cases from the latest executions.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <Card className="border-dashed">
          <h2 className="font-medium">No test cases yet</h2>
          <p className="mt-1 text-sm text-muted">
            Run an execution to generate professional test cases.
          </p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-elevated text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Module</th>
                <th className="px-4 py-3 font-medium">Scenario</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Auto</th>
              </tr>
            </thead>
            <tbody>
              {items.map((tc) => (
                <tr key={tc.id} className="border-t border-border">
                  <td className="px-4 py-3 font-mono text-xs">{tc.id}</td>
                  <td className="px-4 py-3">{tc.module ?? '—'}</td>
                  <td className="px-4 py-3">{tc.scenario ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge>{tc.priority ?? '—'}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {tc.automationCandidate ? (
                      <Badge tone="accent">yes</Badge>
                    ) : (
                      <Badge>no</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
