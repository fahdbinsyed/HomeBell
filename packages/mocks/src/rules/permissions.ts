/** SIMULATION of the role → permission bundles (03-identity-auth-otp-devices.md §5). */
import type { Permission, PlatformRole, SchoolRole } from '@homebell/contracts';

const SCHOOL: Record<SchoolRole, Permission[]> = {
  'school.admin': [
    'school.settings.read',
    'school.settings.write',
    'school.staff.manage',
    'school.students.read',
    'school.students.write',
    'school.imports.write',
    'school.guardians.read',
    'school.guardians.write',
    'school.guardians.block',
    'school.devices.override',
    'school.displays.manage',
    'school.queue.read',
    'school.queue.dispatch',
    'school.queue.resolve',
    'school.reports.read',
    'school.reports.export',
    'school.audit.read',
    'school.subscription.read',
  ],
  'school.dispatcher': [
    'school.queue.read',
    'school.queue.dispatch',
    'school.queue.resolve',
    'school.students.read',
    'school.guardians.read',
  ],
  'school.front_desk': ['school.queue.read', 'school.queue.dispatch', 'school.students.read'],
  'school.reporting': [
    'school.reports.read',
    'school.reports.export',
    'school.audit.read',
    'school.queue.read',
  ],
};

const PLATFORM: Record<PlatformRole, Permission[]> = {
  'platform.super_admin': [
    'platform.tenants.read',
    'platform.tenants.write',
    'platform.lifecycle.write',
    'platform.plans.read',
    'platform.plans.write',
    'platform.subscriptions.write',
    'platform.overrides.write',
    'platform.flags.write',
    'platform.notes.read',
    'platform.notes.write',
    'platform.audit.read',
    'platform.users.manage',
    'platform.support_sessions.create',
    'platform.devices.override',
  ],
  'platform.ops_admin': [
    'platform.tenants.read',
    'platform.tenants.write',
    'platform.lifecycle.write',
    'platform.plans.read',
    'platform.notes.read',
    'platform.notes.write',
    'platform.audit.read',
    'platform.support_sessions.create',
    'platform.devices.override',
  ],
  'platform.billing_ops': [
    'platform.tenants.read',
    'platform.plans.read',
    'platform.plans.write',
    'platform.subscriptions.write',
    'platform.overrides.write',
    'platform.notes.read',
    'platform.notes.write',
  ],
  'platform.support_analyst': [
    'platform.tenants.read',
    'platform.plans.read',
    'platform.notes.read',
    'platform.audit.read',
    'platform.support_sessions.create',
  ],
};

export const permissionsForSchoolRole = (role: SchoolRole): Permission[] => [...SCHOOL[role]];
export const permissionsForPlatformRoles = (roles: PlatformRole[]): Permission[] => [
  ...new Set(roles.flatMap((r) => PLATFORM[r])),
];
