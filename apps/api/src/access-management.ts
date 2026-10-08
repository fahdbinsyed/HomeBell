import { randomUUID } from "node:crypto";
import type { Actor } from "./database.js";
import { ControlWork } from "./control-work.js";
import { assert } from "./common.js";
import { policy } from "./entitlements.js";
import {
  grantInput,
  lifecycleInput,
  overrideInput,
  extensionInput,
  command,
} from "../../../packages/contracts/src/platform.js";
export class AccessManagement {
  constructor(private control: ControlWork) {}
  async lifecycle(actor: Actor, t: string, input: unknown, key: string) {
    const parsed = grantInput.safeParse(input);
    if (parsed.success) {
      const b = parsed.data,
        kind = {
          start_trial: "trial",
          grant_free: "pilot_free",
          grant_manual: "manual_override",
        }[b.action];
      return this.control.tenant(
        actor,
        t,
        "access.manage",
        `access.${b.action}`,
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
          assert(
            new Date(b.startsAt) <= new Date() &&
              new Date(b.endsAt) > new Date(),
            400,
            "TERM_MUST_BE_CURRENT",
          );
          assert(
            !(
              await tx.query(
                "SELECT 1 FROM control.access_grants WHERE tenant_id=$1 AND starts_at<$3 AND ends_at>$2",
                [t, b.startsAt, b.endsAt],
              )
            ).rowCount,
            409,
            "OVERLAPPING_GRANT",
          );
          await this.control.cap(tx, t, b.childCap);
          await tx.query(
            "INSERT INTO control.access_grants(tenant_id,id,kind,starts_at,ends_at,child_cap,capabilities,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              t,
              randomUUID(),
              kind,
              b.startsAt,
              b.endsAt,
              b.childCap,
              b.capabilities,
              "operator_assignment",
            ],
          );
          await tx.query("UPDATE control.tenants SET status=$2 WHERE id=$1", [
            t,
            kind,
          ]);
        },
      );
    }
    const b = lifecycleInput.parse(input);
    return this.control.tenant(
      actor,
      t,
      "tenant.lifecycle",
      `tenant.${b.action}`,
      key,
      b,
      async (tx, current) => {
        let status: string;
        if (b.action === "activate" || b.action === "reinstate") {
          assert(
            current.status !== "offboarding",
            409,
            "INVALID_LIFECYCLE_TRANSITION",
          );
          assert(
            b.action === "activate"
              ? current.status === "draft"
              : ["suspended", "deactivated", "cancelled", "expired"].includes(
                  String(current.status),
                ),
            409,
            "INVALID_LIFECYCLE_TRANSITION",
          );
          const grant = (
            await tx.query(
              "SELECT kind,child_cap FROM control.access_grants WHERE tenant_id=$1 AND starts_at<=now() AND ends_at>now() ORDER BY ends_at DESC LIMIT 1",
              [t],
            )
          ).rows[0];
          assert(grant, 409, "NO_VALID_ACCESS_BASIS");
          status = grant.kind === "legacy" ? "manual_override" : grant.kind;
        } else {
          const states = {
            suspend: "suspended",
            deactivate: "deactivated",
            cancel: "cancelled",
            offboard: "offboarding",
          };
          status = states[b.action];
          assert(
            current.status !== "offboarding" && current.status !== status,
            409,
            "INVALID_LIFECYCLE_TRANSITION",
          );
        }
        await tx.query("UPDATE control.tenants SET status=$2 WHERE id=$1", [
          t,
          status,
        ]);
      },
      "operations",
    );
  }
  async extend(actor: Actor, t: string, input: unknown, key: string) {
    const b = extensionInput.parse(input);
    return this.control.tenant(
      actor,
      t,
      "access.manage",
      "access.extended",
      key,
      b,
      async (tx) => {
        const g = (
          await tx.query(
            "SELECT * FROM control.access_grants WHERE tenant_id=$1 AND id=$2",
            [t, b.grantId],
          )
        ).rows[0];
        assert(g, 404, "NOT_FOUND");
        assert(new Date(b.endsAt) > g.ends_at, 400, "INVALID_EXTENSION");
        assert(
          !(
            await tx.query(
              "SELECT 1 FROM control.access_grants WHERE tenant_id=$1 AND id<>$2 AND starts_at<$3 AND ends_at>$4",
              [t, b.grantId, b.endsAt, g.ends_at],
            )
          ).rowCount,
          409,
          "OVERLAPPING_GRANT",
        );
        await this.control.cap(tx, t, g.child_cap);
        if (g.kind === "active_paid")
          await tx.query(
            "INSERT INTO control.access_grants(tenant_id,id,kind,starts_at,ends_at,child_cap,capabilities,provenance) VALUES($1,$2,'manual_override',$3,$4,$5,$6,'complimentary_extension')",
            [t, randomUUID(), g.ends_at, b.endsAt, g.child_cap, g.capabilities],
          );
        else
          await tx.query(
            "UPDATE control.access_grants SET ends_at=$3 WHERE tenant_id=$1 AND id=$2",
            [t, b.grantId, b.endsAt],
          );
      },
    );
  }
  async override(actor: Actor, t: string, input: unknown, key: string) {
    const b = overrideInput.parse(input);
    return this.control.tenant(
      actor,
      t,
      "access.manage",
      "override.created",
      key,
      b,
      async (tx) => {
        assert(
          !(
            await tx.query(
              "SELECT 1 FROM control.entitlement_overrides WHERE tenant_id=$1 AND target=$2 AND revoked_at IS NULL AND starts_at<$4 AND ends_at>$3",
              [t, b.target, b.startsAt, b.endsAt],
            )
          ).rowCount,
          409,
          "OVERLAPPING_GRANT",
        );
        if (b.target === "childCap")
          await this.control.cap(tx, t, b.value as number);
        await tx.query(
          "INSERT INTO control.entitlement_overrides(tenant_id,id,target,bool_value,int_value,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            t,
            randomUUID(),
            b.target,
            typeof b.value === "boolean" ? b.value : null,
            typeof b.value === "number" ? b.value : null,
            b.startsAt,
            b.endsAt,
          ],
        );
      },
    );
  }
  async revoke(
    actor: Actor,
    t: string,
    id: string,
    input: unknown,
    key: string,
  ) {
    const b = command.parse(input);
    return this.control.tenant(
      actor,
      t,
      "access.manage",
      `override.${id}.revoked`,
      key,
      b,
      async (tx) => {
        const revoked = (
          await tx.query(
            "UPDATE control.entitlement_overrides SET revoked_at=now() WHERE tenant_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING target",
            [t, id],
          )
        ).rows[0];
        assert(revoked, 404, "NOT_FOUND");
        const p = await policy(tx, t);
        if (revoked.target === "childCap")
          await this.control.cap(tx, t, p.childCap);
      },
    );
  }
}
