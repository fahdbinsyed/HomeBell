/**
 * Mock dismissal engine: every pickup state change goes through here so the queue sequence,
 * realtime events (queue / display / guardian audiences), history, audit and notifications
 * stay consistent. SIMULATION of 06-state-machines.md §1.
 */
import type { MockDb } from './db/db';
import type { ActorRecord, PickupRecord } from './db/types';
import { displayItem, guardianPickup, isDisplayed, queueItem, openPositions } from './mappers';

type Transition = {
  to: PickupRecord['state'];
  actorType: PickupRecord['history'][number]['actorType'];
  actor: ActorRecord | null;
  reason?: string | null;
};

function publish(
  db: MockDb,
  p: PickupRecord,
  type: 'queue.request.created' | 'queue.request.updated',
  wasDisplayed: boolean,
): void {
  const ev = db.queueEvent(p, type);
  const base = {
    version: 1 as const,
    tenantId: p.tenantId,
    queueDate: p.queueDate,
    seq: ev.seq,
    occurredAt: ev.occurredAt,
  };
  db.emit(
    {
      ...base,
      eventId: ev.eventId,
      type,
      data: { item: queueItem(db, p, openPositions(db, p.tenantId, p.queueDate)) },
    },
    { kind: 'tenant-queue', tenantId: p.tenantId },
  );
  if (isDisplayed(p)) {
    db.emit(
      {
        ...base,
        eventId: db.id(),
        type: 'display.item.upserted',
        data: { item: displayItem(db, p) },
      },
      { kind: 'tenant-display', tenantId: p.tenantId },
    );
  } else if (wasDisplayed) {
    db.emit(
      { ...base, eventId: db.id(), type: 'display.item.removed', data: { itemId: p.id } },
      { kind: 'tenant-display', tenantId: p.tenantId },
    );
  }
  // Every guardian linked to the student sees status changes (primary + additional).
  const userIds = new Set(
    db.state.links
      .filter((l) => l.studentId === p.studentId && !l.removedAt)
      .map((l) => db.state.guardians.find((g) => g.id === l.guardianId)?.userId)
      .filter((x): x is string => !!x),
  );
  for (const userId of userIds) {
    db.emit(
      {
        eventId: db.id(),
        type: 'guardian.request.status_changed',
        version: 1,
        tenantId: p.tenantId,
        occurredAt: ev.occurredAt,
        data: { request: guardianPickup(db, p, userId) },
      },
      { kind: 'user', userId },
    );
  }
}

function notifyGuardians(
  db: MockDb,
  p: PickupRecord,
  title: string,
  bodyText: string,
  type: 'pickup_status' | 'pickup_reminder' = 'pickup_status',
): void {
  const userIds = new Set(
    db.state.links
      .filter((l) => l.studentId === p.studentId && !l.removedAt)
      .map((l) => db.state.guardians.find((g) => g.id === l.guardianId)?.userId)
      .filter((x): x is string => !!x),
  );
  for (const userId of userIds) {
    db.state.notifications.unshift({
      id: db.id(),
      userId,
      tenantId: p.tenantId,
      type,
      title,
      body: bodyText,
      data: { pickupRequestId: p.id },
      createdAt: db.nowIso(),
      readAt: null,
    });
  }
}

export function createPickup(
  db: MockDb,
  args: {
    tenantId: string;
    studentId: string;
    guardianId: string;
    note: string | null;
    actor: ActorRecord;
  },
): PickupRecord {
  const now = db.nowIso();
  const p: PickupRecord = {
    id: db.id(),
    tenantId: args.tenantId,
    queueDate: db.today(args.tenantId),
    studentId: args.studentId,
    guardianId: args.guardianId,
    state: 'requested',
    seq: 0,
    requestedAt: now,
    sentOutAt: null,
    sentOutBy: null,
    acknowledgedAt: null,
    acknowledgedByGuardianId: null,
    viaSentOut: null,
    closedAt: null,
    exceptionAt: null,
    resolution: null,
    reminderSentAt: null,
    note: args.note,
    history: [
      {
        fromState: null,
        toState: 'requested',
        actorType: 'guardian',
        actor: args.actor,
        reason: null,
        at: now,
      },
    ],
  };
  db.state.pickups.push(p);
  const t = db.tenant(args.tenantId);
  if (t) t.lastActivityAt = now;
  db.audit({
    tenantId: p.tenantId,
    action: 'pickup.requested',
    outcome: 'success',
    actor: args.actor,
    targetType: 'pickup_request',
    targetId: p.id,
  });
  publish(db, p, 'queue.request.created', false);
  db.touch();
  return p;
}

export function transition(
  db: MockDb,
  p: PickupRecord,
  t: Transition,
  extra: (p: PickupRecord) => void = () => {},
): PickupRecord {
  const wasDisplayed = isDisplayed(p);
  const from = p.state;
  const now = db.nowIso();
  p.state = t.to;
  if (t.to === 'acknowledged' || t.to === 'cancelled' || t.to === 'resolved') p.closedAt = now;
  if (t.to === 'exception') p.exceptionAt = now;
  extra(p);
  p.history.push({
    fromState: from,
    toState: t.to,
    actorType: t.actorType,
    actor: t.actor,
    reason: t.reason ?? null,
    at: now,
  });
  const actionByState = {
    sent_out: 'pickup.sent_out',
    acknowledged: 'pickup.acknowledged',
    cancelled: 'pickup.cancelled',
    exception: 'pickup.exception',
    resolved: 'pickup.resolved',
    requested: 'pickup.requested',
  } as const;
  db.audit({
    tenantId: p.tenantId,
    action: actionByState[t.to],
    outcome: 'success',
    actor: t.actor ?? db.systemActor(),
    targetType: 'pickup_request',
    targetId: p.id,
    reasonCode: t.reason ?? null,
  });
  publish(db, p, 'queue.request.updated', wasDisplayed);
  db.touch();
  return p;
}

export function sendOut(db: MockDb, p: PickupRecord, actor: ActorRecord): PickupRecord {
  const s = db.state.students.find((x) => x.id === p.studentId)!;
  transition(db, p, { to: 'sent_out', actorType: 'staff', actor }, (x) => {
    x.sentOutAt = db.nowIso();
    x.sentOutBy = actor;
  });
  notifyGuardians(
    db,
    p,
    `${s.preferredName ?? s.firstName} is on the way`,
    `${db.tenant(p.tenantId)?.name} sent ${s.preferredName ?? s.firstName} out. Confirm once you have them.`,
  );
  return p;
}

export function acknowledge(
  db: MockDb,
  p: PickupRecord,
  guardianId: string,
  actor: ActorRecord,
): PickupRecord {
  const viaSentOut = p.state === 'sent_out' || !!p.sentOutAt;
  transition(db, p, { to: 'acknowledged', actorType: 'guardian', actor }, (x) => {
    x.acknowledgedAt = db.nowIso();
    x.acknowledgedByGuardianId = guardianId;
    x.viaSentOut = viaSentOut;
  });
  // One-time guardians lose access after their first acknowledged pickup (ADR-0011).
  const g = db.state.guardians.find((x) => x.id === guardianId);
  if (g?.validityMode === 'one_time' && g.state === 'active') {
    g.state = 'expired';
    g.stateReason = 'One-time access used';
    g.stateChangedAt = db.nowIso();
    returnSeat(db, g.seatId);
    db.emit(
      {
        eventId: db.id(),
        type: 'guardian.access.changed',
        version: 1,
        tenantId: g.tenantId,
        occurredAt: db.nowIso(),
        data: {
          tenantId: g.tenantId,
          guardianId: g.id,
          state: 'expired',
          reasonCode: 'one_time_used',
        },
      },
      { kind: 'user', userId: g.userId },
    );
  }
  return p;
}

export function returnSeat(db: MockDb, seatId: string | null): void {
  const seat = seatId ? db.state.seats.find((s) => s.id === seatId) : undefined;
  if (!seat || seat.state !== 'assigned') return;
  if (seat.reassignmentsUsed < 5 && seat.termEndsAt > db.nowIso()) {
    seat.state = 'available';
    seat.assignedGuardianId = null;
  }
}

/** Timeout worker simulation (ADR-0014): reminders, exceptions. Returns changed pickups. */
export function sweepTimeouts(db: MockDb): PickupRecord[] {
  const changed: PickupRecord[] = [];
  for (const p of db.state.pickups) {
    if (p.state !== 'sent_out' || !p.sentOutAt) continue;
    const t = db.tenant(p.tenantId)!;
    const { sentOutReminderMinutes, sentOutExceptionMinutes } = t.settings.dismissal.timeouts;
    if (!p.reminderSentAt && p.sentOutAt < db.addMinutes(-sentOutReminderMinutes)) {
      p.reminderSentAt = db.nowIso();
      notifyGuardians(
        db,
        p,
        'Please confirm pickup',
        'Tap "Confirm picked up" once your child is with you.',
        'pickup_reminder',
      );
      changed.push(p);
    }
    if (p.sentOutAt < db.addMinutes(-sentOutExceptionMinutes)) {
      transition(db, p, {
        to: 'exception',
        actorType: 'system',
        actor: db.systemActor(),
        reason: `No acknowledgment within ${sentOutExceptionMinutes} minutes`,
      });
      changed.push(p);
    }
  }
  return changed;
}
