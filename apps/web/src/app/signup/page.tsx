'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { ApiError, api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { setSelectedOrgId } from '@/lib/org';

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const orgName = organizationName.trim();
    if (orgName.length < 2) {
      setError('Organization name must be at least 2 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error: err } = await authClient.signUp.email({
        name,
        email,
        password,
      });
      if (err) {
        setError(err.message ?? 'Signup failed');
        return;
      }
      try {
        const org = await api<{ id: string }>('/api/v1/orgs', {
          method: 'POST',
          body: JSON.stringify({ name: orgName }),
        });
        if (org?.id) setSelectedOrgId(org.id);
      } catch (createErr) {
        setError(
          createErr instanceof ApiError
            ? `Account created, but organization failed: ${createErr.message}`
            : 'Account created. Create your organization on the next screen.',
        );
        router.push('/app/orgs');
        return;
      }
      router.push('/app/orgs');
    } catch {
      setError('Unable to reach auth service. Try again when the API is up.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-soft">
        <div className="mb-6">
          <div className="text-sm font-semibold">QAForge</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Create your account
          </h1>
          <p className="mt-1 text-sm text-muted">
            Create an account and your organization to manage test cases and
            runs.
          </p>
        </div>
        <form className="space-y-4" onSubmit={onSubmit}>
          <Input
            label="Name"
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label="Password"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Input
            label="Organization name"
            name="organizationName"
            required
            minLength={2}
            placeholder="Acme QA"
            hint="Required. Individuals can use their own name."
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
          />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating…' : 'Create account'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          Already have an account?{' '}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
