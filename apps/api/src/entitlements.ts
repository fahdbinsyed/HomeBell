import type { Tx } from "./database.js";
import { assert } from "./common.js";

export const operationalStates = [
  "trial",
  "pilot_free",
  "active_paid",
  "manual_override",
];
export function annualEnd(start: string): string {
  const date = new Date(start),
    month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.toISOString();
}
export interface Grant {
  id: string;
  kind: string;
  starts_at: Date;
  ends_at: Date;
  child_cap: number;
  capabilities: string[];
  provenance: string;
}
export interface Override {
  target: string;
  bool_value: boolean | null;
  int_value: number | null;
  starts_at: Date;
  ends_at: Date;
  revoked_at: Date | null;
}
export function resolvePolicy(
  status: string,
  version: number,
  grants: Grant[],
  overrides: Override[],
  now = new Date(),
) {
  const current = grants.filter((g) => g.starts_at <= now && g.ends_at > now);
  const activeOverrides = overrides.filter(
    (o) => !o.revoked_at && o.starts_at <= now && o.ends_at > now,
  );
  const capabilities = new Set(current.flatMap((g) => g.capabilities));
  let childCap = Math.max(0, ...current.map((g) => g.child_cap));
  for (const o of activeOverrides) {
    if (o.target === "childCap") childCap = o.int_value!;
    else if (o.bool_value) capabilities.add(o.target);
  }
  for (const o of activeOverrides)
    if (o.bool_value === false) capabilities.delete(o.target);
  const allowed = operationalStates.includes(status) && current.length > 0;
  return {
    allowed,
    reason: !operationalStates.includes(status)
      ? "LIFECYCLE_DENIED"
      : current.length
        ? "ACCESS_GRANTED"
        : "NO_VALID_ACCESS_BASIS",
    version,
    childCap,
    capabilities: allowed ? [...capabilities] : [],
    expiresAt: current.length
      ? new Date(Math.max(...current.map((g) => +g.ends_at))).toISOString()
      : null,
    provenance: current.map((g) => ({
      id: g.id,
      kind: g.kind,
      source: g.provenance,
    })),
    effectiveState:
      operationalStates.includes(status) && !current.length
        ? "expired"
        : status,
  };
}
export async function policy(tx: Tx, tenantId: string) {
  const t = (
    await tx.query("SELECT status,version FROM control.tenants WHERE id=$1", [
      tenantId,
    ])
  ).rows[0];
  assert(t, 404, "NOT_FOUND");
  const grants = (
    await tx.query<Grant>(
      "SELECT * FROM control.access_grants WHERE tenant_id=$1",
      [tenantId],
    )
  ).rows;
  const overrides = (
    await tx.query<Override>(
      "SELECT * FROM control.entitlement_overrides WHERE tenant_id=$1",
      [tenantId],
    )
  ).rows;
  return resolvePolicy(t.status, t.version, grants, overrides);
}
export async function admitStudent(tx: Tx, tenantId: string) {
  const usage = (
    await tx.query(
      "SELECT active_students FROM control.tenant_usage WHERE tenant_id=$1 FOR UPDATE",
      [tenantId],
    )
  ).rows[0];
  const effective = await policy(tx, tenantId);
  const futureCap = (
    await tx.query(
      "SELECT min(int_value) AS cap FROM control.entitlement_overrides WHERE tenant_id=$1 AND target='childCap' AND revoked_at IS NULL AND ends_at>now()",
      [tenantId],
    )
  ).rows[0]?.cap;
  assert(
    usage &&
      effective.allowed &&
      usage.active_students <
        Math.min(effective.childCap, futureCap ?? effective.childCap),
    409,
    "LICENSE_LIMIT_REACHED",
  );
}
