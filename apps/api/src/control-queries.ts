import { randomUUID } from "node:crypto";
import type { Actor } from "./database.js";
import type { Config } from "./config.js";
import { ControlWork } from "./control-work.js";
import { policy } from "./entitlements.js";
import { assert, canonical, cursorDecode, cursorEncode } from "./common.js";
import { present } from "./mutations.js";
import { listInput } from "../../../packages/contracts/src/index.js";
import {
  noteInput,
  platformAuditInput,
} from "../../../packages/contracts/src/platform.js";
export class ControlQueries {
  constructor(
    private control: ControlWork,
    private config: Config,
  ) {}
  async overview(actor: Actor) {
    return this.control.db.platformWork(actor, "tenant.read", async (tx) => {
      const rows = (
        await tx.query(
          "WITH catalog AS (SELECT t.id,t.status,EXISTS(SELECT 1 FROM control.access_grants g WHERE g.tenant_id=t.id AND g.starts_at<=now() AND g.ends_at>now()) AS has_access,(SELECT max(ends_at) FROM control.access_grants g WHERE g.tenant_id=t.id AND g.starts_at<=now() AND g.ends_at>now()) AS expires_at,EXISTS(SELECT 1 FROM control.access_grants g WHERE g.tenant_id=t.id AND g.provenance='phase1_migration') AS reconcile FROM control.tenants t) SELECT count(*)::int AS total,count(*) FILTER(WHERE status IN ('trial','pilot_free','active_paid','manual_override') AND has_access)::int AS active,count(*) FILTER(WHERE status IN ('trial','pilot_free','active_paid','manual_override') AND expires_at>now() AND expires_at<now()+interval '30 days')::int AS expiring,count(*) FILTER(WHERE reconcile)::int AS reconciliation FROM catalog",
        )
      ).rows[0];
      return rows;
    });
  }
  async detail(actor: Actor, t: string) {
    return this.control.db.platformWork(actor, "tenant.read", async (tx) => {
      const row = (
        await tx.query("SELECT * FROM control.tenants WHERE id=$1", [t])
      ).rows[0];
      assert(row, 404, "NOT_FOUND");
      const commercial = !!(
        await tx.query(
          "SELECT 1 FROM identity.effective_platform_permissions WHERE user_id=$1 AND permission='plan.read'",
          [actor.userId],
        )
      ).rowCount;
      return {
        ...present(row),
        entitlements: await policy(tx, t),
        subscriptions: commercial
          ? (
              await tx.query(
                "SELECT s.id,s.starts_at,s.ends_at,s.manual_reference,v.amount_minor,v.currency,v.child_cap,v.number,p.name FROM control.subscriptions s JOIN control.plan_versions v ON v.id=s.plan_version_id JOIN control.plans p ON p.id=v.plan_id WHERE s.tenant_id=$1 ORDER BY s.starts_at DESC",
                [t],
              )
            ).rows.map(present)
          : [],
        usage: present(
          (
            await tx.query(
              "SELECT * FROM control.tenant_usage WHERE tenant_id=$1",
              [t],
            )
          ).rows[0],
        ),
        grants: (
          await tx.query(
            "SELECT * FROM control.access_grants WHERE tenant_id=$1 ORDER BY ends_at DESC",
            [t],
          )
        ).rows.map(present),
        overrides: (
          await tx.query(
            "SELECT * FROM control.entitlement_overrides WHERE tenant_id=$1 ORDER BY starts_at DESC",
            [t],
          )
        ).rows.map(present),
      };
    });
  }
  async note(actor: Actor, t: string, input: unknown, key: string) {
    const b = noteInput.parse(input);
    return this.control.tenant(
      actor,
      t,
      "notes.write",
      "note.added",
      key,
      b,
      async (tx) => {
        await tx.query(
          "INSERT INTO control.tenant_notes(tenant_id,id,body,refund_status,actor_id) VALUES($1,$2,$3,$4,$5)",
          [t, randomUUID(), b.text, b.refundStatus ?? null, actor.userId],
        );
      },
      "support",
    );
  }
  async notes(actor: Actor, t: string, input: unknown) {
    const q = listInput.parse(input),
      scope = canonical({ actor: actor.userId, t, resource: "notes" }),
      after = cursorDecode(this.config.CURSOR_SECRET, scope, q.cursor);
    return this.control.db.platformWork(actor, "notes.read", async (tx) => {
      assert(
        (await tx.query("SELECT 1 FROM control.tenants WHERE id=$1", [t]))
          .rowCount,
        404,
        "NOT_FOUND",
      );
      const rows = (
        await tx.query(
          "SELECT * FROM control.tenant_notes WHERE tenant_id=$1 AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM control.tenant_notes WHERE tenant_id=$1 AND id=$2)) ORDER BY created_at DESC,id DESC LIMIT $3",
          [t, after, q.limit + 1],
        )
      ).rows;
      return {
        data: rows.slice(0, q.limit).map(present),
        nextCursor:
          rows.length > q.limit
            ? cursorEncode(
                this.config.CURSOR_SECRET,
                scope,
                rows[q.limit - 1].id,
              )
            : null,
      };
    });
  }
  async audit(actor: Actor, input: unknown) {
    const q = platformAuditInput.parse(input);
    assert(actor.audience === "platform", 403, "WRONG_AUDIENCE");
    return this.control.db.transaction(this.control.db.control, async (tx) => {
      const s = await this.control.db.checkSession(tx, actor, true);
      assert(s.mfa, 403, "MFA_REQUIRED");
      const permissions = (
        await tx.query(
          "SELECT permission FROM identity.effective_platform_permissions WHERE user_id=$1",
          [actor.userId],
        )
      ).rows.map((r) => r.permission as string);
      const categories = permissions.includes("audit.all")
        ? ["operations", "billing", "support"]
        : ["operations", "billing", "support"].filter((c) =>
            permissions.includes(`audit.${c}`),
          );
      assert(categories.length, 403, "FORBIDDEN");
      const scope = canonical({
          actor: actor.userId,
          resource: "platform.audit",
          from: q.from,
          to: q.to,
          tenantId: q.tenantId,
          actorId: q.actorId,
          action: q.action,
          categories,
        }),
        after = cursorDecode(this.config.CURSOR_SECRET, scope, q.cursor);
      const rows = (
        await tx.query(
          "SELECT * FROM control.audit_events WHERE category=ANY($1::text[]) AND created_at>=$2 AND created_at<=$3 AND ($4::uuid IS NULL OR tenant_id=$4) AND ($5::uuid IS NULL OR actor_id=$5) AND ($6::text IS NULL OR action=$6) AND ($7::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM control.audit_events WHERE id=$7)) ORDER BY created_at DESC,id DESC LIMIT $8",
          [
            categories,
            q.from,
            q.to,
            q.tenantId ?? null,
            q.actorId ?? null,
            q.action ?? null,
            after,
            q.limit + 1,
          ],
        )
      ).rows;
      return {
        data: rows.slice(0, q.limit).map(present),
        nextCursor:
          rows.length > q.limit
            ? cursorEncode(
                this.config.CURSOR_SECRET,
                scope,
                rows[q.limit - 1].id,
              )
            : null,
      };
    });
  }
}
