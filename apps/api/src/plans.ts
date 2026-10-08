import { randomUUID } from "node:crypto";
import type { Actor } from "./database.js";
import { ControlWork } from "./control-work.js";
import { assert, canonical, cursorDecode, cursorEncode } from "./common.js";
import type { Config } from "./config.js";
import { listInput } from "../../../packages/contracts/src/index.js";
import { once, present } from "./mutations.js";
import {
  command,
  planInput,
  versionInput,
  subscriptionInput,
} from "../../../packages/contracts/src/platform.js";
import { annualEnd } from "./entitlements.js";
export class Plans {
  constructor(
    private control: ControlWork,
    private config: Config,
  ) {}
  async list(actor: Actor, input: unknown = {}) {
    const q = listInput.parse(input),
      scope = canonical({ actor: actor.userId, resource: "plans" }),
      after = cursorDecode(this.config.CURSOR_SECRET, scope, q.cursor);
    return this.control.db.platformWork(actor, "plan.read", async (tx) => {
      const rows = (
        await tx.query(
          "SELECT p.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'number',v.number,'amountMinor',v.amount_minor,'childCap',v.child_cap,'capabilities',v.capabilities) ORDER BY number DESC) FROM control.plan_versions v WHERE v.plan_id=p.id),'[]') AS versions FROM control.plans p WHERE ($1::uuid IS NULL OR p.id>$1) ORDER BY p.id LIMIT $2",
          [after, q.limit + 1],
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
  async create(actor: Actor, input: unknown, key: string) {
    const body = planInput.parse(input);
    return this.control.db.platformWork(actor, "plan.manage", (tx) =>
      once(tx, actor, null, "plan.create", key, body, async () => {
        const row = (
          await tx.query(
            "INSERT INTO control.plans(id,name,code) VALUES($1,$2,$3) RETURNING *",
            [randomUUID(), body.name, body.code],
          )
        ).rows[0];
        await this.control.audit(
          tx,
          actor,
          null,
          "plan.created",
          row.id,
          { reason: body.reason },
          "billing",
        );
        return present(row);
      }),
    );
  }
  async change(
    actor: Actor,
    id: string,
    input: unknown,
    key: string,
    archive = false,
  ) {
    const body = archive ? command.parse(input) : versionInput.parse(input);
    return this.control.db.platformWork(actor, "plan.manage", (tx) =>
      once(
        tx,
        actor,
        null,
        `plan.${id}.${archive ? "archive" : "publish"}`,
        key,
        body,
        async () => {
          const plan = (
            await tx.query(
              "SELECT * FROM control.plans WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          assert(plan, 404, "NOT_FOUND");
          assert(
            plan.version === body.expectedVersion,
            409,
            "VERSION_CONFLICT",
          );
          assert(!plan.archived, 409, "PLAN_ARCHIVED");
          if (!archive) {
            const v = versionInput.parse(body);
            await tx.query(
              "INSERT INTO control.plan_versions(id,plan_id,number,amount_minor,child_cap,capabilities) VALUES($1,$2,$3,$4,$5,$6)",
              [
                randomUUID(),
                id,
                plan.version,
                v.amountMinor,
                v.childCap,
                v.capabilities,
              ],
            );
          }
          const row = (
            await tx.query(
              "UPDATE control.plans SET version=version+1,archived=$2 WHERE id=$1 RETURNING *",
              [id, archive],
            )
          ).rows[0];
          await this.control.audit(
            tx,
            actor,
            null,
            archive ? "plan.archived" : "plan.published",
            id,
            { reason: body.reason, version: row.version },
            "billing",
          );
          return present(row);
        },
      ),
    );
  }
  async subscribe(actor: Actor, t: string, input: unknown, key: string) {
    const b = subscriptionInput.parse(input),
      end = annualEnd(b.startsAt);
    return this.control.tenant(
      actor,
      t,
      "access.manage",
      "subscription.assigned",
      key,
      b,
      async (tx, current) => {
        assert(
          !["suspended", "deactivated", "cancelled", "offboarding"].includes(
            String(current.status),
          ),
          409,
          "INVALID_LIFECYCLE_TRANSITION",
        );
        const v = (
          await tx.query(
            "SELECT v.* FROM control.plan_versions v JOIN control.plans p ON p.id=v.plan_id WHERE v.id=$1 AND NOT p.archived FOR SHARE OF p",
            [b.planVersionId],
          )
        ).rows[0];
        assert(v, 404, "NOT_FOUND");
        assert(
          new Date(b.startsAt) <= new Date() && new Date(end) > new Date(),
          400,
          "TERM_MUST_BE_CURRENT",
        );
        assert(
          !(
            await tx.query(
              "SELECT 1 FROM control.access_grants WHERE tenant_id=$1 AND starts_at<$3 AND ends_at>$2 AND (kind='active_paid' OR starts_at>=clock_timestamp())",
              [t, b.startsAt, end],
            )
          ).rowCount,
          409,
          "OVERLAPPING_GRANT",
        );
        await this.control.cap(tx, t, v.child_cap);
        // An explicit annual assignment replaces current non-paid access;
        // keep its row and original grant audit rather than inventing a payment.
        await tx.query(
          "UPDATE control.access_grants SET ends_at=clock_timestamp() WHERE tenant_id=$1 AND kind<>'active_paid' AND starts_at<clock_timestamp() AND ends_at>clock_timestamp()",
          [t],
        );
        const id = randomUUID();
        await tx.query(
          "INSERT INTO control.subscriptions(tenant_id,id,plan_version_id,starts_at,ends_at,manual_reference,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            t,
            id,
            b.planVersionId,
            b.startsAt,
            end,
            b.manualReference,
            b.reason,
            actor.userId,
          ],
        );
        await tx.query(
          "INSERT INTO control.access_grants(tenant_id,id,kind,starts_at,ends_at,child_cap,capabilities,subscription_id,provenance) VALUES($1,$2,'active_paid',$3,$4,$5,$6,$7,'manual_commercial_assignment')",
          [t, randomUUID(), b.startsAt, end, v.child_cap, v.capabilities, id],
        );
        await tx.query(
          "UPDATE control.tenants SET status='active_paid' WHERE id=$1",
          [t],
        );
      },
    );
  }
}
