'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { Button } from '@/components/Button';

export type TestCaseRow = {
  id: string;
  externalId: string;
  module: string | null;
  scenario: string;
  preconditions: string | null;
  steps: unknown;
  expected: string;
  priority: string | null;
  severity: string | null;
  type: string | null;
};

function stepsToText(steps: unknown): string {
  if (Array.isArray(steps)) return steps.map(String).join('\n');
  if (typeof steps === 'string') return steps;
  return '';
}

function textToSteps(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function DesignCasesPanel({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    externalId: '',
    module: '',
    scenario: '',
    preconditions: '',
    steps: '',
    expected: '',
    priority: 'P1',
    type: 'functional',
  });
  const [adding, setAdding] = useState(false);

  const casesQuery = useQuery({
    queryKey: ['test-cases', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<TestCaseRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases`,
      );
    },
    refetchInterval: 5000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      const body = {
        externalId: draft.externalId.trim() || undefined,
        module: draft.module.trim() || 'General',
        scenario: draft.scenario.trim(),
        preconditions: draft.preconditions,
        steps: textToSteps(draft.steps),
        expected: draft.expected.trim(),
        priority: draft.priority || 'P1',
        type: draft.type || 'functional',
      };
      if (adding) {
        return api(`/api/v1/orgs/${orgId}/projects/${projectId}/test-cases`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      if (!editingId) throw new Error('No case selected');
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/${editingId}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
    },
    onSuccess: async () => {
      setEditingId(null);
      setAdding(false);
      await qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
      await qc.invalidateQueries({ queryKey: ['stlc-phase', projectId] });
      await qc.invalidateQueries({ queryKey: ['stlc-phases', projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/${id}`,
        { method: 'DELETE' },
      );
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
      await qc.invalidateQueries({ queryKey: ['stlc-phase', projectId] });
      await qc.invalidateQueries({ queryKey: ['stlc-phases', projectId] });
    },
  });

  function startEdit(row: TestCaseRow) {
    setAdding(false);
    setEditingId(row.id);
    setDraft({
      externalId: row.externalId,
      module: row.module ?? '',
      scenario: row.scenario,
      preconditions: row.preconditions ?? '',
      steps: stepsToText(row.steps),
      expected: row.expected,
      priority: row.priority ?? 'P1',
      type: row.type ?? 'functional',
    });
  }

  function startAdd() {
    setEditingId(null);
    setAdding(true);
    setDraft({
      externalId: '',
      module: 'General',
      scenario: '',
      preconditions: '',
      steps: '1. ',
      expected: '',
      priority: 'P1',
      type: 'functional',
    });
  }

  const cases = casesQuery.data ?? [];
  const showForm = adding || Boolean(editingId);

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-fg">Documented test cases</p>
          <p className="text-xs text-muted">
            {cases.length} case(s)
            {canEdit
              ? ' — edit or delete anytime, including after Accept'
              : ''}
          </p>
        </div>
        {canEdit ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={startAdd}
            disabled={showForm}
          >
            Add case
          </Button>
        ) : null}
      </div>

      {casesQuery.isLoading ? (
        <p className="text-sm text-muted">Loading cases…</p>
      ) : cases.length === 0 && !adding ? (
        <p className="rounded-lg border border-border bg-panel/40 p-4 text-sm text-muted">
          No test cases yet. AI is designing them, or add one manually.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-panel/60 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Module</th>
                <th className="px-3 py-2 font-medium">Scenario</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Type</th>
                {canEdit ? (
                  <th className="px-3 py-2 font-medium">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {cases.map((row) => (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.externalId}
                  </td>
                  <td className="px-3 py-2 text-muted">{row.module ?? '—'}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-fg">{row.scenario}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">
                      {row.expected}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {row.priority ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-muted">{row.type ?? '—'}</td>
                  {canEdit ? (
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(row)}
                          disabled={showForm}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete ${row.externalId}? This cannot be undone.`,
                              )
                            ) {
                              deleteMutation.mutate(row.id);
                            }
                          }}
                          disabled={deleteMutation.isPending}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm ? (
        <div className="space-y-3 rounded-lg border border-border bg-panel/40 p-4">
          <p className="text-sm font-medium text-fg">
            {adding ? 'New test case' : 'Edit test case'}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted">
              ID
              <input
                className="w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
                value={draft.externalId}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, externalId: e.target.value }))
                }
                placeholder="TC-001"
              />
            </label>
            <label className="space-y-1 text-xs text-muted">
              Module
              <input
                className="w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
                value={draft.module}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, module: e.target.value }))
                }
              />
            </label>
            <label className="space-y-1 text-xs text-muted sm:col-span-2">
              Scenario
              <input
                className="w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
                value={draft.scenario}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, scenario: e.target.value }))
                }
              />
            </label>
            <label className="space-y-1 text-xs text-muted sm:col-span-2">
              Preconditions
              <textarea
                className="min-h-[60px] w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
                value={draft.preconditions}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, preconditions: e.target.value }))
                }
              />
            </label>
            <label className="space-y-1 text-xs text-muted sm:col-span-2">
              Steps (one per line)
              <textarea
                className="min-h-[100px] w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 font-mono text-sm text-fg"
                value={draft.steps}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, steps: e.target.value }))
                }
              />
            </label>
            <label className="space-y-1 text-xs text-muted sm:col-span-2">
              Expected result
              <textarea
                className="min-h-[70px] w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
                value={draft.expected}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, expected: e.target.value }))
                }
              />
            </label>
            <label className="space-y-1 text-xs text-muted">
              Priority
              <input
                className="w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
                value={draft.priority}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, priority: e.target.value }))
                }
              />
            </label>
            <label className="space-y-1 text-xs text-muted">
              Type
              <input
                className="w-full rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-fg"
                value={draft.type}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, type: e.target.value }))
                }
              />
            </label>
          </div>
          {saveMutation.isError ? (
            <p className="text-sm text-danger">
              {saveMutation.error instanceof Error
                ? saveMutation.error.message
                : 'Save failed'}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={
                saveMutation.isPending ||
                !draft.scenario.trim() ||
                !draft.expected.trim()
              }
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save case'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setEditingId(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
