'use client';

import type { CaseStatus } from '@qaforge/shared';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { areaClass, fieldClass } from './tcms-board';
import type { CaseFieldRow, CaseTemplateRow } from './tcms-templates-modal';

export type CaseDraft = {
  externalId: string;
  folderId: string;
  scenario: string;
  preconditions: string;
  steps: string;
  expected: string;
  type: string;
  requirementKey: string;
  designTechnique: string;
  priorityLabel: string;
  caseStatus: CaseStatus;
  testData: string;
  templateId: string;
  customFields: Record<string, string>;
};

export type FolderOption = {
  id: string;
  label: string;
};

export function TcmsCaseModal({
  open,
  title,
  draft,
  folders,
  fields = [],
  templates = [],
  busy,
  error,
  readOnly,
  onChange,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  draft: CaseDraft;
  folders: FolderOption[];
  fields?: CaseFieldRow[];
  templates?: CaseTemplateRow[];
  busy?: boolean;
  error?: string | null;
  readOnly?: boolean;
  onChange: (next: CaseDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const activeTemplate =
    templates.find((t) => t.id === draft.templateId) ??
    templates.find((t) => t.isDefault);
  const templateKeys = Array.isArray(activeTemplate?.fieldKeys)
    ? activeTemplate.fieldKeys
    : [];
  const visibleFields = templateKeys.length
    ? fields.filter((f) => templateKeys.includes(f.key))
    : fields;
  return (
    <Modal
      open={open}
      title={title}
      wide
      onClose={onClose}
      footer={
        readOnly ? (
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || !draft.scenario.trim() || !draft.expected.trim()}
              onClick={onSave}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted">
          ID
          <input
            className={fieldClass}
            disabled={readOnly}
            value={draft.externalId}
            onChange={(e) =>
              onChange({ ...draft, externalId: e.target.value })
            }
            placeholder="TC-001"
          />
        </label>
        <label className="space-y-1 text-xs text-muted">
          Folder / subfolder
          <select
            className={fieldClass}
            disabled={readOnly}
            value={draft.folderId}
            onChange={(e) =>
              onChange({ ...draft, folderId: e.target.value })
            }
          >
            <option value="">Ungrouped</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted sm:col-span-2">
          Title
          <input
            className={fieldClass}
            disabled={readOnly}
            value={draft.scenario}
            onChange={(e) =>
              onChange({ ...draft, scenario: e.target.value })
            }
          />
        </label>
        <label className="space-y-1 text-xs text-muted sm:col-span-2">
          Preconditions
          <textarea
            className={`${areaClass} min-h-[56px]`}
            disabled={readOnly}
            value={draft.preconditions}
            onChange={(e) =>
              onChange({ ...draft, preconditions: e.target.value })
            }
          />
        </label>
        <label className="space-y-1 text-xs text-muted sm:col-span-2">
          Steps (one per line)
          <textarea
            className={`${areaClass} min-h-[96px] font-mono`}
            disabled={readOnly}
            value={draft.steps}
            onChange={(e) => onChange({ ...draft, steps: e.target.value })}
          />
        </label>
        <label className="space-y-1 text-xs text-muted sm:col-span-2">
          Expected result
          <textarea
            className={`${areaClass} min-h-[64px]`}
            disabled={readOnly}
            value={draft.expected}
            onChange={(e) =>
              onChange({ ...draft, expected: e.target.value })
            }
          />
        </label>
        <label className="space-y-1 text-xs text-muted">
          Status
          <select
            className={fieldClass}
            disabled={readOnly}
            value={draft.caseStatus}
            onChange={(e) =>
              onChange({
                ...draft,
                caseStatus: e.target.value as CaseStatus,
              })
            }
          >
            <option value="DRAFT">Draft</option>
            <option value="APPROVED">Approved</option>
            <option value="READY">Ready</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted">
          Priority
          <select
            className={fieldClass}
            disabled={readOnly}
            value={draft.priorityLabel}
            onChange={(e) =>
              onChange({ ...draft, priorityLabel: e.target.value })
            }
          >
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted">
          Requirement
          <input
            className={fieldClass}
            disabled={readOnly}
            value={draft.requirementKey}
            onChange={(e) =>
              onChange({ ...draft, requirementKey: e.target.value })
            }
            placeholder="REQ-001"
          />
        </label>
        <label className="space-y-1 text-xs text-muted">
          Technique
          <select
            className={fieldClass}
            disabled={readOnly}
            value={draft.designTechnique}
            onChange={(e) =>
              onChange({ ...draft, designTechnique: e.target.value })
            }
          >
            <option value="">—</option>
            <option value="HAPPY_PATH">Happy path</option>
            <option value="EQUIVALENCE">Equivalence</option>
            <option value="BOUNDARY">Boundary</option>
            <option value="DECISION_TABLE">Decision table</option>
            <option value="STATE_TRANSITION">State transition</option>
            <option value="NEGATIVE">Negative</option>
            <option value="ERROR_GUESSING">Error guessing</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted sm:col-span-2">
          Test data (key=value per line)
          <textarea
            className={`${areaClass} min-h-[56px] font-mono`}
            disabled={readOnly}
            value={draft.testData}
            onChange={(e) => onChange({ ...draft, testData: e.target.value })}
          />
        </label>
        {templates.length ? (
          <label className="space-y-1 text-xs text-muted sm:col-span-2">
            Template
            <select
              className={fieldClass}
              disabled={readOnly}
              value={draft.templateId}
              onChange={(e) =>
                onChange({ ...draft, templateId: e.target.value })
              }
            >
              <option value="">All custom fields</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {visibleFields.map((f) => (
          <label
            key={f.id}
            className={`space-y-1 text-xs text-muted ${
              f.type === 'TEXTAREA' ? 'sm:col-span-2' : ''
            }`}
          >
            {f.label}
            {f.type === 'TEXTAREA' ? (
              <textarea
                className={`${areaClass} min-h-[56px]`}
                disabled={readOnly}
                value={draft.customFields[f.key] ?? ''}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    customFields: {
                      ...draft.customFields,
                      [f.key]: e.target.value,
                    },
                  })
                }
              />
            ) : f.type === 'DROPDOWN' ? (
              <select
                className={fieldClass}
                disabled={readOnly}
                value={draft.customFields[f.key] ?? ''}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    customFields: {
                      ...draft.customFields,
                      [f.key]: e.target.value,
                    },
                  })
                }
              >
                <option value="">—</option>
                {(Array.isArray(f.options) ? f.options : []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : f.type === 'CHECKBOX' ? (
              <input
                type="checkbox"
                disabled={readOnly}
                checked={draft.customFields[f.key] === 'true'}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    customFields: {
                      ...draft.customFields,
                      [f.key]: e.target.checked ? 'true' : 'false',
                    },
                  })
                }
              />
            ) : (
              <input
                className={fieldClass}
                type={f.type === 'NUMBER' ? 'number' : 'text'}
                disabled={readOnly}
                value={draft.customFields[f.key] ?? ''}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    customFields: {
                      ...draft.customFields,
                      [f.key]: e.target.value,
                    },
                  })
                }
              />
            )}
          </label>
        ))}
      </div>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </Modal>
  );
}
