/**
 * Time-zone helpers that work on every JS engine the mocks run on (Node, browsers, Hermes).
 *
 * Only numeric `formatToParts` fields are used — no `timeZoneName: 'shortOffset'`, no reliance on a
 * locale's date layout (e.g. 'en-CA' → YYYY-MM-DD) and no weekday names — because Hermes' Intl
 * support varies by build. If the engine cannot resolve the zone at all we fall back to UTC.
 */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

function utcParts(at: Date): ZonedParts {
  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
    hour: at.getUTCHours(),
    minute: at.getUTCMinutes(),
    second: at.getUTCSeconds(),
  };
}

export function zonedParts(timeZone: string, at: Date): ZonedParts {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const result: ZonedParts = {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour') % 24, // some engines print 24 for midnight
      minute: get('minute'),
      second: get('second'),
    };
    if (Object.values(result).some((v) => !Number.isFinite(v))) return utcParts(at);
    return result;
  } catch {
    return utcParts(at);
  }
}

/** Calendar date (YYYY-MM-DD) in `timeZone`. */
export function zonedDate(timeZone: string, at: Date): string {
  const p = zonedParts(timeZone, at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** HH:mm and ISO weekday (1 = Monday … 7 = Sunday) in `timeZone`. */
export function zonedClock(timeZone: string, at: Date): { time: string; isoWeekday: number } {
  const p = zonedParts(timeZone, at);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 = Sunday
  return { time: `${pad(p.hour)}:${pad(p.minute)}`, isoWeekday: weekday === 0 ? 7 : weekday };
}

/** Offset of `timeZone` from UTC at `at`, in minutes (e.g. -300 for New York in winter). */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const p = zonedParts(timeZone, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}
