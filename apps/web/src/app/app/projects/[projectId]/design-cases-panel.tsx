'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  DESIGN_TECHNIQUES,
  TECHNIQUE_LABELS,
  UNGROUPED_FOLDER_KEY,
  buildTcmsTree,
  normalizeCaseStatus,
  statusCounts,
  type CaseStatus,
} from '@qaforge/shared';
import { api, downloadAuthenticated } from '@/lib/api';
import { getDefaultOrgId } from '@/lib/org';
import { ActionMenu } from '@/components/ActionMenu';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  ListingEmpty,
  ListingLink,
  ListingPager,
  ListingTable,
  listingFilterClass,
  useListingSlice,
} from '@/components/ListingTable';
import { Modal } from '@/components/Modal';
import { TcmsBoard, TcmsTreeButton, fieldClass } from './tcms-board';
import { TcmsAiGenerateModal } from './tcms-ai-generate-modal';
import {
  TcmsCaseModal,
  type CaseDraft,
  type FolderOption,
} from './tcms-case-modal';
import { TcmsImportModal } from './tcms-import-modal';
import {
  TcmsTemplatesModal,
  type CaseFieldRow,
  type CaseTemplateRow,
} from './tcms-templates-modal';

const ARCHIVED_KEY = '__archived__';

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
  requirementKey?: string | null;
  designTechnique?: string | null;
  featureKey?: string | null;
  featureName?: string | null;
  requirementTitle?: string | null;
  folderId?: string | null;
  folderName?: string | null;
  parentFolderId?: string | null;
  designMode?: string | null;
  priorityLabel?: string | null;
  readyForExecution?: boolean;
  caseStatus?: string | null;
  testData?: unknown;
  customFields?: Record<string, string> | null;
  templateId?: string | null;
  deletedAt?: string | null;
};

export type TcmsFolderRow = {
  id: string;
  parentId: string | null;
  name: string;
  featureKey: string | null;
  requirementKey: string | null;
  sortOrder: number;
};

type FolderSel = { folderId: string; sectionId: string };

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

function testDataToText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  return Object.entries(data as Record<string, string>)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function textToTestData(text: string): Record<string, string> | undefined {
  const rows = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!rows.length) return undefined;
  const out: Record<string, string> = {};
  for (const row of rows) {
    const i = row.indexOf('=');
    if (i === -1) out.note = row;
    else out[row.slice(0, i).trim()] = row.slice(i + 1).trim();
  }
  return out;
}

const emptyDraft = (): CaseDraft => ({
  externalId: '',
  folderId: '',
  scenario: '',
  preconditions: '',
  steps: '1. ',
  expected: '',
  type: 'functional',
  requirementKey: '',
  designTechnique: 'HAPPY_PATH',
  priorityLabel: 'MEDIUM',
  caseStatus: 'DRAFT',
  testData: '',
  templateId: '',
  customFields: {},
});

function statusTone(status: CaseStatus) {
  if (status === 'READY') return 'success' as const;
  if (status === 'APPROVED') return 'accent' as const;
  return 'default' as const;
}

function isArchived(row: TestCaseRow) {
  return Boolean(row.deletedAt);
}

async function downloadCases(projectId: string, format: string) {
  const orgId = await getDefaultOrgId();
  await downloadAuthenticated(
    `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/download?format=${format}`,
    `test-cases.${format === 'xls' ? 'xls' : format}`,
  );
}

export function DesignCasesPanel({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [folder, setFolder] = useState<FolderSel>({
    folderId: '*',
    sectionId: '',
  });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [techniqueFilter, setTechniqueFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<CaseDraft>(emptyDraft);
  const [folderName, setFolderName] = useState('');
  const [folderOpen, setFolderOpen] = useState(false);
  const [subfolderParent, setSubfolderParent] = useState<string | null>(null);
  const [subfolderName, setSubfolderName] = useState('');
  const [rename, setRename] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [deleteFolder, setDeleteFolder] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleteFolderCases, setDeleteFolderCases] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string>('');
  const [bulkPriority, setBulkPriority] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [archiveIds, setArchiveIds] = useState<string[] | null>(null);
  const [purgeIds, setPurgeIds] = useState<string[] | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const casesQuery = useQuery({
    queryKey: ['test-cases', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<TestCaseRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases?includeArchived=1`,
      );
    },
    refetchInterval: 5000,
  });

  const fieldsQuery = useQuery({
    queryKey: ['case-fields', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<CaseFieldRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/case-fields`,
      );
    },
  });

  const templatesQuery = useQuery({
    queryKey: ['case-templates', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<CaseTemplateRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/case-templates`,
      );
    },
  });

  const foldersQuery = useQuery({
    queryKey: ['tcms-folders', projectId],
    queryFn: async () => {
      const orgId = await getDefaultOrgId();
      return api<TcmsFolderRow[]>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/folders`,
      );
    },
  });

  const allCases = casesQuery.data ?? [];
  const live = useMemo(() => allCases.filter((c) => !isArchived(c)), [allCases]);
  const archived = useMemo(
    () => allCases.filter((c) => isArchived(c)),
    [allCases],
  );
  const folderRows = foldersQuery.data ?? [];
  const folders = useMemo(
    () => buildTcmsTree(folderRows, live),
    [folderRows, live],
  );
  const counts = statusCounts(live);
  const inArchived = folder.folderId === ARCHIVED_KEY;
  const folderOptions: FolderOption[] = useMemo(() => {
    const tops = folderRows.filter((f) => !f.parentId);
    const out: FolderOption[] = [];
    for (const top of tops) {
      out.push({ id: top.id, label: top.name });
      for (const sub of folderRows.filter((f) => f.parentId === top.id)) {
        out.push({ id: sub.id, label: `${top.name} / ${sub.name}` });
      }
    }
    return out;
  }, [folderRows]);

  const folderFiltered = useMemo(() => {
    let rows: TestCaseRow[];
    if (inArchived) {
      rows = archived;
    } else if (folder.folderId === '*') {
      rows = live;
    } else {
      rows = folders.find((f) => f.key === folder.folderId)?.cases ?? [];
      if (folder.sectionId) {
        const tree = folders.find((f) => f.key === folder.folderId);
        rows = tree?.sections.find((s) => s.key === folder.sectionId)?.cases ?? [];
      }
    }
    if (statusFilter) {
      rows = rows.filter(
        (c) =>
          normalizeCaseStatus(c.caseStatus, c.readyForExecution) ===
          statusFilter,
      );
    }
    if (priorityFilter) {
      rows = rows.filter(
        (c) => (c.priorityLabel ?? c.priority ?? '') === priorityFilter,
      );
    }
    if (techniqueFilter) {
      rows = rows.filter((c) => c.designTechnique === techniqueFilter);
    }
    return rows;
  }, [
    live,
    archived,
    folders,
    folder,
    statusFilter,
    priorityFilter,
    techniqueFilter,
    inArchived,
  ]);

  const listing = useListingSlice(folderFiltered, {
    query: search,
    searchText: (c) =>
      `${c.externalId} ${c.scenario} ${c.requirementKey ?? ''} ${c.type ?? ''}`,
    resetKey: `${folder.folderId}:${folder.sectionId}:${statusFilter}:${priorityFilter}:${techniqueFilter}:${inArchived}`,
  });
  const filtersActive = Boolean(
    search.trim() || statusFilter || priorityFilter || techniqueFilter,
  );
  const visible = listing.pageRows;

  const selectedIds = [...selected];

  function invalidate() {
    return Promise.all([
      qc.invalidateQueries({ queryKey: ['test-cases', projectId] }),
      qc.invalidateQueries({ queryKey: ['tcms-folders', projectId] }),
      qc.invalidateQueries({ queryKey: ['stlc-phase', projectId] }),
    ]);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const orgId = await getDefaultOrgId();
      const body = {
        externalId: draft.externalId.trim() || undefined,
        scenario: draft.scenario.trim(),
        preconditions: draft.preconditions,
        steps: textToSteps(draft.steps),
        expected: draft.expected.trim(),
        type: draft.type || 'functional',
        requirementKey: draft.requirementKey.trim() || null,
        designTechnique: draft.designTechnique.trim() || null,
        folderId: draft.folderId || null,
        priorityLabel: draft.priorityLabel as 'HIGH' | 'MEDIUM' | 'LOW',
        caseStatus: draft.caseStatus,
        testData: textToTestData(draft.testData) ?? null,
        templateId: draft.templateId || null,
        customFields: Object.keys(draft.customFields).length
          ? draft.customFields
          : null,
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
      setAdding(false);
      setEditingId(null);
      await invalidate();
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (id: string) => {
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/${id}/duplicate`,
        { method: 'POST', body: '{}' },
      );
    },
    onSuccess: () => void invalidate(),
  });

  const archiveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const orgId = await getDefaultOrgId();
      const only = ids[0];
      if (ids.length === 1 && only) {
        return api(
          `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/${only}`,
          { method: 'DELETE' },
        );
      }
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/bulk`,
        { method: 'DELETE', body: JSON.stringify({ ids }) },
      );
    },
    onSuccess: async () => {
      setSelected(new Set());
      setArchiveIds(null);
      await invalidate();
    },
  });

  const purgeMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const orgId = await getDefaultOrgId();
      const only = ids[0];
      if (ids.length === 1 && only) {
        return api(
          `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/${only}?permanent=1`,
          { method: 'DELETE' },
        );
      }
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/bulk`,
        { method: 'DELETE', body: JSON.stringify({ ids, permanent: true }) },
      );
    },
    onSuccess: async () => {
      setSelected(new Set());
      setPurgeIds(null);
      await invalidate();
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const orgId = await getDefaultOrgId();
      const only = ids[0];
      if (ids.length === 1 && only) {
        return api(
          `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/${only}/restore`,
          { method: 'POST', body: '{}' },
        );
      }
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/restore`,
        { method: 'POST', body: JSON.stringify({ ids }) },
      );
    },
    onSuccess: async () => {
      setSelected(new Set());
      await invalidate();
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/test-cases/bulk`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
    },
    onSuccess: async () => {
      setBulkOpen(false);
      await invalidate();
    },
  });

  const folderMutation = useMutation({
    mutationFn: async (body: { name: string; parentId?: string | null }) => {
      const orgId = await getDefaultOrgId();
      return api<TcmsFolderRow>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/folders`,
        { method: 'POST', body: JSON.stringify(body) },
      );
    },
    onSuccess: async (created) => {
      setFolderName('');
      setFolderOpen(false);
      setSubfolderName('');
      setSubfolderParent(null);
      setFolder({ folderId: created.id, sectionId: '' });
      await invalidate();
    },
  });

  const renameMutation = useMutation({
    mutationFn: async (body: { id: string; name: string }) => {
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/folders/${body.id}`,
        { method: 'PATCH', body: JSON.stringify({ name: body.name }) },
      );
    },
    onSuccess: async () => {
      setRename(null);
      await invalidate();
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async () => {
      if (!deleteFolder) return;
      const orgId = await getDefaultOrgId();
      return api(
        `/api/v1/orgs/${orgId}/projects/${projectId}/tcms/folders/${deleteFolder.id}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ deleteCases: deleteFolderCases }),
        },
      );
    },
    onSuccess: async () => {
      setDeleteFolder(null);
      setDeleteFolderCases(false);
      setFolder({ folderId: '*', sectionId: '' });
      await invalidate();
    },
  });

  function openDraft(row: TestCaseRow, readOnly: boolean) {
    setAdding(false);
    setViewing(readOnly);
    setEditingId(row.id);
    setDraft({
      externalId: row.externalId,
      folderId: row.folderId ?? '',
      scenario: row.scenario,
      preconditions: row.preconditions ?? '',
      steps: stepsToText(row.steps),
      expected: row.expected,
      type: row.type ?? 'functional',
      requirementKey: row.requirementKey ?? '',
      designTechnique: row.designTechnique ?? '',
      priorityLabel: row.priorityLabel ?? 'MEDIUM',
      caseStatus: normalizeCaseStatus(row.caseStatus, row.readyForExecution),
      testData: testDataToText(row.testData),
      templateId: row.templateId ?? '',
      customFields:
        row.customFields && typeof row.customFields === 'object'
          ? Object.fromEntries(
              Object.entries(row.customFields).map(([k, v]) => [k, String(v)]),
            )
          : {},
    });
  }

  function startAdd() {
    setEditingId(null);
    setViewing(false);
    setAdding(true);
    const sectionId = folder.sectionId;
    const folderId =
      sectionId ||
      (folder.folderId !== '*' &&
      folder.folderId !== UNGROUPED_FOLDER_KEY &&
      folder.folderId !== ARCHIVED_KEY
        ? folder.folderId
        : '');
    const def = templatesQuery.data?.find((t) => t.isDefault);
    setDraft({
      ...emptyDraft(),
      folderId,
      templateId: def?.id ?? '',
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <TcmsBoard
        title="Test cases"
        hint={`${counts.total} cases · ${counts.ready} ready · ${archived.length} archived`}
        tree={
          <div className="space-y-0.5">
            <TcmsTreeButton
              active={folder.folderId === '*'}
              onClick={() => setFolder({ folderId: '*', sectionId: '' })}
              count={String(live.length)}
            >
              All cases
            </TcmsTreeButton>
            {folders.map((f) => {
              const open =
                expandedFolders.has(f.key) || folder.folderId === f.key;
              const nested = f.sections.some((s) => s.key);
              const isSystem = f.key === UNGROUPED_FOLDER_KEY;
              return (
                <div key={f.key}>
                  <div className="flex items-center gap-0.5">
                    <div className="min-w-0 flex-1">
                      <TcmsTreeButton
                        active={folder.folderId === f.key && !folder.sectionId}
                        onClick={() => {
                          setFolder({ folderId: f.key, sectionId: '' });
                          setExpandedFolders((prev) => {
                            const next = new Set(prev);
                            if (next.has(f.key)) next.delete(f.key);
                            else next.add(f.key);
                            return next;
                          });
                        }}
                        chevron={nested ? (open ? '▾' : '▸') : '·'}
                        count={`${statusCounts(f.cases).ready}/${f.cases.length}`}
                      >
                        {f.title}
                      </TcmsTreeButton>
                    </div>
                    {canEdit && !isSystem ? (
                      <ActionMenu
                        items={[
                          {
                            label: 'Rename',
                            onClick: () =>
                              setRename({ id: f.key, name: f.title }),
                          },
                          {
                            label: 'Add subfolder',
                            onClick: () => {
                              setSubfolderParent(f.key);
                              setSubfolderName('');
                            },
                          },
                          {
                            label: 'Delete folder',
                            danger: true,
                            onClick: () =>
                              setDeleteFolder({ id: f.key, name: f.title }),
                          },
                        ]}
                      />
                    ) : null}
                  </div>
                  {nested && open
                    ? f.sections.map((s) => (
                        <div key={s.key} className="flex items-center gap-0.5">
                          <div className="min-w-0 flex-1">
                            <TcmsTreeButton
                              indent={1}
                              active={
                                folder.folderId === f.key &&
                                folder.sectionId === s.key
                              }
                              onClick={() =>
                                setFolder({
                                  folderId: f.key,
                                  sectionId: s.key,
                                })
                              }
                              count={String(s.cases.length)}
                            >
                              {s.title}
                            </TcmsTreeButton>
                          </div>
                          {canEdit ? (
                            <ActionMenu
                              items={[
                                {
                                  label: 'Rename',
                                  onClick: () =>
                                    setRename({ id: s.key, name: s.title }),
                                },
                                {
                                  label: 'Delete folder',
                                  danger: true,
                                  onClick: () =>
                                    setDeleteFolder({
                                      id: s.key,
                                      name: s.title,
                                    }),
                                },
                              ]}
                            />
                          ) : null}
                        </div>
                      ))
                    : null}
                </div>
              );
            })}
            <TcmsTreeButton
              active={inArchived}
              onClick={() => setFolder({ folderId: ARCHIVED_KEY, sectionId: '' })}
              count={String(archived.length)}
            >
              Archived
            </TcmsTreeButton>
            {canEdit ? (
              <div className="mt-3 border-t border-border pt-3">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    setFolderName('');
                    setFolderOpen(true);
                  }}
                >
                  Add a folder
                </Button>
              </div>
            ) : null}
          </div>
        }
        toolbar={
          <>
            <input
              className={`${fieldClass} max-w-[11rem]`}
              placeholder="Search cases"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className={listingFilterClass}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="APPROVED">Approved</option>
              <option value="READY">Ready</option>
            </select>
            <select
              className={listingFilterClass}
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              aria-label="Filter by priority"
            >
              <option value="">All priorities</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
            <select
              className={listingFilterClass}
              value={techniqueFilter}
              onChange={(e) => setTechniqueFilter(e.target.value)}
              aria-label="Filter by technique"
            >
              <option value="">All techniques</option>
              {DESIGN_TECHNIQUES.map((t) => (
                <option key={t} value={t}>
                  {TECHNIQUE_LABELS[t]}
                </option>
              ))}
            </select>
            {canEdit && selectedIds.length ? (
              <>
                {inArchived ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => restoreMutation.mutate(selectedIds)}
                  >
                    Restore selected
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setBulkOpen(true)}
                  >
                    Edit selected
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    inArchived
                      ? setPurgeIds(selectedIds)
                      : setArchiveIds(selectedIds)
                  }
                >
                  {inArchived ? 'Delete selected' : 'Archive selected'}
                </Button>
              </>
            ) : null}
            {canEdit && !inArchived ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setAiOpen(true)}
                >
                  AI
                </Button>
                <Button type="button" size="sm" onClick={startAdd}>
                  Add case
                </Button>
              </>
            ) : null}
            <ActionMenu
              label="More"
              items={[
                {
                  label: 'Export CSV',
                  onClick: () =>
                    void downloadCases(projectId, 'csv'),
                },
                {
                  label: 'Export XLS',
                  onClick: () =>
                    void downloadCases(projectId, 'xls'),
                },
                {
                  label: 'Export JSON',
                  onClick: () =>
                    void downloadCases(projectId, 'json'),
                },
                ...(canEdit
                  ? [
                      {
                        label: 'Import',
                        onClick: () => setImportOpen(true),
                      },
                      {
                        label: 'Templates',
                        onClick: () => setTemplatesOpen(true),
                      },
                    ]
                  : []),
              ]}
            />
            {selectedIds.length ? (
              <span className="text-xs text-muted">
                {selectedIds.length} selected
              </span>
            ) : null}
          </>
        }
      >
        <>
        <ListingTable
          rows={visible}
          loading={casesQuery.isLoading}
          columnKey="cases"
          lockedColumnId="id"
          selectable={canEdit}
          selected={selected}
          onToggle={toggleSelect}
          onToggleAll={(checked) => {
            setSelected((prev) => {
              const next = new Set(prev);
              for (const row of listing.pageRows) {
                if (checked) next.add(row.id);
                else next.delete(row.id);
              }
              return next;
            });
          }}
          onRowClick={(row) =>
            openDraft(row, !canEdit || inArchived)
          }
          empty={
            <ListingEmpty
              action={
                canEdit && !inArchived && !filtersActive ? (
                  <span className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setAiOpen(true)}
                    >
                      AI
                    </Button>
                    <Button type="button" size="sm" onClick={startAdd}>
                      Add a case
                    </Button>
                  </span>
                ) : null
              }
            >
              {filtersActive
                ? 'No rows match these filters.'
                : inArchived
                  ? 'No archived cases.'
                  : live.length
                    ? 'No cases in this folder.'
                    : 'No test cases yet. Add a folder, then add a case.'}
            </ListingEmpty>
          }
          columns={[
            {
              id: 'id',
              header: 'ID',
              className: 'font-mono text-xs',
              cell: (row) => (
                <ListingLink
                  className="font-mono text-xs"
                  onClick={() => openDraft(row, !canEdit || inArchived)}
                >
                  {row.externalId}
                </ListingLink>
              ),
            },
            {
              id: 'title',
              header: 'Title',
              className: 'font-medium',
              cell: (row) => (
                <ListingLink
                  className="font-medium"
                  onClick={() => openDraft(row, !canEdit || inArchived)}
                >
                  {row.scenario}
                </ListingLink>
              ),
            },
            {
              id: 'status',
              header: 'Status',
              cell: (row) => {
                const status = normalizeCaseStatus(
                  row.caseStatus,
                  row.readyForExecution,
                );
                return <Badge tone={statusTone(status)}>{status}</Badge>;
              },
            },
            {
              id: 'priority',
              header: 'Priority',
              className: 'text-muted',
              cell: (row) => row.priorityLabel ?? row.priority ?? '—',
            },
            {
              id: 'technique',
              header: 'Technique',
              className: 'text-xs text-muted',
              cell: (row) => row.designTechnique ?? '—',
            },
          ]}
          actions={(row) =>
            canEdit
              ? inArchived
                ? [
                    {
                      label: 'Restore',
                      onClick: () => restoreMutation.mutate([row.id]),
                    },
                    {
                      label: 'Delete',
                      danger: true,
                      onClick: () => setPurgeIds([row.id]),
                    },
                  ]
                : [
                    { label: 'Edit', onClick: () => openDraft(row, false) },
                    {
                      label: 'Duplicate',
                      onClick: () => duplicateMutation.mutate(row.id),
                    },
                    {
                      label: 'Archive',
                      onClick: () => setArchiveIds([row.id]),
                    },
                    {
                      label: 'Delete',
                      danger: true,
                      onClick: () => setPurgeIds([row.id]),
                    },
                  ]
              : [{ label: 'View', onClick: () => openDraft(row, true) }]
          }
        />
        <ListingPager
          page={listing.page}
          totalPages={listing.totalPages}
          from={listing.from}
          to={listing.to}
          total={listing.total}
          pageSize={listing.pageSize}
          onPage={listing.setPage}
          onPageSize={listing.setPageSize}
        />
        </>
      </TcmsBoard>

      <TcmsAiGenerateModal
        open={aiOpen}
        projectId={projectId}
        folders={folderOptions}
        defaultFolderId={
          folder.sectionId ||
          (folder.folderId !== '*' &&
          folder.folderId !== UNGROUPED_FOLDER_KEY &&
          folder.folderId !== ARCHIVED_KEY
            ? folder.folderId
            : '')
        }
        onClose={() => setAiOpen(false)}
        onAdded={() => void invalidate()}
      />

      <TcmsImportModal
        open={importOpen}
        projectId={projectId}
        folders={folderOptions}
        defaultFolderId={
          folder.sectionId ||
          (folder.folderId !== '*' &&
          folder.folderId !== UNGROUPED_FOLDER_KEY &&
          folder.folderId !== ARCHIVED_KEY
            ? folder.folderId
            : '')
        }
        onClose={() => setImportOpen(false)}
        onImported={() => void invalidate()}
      />

      <TcmsTemplatesModal
        open={templatesOpen}
        projectId={projectId}
        canEdit={canEdit}
        onClose={() => setTemplatesOpen(false)}
      />

      <TcmsCaseModal
        open={adding || Boolean(editingId)}
        title={
          adding ? 'New test case' : viewing ? 'Test case' : 'Edit test case'
        }
        draft={draft}
        folders={folderOptions}
        fields={fieldsQuery.data ?? []}
        templates={templatesQuery.data ?? []}
        busy={saveMutation.isPending}
        readOnly={viewing}
        error={
          saveMutation.isError
            ? saveMutation.error instanceof Error
              ? saveMutation.error.message
              : 'Save failed'
            : null
        }
        onChange={setDraft}
        onClose={() => {
          setAdding(false);
          setEditingId(null);
          setViewing(false);
        }}
        onSave={() => saveMutation.mutate()}
      />

      <Modal
        open={folderOpen}
        title="New folder"
        onClose={() => setFolderOpen(false)}
        footer={
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setFolderOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!folderName.trim() || folderMutation.isPending}
              onClick={() =>
                folderMutation.mutate({ name: folderName.trim() })
              }
            >
              Create
            </Button>
          </>
        }
      >
        <input
          className={fieldClass}
          placeholder="Folder name"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
        />
      </Modal>

      <Modal
        open={Boolean(subfolderParent)}
        title="New subfolder"
        onClose={() => setSubfolderParent(null)}
        footer={
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSubfolderParent(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!subfolderName.trim() || folderMutation.isPending}
              onClick={() =>
                folderMutation.mutate({
                  name: subfolderName.trim(),
                  parentId: subfolderParent,
                })
              }
            >
              Create
            </Button>
          </>
        }
      >
        <input
          className={fieldClass}
          placeholder="Subfolder name"
          value={subfolderName}
          onChange={(e) => setSubfolderName(e.target.value)}
        />
      </Modal>

      <Modal
        open={Boolean(rename)}
        title="Rename folder"
        onClose={() => setRename(null)}
        footer={
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRename(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!rename?.name.trim() || renameMutation.isPending}
              onClick={() =>
                rename &&
                renameMutation.mutate({
                  id: rename.id,
                  name: rename.name.trim(),
                })
              }
            >
              Save
            </Button>
          </>
        }
      >
        <input
          className={fieldClass}
          value={rename?.name ?? ''}
          onChange={(e) =>
            setRename((cur) => (cur ? { ...cur, name: e.target.value } : cur))
          }
        />
      </Modal>

      <Modal
        open={bulkOpen}
        title={`Edit ${selectedIds.length} cases`}
        onClose={() => setBulkOpen(false)}
        footer={
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setBulkOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={bulkMutation.isPending}
              onClick={() => {
                const body: Record<string, unknown> = { ids: selectedIds };
                if (bulkStatus) body.status = bulkStatus;
                if (bulkPriority) body.priorityLabel = bulkPriority;
                if (moveTo) body.folderId = moveTo;
                bulkMutation.mutate(body);
              }}
            >
              {bulkMutation.isPending ? 'Saving…' : 'Apply'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block space-y-1 text-xs text-muted">
            Status (leave blank to keep)
            <select
              className={fieldClass}
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
            >
              <option value="">—</option>
              <option value="DRAFT">Draft</option>
              <option value="APPROVED">Approved</option>
              <option value="READY">Ready</option>
            </select>
          </label>
          <label className="block space-y-1 text-xs text-muted">
            Priority (leave blank to keep)
            <select
              className={fieldClass}
              value={bulkPriority}
              onChange={(e) => setBulkPriority(e.target.value)}
            >
              <option value="">—</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </label>
          <label className="block space-y-1 text-xs text-muted">
            Move to folder
            <select
              className={fieldClass}
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
            >
              <option value="">—</option>
              {folderOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteFolder)}
        title={`Delete folder “${deleteFolder?.name ?? ''}”?`}
        danger
        busy={deleteFolderMutation.isPending}
        confirmLabel="Delete"
        onCancel={() => {
          setDeleteFolder(null);
          setDeleteFolderCases(false);
        }}
        onConfirm={() => deleteFolderMutation.mutate()}
      >
        <label className="mt-2 flex items-start gap-2 text-sm text-fg">
          <input
            type="checkbox"
            className="mt-1"
            checked={deleteFolderCases}
            onChange={(e) => setDeleteFolderCases(e.target.checked)}
          />
          Also archive test cases in this folder. Otherwise they move to the
          parent (or Ungrouped).
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(archiveIds?.length)}
        title="Archive test cases?"
        danger
        busy={archiveMutation.isPending}
        confirmLabel="Archive"
        onCancel={() => setArchiveIds(null)}
        onConfirm={() => {
          if (archiveIds?.length) archiveMutation.mutate(archiveIds);
        }}
      >
        They leave the live list and can be restored from Archived.
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(purgeIds?.length)}
        title="Delete test cases permanently?"
        danger
        busy={purgeMutation.isPending}
        confirmLabel="Delete forever"
        onCancel={() => setPurgeIds(null)}
        onConfirm={() => {
          if (purgeIds?.length) purgeMutation.mutate(purgeIds);
        }}
      >
        This cannot be undone.
      </ConfirmDialog>
    </>
  );
}
