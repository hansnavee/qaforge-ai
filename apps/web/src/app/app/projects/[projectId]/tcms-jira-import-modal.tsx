'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { parsePlanLimitError } from '@/lib/plan';
import { getDefaultOrgId } from '@/lib/org';
import { usePlan } from '@/lib/use-plan';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { ProFeatureNotice, UpgradeModal } from '@/components/UpgradeModal';
import { areaClass, fieldClass } from './tcms-board';

type JiraTicket = {
  key: string;
  id: string;
  summary: string;
  description: string;
  issueType: string;
  status: string;
  parentKey: string | null;
  epicKey: string | null;
  url: string;
  isBug: boolean;
  selectable: boolean;
};

type ListResponse = {
  projectKey: string;
  mode: string;
  tickets: JiraTicket[];
};

type ImportResponse = {
  created: number;
  updated: number;
  relations: number;
  skippedBugs: string[];
};

type Tab = 'BROWSE' | 'PROMPT' | 'KEYS' | 'EPIC';

export function TcmsJiraImportModal({
  open,
  projectId,
  onClose,
  onImported,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const { canJira } = usePlan();
  const [tab, setTab] = useState<Tab>('BROWSE');
  const [prompt, setPrompt] = useState('');
  const [keysText, setKeysText] = useState('');
  const [epicKey, setEpicKey] = useState('');
  const [filter, setFilter] = useState('');
  const [tickets, setTickets] = useState<JiraTicket[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [upgradeError, setUpgradeError] = useState<ReturnType<
    typeof parsePlanLimitError
  >>(null);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter(
      (t) =>
        t.key.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        t.issueType.toLowerCase().includes(q),
    );
  }, [tickets, filter]);

  const selectableVisible = visible.filter((t) => t.selectable);
  const selectedCount = [...selected].filter((k) =>
    tickets.some((t) => t.key === k && t.selectable),
  ).length;

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    if (tab === 'BROWSE' && canJira) {
      void loadTickets({ mode: 'BROWSE' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, canJira]);

  async function loadTickets(body: {
    mode: Tab;
    prompt?: string;
    keys?: string[];
    epicKey?: string;
  }) {
    if (!canJira) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const orgId = await getDefaultOrgId();
      const data = await api<ListResponse>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/integrations/jira/tickets`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      setProjectKey(data.projectKey);
      setTickets(data.tickets ?? []);
      const next = new Set<string>();
      for (const t of data.tickets ?? []) {
        if (
          t.selectable &&
          (body.mode === 'KEYS' || body.mode === 'EPIC' || body.mode === 'BROWSE')
        ) {
          if (body.mode === 'BROWSE') {
            /* leave unchecked for browse */
          } else {
            next.add(t.key);
          }
        }
      }
      setSelected(next);
    } catch (err) {
      const planErr =
        err instanceof ApiError ? parsePlanLimitError(err.body) : null;
      if (planErr) {
        setUpgradeError(planErr);
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not load Jira tickets',
      );
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }

  async function runSearch() {
    if (tab === 'PROMPT') {
      await loadTickets({ mode: 'PROMPT', prompt: prompt.trim() });
      return;
    }
    if (tab === 'KEYS') {
      const keys = keysText
        .split(/[\s,;]+/)
        .map((k) => k.trim())
        .filter(Boolean);
      await loadTickets({ mode: 'KEYS', keys });
      return;
    }
    if (tab === 'EPIC') {
      await loadTickets({ mode: 'EPIC', epicKey: epicKey.trim() });
    }
  }

  function toggle(key: string, selectable: boolean) {
    if (!selectable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of selectableVisible) next.add(t.key);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function importSelected() {
    const keys = [...selected].filter((k) =>
      tickets.some((t) => t.key === k && t.selectable),
    );
    if (!keys.length) {
      setError('Select at least one ticket to import.');
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const orgId = await getDefaultOrgId();
      const data = await api<ImportResponse>(
        `/api/v1/orgs/${orgId}/projects/${projectId}/integrations/jira/import-requirements`,
        { method: 'POST', body: JSON.stringify({ keys }) },
      );
      setResult(data);
      onImported();
    } catch (err) {
      const planErr =
        err instanceof ApiError ? parsePlanLimitError(err.body) : null;
      if (planErr) {
        setUpgradeError(planErr);
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Import failed',
      );
    } finally {
      setImporting(false);
    }
  }

  function close() {
    if (loading || importing) return;
    onClose();
  }

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title="Import from Jira"
        wide
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={close}
              disabled={loading || importing}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={() => void importSelected()}
              disabled={
                !canJira || importing || loading || selectedCount === 0
              }
            >
              {importing
                ? 'Importing…'
                : `Import selected (${selectedCount})`}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted">
            Fetch tickets from the connected Jira project, tick the ones for
            this QA cycle, then import into TCMS. AI QA Engineer can then run
            on those requirements.
            {projectKey ? (
              <span className="ml-1 font-mono">Project: {projectKey}</span>
            ) : null}
          </p>

          {!canJira ? (
            <ProFeatureNotice feature="Jira import" planName="Enterprise">
              Connect Jira in Settings after upgrading.
            </ProFeatureNotice>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {(
              [
                ['BROWSE', 'Browse'],
                ['PROMPT', 'Prompt'],
                ['KEYS', 'Keys'],
                ['EPIC', 'Epic'],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={tab === id ? 'primary' : 'secondary'}
                disabled={!canJira || loading}
                onClick={() => setTab(id)}
              >
                {label}
              </Button>
            ))}
          </div>

          {tab === 'PROMPT' ? (
            <div className="flex gap-2">
              <input
                className={`${fieldClass} flex-1`}
                placeholder="e.g. login and checkout for sprint 24"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={!canJira || loading}
              />
              <Button
                type="button"
                size="sm"
                disabled={!canJira || loading || !prompt.trim()}
                onClick={() => void runSearch()}
              >
                Search
              </Button>
            </div>
          ) : null}

          {tab === 'KEYS' ? (
            <div className="space-y-2">
              <textarea
                className={`${areaClass} min-h-[72px]`}
                placeholder="QA-12, QA-15"
                value={keysText}
                onChange={(e) => setKeysText(e.target.value)}
                disabled={!canJira || loading}
              />
              <Button
                type="button"
                size="sm"
                disabled={!canJira || loading || !keysText.trim()}
                onClick={() => void runSearch()}
              >
                Load keys
              </Button>
            </div>
          ) : null}

          {tab === 'EPIC' ? (
            <div className="flex gap-2">
              <input
                className={`${fieldClass} flex-1`}
                placeholder="Epic key e.g. QA-1"
                value={epicKey}
                onChange={(e) => setEpicKey(e.target.value)}
                disabled={!canJira || loading}
              />
              <Button
                type="button"
                size="sm"
                disabled={!canJira || loading || !epicKey.trim()}
                onClick={() => void runSearch()}
              >
                Expand
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${fieldClass} max-w-xs`}
              placeholder="Filter list"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={selectAllVisible}
              disabled={!selectableVisible.length}
            >
              Select all visible
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={clearSelection}
              disabled={!selected.size}
            >
              Clear
            </Button>
            {tab === 'BROWSE' ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!canJira || loading}
                onClick={() => void loadTickets({ mode: 'BROWSE' })}
              >
                Refresh
              </Button>
            ) : null}
          </div>

          {loading ? (
            <p className="text-xs text-muted">Loading tickets…</p>
          ) : (
            <div className="max-h-72 overflow-auto rounded-md border border-border">
              {visible.length === 0 ? (
                <p className="p-3 text-xs text-muted">No tickets to show.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {visible.map((t) => (
                    <li key={t.key} className="flex gap-2 px-3 py-2 text-xs">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={selected.has(t.key)}
                        disabled={!t.selectable}
                        onChange={() => toggle(t.key, t.selectable)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          <span className="font-mono">{t.key}</span>
                          <span className="text-muted"> · {t.issueType}</span>
                          {t.isBug ? (
                            <span className="text-muted">
                              {' '}
                              (bug — use defect sync)
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-muted">{t.summary}</div>
                        {(t.parentKey || t.epicKey) && (
                          <div className="text-muted">
                            {t.parentKey ? `parent ${t.parentKey}` : ''}
                            {t.parentKey && t.epicKey ? ' · ' : ''}
                            {t.epicKey && t.epicKey !== t.key
                              ? `epic ${t.epicKey}`
                              : ''}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error ? <p className="text-xs text-danger">{error}</p> : null}
          {result ? (
            <p className="text-xs text-success">
              Imported: {result.created} created, {result.updated} updated
              {result.relations ? `, ${result.relations} links` : ''}.
              {result.skippedBugs?.length
                ? ` Skipped bugs: ${result.skippedBugs.join(', ')}.`
                : ''}{' '}
              Open AI QA Engineer next with project requirements included.
            </p>
          ) : null}
        </div>
      </Modal>
      <UpgradeModal
        open={Boolean(upgradeError)}
        error={upgradeError}
        onClose={() => setUpgradeError(null)}
      />
    </>
  );
}
