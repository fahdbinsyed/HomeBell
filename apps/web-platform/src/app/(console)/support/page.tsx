'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import type { SupportSession } from '@homebell/contracts';
import { formatDateTime } from '@homebell/copy';
import {
  Badge,
  Button,
  DataTable,
  LoadMore,
  PageHeader,
  useLink,
  useToast,
} from '@homebell/ui-web';
import { messageFor, useApi, usePagedList } from '@homebell/web-core';

export default function SupportSessionsPage() {
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const Link = useLink();
  const list = usePagedList<SupportSession>(['platform', 'support-sessions'], (cursor) =>
    unwrap(client.GET('/v1/platform/support-sessions', { params: { query: { cursor } } })),
  );
  const end = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        client.POST('/v1/platform/support-sessions/{sessionId}/end', {
          params: { path: { sessionId: id } },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform', 'support-sessions'] });
      toast('Support session ended');
    },
  });
  const now = new Date().toISOString();
  return (
    <>
      <PageHeader
        title="Support sessions"
        description="Read-only, time-boxed access to a school's dashboard. Start one from a school's page with a reason; each session is audited for the school."
      />
      <DataTable
        caption="Support sessions"
        rows={list.items}
        loading={list.isPending}
        error={list.error ? messageFor(list.error) : null}
        rowKey={(s) => s.id}
        empty={{
          title: 'No support sessions yet',
          description: 'Open a school and choose “View as school (read-only)”.',
          action: (
            <Link href="/tenants" className="text-primary underline">
              Go to schools
            </Link>
          ),
        }}
        columns={[
          {
            key: 'school',
            header: 'School',
            cell: (s) => (
              <Link href={`/tenants/${s.tenantId}`} className="font-medium hover:underline">
                {s.tenantName}
              </Link>
            ),
          },
          { key: 'who', header: 'Operator', cell: (s) => s.platformUser.displayName },
          {
            key: 'reason',
            header: 'Reason',
            cell: (s) => <span className="line-clamp-2">{s.reason}</span>,
          },
          {
            key: 'when',
            header: 'Started',
            cell: (s) => formatDateTime(s.startedAt),
            hideOnMobile: true,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (s) =>
              s.endedAt ? (
                <Badge>Ended</Badge>
              ) : s.expiresAt < now ? (
                <Badge>Expired</Badge>
              ) : (
                <Badge tone="warning">Active until {formatDateTime(s.expiresAt)}</Badge>
              ),
          },
          {
            key: 'a',
            header: <span className="sr-only">Actions</span>,
            cell: (s) =>
              !s.endedAt &&
              s.expiresAt > now && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={end.isPending}
                  onClick={() => end.mutate(s.id)}
                >
                  End now
                </Button>
              ),
          },
        ]}
        footer={
          <LoadMore
            hasMore={!!list.hasNextPage}
            loading={list.isFetchingNextPage}
            onClick={() => list.fetchNextPage()}
          />
        }
      />
    </>
  );
}
