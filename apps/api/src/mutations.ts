import { randomUUID } from "node:crypto";
import type { Tx, Actor } from "./database.js";
import { assert, canonical, digest, requestId, context } from "./common.js";
export async function once<T>(
  tx: Tx,
  actor: Actor,
  tenantId: string | null,
  operation: string,
  key: string,
  input: unknown,
  work: () => Promise<T>,
): Promise<T> {
  const schema = tenantId ? "app" : "control";
  const fields = tenantId
    ? "tenant_id,actor_id,operation,key,digest"
    : "actor_id,operation,key,digest";
  const values = tenantId
    ? [tenantId, actor.userId, operation, key, digest(canonical(input))]
    : [actor.userId, operation, key, digest(canonical(input))];
  await tx.query(
    `INSERT INTO ${schema}.idempotency(${fields}) VALUES(${values.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT DO NOTHING`,
    values,
  );
  const where = tenantId
    ? "tenant_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4"
    : "actor_id=$1 AND operation=$2 AND key=$3";
  const identifiers = values.slice(0, -1);
  const record = (
    await tx.query(
      `SELECT digest,result,expires_at FROM ${schema}.idempotency WHERE ${where} FOR UPDATE`,
      identifiers,
    )
  ).rows[0];
  assert(record.digest === values.at(-1), 409, "IDEMPOTENCY_CONFLICT");
  assert(record.expires_at > new Date(), 409, "IDEMPOTENCY_KEY_EXPIRED");
  if (record.result !== null) return record.result as T;
  const result = await work();
  await tx.query(
    `UPDATE ${schema}.idempotency SET result=$${identifiers.length + 1} WHERE ${where}`,
    [...identifiers, JSON.stringify(result)],
  );
  return result;
}
export async function evidence(
  tx: Tx,
  actor: Actor,
  tenantId: string | null,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown> = {},
) {
  if (tenantId) {
    await tx.query(
      "INSERT INTO app.audit_events(tenant_id,id,actor_id,action,resource_id,request_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        tenantId,
        randomUUID(),
        actor.userId,
        action,
        resourceId,
        requestId(),
        JSON.stringify(metadata),
      ],
    );
    await tx.query(
      "INSERT INTO app.outbox(tenant_id,id,type,resource_id,request_id,payload) VALUES($1,$2,$3,$4,$5,$6)",
      [
        tenantId,
        randomUUID(),
        action,
        resourceId,
        requestId(),
        JSON.stringify({
          schemaVersion: 1,
          resourceId,
          correlationId: context.getStore()?.correlationId,
          traceId: context.getStore()?.traceId,
          ...metadata,
        }),
      ],
    );
  } else
    await tx.query(
      "INSERT INTO control.audit_events(id,actor_id,action,resource_id,request_id,metadata) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        actor.userId,
        action,
        resourceId,
        requestId(),
        JSON.stringify(metadata),
      ],
    );
}
export function present(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !["tenant_id", "user_id"].includes(key))
      .map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        value instanceof Date ? value.toISOString() : value,
      ]),
  );
}
