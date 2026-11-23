/** SIMULATION of license validity modes (ADR-0011). */
import type { ValidityInput } from '@homebell/contracts';
import type { MockDb } from '../db/db';

export interface ComputedValidity {
  validFrom: string;
  validUntil: string | null;
  durationDays: number | null;
}

/** Returns null when the input is invalid for the seat term (INVALID_VALIDITY_WINDOW). */
export function computeValidity(
  db: MockDb,
  input: ValidityInput,
  termEndsAt: string,
  from = db.now(),
): ComputedValidity | null {
  const validFrom = from.toISOString();
  switch (input.mode) {
    case 'permanent':
      return { validFrom, validUntil: termEndsAt, durationDays: null };
    case 'temporary': {
      const days = input.durationDays;
      if (!days || days < 1 || days > 30) return null;
      const until = db.addDays(days, from);
      return { validFrom, validUntil: until < termEndsAt ? until : termEndsAt, durationDays: days };
    }
    case 'valid_until_date': {
      if (!input.validUntil) return null;
      const until = `${input.validUntil}T23:59:59.000Z`;
      if (until > termEndsAt || until < validFrom) return null;
      return { validFrom, validUntil: until, durationDays: null };
    }
    case 'one_time':
      return { validFrom, validUntil: db.addDays(1, from), durationDays: null };
    default:
      return null;
  }
}
