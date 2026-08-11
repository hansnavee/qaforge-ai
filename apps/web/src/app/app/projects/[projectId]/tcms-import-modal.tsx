'use client';

import { useState } from 'react';
import { apiForm } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { fieldClass } from './tcms-board';
import type { FolderOption } from './tcms-case-modal';

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ line: number; message: string }>;
};

export function TcmsImportModal({
  open,
  projectId,
  folders,
  defaultFolderId,
  onClose,
  onImported,
}: {
  open: boolean;
  projectId: string;
  folders: FolderOption[];
  defaultFolderId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function run() {
    if (!file) {
      setError('Choose a CSV, JSON, or XLS file');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const orgId = await getDefaultOrgId();
      const form = new FormData();
      form.append('file', file);
      if (folderId) form.append('folderId', folderId);
      form.append('updateExisting', updateExisting ? 'true' : 'false');
      const data = await apiForm<ImportResult>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/import`,
        form,
      );
      setResult(data);
      if (data.created + data.updated > 0) onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Import test cases"
      onClose={onClose}
      footer={
        <>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result ? (
            <Button
              type="button"
              size="sm"
              disabled={busy || !file}
              onClick={() => void run()}
            >
              {busy ? 'Importing…' : 'Import as Draft'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-3">
        <input
          type="file"
          accept=".csv,.json,.xls,.xlsx,text/csv,application/json"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
          }}
        />
        <label className="block space-y-1 text-xs text-muted">
          Folder if the file has none
          <select
            className={fieldClass}
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
          >
            <option value="">Ungrouped</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={updateExisting}
            onChange={(e) => setUpdateExisting(e.target.checked)}
          />
          Update existing cases with the same ID
        </label>
        {result ? (
          <p className="text-sm">
            Created {result.created}, updated {result.updated}, skipped{' '}
            {result.skipped}
            {result.errors[0]
              ? `. First error (line ${result.errors[0].line}): ${result.errors[0].message}`
              : '.'}
          </p>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
