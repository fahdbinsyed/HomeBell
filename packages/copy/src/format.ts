/** Locale-aware formatting shared by web and mobile (Intl only; no date library). */
const locale = () => (typeof navigator !== 'undefined' && navigator.language) || 'en-US';

export const formatDate = (
  iso: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string =>
  iso
    ? new Intl.DateTimeFormat(locale(), opts).format(
        new Date(iso.length === 10 ? `${iso}T12:00:00` : iso),
      )
    : '—';

export const formatDateTime = (iso: string | null | undefined): string =>
  formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' });

export const formatTime = (iso: string | null | undefined, timeZone?: string): string =>
  iso
    ? new Intl.DateTimeFormat(locale(), {
        timeStyle: 'short',
        ...(timeZone ? { timeZone } : {}),
      }).format(new Date(iso))
    : '—';

/** Hermes builds without full Intl lack RelativeTimeFormat; fall back to plain English. */
function relative(value: number, unit: 'second' | 'minute' | 'hour' | 'day'): string {
  try {
    if (typeof Intl.RelativeTimeFormat === 'function')
      return new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(value, unit);
  } catch {
    /* fall through */
  }
  const n = Math.abs(value);
  const label = `${n} ${unit}${n === 1 ? '' : 's'}`;
  return value < 0 ? `${label} ago` : `in ${label}`;
}

export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const diffSec = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return 'just now';
  if (abs < 45 * 60) return relative(Math.round(diffSec / 60), 'minute');
  if (abs < 22 * 3600) return relative(Math.round(diffSec / 3600), 'hour');
  if (abs < 26 * 86400) return relative(Math.round(diffSec / 86400), 'day');
  return formatDate(iso);
}

/** Whole minutes elapsed since `iso` (for queue "waiting" timers). */
export const minutesSince = (iso: string, now: Date = new Date()): number =>
  Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));

export const formatMoney = (
  m: { amountMinor: number; currency: string } | null | undefined,
): string =>
  m
    ? new Intl.NumberFormat(locale(), { style: 'currency', currency: m.currency }).format(
        m.amountMinor / 100,
      )
    : '—';

export const formatNumber = (n: number | null | undefined): string =>
  n === null || n === undefined ? '∞' : new Intl.NumberFormat(locale()).format(n);

/** "+15551234567" → "+1 555 123 4567" (display only; never used for storage). */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

export const daysUntil = (iso: string | null | undefined, now: Date = new Date()): number | null =>
  iso ? Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000) : null;
