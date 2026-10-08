import { randomUUID } from "node:crypto";
import { Database, type Actor, type Tx } from "./database.js";
import { assert, requestId } from "./common.js";
import { evidence, once, present } from "./mutations.js";
import { policy } from "./entitlements.js";
export class ControlWork {
  constructor(readonly db: Database) {}
  async tenant(
    actor: Actor,
    t: string,
    permission: string,
    operation: string,
    key: string,
    body: { expectedVersion: number; reason: string },
    work: (tx: Tx, current: Record<string, unknown>) => Promise<void>,
    category = "billing",
  ) {
    return this.db.platformWork(actor, permission, (tx) =>
      once(tx, actor, null, `${t}.${operation}`, key, body, async () => {
        await tx.query("SELECT set_config('app.tenant_id',$1,true)", [t]);
        const current = (
          await tx.query(
            "SELECT * FROM control.tenants WHERE id=$1 FOR UPDATE",
            [t],
          )
        ).rows[0];
        assert(current, 404, "NOT_FOUND");
        if (current.version !== body.expectedVersion)
          this.db.policyMetrics.lifecycleConflicts++;
        assert(
          current.version === body.expectedVersion,
          409,
          "VERSION_CONFLICT",
        );
        await work(tx, current);
        const effective = await policy(tx, t);
        if (effective.allowed) await this.cap(tx, t, effective.childCap);
        const row = (
          await tx.query(
            "UPDATE control.tenants SET version=version+1,access_until=$2 WHERE id=$1 RETURNING *",
            [t, effective.expiresAt],
          )
        ).rows[0];
        if (row.status !== current.status)
          await tx.query(
            "INSERT INTO control.lifecycle_history(tenant_id,id,previous_status,status,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6)",
            [
              t,
              randomUUID(),
              current.status,
              row.status,
              body.reason,
              actor.userId,
            ],
          );
        await this.audit(
          tx,
          actor,
          t,
          operation,
          t,
          {
            input: Object.fromEntries(
              Object.entries(body).filter(([field]) => field !== "text"),
            ),
            version: row.version,
          },
          category,
        );
        await evidence(tx, actor, t, operation, t, {
          version: row.version,
          status: row.status,
        });
        return { ...present(row), entitlements: await policy(tx, t) };
      }),
    );
  }
  async audit(
    tx: Tx,
    actor: Actor,
    t: string | null,
    action: string,
    resource: string,
    metadata: Record<string, unknown>,
    category: string,
  ) {
    await tx.query(
      "INSERT INTO control.audit_events(id,actor_id,tenant_id,action,resource_id,request_id,metadata,category) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        actor.userId,
        t,
        action,
        resource,
        requestId(),
        JSON.stringify(metadata),
        category,
      ],
    );
  }
  async cap(tx: Tx, t: string, cap: number) {
    const usage = (
      await tx.query(
        "SELECT active_students FROM control.tenant_usage WHERE tenant_id=$1",
        [t],
      )
    ).rows[0];
    assert(usage && cap >= usage.active_students, 409, "CAP_BELOW_USAGE");
  }
}
