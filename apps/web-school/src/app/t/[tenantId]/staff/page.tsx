'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { schoolRoleValues, type SchoolRole, type StaffMember } from '@homebell/contracts';
import { formatDate, formatRelative, labels } from '@homebell/copy';
import {
  Badge,
  Banner,
  Button,
  Card,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  StateBadge,
  useToast,
} from '@homebell/ui-web';
import { messageFor, useApi } from '@homebell/web-core';
import { schoolKey, useSchool } from '@/lib/school';

const ROLE_HELP: Record<SchoolRole, string> = {
  'school.admin': 'Everything: students, guardians, staff, settings, reports.',
  'school.dispatcher': 'Runs the live queue; can view students and guardians.',
  'school.front_desk': 'Live queue and student lookup.',
  'school.reporting': 'Reports and audit log only.',
};

export default function StaffPage() {
  const { tenantId, canWrite, me } = useSchool();
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const key = schoolKey(tenantId, 'staff');
  const staff = useQuery({
    queryKey: key,
    queryFn: () => unwrap(client.GET('/v1/t/{tenantId}/staff', { params: { path: { tenantId } } })),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<SchoolRole>('school.front_desk');
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [editRole, setEditRole] = useState<SchoolRole>('school.front_desk');
  const invite = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/t/{tenantId}/staff-invitations', {
          params: { path: { tenantId } },
          body: { email: email.trim(), fullName: fullName.trim(), role },
        }),
      ),
    onSuccess: () => {
      setInviteOpen(false);
      setEmail('');
      setFullName('');
      void refresh();
      toast('Invitation sent');
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      client.DELETE('/v1/t/{tenantId}/staff-invitations/{invitationId}', {
        params: { path: { tenantId, invitationId: id } },
      }),
    onSuccess: () => {
      void refresh();
      toast('Invitation revoked');
    },
  });
  const update = useMutation({
    mutationFn: async (op: 'role' | 'deactivate' | 'reactivate') => {
      const path = { tenantId, membershipId: editing!.membershipId };
      if (op === 'role')
        return unwrap(
          client.PATCH('/v1/t/{tenantId}/staff/{membershipId}', {
            params: { path },
            body: { role: editRole },
          }),
        );
      if (op === 'deactivate')
        return unwrap(
          client.POST('/v1/t/{tenantId}/staff/{membershipId}/deactivate', { params: { path } }),
        );
      return unwrap(
        client.POST('/v1/t/{tenantId}/staff/{membershipId}/reactivate', { params: { path } }),
      );
    },
    onSuccess: () => {
      setEditing(null);
      void refresh();
      toast('Staff member updated');
    },
  });
  return (
    <>
      <PageHeader
        title="Staff & roles"
        description="Invite staff by email and give each person the smallest role they need."
        actions={canWrite && <Button onClick={() => setInviteOpen(true)}>Invite staff</Button>}
      />
      <div className="flex flex-col gap-6">
        <DataTable
          caption="Staff"
          rows={staff.data?.members}
          loading={staff.isPending}
          error={staff.error ? messageFor(staff.error) : null}
          rowKey={(m) => m.membershipId}
          columns={[
            {
              key: 'n',
              header: 'Name',
              cell: (m) => (
                <div>
                  <p className="font-medium">
                    {m.fullName}
                    {m.userId === me.userId && (
                      <span className="ml-2 text-xs text-text-muted">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-text-muted">{m.email}</p>
                </div>
              ),
            },
            { key: 'r', header: 'Role', cell: (m) => labels.schoolRole[m.role] },
            {
              key: 's',
              header: 'Status',
              cell: (m) => (
                <StateBadge
                  group="membership"
                  value={m.status}
                  label={m.status === 'active' ? 'Active' : 'Deactivated'}
                />
              ),
            },
            {
              key: 'm',
              header: '2-step',
              cell: (m) => (m.mfaEnabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>),
              hideOnMobile: true,
            },
            {
              key: 'l',
              header: 'Last sign-in',
              cell: (m) => formatRelative(m.lastLoginAt),
              hideOnMobile: true,
            },
            {
              key: 'a',
              header: <span className="sr-only">Actions</span>,
              cell: (m) =>
                canWrite &&
                m.userId !== me.userId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(m);
                      setEditRole(m.role);
                    }}
                  >
                    Manage
                  </Button>
                ),
            },
          ]}
        />
        {(staff.data?.pendingInvitations.length ?? 0) > 0 && (
          <Card title="Pending invitations" padded={false}>
            <ul className="divide-y divide-border">
              {staff.data!.pendingInvitations.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                >
                  <div>
                    <p className="font-medium">
                      {i.fullName} <span className="font-normal text-text-muted">· {i.email}</span>
                    </p>
                    <p className="text-xs text-text-muted">
                      {labels.schoolRole[i.role]} · expires {formatDate(i.expiresAt)}
                    </p>
                  </div>
                  {canWrite && (
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite staff"
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={invite.isPending}
              disabled={!/\S+@\S+\.\S+/.test(email) || !fullName.trim()}
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
          <Field label="Role" hint={ROLE_HELP[role]}>
            {(p) => (
              <Select
                {...p}
                value={role}
                onChange={(e) => setRole(e.target.value as SchoolRole)}
                options={schoolRoleValues.map((r) => ({ value: r, label: labels.schoolRole[r] }))}
              />
            )}
          </Field>
        </div>
      </Dialog>
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Manage ${editing?.fullName ?? ''}`}
        footer={
          <>
            {editing?.status === 'active' ? (
              <Button
                variant="danger"
                loading={update.isPending}
                onClick={() => update.mutate('deactivate')}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                variant="secondary"
                loading={update.isPending}
                onClick={() => update.mutate('reactivate')}
              >
                Reactivate
              </Button>
            )}
            <Button
              loading={update.isPending}
              disabled={editRole === editing?.role}
              onClick={() => update.mutate('role')}
            >
              Save role
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {update.error && <Banner tone="danger">{messageFor(update.error)}</Banner>}
          <Field label="Role" hint={ROLE_HELP[editRole]}>
            {(p) => (
              <Select
                {...p}
                value={editRole}
                onChange={(e) => setEditRole(e.target.value as SchoolRole)}
                options={schoolRoleValues.map((r) => ({ value: r, label: labels.schoolRole[r] }))}
              />
            )}
          </Field>
        </div>
      </Dialog>
    </>
  );
}
