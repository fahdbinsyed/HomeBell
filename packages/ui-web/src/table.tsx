'use client';
import type { ReactNode } from 'react';
import { EmptyState, ErrorState, LoadingState } from './feedback';
import { Button } from './primitives';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hide on small screens. */
  hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: { title: string; description?: ReactNode; action?: ReactNode };
  onRowClick?: (row: T) => void;
  caption?: string;
  footer?: ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
  onRowClick,
  caption,
  footer,
}: DataTableProps<T>) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (loading && !rows) return <LoadingState rows={5} />;
  if (rows && rows.length === 0 && empty) return <EmptyState {...empty} />;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-surface-muted text-xs uppercase tracking-wide text-text-muted">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={[
                    'px-4 py-3 font-medium',
                    c.hideOnMobile ? 'hidden md:table-cell' : '',
                    c.className ?? '',
                  ].join(' ')}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(rows ?? []).map((r) => (
              <tr
                key={rowKey(r)}
                className={
                  onRowClick
                    ? 'cursor-pointer hover:bg-surface-muted focus-within:bg-surface-muted'
                    : ''
                }
                onClick={onRowClick ? () => onRowClick(r) : undefined}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={[
                      'px-4 py-3 align-middle',
                      c.hideOnMobile ? 'hidden md:table-cell' : '',
                      c.className ?? '',
                    ].join(' ')}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && <div className="border-t border-border px-4 py-3">{footer}</div>}
    </div>
  );
}

export function LoadMore({
  hasMore,
  loading,
  onClick,
  shown,
  total,
}: {
  hasMore: boolean;
  loading?: boolean;
  onClick: () => void;
  shown?: number;
  total?: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm text-text-muted">
      <span>{shown !== undefined ? `Showing ${shown}${total ? ` of ${total}` : ''}` : ''}</span>
      {hasMore && (
        <Button variant="secondary" size="sm" loading={loading} onClick={onClick}>
          Load more
        </Button>
      )}
    </div>
  );
}
