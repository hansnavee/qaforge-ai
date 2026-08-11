'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { ApiError, api } from '@/lib/api';
import { clearOrgCache } from '@/lib/org';
import { SHOW_AI_STLC_UI } from '@/lib/product-flags';
import { useOrgCaps } from '@/lib/use-org';

export default function NewProjectPage() {
  const router = useRouter();
  const { caps, isLoading: orgLoading } = useOrgCaps();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const canSubmit = name.trim().length >= 2 && !saving;

  async function create() {
    setSaving(true);
    setError(null);

    try {
      if (name.trim().length < 2) {
        throw new Error('Project name must be at least 2 characters');
      }

      const project = await api<{ id: string }>('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });

      clearOrgCache();
      router.push(
        SHOW_AI_STLC_UI
          ? `/app/projects/${project.id}?tab=requirements&view=source`
          : `/app/projects/${project.id}?tab=cases`,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clearOrgCache();
        setError('Session expired or not signed in. Please log in again.');
        router.push('/login');
        return;
      }
      setError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not create project',
      );
    } finally {
      setSaving(false);
    }
  }

  if (!orgLoading && !caps.canDesign) {
    return (
      <div className="mx-auto max-w-lg space-y-3">
        <h1 className="text-xl font-semibold">Not allowed</h1>
        <p className="text-sm text-muted">
          Testers and viewers cannot create projects. Ask a Lead or
          Administrator.
        </p>
        <Button variant="secondary" onClick={() => router.push('/app/projects')}>
          Back to projects
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="text-xs text-muted">
          <a href="/app/projects" className="hover:text-fg">
            Projects
          </a>
          <span className="mx-1">/</span>
          <span>Create</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Create Project
        </h1>
        <p className="mt-1 text-sm text-muted">
          {SHOW_AI_STLC_UI
            ? 'Enter project details, then continue into requirements.'
            : 'Name the project, then add folders and cases by hand.'}
        </p>
      </div>

      <Card className="space-y-5">
        <Input
          label="Project Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Login regression"
          hint="Required · at least 2 characters"
        />

        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Description
          </label>
          <textarea
            className="min-h-20 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional notes for this suite."
          />
        </div>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => router.push('/app/projects')}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={!canSubmit}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
