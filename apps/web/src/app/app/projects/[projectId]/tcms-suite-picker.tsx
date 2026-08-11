'use client';

import { useMemo, useState } from 'react';
import {
  UNGROUPED_FOLDER_KEY,
  buildTcmsTree,
  normalizeCaseStatus,
} from '@qaforge/shared';
import { cn } from '@/lib/cn';
import type { TestCaseRow, TcmsFolderRow } from './design-cases-panel';

export function TcmsSuitePicker({
  folders,
  cases,
  picked,
  onChange,
  excludeIds,
}: {
  folders: TcmsFolderRow[];
  cases: TestCaseRow[];
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
  excludeIds?: Set<string>;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const q = search.trim().toLowerCase();

  const visibleCases = useMemo(() => {
    return cases.filter((c) => {
      if (c.deletedAt) return false;
      if (excludeIds?.has(c.id)) return false;
      if (!q) return true;
      return (
        c.scenario.toLowerCase().includes(q) ||
        c.externalId.toLowerCase().includes(q) ||
        (c.folderName ?? '').toLowerCase().includes(q)
      );
    });
  }, [cases, excludeIds, q]);

  const tree = useMemo(
    () => buildTcmsTree(folders, visibleCases),
    [folders, visibleCases],
  );

  function readyIds(rows: TestCaseRow[]) {
    return rows
      .filter(
        (c) =>
          normalizeCaseStatus(c.caseStatus, c.readyForExecution) === 'READY',
      )
      .map((c) => c.id);
  }

  function toggleIds(ids: string[], on: boolean) {
    onChange(
      (() => {
        const next = new Set(picked);
        for (const id of ids) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      })(),
    );
  }

  function folderState(rows: TestCaseRow[]) {
    const ready = readyIds(rows);
    const selected = ready.filter((id) => picked.has(id)).length;
    return {
      ready,
      selected,
      all: ready.length > 0 && selected === ready.length,
      some: selected > 0 && selected < ready.length,
    };
  }

  return (
    <div className="space-y-3">
      <input
        className="h-9 w-full rounded-lg border border-border bg-bg-elevated px-2.5 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
        placeholder="Search suites or cases"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="max-h-[28rem] space-y-1 overflow-auto pr-1">
        {tree.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted">
            No suites match.
          </p>
        ) : (
          tree.map((folder) => {
            const st = folderState(folder.cases);
            const expanded =
              open.has(folder.key) || Boolean(q) || folder.key === UNGROUPED_FOLDER_KEY;
            const nested = folder.sections.some((s) => s.key);
            return (
              <div key={folder.key} className="rounded-lg border border-border/70">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <button
                    type="button"
                    className="w-5 text-xs text-muted"
                    onClick={() =>
                      setOpen((prev) => {
                        const next = new Set(prev);
                        if (next.has(folder.key)) next.delete(folder.key);
                        else next.add(folder.key);
                        return next;
                      })
                    }
                  >
                    {nested || folder.cases.length ? (expanded ? '▾' : '▸') : '·'}
                  </button>
                  <input
                    type="checkbox"
                    checked={st.all}
                    disabled={!st.ready.length}
                    ref={(el) => {
                      if (el) el.indeterminate = st.some;
                    }}
                    title={
                      st.ready.length
                        ? undefined
                        : 'This suite has no Ready cases'
                    }
                    onChange={(e) => toggleIds(st.ready, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{folder.title}</span>
                  <span className="shrink-0 text-[11px] text-muted">
                    {st.ready.length}/{folder.cases.length} Ready
                  </span>
                </div>
                {expanded ? (
                  <>
                    <CaseChecks
                      rows={
                        nested
                          ? folder.cases.filter((c) => c.folderId === folder.key)
                          : folder.cases
                      }
                      picked={picked}
                      toggleIds={toggleIds}
                    />
                    {nested
                      ? folder.sections.map((section) => {
                          const sec = folderState(section.cases);
                          return (
                            <div
                              key={section.key}
                              className="border-t border-border/60"
                            >
                              <div className="flex items-center gap-2 bg-panel/40 px-2 py-1 pl-8">
                                <input
                                  type="checkbox"
                                  checked={sec.all}
                                  disabled={!sec.ready.length}
                                  ref={(el) => {
                                    if (el) el.indeterminate = sec.some;
                                  }}
                                  title={
                                    sec.ready.length
                                      ? undefined
                                      : 'This suite has no Ready cases'
                                  }
                                  onChange={(e) =>
                                    toggleIds(sec.ready, e.target.checked)
                                  }
                                />
                                <span className="min-w-0 flex-1 truncate text-xs">
                                  {section.title}
                                </span>
                                <span className="text-[10px] text-muted">
                                  {sec.ready.length}/{section.cases.length} Ready
                                </span>
                              </div>
                              <CaseChecks
                                rows={section.cases}
                                picked={picked}
                                toggleIds={toggleIds}
                              />
                            </div>
                          );
                        })
                      : null}
                  </>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function CaseChecks({
  rows,
  picked,
  toggleIds,
}: {
  rows: TestCaseRow[];
  picked: Set<string>;
  toggleIds: (ids: string[], on: boolean) => void;
}) {
  if (!rows.length) return null;
  return (
    <ul className="pb-1">
      {rows.map((c) => {
        const ready =
          normalizeCaseStatus(c.caseStatus, c.readyForExecution) === 'READY';
        return (
          <li key={c.id}>
            <label
              className={cn(
                'flex items-center gap-2 px-2 py-1 pl-12 text-sm',
                ready
                  ? 'cursor-pointer hover:bg-panel/50'
                  : 'cursor-not-allowed opacity-50',
              )}
              title={ready ? undefined : 'Mark Ready first'}
            >
              <input
                type="checkbox"
                disabled={!ready}
                checked={picked.has(c.id)}
                onChange={(e) => toggleIds([c.id], e.target.checked)}
              />
              <span className="font-mono text-[11px] text-muted">
                {c.externalId}
              </span>
              <span className="min-w-0 flex-1 truncate">{c.scenario}</span>
              {!ready ? (
                <span className="text-[10px] uppercase text-muted">
                  {normalizeCaseStatus(c.caseStatus, c.readyForExecution)}
                </span>
              ) : null}
            </label>
          </li>
        );
      })}
    </ul>
  );
}
