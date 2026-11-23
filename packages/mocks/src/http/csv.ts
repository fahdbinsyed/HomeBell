import type { AuditLogEntry } from '@homebell/contracts';

const cell = (v: unknown): string => {
  const s =
    v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  return (
    [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') +
    '\n'
  );
}

export const csvResponse = (csv: string, filename: string) =>
  new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });

export const auditCsv = (rows: AuditLogEntry[]) =>
  csvResponse(
    toCsv(
      ['occurredAt', 'tenantName', 'action', 'outcome', 'actor', 'targetLabel', 'reasonCode'],
      rows.map((r) => ({ ...r, actor: r.actor.displayName })),
    ),
    'audit-log.csv',
  );
