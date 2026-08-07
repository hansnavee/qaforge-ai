'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { Progress } from '@/components/Progress';
import { api, ApiError } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';

const STEPS = ['Details', 'Requirements', 'Framework', 'Review'] as const;

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    appUrl: '',
    loginUrl: '',
    requirementText: '',
    framework: 'PLAYWRIGHT',
    language: 'TYPESCRIPT',
    environment: 'QA',
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const orgId = await getDefaultOrgId();
      const payload = {
        ...form,
        loginUrl: form.loginUrl.trim() || undefined,
        requirementText: form.requirementText.trim() || undefined,
      };
      const project = await api<{ id: string }>(
        `/api/v1/orgs/${orgId}/projects`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );
      router.push(`/app/projects/${project.id}`);
    } catch (e) {
      const detail =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : null;
      setError(
        detail
          ? `Could not create project: ${detail}`
          : 'Could not create project. The API may be offline — your draft is kept locally.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
        <p className="mt-1 text-sm text-muted">
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </p>
        <Progress className="mt-3" value={((step + 1) / STEPS.length) * 100} />
      </div>

      <Card className="space-y-4">
        {step === 0 ? (
          <>
            <Input
              label="Project name"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              required
            />
            <Input
              label="Application URL"
              type="url"
              value={form.appUrl}
              onChange={(e) => update('appUrl', e.target.value)}
              placeholder="https://app.example.com"
              required
            />
            <Input
              label="Login URL (optional)"
              type="url"
              value={form.loginUrl}
              onChange={(e) => update('loginUrl', e.target.value)}
              hint="Credentials are never collected by QAForge."
            />
          </>
        ) : null}

        {step === 1 ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Requirements</span>
            <textarea
              className="min-h-40 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-fg outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
              value={form.requirementText}
              onChange={(e) => update('requirementText', e.target.value)}
              placeholder="Paste PRD / acceptance criteria…"
            />
          </label>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ['framework', ['PLAYWRIGHT', 'CYPRESS', 'SELENIUM_JAVA']],
                ['language', ['TYPESCRIPT', 'JAVA', 'CSHARP']],
                ['environment', ['DEV', 'QA', 'UAT', 'PRODUCTION']],
              ] as const
            ).map(([key, options]) => (
              <label key={key} className="flex flex-col gap-1.5 text-sm">
                <span className="capitalize text-muted">{key}</span>
                <select
                  className="h-10 rounded-lg border border-border bg-bg-elevated px-3 text-fg"
                  value={form[key]}
                  onChange={(e) => update(key, e.target.value)}
                >
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : null}

        {step === 3 ? (
          <dl className="space-y-3 text-sm">
            {(
              [
                ['Name', form.name],
                ['App URL', form.appUrl],
                ['Login URL', form.loginUrl || '—'],
                ['Framework', form.framework],
                ['Language', form.language],
                ['Environment', form.environment],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-border/60 pb-2">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-medium">{v || '—'}</dd>
              </div>
            ))}
            <div>
              <dt className="text-muted">Requirements preview</dt>
              <dd className="mt-1 whitespace-pre-wrap text-muted">
                {form.requirementText.slice(0, 280) || 'None provided'}
                {form.requirementText.length > 280 ? '…' : ''}
              </dd>
            </div>
          </dl>
        ) : null}

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div className="flex justify-between pt-2">
          <Button
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              disabled={step === 0 && (!form.name || !form.appUrl)}
            >
              Continue
            </Button>
          ) : (
            <Button onClick={() => void create()} disabled={saving}>
              {saving ? 'Creating…' : 'Create project'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
