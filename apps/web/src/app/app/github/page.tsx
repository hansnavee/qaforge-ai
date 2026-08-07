'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { api, ApiError, API_URL } from '@/lib/api';

type GithubState = {
  connected?: boolean;
  login?: string;
  repos?: Array<{ fullName: string; private?: boolean }>;
};

export default function GithubPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['github'],
    queryFn: async () => {
      try {
        return await api<GithubState>('/api/v1/github');
      } catch (e) {
        if (e instanceof ApiError) return { connected: false } as GithubState;
        throw e;
      }
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">GitHub</h1>
        <p className="mt-1 text-sm text-muted">
          Push generated frameworks and open PRs.
        </p>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">
              {data?.connected
                ? `Connected as ${data.login ?? 'user'}`
                : 'Not connected'}
            </div>
            <p className="mt-1 text-sm text-muted">
              OAuth connects your organization to push automation branches.
            </p>
          </div>
          <a href={`${API_URL}/api/v1/github/connect`}>
            <Button>{data?.connected ? 'Reconnect' : 'Connect GitHub'}</Button>
          </a>
        </div>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted">Loading repositories…</p>
      ) : null}

      {!isLoading && (!data?.repos || data.repos.length === 0) ? (
        <Card className="border-dashed">
          <h2 className="font-medium">No repositories listed</h2>
          <p className="mt-1 text-sm text-muted">
            Connect GitHub to see repos available for push.
          </p>
        </Card>
      ) : (
        <div className="grid gap-2">
          {(data?.repos ?? []).map((repo) => (
            <Card key={repo.fullName} className="py-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm">{repo.fullName}</span>
                {repo.private ? <Badge>private</Badge> : <Badge tone="accent">public</Badge>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
