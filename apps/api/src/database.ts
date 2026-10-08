import pg from "pg";
import type { Config } from "./config.js";
import type { Audience } from "../../../packages/contracts/src/index.js";
import { assert, requestId, logger } from "./common.js";
import { randomUUID } from "node:crypto";
import { policy } from "./entitlements.js";

export interface Actor {
  userId: string;
  sessionId: string;
  audience: Audience;
}
export type Tx = pg.PoolClient;
export class Database {
  readonly policyMetrics = { entitlementDenials: 0, lifecycleConflicts: 0 };
  readonly identity: pg.Pool;
  readonly tenant: pg.Pool;
  readonly control: pg.Pool;
  constructor(config: Config) {
    const pool = (connectionString: string) =>
      new pg.Pool({
        connectionString,
        max: 10,
        connectionTimeoutMillis: 3000,
        statement_timeout: 5000,
        idle_in_transaction_session_timeout: 10000,
      });
    this.identity = pool(config.IDENTITY_DATABASE_URL);
    this.tenant = pool(config.TENANT_DATABASE_URL);
    this.control = pool(config.CONTROL_DATABASE_URL);
    for (const p of [this.identity, this.tenant, this.control])
      p.on("error", () =>
        logger.error(
          { event: "database.pool_error" },
          "Database connection unavailable",
        ),
      );
  }
  async transaction<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = await pool.connect();
    let broken = false;
    try {
      await tx.query("BEGIN");
      const result = await fn(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await tx.query("ROLLBACK");
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      tx.release(broken);
    }
  }
  async checkSession(tx: Tx, actor: Actor, lock: boolean | "update" = false) {
    const users = await tx.query(
      "SELECT id,status,security_version,active_device_id FROM identity.users WHERE id=$1" +
        (lock ? " FOR SHARE" : ""),
      [actor.userId],
    );
    const user = users.rows[0];
    const sessions = await tx.query(
      "SELECT id,user_id,audience,security_version,mfa,device_id,expires_at,idle_until,revoked_at FROM identity.sessions WHERE id=$1 AND user_id=$2" +
        (lock === "update" ? " FOR UPDATE" : lock ? " FOR SHARE" : ""),
      [actor.sessionId, actor.userId],
    );
    const s = sessions.rows[0];
    assert(
      user &&
        s &&
        user.status === "active" &&
        !s.revoked_at &&
        s.audience === actor.audience &&
        s.security_version === user.security_version &&
        s.expires_at > new Date() &&
        s.idle_until > new Date(),
      401,
      "SESSION_INVALID",
    );
    if (actor.audience === "guardian")
      assert(
        s.device_id && s.device_id === user.active_device_id,
        401,
        "SESSION_INVALID",
      );
    return s;
  }
  async tenantWork<T>(
    actor: Actor,
    tenantId: string,
    permission: string,
    fn: (tx: Tx) => Promise<T>,
  ) {
    assert(actor.audience === "school", 403, "WRONG_AUDIENCE");
    return this.transaction(this.tenant, async (tx) => {
      await tx.query(
        "SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)",
        [tenantId, actor.userId],
      );
      const session = await this.checkSession(tx, actor, true);
      const t = (
        await tx.query(
          "SELECT id,status,access_until FROM control.tenants WHERE id=$1 FOR SHARE",
          [tenantId],
        )
      ).rows[0];
      const m = (
        await tx.query(
          "SELECT role_id,active FROM app.memberships WHERE tenant_id=$1 AND user_id=$2 FOR SHARE",
          [tenantId, actor.userId],
        )
      ).rows[0];
      assert(t && m?.active, 404, "NOT_FOUND");
      const access = await policy(tx, tenantId);
      if (!access.allowed || !access.capabilities.includes(permission))
        this.policyMetrics.entitlementDenials++;
      assert(access.allowed, 403, "TENANT_UNAVAILABLE");
      assert(
        access.capabilities.includes(permission),
        403,
        "ENTITLEMENT_DENIED",
      );
      const p = await tx.query(
        "SELECT 1 FROM app.role_permissions WHERE tenant_id=$1 AND role_id=$2 AND permission=$3",
        [tenantId, m.role_id, permission],
      );
      assert(p.rowCount, 403, "FORBIDDEN");
      const role = (
        await tx.query(
          "SELECT name FROM app.roles WHERE tenant_id=$1 AND id=$2",
          [tenantId, m.role_id],
        )
      ).rows[0];
      if (role?.name === "School Admin")
        assert(session.mfa, 403, "MFA_REQUIRED");
      return fn(tx);
    });
  }
  async platformWork<T>(
    actor: Actor,
    permission: string,
    fn: (tx: Tx) => Promise<T>,
  ) {
    assert(actor.audience === "platform", 403, "WRONG_AUDIENCE");
    return this.transaction(this.control, async (tx) => {
      const s = await this.checkSession(tx, actor, true);
      assert(s.mfa, 403, "MFA_REQUIRED");
      assert(
        (
          await tx.query(
            "SELECT 1 FROM identity.effective_platform_permissions WHERE user_id=$1 AND permission=$2",
            [actor.userId, permission],
          )
        ).rowCount,
        403,
        "FORBIDDEN",
      );
      return fn(tx);
    });
  }
  async securityEvent(action: string, actorId: string | null = null, tx?: Tx) {
    await (tx ?? this.identity).query(
      "INSERT INTO identity.security_events(id,actor_id,action,request_id) VALUES($1,$2,$3,$4)",
      [randomUUID(), actorId, action, requestId()],
    );
  }
  async close() {
    await Promise.all([
      this.identity.end(),
      this.tenant.end(),
      this.control.end(),
    ]);
  }
}
