'use client';

import Link from 'next/link';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ActionMenu, type ActionMenuItem } from '@/components/ActionMenu';
import { cn } from '@/lib/cn';

export const LISTING_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_LISTING_PAGE_SIZE = 25;

export const listingSearchClass =
  'h-8 max-w-[14rem] rounded-lg border border-border bg-bg-elevated px-2 text-sm outline-none focus:border-accent/60';

export const listingFilterClass =
  'h-8 w-auto rounded-lg border border-border bg-bg-elevated px-2 text-sm outline-none focus:border-accent/60';

export function useListingSlice<T>(
  rows: T[],
  opts: {
    query: string;
    searchText: (row: T) => string;
    resetKey?: string;
    pageSize?: number;
  },
) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(
    opts.pageSize ?? DEFAULT_LISTING_PAGE_SIZE,
  );

  const filtered = useMemo(() => {
    const q = opts.query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      opts.searchText(row).toLowerCase().includes(q),
    );
  }, [rows, opts.query, opts.searchText]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

  useEffect(() => {
    setPage(1);
  }, [opts.query, opts.resetKey, pageSize]);

  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  return {
    filtered,
    pageRows,
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    total,
    totalPages,
    from: total ? start + 1 : 0,
    to: Math.min(start + pageSize, total),
  };
}

export function ListingPager({
  page,
  totalPages,
  from,
  to,
  total,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  totalPages: number;
  from: number;
  to: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  if (!total) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          Per page
          <select
            className="h-7 rounded-md border border-border bg-bg-elevated px-1"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {LISTING_PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Prev
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export type ListingColumn<T> = {
  id: string;
  header: string;
  className?: string;
  cell: (row: T) => ReactNode;
};

const columnListeners = new Map<string, Set<(hidden: string[]) => void>>();

function listingColsKey(columnKey: string) {
  return `listing-cols:${columnKey}`;
}

function readHiddenColumns(columnKey: string, lockedColumnId: string) {
  try {
    const raw = sessionStorage.getItem(listingColsKey(columnKey));
    if (!raw) return [] as string[];
    const ids = JSON.parse(raw) as unknown;
    if (!Array.isArray(ids)) return [];
    return ids.filter(
      (id): id is string => typeof id === 'string' && id !== lockedColumnId,
    );
  } catch {
    return [];
  }
}

function writeHiddenColumns(columnKey: string, hidden: string[]) {
  try {
    sessionStorage.setItem(listingColsKey(columnKey), JSON.stringify(hidden));
  } catch {
    /* private mode */
  }
  columnListeners.get(columnKey)?.forEach((fn) => fn(hidden));
}

export function useListingColumns(
  columnKey: string | undefined,
  lockedColumnId: string | undefined,
) {
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    if (!columnKey || !lockedColumnId) {
      setHidden([]);
      return;
    }
    setHidden(readHiddenColumns(columnKey, lockedColumnId));
    const onChange = (next: string[]) => setHidden(next);
    let set = columnListeners.get(columnKey);
    if (!set) {
      set = new Set();
      columnListeners.set(columnKey, set);
    }
    set.add(onChange);
    return () => {
      set.delete(onChange);
    };
  }, [columnKey, lockedColumnId]);

  function toggle(id: string) {
    if (!columnKey || !lockedColumnId || id === lockedColumnId) return;
    const next = hidden.includes(id)
      ? hidden.filter((h) => h !== id)
      : [...hidden, id];
    setHidden(next);
    writeHiddenColumns(columnKey, next);
  }

  return {
    hidden,
    toggle,
    enabled: Boolean(columnKey && lockedColumnId),
  };
}

function ListingColumnsMenu<T>({
  columns,
  lockedColumnId,
  hidden,
  onToggle,
}: {
  columns: ListingColumn<T>[];
  lockedColumnId: string;
  hidden: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative mb-2 flex justify-end">
      <button
        type="button"
        aria-label="Columns"
        aria-expanded={open}
        className="h-8 rounded-lg border border-border bg-bg-elevated px-2 text-xs text-muted hover:text-fg"
        onClick={() => setOpen((v) => !v)}
      >
        Columns
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-9 z-40 min-w-[12rem] rounded-lg border border-border bg-bg py-1 shadow-lg"
        >
          {columns.map((col) => {
            const locked = col.id === lockedColumnId;
            const checked = locked || !hidden.includes(col.id);
            return (
              <label
                key={col.id}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 text-sm',
                  locked ? 'text-muted' : 'hover:bg-bg-elevated',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked}
                  aria-label={
                    locked ? `${col.header} (Always shown)` : col.header
                  }
                  onChange={() => onToggle(col.id)}
                />
                <span>
                  {col.header}
                  {locked ? (
                    <span className="ml-1 text-[11px] text-muted">
                      Always shown
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ListingEmpty({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center">
      <p className="text-sm text-muted">{children}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ListingLink({
  href,
  onClick,
  children,
  className,
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  const styles = cn('text-left text-accent hover:underline', className);
  if (href) {
    return (
      <Link href={href} className={styles} onClick={(e) => e.stopPropagation()}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={styles}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

export function ListingTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  empty,
  selectable,
  selected,
  onToggle,
  onToggleAll,
  actions,
  onRowClick,
  columnKey,
  lockedColumnId,
}: {
  columns: ListingColumn<T>[];
  rows: T[];
  loading?: boolean;
  empty?: ReactNode;
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: (checked: boolean) => void;
  actions?: (row: T) => ActionMenuItem[];
  onRowClick?: (row: T) => void;
  columnKey?: string;
  lockedColumnId?: string;
}) {
  const { hidden, toggle, enabled } = useListingColumns(
    columnKey,
    lockedColumnId,
  );
  const visibleColumns = useMemo(
    () =>
      columns.filter(
        (col) => col.id === lockedColumnId || !hidden.includes(col.id),
      ),
    [columns, hidden, lockedColumnId],
  );
  const allSelected =
    selectable &&
    rows.length > 0 &&
    rows.every((row) => selected?.has(row.id));
  const showActions = Boolean(actions);
  const menu =
    enabled && lockedColumnId ? (
      <ListingColumnsMenu
        columns={columns}
        lockedColumnId={lockedColumnId}
        hidden={hidden}
        onToggle={toggle}
      />
    ) : null;

  if (loading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }
  if (!rows.length) {
    return <>{empty ?? <ListingEmpty>Nothing here yet.</ListingEmpty>}</>;
  }

  return (
    <div>
      {menu}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-muted">
            <tr>
              {selectable ? (
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    checked={Boolean(allSelected)}
                    onChange={(e) => onToggleAll?.(e.target.checked)}
                    aria-label="Select all"
                  />
                </th>
              ) : null}
              {visibleColumns.map((col) => (
                <th
                  key={col.id}
                  className={cn('px-2 py-2 font-medium', col.className)}
                >
                  {col.header}
                </th>
              ))}
              {showActions ? (
                <th className="w-16 px-2 py-2 font-medium">Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const items = actions?.(row) ?? [];
              return (
                <tr
                  key={row.id}
                  className={cn(
                    'border-t border-border hover:bg-panel/40',
                    onRowClick && 'cursor-pointer',
                  )}
                  onClick={() => onRowClick?.(row)}
                >
                  {selectable ? (
                    <td
                      className="px-2 py-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(selected?.has(row.id))}
                        onChange={() => onToggle?.(row.id)}
                        aria-label="Select row"
                      />
                    </td>
                  ) : null}
                  {visibleColumns.map((col) => (
                    <td
                      key={col.id}
                      className={cn('px-2 py-2', col.className)}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                  {showActions ? (
                    <td
                      className="px-2 py-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {items.length ? <ActionMenu items={items} /> : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
