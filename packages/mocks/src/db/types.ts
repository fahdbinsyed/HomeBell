/**
 * Internal records of the mock database. They mirror the server's domain model
 * (docs/architecture/10-domain-model.md) closely enough to drive every UI state,
 * and are mapped to contract DTOs in ../mappers.ts. SIMULATION ONLY — the real
 * rules live on the server (Phase 2+).
 */
import type {
  CooldownOverrideReason,
  DevicePlatform,
  DeviceState,
  DismissalEligibility,
  DisplayState,
  EntitlementKind,
  FeatureFlag,
  GuardianKind,
  GuardianState,
  ImportJob,
  ImportRow,
  InvitationState,
  LicenseSeatSource,
  LicenseSeatState,
  LicenseValidityMode,
  LifecycleReasonCode,
  MembershipState,
  NoteCategory,
  NotificationType,
  PickupActorType,
  PickupRequestState,
  PickupResolution,
  PlatformRole,
  PlanVersion,
  RefundStatus,
  Relationship,
  SchoolRole,
  SessionKind,
  SessionScope,
  StudentStatus,
  SubscriptionPlan,
  TenantContact,
  TenantLifecycleState,
  TenantSettings,
  AuditAction,
  AuditActorType,
  AuditOutcome,
  OtpPurpose,
  BillingProvider,
  PurchaseState,
} from '@homebell/contracts';

export interface ActorRecord {
  type: AuditActorType;
  id: string | null;
  displayName: string;
}

export interface TenantRecord {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  countryCode: string;
  region: string;
  timezone: string;
  termStartDate: string;
  termEndDate: string;
  state: TenantLifecycleState;
  previousOperationalState: TenantLifecycleState | null;
  expiresAt: string | null;
  dataPlacement: 'shared' | 'dedicated';
  primaryContact: TenantContact;
  settings: TenantSettings;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
}

export interface LifecycleHistoryRecord {
  id: string;
  tenantId: string;
  action: string;
  fromState: TenantLifecycleState | null;
  toState: TenantLifecycleState;
  reasonCode: LifecycleReasonCode;
  note: string | null;
  expiresAt: string | null;
  refundStatus: RefundStatus;
  actor: ActorRecord;
  at: string;
}

export interface SubscriptionRecord {
  id: string;
  tenantId: string;
  planVersionId: string;
  startsAt: string;
  endsAt: string;
  billingReference: string | null;
  createdBy: ActorRecord;
  createdAt: string;
}

export interface OverrideRecord {
  id: string;
  tenantId: string;
  kind: EntitlementKind;
  key: string;
  value: boolean | number | null;
  reasonCode: LifecycleReasonCode;
  note: string;
  expiresAt: string | null;
  createdBy: ActorRecord;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: ActorRecord | null;
  revokeNote: string | null;
}

export interface NoteRecord {
  id: string;
  tenantId: string;
  category: NoteCategory;
  body: string;
  refundStatus: RefundStatus;
  pinned: boolean;
  author: ActorRecord;
  createdAt: string;
}

export interface UserRecord {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  password: string | null;
  platformRoles: PlatformRole[];
  platformStatus: MembershipState;
  mfaEnabled: boolean;
  locale: string;
  termsVersion: string | null;
  lastLoginAt: string | null;
}

export interface MembershipRecord {
  id: string;
  userId: string;
  tenantId: string;
  role: SchoolRole;
  status: MembershipState;
}

export interface StaffInvitationRecord {
  id: string;
  tenantId: string | null;
  email: string;
  fullName: string;
  role: SchoolRole | null;
  platformRoles: PlatformRole[];
  token: string;
  expiresAt: string;
  invitedBy: ActorRecord;
  createdAt: string;
  status: 'pending' | 'accepted' | 'revoked';
}

export interface SessionRecord {
  id: string;
  userId: string;
  kind: SessionKind;
  scope: SessionScope;
  deviceId: string | null;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  supportTenantId: string | null;
  revokedAt: string | null;
}

export interface DeviceRecord {
  id: string;
  userId: string;
  platform: DevicePlatform;
  model: string;
  state: DeviceState;
  activatedAt: string;
  lastSeenAt: string | null;
}

export interface TransferRecord {
  id: string;
  userId: string;
  fromDeviceId: string | null;
  toDeviceId: string;
  at: string;
  viaOverride: boolean;
  suspicious: boolean;
}

export interface CooldownOverrideRecord {
  id: string;
  userId: string;
  tenantId: string | null;
  reasonCode: CooldownOverrideReason;
  note: string;
  grantedBy: ActorRecord;
  grantedByKind: 'school' | 'platform';
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface OtpChallengeRecord {
  id: string;
  phone: string;
  purpose: OtpPurpose;
  code: string;
  attempts: number;
  createdAt: string;
  expiresAt: string;
  lastSentAt: string;
  status: 'pending' | 'verified' | 'dead';
  invitationId: string | null;
}

export interface ClassRecord {
  id: string;
  tenantId: string;
  name: string;
  gradeLevel: string | null;
  sortOrder: number;
}

export interface SectionRecord {
  id: string;
  tenantId: string;
  classId: string;
  name: string;
}

export interface StudentRecord {
  id: string;
  tenantId: string;
  externalRef: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  classId: string;
  sectionId: string | null;
  status: StudentStatus;
  dismissalEligibility: DismissalEligibility;
  notes: string | null;
  restrictionsNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GuardianRecord {
  id: string;
  tenantId: string;
  userId: string;
  kind: GuardianKind;
  fullName: string;
  phone: string;
  state: GuardianState;
  stateReason: string | null;
  stateChangedAt: string | null;
  invitedByGuardianId: string | null;
  seatId: string | null;
  validityMode: LicenseValidityMode | null;
  validFrom: string | null;
  validUntil: string | null;
  durationDays: number | null;
  activatedAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
}

export interface LinkRecord {
  id: string;
  tenantId: string;
  guardianId: string;
  studentId: string;
  relationship: Relationship;
  isPrimary: boolean;
  removedAt: string | null;
}

export interface SeatRecord {
  id: string;
  tenantId: string;
  ownerGuardianId: string;
  source: LicenseSeatSource;
  state: LicenseSeatState;
  termEndsAt: string;
  reassignmentsUsed: number;
  assignedGuardianId: string | null;
  createdAt: string;
}

export interface InvitationRecord {
  id: string;
  tenantId: string;
  seatId: string;
  guardianId: string;
  createdByGuardianId: string;
  fullName: string;
  phone: string;
  relationship: Relationship;
  studentIds: string[];
  code: string;
  expiresAt: string;
  state: InvitationState;
  createdAt: string;
  redeemedAt: string | null;
}

export interface PurchaseIntentRecord {
  id: string;
  tenantId: string;
  guardianId: string;
  userId: string;
  provider: BillingProvider;
  productId: string;
  expiresAt: string;
  state: PurchaseState | 'open';
  seatId: string | null;
}

export interface PickupHistoryRecord {
  fromState: PickupRequestState | null;
  toState: PickupRequestState;
  actorType: PickupActorType;
  actor: ActorRecord | null;
  reason: string | null;
  at: string;
}

export interface PickupRecord {
  id: string;
  tenantId: string;
  queueDate: string;
  studentId: string;
  guardianId: string;
  state: PickupRequestState;
  seq: number;
  requestedAt: string;
  sentOutAt: string | null;
  sentOutBy: ActorRecord | null;
  acknowledgedAt: string | null;
  acknowledgedByGuardianId: string | null;
  viaSentOut: boolean | null;
  closedAt: string | null;
  exceptionAt: string | null;
  resolution: PickupResolution | null;
  reminderSentAt: string | null;
  note: string | null;
  history: PickupHistoryRecord[];
}

export interface QueueEventRecord {
  eventId: string;
  tenantId: string;
  queueDate: string;
  seq: number;
  type: 'queue.request.created' | 'queue.request.updated' | 'queue.reset';
  pickupId: string | null;
  occurredAt: string;
}

export interface DisplayRecord {
  id: string;
  tenantId: string;
  name: string;
  zone: string | null;
  state: DisplayState;
  token: string;
  pairedAt: string;
  pairedBy: ActorRecord;
  lastHeartbeatAt: string | null;
  appVersion: string | null;
}

export interface PairingSessionRecord {
  id: string;
  code: string;
  pollSecret: string;
  expiresAt: string;
  status: 'pending' | 'paired' | 'expired';
  displayId: string | null;
  tokenDelivered: boolean;
}

export interface ImportJobRecord {
  job: ImportJob;
  tenantId: string;
  rows: ImportRow[];
}

export interface NotificationRecord {
  id: string;
  userId: string;
  tenantId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>;
  createdAt: string;
  readAt: string | null;
}

export interface AuditRecord {
  id: string;
  occurredAt: string;
  tenantId: string | null;
  action: AuditAction;
  outcome: AuditOutcome;
  actor: ActorRecord;
  onBehalfOf: ActorRecord | null;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  reasonCode: string | null;
  data: Record<string, unknown>;
}

export interface SupportSessionRecord {
  id: string;
  tenantId: string;
  platformUserId: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
}

export interface MockState {
  version: 1;
  tenants: TenantRecord[];
  lifecycleHistory: LifecycleHistoryRecord[];
  subscriptions: SubscriptionRecord[];
  overrides: OverrideRecord[];
  notes: NoteRecord[];
  plans: SubscriptionPlan[];
  planVersions: PlanVersion[];
  flags: FeatureFlag[];
  users: UserRecord[];
  memberships: MembershipRecord[];
  staffInvitations: StaffInvitationRecord[];
  sessions: SessionRecord[];
  devices: DeviceRecord[];
  transfers: TransferRecord[];
  cooldownOverrides: CooldownOverrideRecord[];
  otpChallenges: OtpChallengeRecord[];
  classes: ClassRecord[];
  sections: SectionRecord[];
  students: StudentRecord[];
  guardians: GuardianRecord[];
  links: LinkRecord[];
  seats: SeatRecord[];
  invitations: InvitationRecord[];
  purchaseIntents: PurchaseIntentRecord[];
  pickups: PickupRecord[];
  queueEvents: QueueEventRecord[];
  queueSeq: Record<string, number>;
  displays: DisplayRecord[];
  pairingSessions: PairingSessionRecord[];
  imports: ImportJobRecord[];
  notifications: NotificationRecord[];
  audit: AuditRecord[];
  supportSessions: SupportSessionRecord[];
  idempotency: Record<string, { hash: string; status: number; body: unknown }>;
}
