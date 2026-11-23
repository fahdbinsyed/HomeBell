'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import {
  noteCategoryValues,
  refundStatusValues,
  type NoteCategory,
  type RefundStatus,
  type SupportNote,
} from '@homebell/contracts';
import { formatDateTime, labels } from '@homebell/copy';
import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  LoadMore,
  LoadingState,
  Select,
  Textarea,
  useToast,
} from '@homebell/ui-web';
import { messageFor, useApi, usePagedList } from '@homebell/web-core';
import { useCan } from '@/lib/use-platform';

export default function NotesPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [filter, setFilter] = useState<NoteCategory | ''>('');
  const notes = usePagedList<SupportNote>(
    ['platform', 'tenant', tenantId, 'notes', filter],
    (cursor) =>
      unwrap(
        client.GET('/v1/platform/tenants/{tenantId}/notes', {
          params: { path: { tenantId }, query: { cursor, category: filter || undefined } },
        }),
      ),
  );
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<NoteCategory>('general');
  const [refundStatus, setRefundStatus] = useState<RefundStatus>('none');
  const [pinned, setPinned] = useState(false);
  const add = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/platform/tenants/{tenantId}/notes', {
          params: { path: { tenantId } },
          body: {
            body: body.trim(),
            category,
            refundStatus: category === 'refund' ? refundStatus : undefined,
            pinned,
          },
        }),
      ),
    onSuccess: () => {
      setBody('');
      setPinned(false);
      void qc.invalidateQueries({ queryKey: ['platform', 'tenant', tenantId, 'notes'] });
      toast('Note added');
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Internal notes</h2>
          <Select
            aria-label="Filter notes"
            className="w-48"
            value={filter}
            onChange={(e) => setFilter(e.target.value as NoteCategory | '')}
            placeholder="All categories"
            options={noteCategoryValues.map((c) => ({ value: c, label: labels.noteCategory[c] }))}
          />
        </div>
        {notes.isPending ? (
          <LoadingState />
        ) : notes.error ? (
          <ErrorState message={messageFor(notes.error)} onRetry={() => notes.refetch()} />
        ) : notes.items?.length === 0 ? (
          <EmptyState
            title="No notes yet"
            description="Notes are visible to platform staff only and can't be edited or deleted."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {notes.items?.map((n) => (
              <li key={n.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  <Badge
                    tone={
                      n.category === 'refund'
                        ? 'warning'
                        : n.category === 'security'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {labels.noteCategory[n.category]}
                  </Badge>
                  {n.pinned && <Badge tone="brand">Pinned</Badge>}
                  {n.refundStatus !== 'none' && (
                    <Badge tone="warning">{labels.refundStatus[n.refundStatus]}</Badge>
                  )}
                  <span>
                    {n.author.displayName} · {formatDateTime(n.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
        <LoadMore
          hasMore={!!notes.hasNextPage}
          loading={notes.isFetchingNextPage}
          onClick={() => notes.fetchNextPage()}
        />
      </div>
      {can('platform.notes.write') && (
        <Card title="Add note" description="Append-only and audited.">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            {add.error && <Banner tone="danger">{messageFor(add.error)}</Banner>}
            <Field label="Category">
              {(p) => (
                <Select
                  {...p}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as NoteCategory)}
                  options={noteCategoryValues.map((c) => ({
                    value: c,
                    label: labels.noteCategory[c],
                  }))}
                />
              )}
            </Field>
            {category === 'refund' && (
              <>
                <Banner tone="info">
                  HomeBell does not process refunds. Use this to record what the business team did
                  outside the app.
                </Banner>
                <Field label="Refund status">
                  {(p) => (
                    <Select
                      {...p}
                      value={refundStatus}
                      onChange={(e) => setRefundStatus(e.target.value as RefundStatus)}
                      options={refundStatusValues.map((r) => ({
                        value: r,
                        label: labels.refundStatus[r],
                      }))}
                    />
                  )}
                </Field>
              </>
            )}
            <Field label="Note" required>
              {(p) => (
                <Textarea {...p} rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
              )}
            </Field>
            <Checkbox
              label="Pin to top"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
            />
            <Button type="submit" loading={add.isPending} disabled={!body.trim()}>
              Add note
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
