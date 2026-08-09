'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { API_URL, ApiError, api } from '@/lib/api';
import { clearOrgCache } from '@/lib/org';

export default function NewProjectPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [appUrl, setAppUrl] = useState('');
  const [requirementText, setRequirementText] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const hasPaste = requirementText.trim().length > 0;
  const hasFile = Boolean(file);
  const canSubmit =
    name.trim().length >= 2 && (hasPaste || hasFile) && !saving;

  async function create() {
    setSaving(true);
    setError(null);

    try {
      if (name.trim().length < 2) {
        throw new Error('Project name must be at least 2 characters');
      }
      if (!hasPaste && !hasFile) {
        throw new Error('Upload a requirement file or paste requirements');
      }
      if (appUrl.trim()) {
        try {
          void new URL(appUrl.trim());
        } catch {
          throw new Error('Application URL must be a valid URL');
        }
      }

      let projectId: string;

      if (file) {
        const form = new FormData();
        form.append('name', name.trim());
        if (description.trim()) form.append('description', description.trim());
        if (appUrl.trim()) form.append('appUrl', appUrl.trim());
        form.append('file', file);
        const res = await fetch(
          `${API_URL.replace(/\/$/, '')}/api/v1/projects`,
          {
            method: 'POST',
            credentials: 'include',
            body: form,
          },
        );
        const text = await res.text();
        let data: unknown = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        }
        if (!res.ok) {
          throw new ApiError(
            typeof data === 'object' &&
              data &&
              'message' in data &&
              typeof (data as { message: unknown }).message === 'string'
              ? (data as { message: string }).message
              : 'Could not create project',
            res.status,
            data,
          );
        }
        projectId = (data as { id: string }).id;
      } else {
        const project = await api<{ id: string }>('/api/v1/projects', {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || undefined,
            appUrl: appUrl.trim() || undefined,
            requirementText: requirementText.trim(),
          }),
        });
        projectId = project.id;
      }

      clearOrgCache();
      // Natural next step: Requirements screen (not project list)
      router.push(
        `/app/projects/${projectId}?tab=requirements&view=source`,
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
          Enter project details and requirements. You will open the Requirements
          screen next.
        </p>
      </div>

      <Card className="space-y-5">
        <Input
          label="Project Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="E-Commerce Application"
          hint="Required · at least 2 characters"
        />

        <div>
          <label className="mb-1.5 block text-sm font-medium">Description</label>
          <textarea
            className="min-h-20 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Online shopping application."
          />
        </div>

        <Input
          label="Application URL (Optional)"
          type="url"
          value={appUrl}
          onChange={(e) => setAppUrl(e.target.value)}
          placeholder="https://example.com"
        />

        <div className="space-y-3">
          <div className="text-sm font-medium text-fg">Requirements</div>
          <div className="rounded-xl border border-dashed border-border bg-bg-elevated/40 px-4 py-5">
            <label className="flex cursor-pointer flex-col items-center gap-2 text-center">
              <span className="text-sm font-medium">Upload Requirement File</span>
              <span className="text-xs text-muted">PDF · DOCX · TXT</span>
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="mt-2 text-sm"
                onChange={(e) => {
                  const next = e.target.files?.[0] ?? null;
                  setFile(next);
                  if (next) setRequirementText('');
                }}
              />
              {file ? (
                <span className="text-xs text-accent">
                  Selected: {file.name} ({Math.round(file.size / 1024)} KB)
                </span>
              ) : null}
            </label>

            <div className="my-4 flex items-center gap-3 text-xs text-muted">
              <div className="h-px flex-1 bg-border" />
              OR
              <div className="h-px flex-1 bg-border" />
            </div>

            <textarea
              className="min-h-36 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
              value={requirementText}
              onChange={(e) => {
                setRequirementText(e.target.value);
                if (e.target.value.trim()) setFile(null);
              }}
              placeholder="Paste requirements…"
              disabled={Boolean(file)}
            />
          </div>
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
