import { randomUUID } from "node:crypto";
import { Database, type Actor } from "./database.js";
import type { Config } from "./config.js";
import { canonical, cursorDecode, cursorEncode } from "./common.js";
import { evidence, once, present } from "./mutations.js";
import { tenantListInput } from "../../../packages/contracts/src/platform.js";
import { policy } from "./entitlements.js";
import { ControlWork } from "./control-work.js";
import { tenantInput } from "../../../packages/contracts/src/index.js";
export const schoolPermissions = [
  "tenant.read",
  "school.records.read",
  "school.records.write",
  "guardians.read",
  "guardians.manage",
  "audit.read",
];
export class Platform {
  constructor(
    private db: Database,
    private config: Config,
  ) {}
  async create(actor: Actor, input: unknown, key: string) {
    const body = tenantInput.parse(input);
    return this.db.platformWork(actor, "tenant.create", (tx) =>
      once(tx, actor, null, "tenant.create", key, body, async () => {
        const id = randomUUID();
        const row = (
          await tx.query(
            "INSERT INTO control.tenants(id,name,time_zone) VALUES($1,$2,$3) RETURNING id,name,time_zone,status,version",
            [id, body.name, body.timeZone],
          )
        ).rows[0];
        await tx.query(
          "INSERT INTO control.tenant_usage(tenant_id) VALUES($1)",
          [id],
        );
        await tx.query("SELECT set_config('app.tenant_id',$1,true)", [id]);
        await tx.query(
          "INSERT INTO app.campuses(tenant_id,id,name) VALUES($1,$2,$3)",
          [id, randomUUID(), "Main"],
        );
        for (const [name, permissions] of [
          ["School Admin", schoolPermissions],
          [
            "Read Only",
            [
              "tenant.read",
              "school.records.read",
              "guardians.read",
              "audit.read",
            ],
          ],
        ] as const) {
          const role = randomUUID();
          await tx.query(
            "INSERT INTO app.roles(tenant_id,id,name) VALUES($1,$2,$3)",
            [id, role, name],
          );
          for (const permission of permissions)
            await tx.query(
              "INSERT INTO app.role_permissions(tenant_id,role_id,permission) VALUES($1,$2,$3)",
              [id, role, permission],
            );
        }
        await new ControlWork(this.db).audit(
          tx,
          actor,
          id,
          "tenant.created",
          id,
          {
            status: "draft",
          },
          "operations",
        );
        await evidence(tx, actor, id, "tenant.created", id, {
          status: "draft",
        });
        return present(row);
      }),
    );
  }
  async list(actor: Actor, input: unknown) {
    const query = tenantListInput.parse(input),
      scope = canonical({
        actor: actor.userId,
        resource: "platform.tenants",
        search: query.search,
        status: query.status,
      });
    const after = cursorDecode(this.config.CURSOR_SECRET, scope, query.cursor);
    return this.db.platformWork(actor, "tenant.read", async (tx) => {
      const rows = (
        await tx.query(
          "WITH catalog AS (SELECT t.*,CASE WHEN status IN ('trial','pilot_free','active_paid','manual_override') AND NOT EXISTS(SELECT 1 FROM control.access_grants g WHERE g.tenant_id=t.id AND g.starts_at<=now() AND g.ends_at>now()) THEN 'expired' ELSE status END AS effective_state FROM control.tenants t) SELECT * FROM catalog WHERE ($1::uuid IS NULL OR id>$1) AND ($3::text IS NULL OR strpos(lower(name),lower($3))>0) AND ($4::text IS NULL OR effective_state=$4) ORDER BY id LIMIT $2",
          [after, query.limit + 1, query.search ?? null, query.status ?? null],
        )
      ).rows;
      const page = rows.slice(0, query.limit);
      const data = [];
      for (const row of page)
        data.push({
          ...present(row),
          entitlements: await policy(tx, row.id),
          usage: present(
            (
              await tx.query(
                "SELECT * FROM control.tenant_usage WHERE tenant_id=$1",
                [row.id],
              )
            ).rows[0],
          ),
        });
      return {
        data,
        nextCursor:
          rows.length > query.limit
            ? cursorEncode(
                this.config.CURSOR_SECRET,
                scope,
                page.at(-1)!.id as string,
              )
            : null,
      };
    });
  }
}
