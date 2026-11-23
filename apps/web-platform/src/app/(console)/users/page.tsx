'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { platformRoleValues, type PlatformRole, type PlatformUser } from '@homebell/contracts';
import { formatRelative, labels } from '@homebell/copy';
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  Input,
  PageHeader,
  useToast,
} from '@homebell/ui-web';
import { messageFor, useApi, useMe, usePagedList } from '@homebell/web-core';
import { useCan } from '@/lib/use-platform';

function RolePicker({
  value,
  onChange,
}: {
  value: PlatformRole[];
  onChange: (r: PlatformRole[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Roles</legend>
      {platformRoleValues.map((r) => (
        <Checkbox
          key={r}
          label={labels.platformRole[r]}
          checked={value.includes(r)}
          onChange={(e) =>
            onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))
          }
        />
      ))}
    </fieldset>
  );
}

export default function PlatformUsersPage() {
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const me = useMe();
  const list = usePagedList<PlatformUser>(
    ['platform', 'users'],
    (cursor) => unwrap(client.GET('/v1/platform/users', { params: { query: { cursor } } })),
    can('platform.users.manage'),
  );
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roles, setRoles] = useState<PlatformRole[]>(['platform.support_analyst']);
  const [editing, setEditing] = useState<PlatformUser | null>(null);
  const [editRoles, setEditRoles] = useState<PlatformRole[]>([]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform', 'users'] });
  const invite = useMutation({
    mutationFn: () =>
      unwrap(client.POST('/v1/platform/user-invitations', { body: { email, fullName, roles } })),
    onSuccess: () => {
      setInviting(false);
      setEmail('');
      setFullName('');
      void refresh();
      toast('Invitation sent — two-step verification is set up at first sign-in');
    },
  });
  const update = useMutation({
    mutationFn: (body: { roles?: PlatformRole[]; status?: 'active' | 'deactivated' }) =>
      unwrap(
        client.PATCH('/v1/platform/users/{userId}', {
          params: { path: { userId: editing!.userId } },
          body,
        }),
      ),
    onSuccess: () => {
      setEditing(null);
      void refresh();
      toast('User updated');
    },
  });
  if (!can('platform.users.manage'))
    return <ErrorState title="Not available" message="Only super admins manage platform users." />;
  return (
    <>
      <PageHeader
        title="Platform users"
        description="HomeBell operators. Two-step verification is mandatory."
        actions={<Button onClick={() => setInviting(true)}>Invite user</Button>}
      />
      <DataTable
        caption="Platform users"
        rows={list.items}
        loading={list.isPending}
        error={list.error ? messageFor(list.error) : null}
        rowKey={(u) => u.userId}
        columns={[
          {
            key: 'n',
            header: 'Name',
            cell: (u) => (
              <div>
                <p className="font-medium">{u.fullName}</p>
                <p className="text-xs text-text-muted">{u.email}</p>
              </div>
            ),
          },
          {
            key: 'r',
            header: 'Roles',
            cell: (u) => (
              <span className="flex flex-wrap gap-1">
                {u.roles.map((r) => (
                  <Badge key={r} tone="brand">
                    {labels.platformRole[r]}
                  </Badge>
                ))}
              </span>
            ),
          },
          {
            key: 's',
            header: 'Status',
            cell: (u) => (
              <Badge
                tone={
                  u.status === 'active' ? 'success' : u.status === 'invited' ? 'info' : 'neutral'
                }
              >
                {u.status}
              </Badge>
            ),
          },
          {
            key: 'm',
            header: 'MFA',
            cell: (u) =>
              u.mfaEnabled ? (
                <Badge tone="success">On</Badge>
              ) : (
                <Badge tone="warning">Pending</Badge>
              ),
            hideOnMobile: true,
          },
          {
            key: 'l',
            header: 'Last sign-in',
            cell: (u) => formatRelative(u.lastLoginAt),
            hideOnMobile: true,
          },
          {
            key: 'a',
            header: <span className="sr-only">Actions</span>,
            cell: (u) =>
              u.userId !== me.data?.userId && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(u);
                    setEditRoles(u.roles);
                  }}
                >
                  Manage
                </Button>
              ),
          },
        ]}
      />
      <Dialog
        open={inviting}
        onClose={() => setInviting(false)}
        title="Invite platform user"
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviting(false)}>
              Cancel
            </Button>
            <Button
              loading={invite.isPending}
              disabled={!/\S+@\S+\.\S+/.test(email) || !fullName.trim() || roles.length === 0}
              onClick={() => invite.mutate()}
            >
              Send invitation
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {invite.error && <Banner tone="danger">{messageFor(invite.error)}</Banner>}
          <Field label="Full name" required>
            {(p) => <Input {...p} value={fullName} onChange={(e) => setFullName(e.target.value)} />}
          </Field>
          <Field label="Email" required>
            {(p) => (
              <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
          </Field>
          <RolePicker value={roles} onChange={setRoles} />
        </div>
      </Dialog>
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Manage ${editing?.fullName ?? ''}`}
        footer={
          <>
            {editing?.status === 'active' ? (
              <Button variant="danger" onClick={() => update.mutate({ status: 'deactivated' })}>
                Deactivate
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => update.mutate({ status: 'active' })}>
                Reactivate
              </Button>
            )}
            <Button
              loading={update.isPending}
              disabled={editRoles.length === 0}
              onClick={() => update.mutate({ roles: editRoles })}
            >
              Save roles
            </Button>
          </>
        }
      >
        {update.error && (
          <div className="mb-3">
            <Banner tone="danger">{messageFor(update.error)}</Banner>
          </div>
        )}
        <RolePicker value={editRoles} onChange={setEditRoles} />
      </Dialog>
    </>
  );
}
