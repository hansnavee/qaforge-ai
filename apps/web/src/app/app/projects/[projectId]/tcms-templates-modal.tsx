'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { fieldClass } from './tcms-board';

export type CaseFieldRow = {
  id: string;
  key: string;
  label: string;
  type: 'TEXT' | 'TEXTAREA' | 'DROPDOWN' | 'CHECKBOX' | 'NUMBER';
  options: string[] | null;
  required: boolean;
  sortOrder: number;
  projectId?: string | null;
};

export type CaseTemplateRow = {
  id: string;
  name: string;
  isDefault: boolean;
  fieldKeys: string[];
  defaults: {
    type?: string;
    priorityLabel?: string;
    preconditions?: string;
    designTechnique?: string;
  } | null;
};

export function TcmsTemplatesModal({
  open,
  projectId,
  canEdit,
  onClose,
}: {
  open: boolean;
  projectId: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [templateName, setTemplateName] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const fieldsQuery = useQuery({
    queryKey: ['case-fields', projectId],
    enabled: open,
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<CaseFieldRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/case-fields`,
      );
    },
  });
  const templatesQuery = useQuery({
    queryKey: ['case-templates', projectId],
    enabled: open,
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<CaseTemplateRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/case-templates`,
      );
    },
  });

  const fields = fieldsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];

  const addTemplate = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/case-templates`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: templateName.trim(),
            isDefault: templates.length === 0,
            fieldKeys: [...selectedKeys],
          }),
        },
      );
    },
    onSuccess: async () => {
      setTemplateName('');
      setSelectedKeys(new Set());
      await qc.invalidateQueries({ queryKey: ['case-templates', projectId] });
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : 'Could not add template'),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/case-templates/${id}`,
        { method: 'DELETE' },
      );
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['case-templates', projectId] }),
  });

  const setDefault = useMutation({
    mutationFn: async (row: CaseTemplateRow) => {
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/case-templates/${row.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: row.name, isDefault: true }),
        },
      );
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['case-templates', projectId] }),
  });

  return (
    <Modal
      open={open}
      title="Case templates"
      size="lg"
      onClose={onClose}
      footer={
        <Button type="button" size="sm" variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-5">
        <p className="text-xs text-muted">
          Templates pick which custom fields show on this project’s case form.{' '}
          <Link href="/app/settings" className="text-accent hover:underline">
            Manage fields in Settings
          </Link>
        </p>
        <ul className="space-y-1 text-sm">
          {fields.map((f) => (
            <li key={f.id}>
              {f.label}{' '}
              <span className="font-mono text-xs text-muted">
                {f.key} · {f.type}
                {f.projectId ? '' : ' · all projects'}
              </span>
            </li>
          ))}
          {!fields.length ? (
            <li className="text-xs text-muted">
              No custom fields apply to this project yet.
            </li>
          ) : null}
        </ul>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Templates</h3>
          <ul className="space-y-1 text-sm">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2">
                <span>
                  {t.name}
                  {t.isDefault ? (
                    <span className="ml-2 text-xs text-muted">default</span>
                  ) : null}
                </span>
                {canEdit ? (
                  <span className="flex gap-1">
                    {!t.isDefault ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setDefault.mutate(t)}
                      >
                        Make default
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteTemplate.mutate(t.id)}
                    >
                      Remove
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
            {!templates.length ? (
              <li className="text-xs text-muted">No templates yet.</li>
            ) : null}
          </ul>
          {canEdit ? (
            <div className="space-y-2">
              <input
                className={fieldClass}
                placeholder="Template name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
              <div className="grid gap-1 sm:grid-cols-2">
                {fields.map((f) => (
                  <label key={f.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(f.key)}
                      onChange={() => {
                        setSelectedKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(f.key)) next.delete(f.key);
                          else next.add(f.key);
                          return next;
                        });
                      }}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                disabled={!templateName.trim() || addTemplate.isPending}
                onClick={() => addTemplate.mutate()}
              >
                Save template
              </Button>
            </div>
          ) : null}
        </section>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
