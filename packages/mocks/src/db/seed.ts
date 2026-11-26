/**
 * Deterministic seed for the mock database. IDs are stable so deep links and tests keep working
 * across reloads. Demo credentials are documented in packages/mocks/README.md (test values only).
 */
import type { PlanVersion, SubscriptionPlan, TenantSettings } from '@homebell/contracts';
import { zonedDate } from './tz';
import type {
  ActorRecord,
  ClassRecord,
  GuardianRecord,
  LinkRecord,
  MockState,
  PickupRecord,
  SectionRecord,
  StudentRecord,
  TenantRecord,
  UserRecord,
} from './types';

/** Stable UUID: category in the first group, counter in the last. Version 7 / variant 8 nibbles. */
export const sid = (category: number, n: number): string =>
  `${category.toString(16).padStart(8, '0')}-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

export const IDS = {
  tenant: (n: number) => sid(0x10, n),
  user: (n: number) => sid(0x20, n),
  plan: (n: number) => sid(0x30, n),
  planVersion: (n: number) => sid(0x31, n),
  klass: (n: number) => sid(0x40, n),
  section: (n: number) => sid(0x41, n),
  student: (n: number) => sid(0x50, n),
  guardian: (n: number) => sid(0x60, n),
  seat: (n: number) => sid(0x61, n),
  invitation: (n: number) => sid(0x62, n),
  device: (n: number) => sid(0x70, n),
  display: (n: number) => sid(0x80, n),
};

export const DEMO = {
  password: 'demo1234',
  mfaCode: '000000',
  otpCode: '000000',
  greenfield: IDS.tenant(1),
  riverside: IDS.tenant(2),
  hillcrest: IDS.tenant(3),
  displayToken: 'disp_demo_greenfield_front_gate',
  invitationCode: 'GRNFD7K2QX',
  expiredInvitationCode: 'EXPRD00000',
  usedInvitationCode: 'SPENT00000',
  phones: {
    primary: '+15550100001',
    spouse: '+15550100002',
    blocked: '+15550100003',
    deactivated: '+15550100004',
    pending: '+15550100005',
    conflictTransferAllowed: '+15550100006',
    conflictInCooldown: '+15550100007',
    suspendedSchool: '+15550100008',
    expiredAdditional: '+15550100009',
    invited: '+15550100010',
    noAccount: '+15550109999',
  },
} as const;

const DAY = 86_400_000;
const iso = (offsetMs: number, base: number) => new Date(base + offsetMs).toISOString();

const defaultSettings = (
  displayName: string,
  windows: TenantSettings['dismissal']['windows'],
): TenantSettings => ({
  dismissal: {
    windows,
    sentOutStepEnabled: true,
    timeouts: {
      sentOutReminderMinutes: 5,
      sentOutExceptionMinutes: 15,
      requestedStaleMinutes: 10,
      endOfDayTime: '23:59',
    },
  },
  locationRule: { enabled: false, center: null, radiusMeters: 300, maxAccuracyMeters: 100 },
  display: {
    nameFormat: 'first_name_last_initial',
    showClass: true,
    showSection: false,
    theme: 'dark',
  },
  branding: { displayName, logoUrl: null, primaryColor: '#1F6FEB' },
  notifications: { dailyDigestEnabled: false },
  security: { staffMfaRequired: false },
  locale: 'en',
});
const allDay = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
  dayOfWeek: d,
  opensAt: '00:00',
  closesAt: '23:59',
}));
const weekdaysAfternoon = [1, 2, 3, 4, 5].map((d) => ({
  dayOfWeek: d,
  opensAt: '14:30',
  closesAt: '16:00',
}));

const FIRST = [
  'Mia',
  'Leo',
  'Ava',
  'Noah',
  'Zara',
  'Ethan',
  'Lina',
  'Omar',
  'Sofia',
  'Kai',
  'Ivy',
  'Mateo',
  'Nora',
  'Arjun',
  'Ella',
  'Yusuf',
  'Chloe',
  'Ravi',
  'Hana',
  'Lucas',
  'Amara',
  'Ben',
  'Isla',
  'Theo',
  'Maya',
  'Elias',
  'Ruby',
  'Sami',
  'Grace',
  'Felix',
  'Layla',
  'Jonah',
];
const LAST = [
  'Rivera',
  'Chen',
  'Okafor',
  'Haddad',
  'Novak',
  'Silva',
  'Kowalski',
  'Mensah',
  'Tanaka',
  'Fischer',
  'Duarte',
  'Ibrahim',
  'Larsen',
  'Moreau',
  'Sharma',
  'Bianchi',
];
const PARENT_FIRST = [
  'Alex',
  'Sam',
  'Jamie',
  'Robin',
  'Dana',
  'Kim',
  'Lee',
  'Toni',
  'Rene',
  'Jules',
  'Noel',
  'Ari',
];

export function createSeed(): MockState {
  const base = Date.now();
  const system: ActorRecord = { type: 'system', id: null, displayName: 'System' };
  const owner: ActorRecord = { type: 'user', id: IDS.user(1), displayName: 'Avery Owner' };

  // ── plans ───────────────────────────────────────────────
  const fullFeatures = {
    'dismissal.queue': true,
    'dismissal.display': true,
    'dismissal.location_rule': true,
    'dismissal.sent_out_step': true,
    'guardians.additional_purchase': true,
    'guardians.school_granted_seats': true,
    'imports.csv': true,
    'reports.standard': true,
    'reports.export': true,
    'branding.custom': true,
    'audio.announcements': false,
    'qr.verification': false,
    'campus.multi': false,
    'sso.enterprise': false,
  };
  const planVersions: PlanVersion[] = [
    {
      id: IDS.planVersion(1),
      planId: IDS.plan(1),
      planName: 'Standard',
      version: 1,
      status: 'published',
      price: { amountMinor: 240_000, currency: 'USD' },
      billingPeriod: 'annual',
      features: fullFeatures,
      limits: {
        'students.max': 1500,
        'staff.max': 50,
        'displays.max': 5,
        'additional_guardians.max_per_student': 4,
        'otp.daily_budget': 2000,
        'imports.max_rows': 5000,
      },
      createdAt: iso(-200 * DAY, base),
      publishedAt: iso(-199 * DAY, base),
    },
    {
      id: IDS.planVersion(2),
      planId: IDS.plan(2),
      planName: 'Pilot',
      version: 1,
      status: 'published',
      price: { amountMinor: 0, currency: 'USD' },
      billingPeriod: 'annual',
      features: { ...fullFeatures, 'reports.export': false, 'branding.custom': false },
      limits: {
        'students.max': 300,
        'staff.max': 10,
        'displays.max': 2,
        'additional_guardians.max_per_student': 2,
        'otp.daily_budget': 300,
        'imports.max_rows': 1000,
      },
      createdAt: iso(-200 * DAY, base),
      publishedAt: iso(-199 * DAY, base),
    },
    {
      id: IDS.planVersion(3),
      planId: IDS.plan(1),
      planName: 'Standard',
      version: 2,
      status: 'draft',
      price: { amountMinor: 264_000, currency: 'USD' },
      billingPeriod: 'annual',
      features: fullFeatures,
      limits: {
        'students.max': 2000,
        'staff.max': 60,
        'displays.max': 8,
        'additional_guardians.max_per_student': 4,
        'otp.daily_budget': 2500,
        'imports.max_rows': 5000,
      },
      createdAt: iso(-5 * DAY, base),
      publishedAt: null,
    },
  ];
  const plans: SubscriptionPlan[] = [
    {
      id: IDS.plan(1),
      code: 'standard',
      name: 'Standard',
      description: 'Annual school subscription.',
      isPublic: true,
      versions: [],
    },
    {
      id: IDS.plan(2),
      code: 'pilot',
      name: 'Pilot',
      description: 'Free pilot / charity access.',
      isPublic: false,
      versions: [],
    },
  ];

  // ── tenants ─────────────────────────────────────────────
  const tenantSpec: Array<
    [
      number,
      string,
      string,
      TenantRecord['state'],
      number | null,
      string,
      TenantRecord['state'] | null,
    ]
  > = [
    [1, 'greenfield-academy', 'Greenfield Academy', 'active_paid', 200, 'America/New_York', null],
    [2, 'riverside-primary', 'Riverside Primary', 'trial', 3, 'America/Chicago', null],
    [3, 'hillcrest-school', 'Hillcrest School', 'suspended', 120, 'America/Denver', 'active_paid'],
    [
      4,
      'oakwood-community',
      'Oakwood Community School',
      'pilot_free',
      90,
      'America/New_York',
      null,
    ],
    [5, 'willow-bay', 'Willow Bay School', 'manual_override', null, 'America/Los_Angeles', null],
    [6, 'cedar-ridge', 'Cedar Ridge Academy', 'draft', null, 'America/New_York', null],
    [7, 'pine-valley', 'Pine Valley School', 'expired', -4, 'America/Phoenix', null],
    [8, 'birch-lane', 'Birch Lane School', 'deactivated', null, 'America/New_York', 'active_paid'],
    [9, 'maple-grove', 'Maple Grove School', 'cancelled', null, 'America/Chicago', 'active_paid'],
    [10, 'elmwood-prep', 'Elmwood Prep', 'offboarding', null, 'America/New_York', null],
  ];
  const tenants: TenantRecord[] = tenantSpec.map(([n, slug, name, state, expDays, tz, prev]) => ({
    id: IDS.tenant(n),
    slug,
    name,
    legalName: `${name} Inc.`,
    countryCode: 'US',
    region: 'us-east',
    timezone: tz,
    termStartDate: '2026-08-24',
    termEndDate: '2027-06-18',
    state,
    previousOperationalState: prev,
    expiresAt: expDays === null ? null : iso(expDays * DAY, base),
    dataPlacement: 'shared',
    primaryContact: {
      fullName: `${name.split(' ')[0]} Office`,
      email: `office@${slug}.test`,
      phone: null,
    },
    settings: defaultSettings(name, n === 2 ? weekdaysAfternoon : allDay),
    createdAt: iso(-(300 - n * 10) * DAY, base),
    updatedAt: iso(-n * DAY, base),
    lastActivityAt: state === 'draft' ? null : iso(-(n - 1) * 3_600_000, base),
  }));

  const lifecycleHistory = tenants.flatMap((t) => {
    const entries: MockState['lifecycleHistory'] = [
      {
        id: sid(0x11, tenants.indexOf(t) * 10 + 1),
        tenantId: t.id,
        action: 'create',
        fromState: null,
        toState: 'draft' as const,
        reasonCode: 'contract_signed' as const,
        note: null,
        expiresAt: null,
        refundStatus: 'none' as const,
        actor: owner,
        at: t.createdAt,
      },
    ];
    if (t.state !== 'draft') {
      entries.push({
        id: sid(0x11, tenants.indexOf(t) * 10 + 2),
        tenantId: t.id,
        action: 'activate',
        fromState: 'draft' as never,
        toState: (t.previousOperationalState ?? t.state) as never,
        reasonCode: 'contract_signed',
        note: null,
        expiresAt: t.expiresAt,
        refundStatus: 'none',
        actor: owner,
        at: iso(1 * DAY, Date.parse(t.createdAt)),
      });
    }
    if (t.previousOperationalState) {
      entries.push({
        id: sid(0x11, tenants.indexOf(t) * 10 + 3),
        tenantId: t.id,
        action:
          t.state === 'suspended' ? 'suspend' : t.state === 'cancelled' ? 'cancel' : 'deactivate',
        fromState: t.previousOperationalState as never,
        toState: t.state as never,
        reasonCode: t.state === 'cancelled' ? 'school_request' : 'non_payment',
        note:
          t.state === 'cancelled'
            ? 'School discontinued at end of pilot. Refund handled manually by finance.'
            : 'Invoice 60 days overdue.',
        expiresAt: null,
        refundStatus: t.state === 'cancelled' ? 'refund_handled_manually' : 'none',
        actor: owner,
        at: iso(-2 * DAY, base),
      });
    }
    return entries;
  });

  const subscriptions: MockState['subscriptions'] = [1, 3, 5, 8, 9].map((n, i) => ({
    id: sid(0x32, i + 1),
    tenantId: IDS.tenant(n),
    planVersionId: IDS.planVersion(1),
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2027-07-31T23:59:59.000Z',
    billingReference: `INV-2026-${String(100 + n)}`,
    createdBy: owner,
    createdAt: iso(-100 * DAY, base),
  }));
  subscriptions.push({
    id: sid(0x32, 9),
    tenantId: IDS.tenant(4),
    planVersionId: IDS.planVersion(2),
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2027-07-31T23:59:59.000Z',
    billingReference: null,
    createdBy: owner,
    createdAt: iso(-90 * DAY, base),
  });

  // ── users ───────────────────────────────────────────────
  const users: UserRecord[] = [];
  const addUser = (n: number, u: Partial<UserRecord> & Pick<UserRecord, 'fullName'>): string => {
    users.push({
      id: IDS.user(n),
      email: null,
      phone: null,
      password: null,
      platformRoles: [],
      platformStatus: 'active',
      mfaEnabled: false,
      locale: 'en',
      termsVersion: null,
      lastLoginAt: null,
      ...u,
    });
    return IDS.user(n);
  };
  addUser(1, {
    fullName: 'Avery Owner',
    email: 'owner@homebell.test',
    password: DEMO.password,
    platformRoles: ['platform.super_admin'],
    mfaEnabled: true,
  });
  addUser(2, {
    fullName: 'Parker Ops',
    email: 'ops@homebell.test',
    password: DEMO.password,
    platformRoles: ['platform.ops_admin'],
    mfaEnabled: true,
  });
  addUser(3, {
    fullName: 'Blake Billing',
    email: 'billing@homebell.test',
    password: DEMO.password,
    platformRoles: ['platform.billing_ops'],
    mfaEnabled: true,
  });
  addUser(4, {
    fullName: 'Shay Support',
    email: 'support@homebell.test',
    password: DEMO.password,
    platformRoles: ['platform.support_analyst'],
    mfaEnabled: true,
  });
  addUser(10, {
    fullName: 'Harper Grant',
    email: 'admin@greenfield.test',
    password: DEMO.password,
  });
  addUser(11, {
    fullName: 'Devon Cruz',
    email: 'dispatch@greenfield.test',
    password: DEMO.password,
  });
  addUser(12, {
    fullName: 'Emery Shaw',
    email: 'frontdesk@greenfield.test',
    password: DEMO.password,
  });
  addUser(13, {
    fullName: 'Rowan Bell',
    email: 'reports@greenfield.test',
    password: DEMO.password,
  });
  addUser(14, { fullName: 'Logan Price', email: 'admin@riverside.test', password: DEMO.password });
  addUser(15, { fullName: 'Morgan Ellis', email: 'multi@homebell.test', password: DEMO.password });
  addUser(16, { fullName: 'Sage Turner', email: 'admin@hillcrest.test', password: DEMO.password });
  addUser(17, {
    fullName: 'Reese Park',
    email: 'admin@oakwood.test',
    password: DEMO.password,
    mfaEnabled: true,
  });

  const memberships = [
    [10, 1, 'school.admin'],
    [11, 1, 'school.dispatcher'],
    [12, 1, 'school.front_desk'],
    [13, 1, 'school.reporting'],
    [14, 2, 'school.admin'],
    [15, 1, 'school.admin'],
    [15, 2, 'school.dispatcher'],
    [15, 4, 'school.admin'],
    [16, 3, 'school.admin'],
    [17, 4, 'school.admin'],
  ].map(([u, t, role], i) => ({
    id: sid(0x21, i + 1),
    userId: IDS.user(u as number),
    tenantId: IDS.tenant(t as number),
    role: role as 'school.admin',
    status: 'active' as const,
  }));

  // ── classes, students, guardians ───────────────────────
  const classes: ClassRecord[] = [];
  const sections: SectionRecord[] = [];
  const students: StudentRecord[] = [];
  const guardians: GuardianRecord[] = [];
  const links: LinkRecord[] = [];
  let classN = 0,
    sectionN = 0,
    studentN = 0,
    guardianN = 0,
    linkN = 0,
    userN = 100;

  const addClasses = (tenantId: string, count: number) => {
    const ids: Array<{ classId: string; sectionIds: string[] }> = [];
    for (let g = 1; g <= count; g++) {
      const classId = IDS.klass(++classN);
      classes.push({
        id: classId,
        tenantId,
        name: `Grade ${g}`,
        gradeLevel: String(g),
        sortOrder: g,
      });
      const sectionIds = ['A', 'B'].map((s) => {
        const id = IDS.section(++sectionN);
        sections.push({ id, tenantId, classId, name: s });
        return id;
      });
      ids.push({ classId, sectionIds });
    }
    return ids;
  };
  const addStudent = (
    tenantId: string,
    first: string,
    last: string,
    cls: { classId: string; sectionIds: string[] },
    sectionIdx: number,
    extra: Partial<StudentRecord> = {},
  ) => {
    const id = IDS.student(++studentN);
    students.push({
      id,
      tenantId,
      externalRef: `S${String(1000 + studentN)}`,
      firstName: first,
      lastName: last,
      preferredName: null,
      classId: cls.classId,
      sectionId: cls.sectionIds[sectionIdx % 2] ?? null,
      status: 'active',
      dismissalEligibility: 'eligible',
      notes: null,
      restrictionsNote: null,
      createdAt: iso(-80 * DAY, base),
      updatedAt: iso(-10 * DAY, base),
      ...extra,
    });
    return id;
  };
  const userForPhone = new Map<string, string>();
  const ensureUser = (fullName: string, phone: string, activated: boolean): string => {
    const existing = userForPhone.get(phone);
    if (existing) return existing;
    const id = addUser(++userN, {
      fullName,
      phone,
      termsVersion: activated ? '2026-08' : null,
      lastLoginAt: activated ? iso(-DAY, base) : null,
    });
    userForPhone.set(phone, id);
    return id;
  };
  const addGuardian = (
    tenantId: string,
    fullName: string,
    phone: string,
    kind: 'primary' | 'additional',
    state: GuardianRecord['state'],
    extra: Partial<GuardianRecord> = {},
  ) => {
    const id = IDS.guardian(++guardianN);
    const activated = state !== 'pending_activation';
    guardians.push({
      id,
      tenantId,
      userId: ensureUser(fullName, phone, activated),
      kind,
      fullName,
      phone,
      state,
      stateReason: null,
      stateChangedAt: null,
      invitedByGuardianId: null,
      seatId: null,
      validityMode: kind === 'additional' ? 'permanent' : null,
      validFrom: activated ? iso(-60 * DAY, base) : null,
      validUntil: null,
      durationDays: null,
      activatedAt: activated ? iso(-60 * DAY, base) : null,
      lastActiveAt: activated ? iso(-2 * 3_600_000, base) : null,
      createdAt: iso(-80 * DAY, base),
      ...extra,
    });
    return id;
  };
  const link = (
    tenantId: string,
    guardianId: string,
    studentId: string,
    relationship: LinkRecord['relationship'],
    isPrimary: boolean,
  ) => {
    links.push({
      id: sid(0x63, ++linkN),
      tenantId,
      guardianId,
      studentId,
      relationship,
      isPrimary,
      removedAt: null,
    });
  };

  // Greenfield — the main demo school.
  const gf = DEMO.greenfield;
  const gfClasses = addClasses(gf, 5);
  const c = (g: number) => gfClasses[g - 1]!;
  const mia = addStudent(gf, 'Mia', 'Rivera', c(2), 0);
  const leo = addStudent(gf, 'Leo', 'Rivera', c(4), 1);
  const jordan = addGuardian(gf, 'Jordan Rivera', DEMO.phones.primary, 'primary', 'active');
  link(gf, jordan, mia, 'parent', true);
  link(gf, jordan, leo, 'parent', true);
  const alex = addGuardian(gf, 'Alex Rivera', DEMO.phones.spouse, 'additional', 'active', {
    invitedByGuardianId: jordan,
    validityMode: 'permanent',
  });
  link(gf, alex, mia, 'spouse', false);
  link(gf, alex, leo, 'spouse', false);
  const pat = addGuardian(
    gf,
    'Pat Moreau',
    DEMO.phones.expiredAdditional,
    'additional',
    'expired',
    {
      invitedByGuardianId: jordan,
      validityMode: 'one_time',
      validUntil: iso(-3 * DAY, base),
      stateReason: 'One-time access used',
    },
  );
  link(gf, pat, mia, 'nanny', false);
  const samPending = addGuardian(
    gf,
    'Sam Okafor',
    DEMO.phones.invited,
    'additional',
    'pending_activation',
    { invitedByGuardianId: jordan, validityMode: 'temporary', durationDays: 7 },
  );
  link(gf, samPending, leo, 'driver', false);

  const special: Array<[string, string, GuardianRecord['state'], string | null]> = [
    [
      'Morgan Lee',
      DEMO.phones.blocked,
      'blocked',
      'Custody restriction on file — contact front office',
    ],
    ['Taylor Brooks', DEMO.phones.deactivated, 'deactivated', 'Family left the school'],
    ['Casey Nguyen', DEMO.phones.pending, 'pending_activation', null],
    ['Riley Patel', DEMO.phones.conflictTransferAllowed, 'active', null],
    ['Drew Kim', DEMO.phones.conflictInCooldown, 'active', null],
  ];
  const specialGuardianIds: string[] = [];
  special.forEach(([name, phone, state, reason], i) => {
    const s = addStudent(gf, FIRST[2 + i]!, name.split(' ')[1]!, c((i % 5) + 1), i);
    const g = addGuardian(gf, name, phone, 'primary', state, {
      stateReason: reason,
      stateChangedAt: reason ? iso(-5 * DAY, base) : null,
    });
    link(gf, g, s, 'parent', true);
    specialGuardianIds.push(g);
  });
  // Bulk students with ordinary primary guardians.
  const bulkGuardianIds: string[] = [];
  for (let i = 0; i < 26; i++) {
    const last = LAST[(i + 3) % LAST.length]!;
    const s = addStudent(
      gf,
      FIRST[(i + 7) % FIRST.length]!,
      last,
      c((i % 5) + 1),
      i,
      i === 5
        ? { dismissalEligibility: 'hold', notes: 'Early pickup by appointment only' }
        : i === 9
          ? { dismissalEligibility: 'not_eligible', notes: 'Bus rider' }
          : i === 13
            ? { status: 'inactive' }
            : {},
    );
    const g = addGuardian(
      gf,
      `${PARENT_FIRST[i % PARENT_FIRST.length]!} ${last}`,
      `+1555020${String(1000 + i).padStart(4, '0')}`,
      'primary',
      'active',
    );
    link(gf, g, s, i % 3 === 0 ? 'mother' : i % 3 === 1 ? 'father' : 'legal_guardian', true);
    bulkGuardianIds.push(g);
  }

  // Riverside (trial) — Jordan has a third child here (multi-school guardian).
  const rv = DEMO.riverside;
  const rvClasses = addClasses(rv, 3);
  const ava = addStudent(rv, 'Ava', 'Rivera', rvClasses[0]!, 0);
  const jordanRv = addGuardian(rv, 'Jordan Rivera', DEMO.phones.primary, 'primary', 'active');
  link(rv, jordanRv, ava, 'parent', true);
  for (let i = 0; i < 8; i++) {
    const last = LAST[(i + 5) % LAST.length]!;
    const s = addStudent(rv, FIRST[(i + 11) % FIRST.length]!, last, rvClasses[i % 3]!, i);
    const g = addGuardian(
      rv,
      `${PARENT_FIRST[(i + 4) % PARENT_FIRST.length]!} ${last}`,
      `+1555030${String(1000 + i)}`,
      'primary',
      'active',
    );
    link(rv, g, s, 'parent', true);
  }
  // Hillcrest (suspended).
  const hc = DEMO.hillcrest;
  const hcClasses = addClasses(hc, 2);
  const quinnKid = addStudent(hc, 'Elias', 'Adams', hcClasses[0]!, 0);
  const quinn = addGuardian(hc, 'Quinn Adams', DEMO.phones.suspendedSchool, 'primary', 'active');
  link(hc, quinn, quinnKid, 'parent', true);
  // A few students for the remaining operational tenants (list counts).
  for (const n of [4, 5, 7, 8, 9]) {
    const t = IDS.tenant(n);
    const cls = addClasses(t, 1);
    for (let i = 0; i < 3 + n; i++) {
      const last = LAST[(i + n) % LAST.length]!;
      const s = addStudent(t, FIRST[(i * 3 + n) % FIRST.length]!, last, cls[0]!, i);
      const g = addGuardian(
        t,
        `${PARENT_FIRST[(i + n) % PARENT_FIRST.length]!} ${last}`,
        `+15550${String(40 + n)}${String(1000 + i)}`,
        'primary',
        'active',
      );
      link(t, g, s, 'parent', true);
    }
  }

  // ── seats & invitations (Jordan @ Greenfield) ──────────
  const termEnd = '2027-06-18T23:59:59.000Z';
  const seats = [
    {
      id: IDS.seat(1),
      tenantId: gf,
      ownerGuardianId: jordan,
      source: 'purchase' as const,
      state: 'assigned' as const,
      termEndsAt: termEnd,
      reassignmentsUsed: 0,
      assignedGuardianId: alex,
      createdAt: iso(-50 * DAY, base),
    },
    {
      id: IDS.seat(2),
      tenantId: gf,
      ownerGuardianId: jordan,
      source: 'purchase' as const,
      state: 'assigned' as const,
      termEndsAt: termEnd,
      reassignmentsUsed: 1,
      assignedGuardianId: samPending,
      createdAt: iso(-20 * DAY, base),
    },
    {
      id: IDS.seat(3),
      tenantId: gf,
      ownerGuardianId: jordan,
      source: 'school_grant' as const,
      state: 'available' as const,
      termEndsAt: termEnd,
      reassignmentsUsed: 1,
      assignedGuardianId: null,
      createdAt: iso(-15 * DAY, base),
    },
  ];
  guardians.find((g) => g.id === alex)!.seatId = IDS.seat(1);
  guardians.find((g) => g.id === samPending)!.seatId = IDS.seat(2);
  guardians.find((g) => g.id === pat)!.seatId = IDS.seat(3);
  const invitations = [
    {
      id: IDS.invitation(1),
      tenantId: gf,
      seatId: IDS.seat(2),
      guardianId: samPending,
      createdByGuardianId: jordan,
      fullName: 'Sam Okafor',
      phone: DEMO.phones.invited,
      relationship: 'driver' as const,
      studentIds: [leo],
      code: DEMO.invitationCode,
      expiresAt: iso(2 * DAY, base),
      state: 'pending' as const,
      createdAt: iso(-1 * DAY, base),
      redeemedAt: null,
    },
    {
      id: IDS.invitation(2),
      tenantId: gf,
      seatId: IDS.seat(3),
      guardianId: pat,
      createdByGuardianId: jordan,
      fullName: 'Pat Moreau',
      phone: DEMO.phones.expiredAdditional,
      relationship: 'nanny' as const,
      studentIds: [mia],
      code: DEMO.usedInvitationCode,
      expiresAt: iso(-10 * DAY, base),
      state: 'redeemed' as const,
      createdAt: iso(-14 * DAY, base),
      redeemedAt: iso(-13 * DAY, base),
    },
    {
      id: IDS.invitation(3),
      tenantId: gf,
      seatId: IDS.seat(3),
      guardianId: pat,
      createdByGuardianId: jordan,
      fullName: 'Pat Moreau',
      phone: DEMO.phones.expiredAdditional,
      relationship: 'nanny' as const,
      studentIds: [mia],
      code: DEMO.expiredInvitationCode,
      expiresAt: iso(-20 * DAY, base),
      state: 'expired' as const,
      createdAt: iso(-25 * DAY, base),
      redeemedAt: null,
    },
  ];

  // ── devices & transfers ────────────────────────────────
  const userOf = (gId: string) => guardians.find((g) => g.id === gId)!.userId;
  const riley = userOf(specialGuardianIds[3]!);
  const drew = userOf(specialGuardianIds[4]!);
  const devices = [
    {
      id: IDS.device(1),
      userId: riley,
      platform: 'ios' as const,
      model: 'iPhone 15',
      state: 'active' as const,
      activatedAt: iso(-90 * DAY, base),
      lastSeenAt: iso(-3_600_000, base),
    },
    {
      id: IDS.device(2),
      userId: drew,
      platform: 'android' as const,
      model: 'Pixel 8',
      state: 'transferred_out' as const,
      activatedAt: iso(-120 * DAY, base),
      lastSeenAt: iso(-10 * DAY, base),
    },
    {
      id: IDS.device(3),
      userId: drew,
      platform: 'ios' as const,
      model: 'iPhone 14',
      state: 'active' as const,
      activatedAt: iso(-10 * DAY, base),
      lastSeenAt: iso(-7_200_000, base),
    },
    {
      id: IDS.device(4),
      userId: userOf(alex),
      platform: 'android' as const,
      model: 'Galaxy S24',
      state: 'active' as const,
      activatedAt: iso(-50 * DAY, base),
      lastSeenAt: iso(-1_800_000, base),
    },
  ];
  const transfers = [
    {
      id: sid(0x71, 1),
      userId: drew,
      fromDeviceId: IDS.device(2),
      toDeviceId: IDS.device(3),
      at: iso(-10 * DAY, base),
      viaOverride: false,
      suspicious: false,
    },
    {
      id: sid(0x71, 2),
      userId: userOf(bulkGuardianIds[2]!),
      fromDeviceId: null,
      toDeviceId: IDS.device(4),
      at: iso(-6 * DAY, base),
      viaOverride: true,
      suspicious: true,
    },
  ];

  // ── today's queue at Greenfield ─────────────────────────
  const tz = tenants[0]!.timezone;
  const queueDate = zonedDate(tz, new Date(base));
  const pickups: PickupRecord[] = [];
  const queueEvents: MockState['queueEvents'] = [];
  let seq = 0;
  const dispatcher: ActorRecord = { type: 'user', id: IDS.user(11), displayName: 'Devon Cruz' };
  const studentOfGuardian = (gId: string) => links.find((l) => l.guardianId === gId)!.studentId;
  const queueSpec: Array<[string, PickupRecord['state'], number]> = [
    [bulkGuardianIds[0]!, 'acknowledged', -55],
    [bulkGuardianIds[1]!, 'acknowledged', -48],
    [bulkGuardianIds[3]!, 'cancelled', -40],
    [bulkGuardianIds[4]!, 'exception', -38],
    [bulkGuardianIds[6]!, 'sent_out', -9],
    [bulkGuardianIds[7]!, 'sent_out', -4],
    [bulkGuardianIds[8]!, 'requested', -34],
    [bulkGuardianIds[10]!, 'requested', -3],
    [bulkGuardianIds[11]!, 'requested', -1],
  ];
  queueSpec.forEach(([gId, state, minutesAgo], i) => {
    const requestedAt = iso(minutesAgo * 60_000, base);
    const history: PickupRecord['history'] = [
      {
        fromState: null,
        toState: 'requested',
        actorType: 'guardian',
        actor: null,
        reason: null,
        at: requestedAt,
      },
    ];
    const p: PickupRecord = {
      id: sid(0x90, i + 1),
      tenantId: gf,
      queueDate,
      studentId: studentOfGuardian(gId),
      guardianId: gId,
      state,
      seq: 0,
      requestedAt,
      sentOutAt: null,
      sentOutBy: null,
      acknowledgedAt: null,
      acknowledgedByGuardianId: null,
      viaSentOut: null,
      closedAt: null,
      exceptionAt: null,
      resolution: null,
      reminderSentAt: null,
      note: i === 7 ? 'Silver minivan, gate 2' : null,
      history,
    };
    if (state !== 'requested' && state !== 'cancelled') {
      p.sentOutAt = iso((minutesAgo + 2) * 60_000, base);
      p.sentOutBy = dispatcher;
      history.push({
        fromState: 'requested',
        toState: 'sent_out',
        actorType: 'staff',
        actor: dispatcher,
        reason: null,
        at: p.sentOutAt,
      });
    }
    if (state === 'acknowledged') {
      p.acknowledgedAt = iso((minutesAgo + 6) * 60_000, base);
      p.acknowledgedByGuardianId = gId;
      p.viaSentOut = true;
      p.closedAt = p.acknowledgedAt;
      history.push({
        fromState: 'sent_out',
        toState: 'acknowledged',
        actorType: 'guardian',
        actor: null,
        reason: null,
        at: p.acknowledgedAt,
      });
    }
    if (state === 'cancelled') {
      p.closedAt = iso((minutesAgo + 1) * 60_000, base);
      history.push({
        fromState: 'requested',
        toState: 'cancelled',
        actorType: 'guardian',
        actor: null,
        reason: 'Plans changed',
        at: p.closedAt,
      });
    }
    if (state === 'exception') {
      p.exceptionAt = iso((minutesAgo + 17) * 60_000, base);
      p.reminderSentAt = iso((minutesAgo + 7) * 60_000, base);
      history.push({
        fromState: 'sent_out',
        toState: 'exception',
        actorType: 'system',
        actor: system,
        reason: 'No acknowledgment within 15 minutes',
        at: p.exceptionAt,
      });
    }
    if (state === 'sent_out' && minutesAgo <= -5)
      p.reminderSentAt = iso((minutesAgo + 5) * 60_000, base);
    for (const _h of history) {
      seq++;
      queueEvents.push({
        eventId: sid(0x91, seq),
        tenantId: gf,
        queueDate,
        seq,
        type: _h.fromState === null ? 'queue.request.created' : 'queue.request.updated',
        pickupId: p.id,
        occurredAt: _h.at,
      });
    }
    p.seq = seq;
    pickups.push(p);
  });
  // Last week's history for reports.
  for (let d = 1; d <= 6; d++) {
    const day = zonedDate(tz, new Date(base - d * DAY));
    for (let k = 0; k < 6; k++) {
      const gId = bulkGuardianIds[(d * 3 + k) % bulkGuardianIds.length]!;
      const at = base - d * DAY - (60 - k * 7) * 60_000;
      const unresolved = k === 5 && d % 2 === 0;
      pickups.push({
        id: sid(0x92, d * 10 + k),
        tenantId: gf,
        queueDate: day,
        studentId: studentOfGuardian(gId),
        guardianId: gId,
        state: unresolved ? 'resolved' : 'acknowledged',
        seq: k + 1,
        requestedAt: iso(0, at),
        sentOutAt: iso(3 * 60_000, at),
        sentOutBy: dispatcher,
        acknowledgedAt: unresolved ? null : iso(9 * 60_000, at),
        acknowledgedByGuardianId: unresolved ? null : gId,
        viaSentOut: true,
        closedAt: iso(unresolved ? 40 * 60_000 : 9 * 60_000, at),
        exceptionAt: unresolved ? iso(18 * 60_000, at) : null,
        resolution: unresolved ? 'guardian_confirmed_offline' : null,
        reminderSentAt: null,
        note: null,
        history: [],
      });
    }
  }

  // ── displays ───────────────────────────────────────────
  const displays = [
    {
      id: IDS.display(1),
      tenantId: gf,
      name: 'Front Gate TV',
      zone: null,
      state: 'active' as const,
      token: DEMO.displayToken,
      pairedAt: iso(-40 * DAY, base),
      pairedBy: { type: 'user' as const, id: IDS.user(10), displayName: 'Harper Grant' },
      lastHeartbeatAt: iso(-30_000, base),
      appVersion: '1.0.0',
    },
    {
      id: IDS.display(2),
      tenantId: gf,
      name: 'Car Line Screen',
      zone: 'car-line',
      state: 'active' as const,
      token: 'disp_demo_greenfield_car_line',
      pairedAt: iso(-30 * DAY, base),
      pairedBy: { type: 'user' as const, id: IDS.user(10), displayName: 'Harper Grant' },
      lastHeartbeatAt: iso(-3 * DAY, base),
      appVersion: '1.0.0',
    },
  ];

  // ── notifications, audit, overrides, notes ────────────
  const jordanUser = userOf(jordan);
  const notifications = [
    {
      id: sid(0xa0, 1),
      userId: jordanUser,
      tenantId: gf,
      type: 'pickup_status' as const,
      title: 'Mia is on the way',
      body: 'Greenfield Academy sent Mia out. Confirm once you have her.',
      data: {},
      createdAt: iso(-DAY, base),
      readAt: iso(-DAY + 60_000, base),
    },
    {
      id: sid(0xa0, 2),
      userId: jordanUser,
      tenantId: gf,
      type: 'invitation_redeemed' as const,
      title: 'Alex accepted your invitation',
      body: 'Alex Rivera can now request pickup for Mia and Leo.',
      data: {},
      createdAt: iso(-50 * DAY, base),
      readAt: iso(-50 * DAY, base),
    },
    {
      id: sid(0xa0, 3),
      userId: jordanUser,
      tenantId: rv,
      type: 'tenant_notice' as const,
      title: 'Riverside pickup hours',
      body: 'Pickup requests open 2:30–4:00 pm on school days.',
      data: {},
      createdAt: iso(-2 * 3_600_000, base),
      readAt: null,
    },
  ];
  const overrides = [
    {
      id: sid(0x33, 1),
      tenantId: IDS.tenant(4),
      kind: 'limit' as const,
      key: 'students.max',
      value: 200,
      reasonCode: 'charity' as const,
      note: 'Charity pilot capped at 200 students.',
      expiresAt: iso(90 * DAY, base),
      createdBy: owner,
      createdAt: iso(-30 * DAY, base),
      revokedAt: null,
      revokedBy: null,
      revokeNote: null,
    },
    {
      id: sid(0x33, 2),
      tenantId: IDS.tenant(1),
      kind: 'feature' as const,
      key: 'dismissal.location_rule',
      value: true,
      reasonCode: 'contract_signed' as const,
      note: 'Location rule included per contract addendum.',
      expiresAt: null,
      createdBy: owner,
      createdAt: iso(-60 * DAY, base),
      revokedAt: null,
      revokedBy: null,
      revokeNote: null,
    },
  ];
  const notes = [
    {
      id: sid(0x34, 1),
      tenantId: IDS.tenant(9),
      category: 'refund' as const,
      body: 'School requested cancellation. Pro-rated refund processed manually by finance (outside HomeBell).',
      refundStatus: 'refund_handled_manually' as const,
      pinned: true,
      author: owner,
      createdAt: iso(-2 * DAY, base),
    },
    {
      id: sid(0x34, 2),
      tenantId: IDS.tenant(5),
      category: 'billing' as const,
      body: 'District contract signed; invoice pending — manual override until PO arrives.',
      refundStatus: 'none' as const,
      pinned: false,
      author: owner,
      createdAt: iso(-12 * DAY, base),
    },
    {
      id: sid(0x34, 3),
      tenantId: IDS.tenant(3),
      category: 'billing' as const,
      body: 'Suspended for non-payment. Reinstate on receipt of payment.',
      refundStatus: 'none' as const,
      pinned: true,
      author: owner,
      createdAt: iso(-2 * DAY, base),
    },
  ];
  const flags = [
    {
      key: 'queue.bulk_sent_out',
      description: 'Bulk "sent out" action in the live queue.',
      enabledByDefault: true,
      tenantAllowList: [],
      tenantDenyList: [],
      updatedAt: iso(-20 * DAY, base),
    },
    {
      key: 'guardian.location_capture',
      description: 'Kill switch for guardian location capture.',
      enabledByDefault: true,
      tenantAllowList: [],
      tenantDenyList: [],
      updatedAt: iso(-20 * DAY, base),
    },
    {
      key: 'display.zones',
      description: 'Zone-filtered display screens (staged rollout).',
      enabledByDefault: false,
      tenantAllowList: [gf],
      tenantDenyList: [],
      updatedAt: iso(-3 * DAY, base),
    },
  ];
  const audit = [
    {
      id: sid(0xb0, 1),
      occurredAt: iso(-2 * DAY, base),
      tenantId: IDS.tenant(3),
      action: 'tenant.lifecycle_changed' as const,
      outcome: 'success' as const,
      actor: owner,
      onBehalfOf: null,
      targetType: 'tenant',
      targetId: IDS.tenant(3),
      targetLabel: 'Hillcrest School',
      reasonCode: 'non_payment',
      data: { from: 'active_paid', to: 'suspended' },
    },
    {
      id: sid(0xb0, 2),
      occurredAt: iso(-5 * DAY, base),
      tenantId: gf,
      action: 'guardian.blocked' as const,
      outcome: 'success' as const,
      actor: { type: 'user' as const, id: IDS.user(10), displayName: 'Harper Grant' },
      onBehalfOf: null,
      targetType: 'guardian',
      targetId: specialGuardianIds[0]!,
      targetLabel: 'Morgan Lee',
      reasonCode: null,
      data: {},
    },
    {
      id: sid(0xb0, 3),
      occurredAt: iso(-6 * DAY, base),
      tenantId: gf,
      action: 'device.cooldown_overridden' as const,
      outcome: 'success' as const,
      actor: { type: 'user' as const, id: IDS.user(10), displayName: 'Harper Grant' },
      onBehalfOf: null,
      targetType: 'guardian',
      targetId: bulkGuardianIds[2]!,
      targetLabel: null,
      reasonCode: 'lost_device',
      data: {},
    },
    {
      id: sid(0xb0, 4),
      occurredAt: iso(-3_600_000, base),
      tenantId: null,
      action: 'auth.login' as const,
      outcome: 'success' as const,
      actor: owner,
      onBehalfOf: null,
      targetType: null,
      targetId: null,
      targetLabel: null,
      reasonCode: null,
      data: {},
    },
  ];

  return {
    version: 1,
    tenants,
    lifecycleHistory,
    subscriptions,
    overrides,
    notes,
    plans,
    planVersions,
    flags,
    users,
    memberships,
    staffInvitations: [
      {
        id: sid(0x22, 1),
        tenantId: gf,
        email: 'coach@greenfield.test',
        fullName: 'Jesse Moore',
        role: 'school.front_desk',
        platformRoles: [],
        token: 'staffinv_demo_greenfield',
        expiresAt: iso(5 * DAY, base),
        invitedBy: { type: 'user', id: IDS.user(10), displayName: 'Harper Grant' },
        createdAt: iso(-DAY, base),
        status: 'pending',
      },
    ],
    sessions: [],
    devices,
    transfers,
    cooldownOverrides: [],
    otpChallenges: [],
    classes,
    sections,
    students,
    guardians,
    links,
    seats,
    invitations,
    purchaseIntents: [],
    pickups,
    queueEvents,
    queueSeq: { [`${gf}:${queueDate}`]: seq },
    displays,
    pairingSessions: [],
    imports: [],
    notifications,
    audit,
    supportSessions: [],
    idempotency: {},
  };
}
