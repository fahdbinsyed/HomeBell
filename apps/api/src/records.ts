import { randomUUID } from "node:crypto";
import { Database, type Actor } from "./database.js";
import type { Config } from "./config.js";
import { assert, canonical, cursorDecode, cursorEncode } from "./common.js";
import { once, evidence, present } from "./mutations.js";
import { admitStudent } from "./entitlements.js";
import {
  accessInput,
  auditInput,
  classInput,
  guardianInput,
  linkInput,
  listInput,
  sectionInput,
  studentInput,
  studentPatch,
} from "../../../packages/contracts/src/index.js";
export type Resource = "classes" | "sections" | "students" | "guardians";
const schemas = {
  classes: classInput,
  sections: sectionInput,
  students: studentInput,
  guardians: guardianInput,
};
const columns = {
  classes: ["name"],
  sections: ["name", "class_id"],
  students: ["display_name", "class_id", "section_id"],
  guardians: ["full_name", "phone"],
};
const permission = (resource: Resource, write: boolean) =>
  resource === "guardians"
    ? `guardians.${write ? "manage" : "read"}`
    : `school.records.${write ? "write" : "read"}`;
export class Records {
  constructor(
    private db: Database,
    private config: Config,
  ) {}
  async tenant(actor: Actor, t: string) {
    return this.db.tenantWork(actor, t, "tenant.read", async (tx) =>
      present(
        (
          await tx.query(
            "SELECT id,name,time_zone,status,version FROM control.tenants WHERE id=$1",
            [t],
          )
        ).rows[0],
      ),
    );
  }
  async list(actor: Actor, t: string, resource: Resource, input: unknown) {
    const query = listInput.parse(input),
      scope = canonical({ t, actor: actor.userId, resource });
    const after = cursorDecode(this.config.CURSOR_SECRET, scope, query.cursor);
    return this.db.tenantWork(
      actor,
      t,
      permission(resource, false),
      async (tx) => {
        const rows = (
          await tx.query(
            `SELECT * FROM app.${resource} WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3`,
            [t, after, query.limit + 1],
          )
        ).rows;
        const page = rows.slice(0, query.limit);
        return {
          data: page.map(present),
          nextCursor:
            rows.length > query.limit
              ? cursorEncode(
                  this.config.CURSOR_SECRET,
                  scope,
                  page.at(-1)!.id as string,
                )
              : null,
        };
      },
    );
  }
  async create(
    actor: Actor,
    t: string,
    resource: Resource,
    input: unknown,
    key: string,
  ) {
    const body = schemas[resource].parse(input) as Record<string, unknown>;
    const values = columns[resource].map(
      (column) =>
        body[column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] ??
        null,
    );
    return this.db.tenantWork(actor, t, permission(resource, true), (tx) =>
      once(tx, actor, t, `${resource}.create`, key, body, async () => {
        if (resource === "students") await admitStudent(tx, t);
        const id = randomUUID(),
          cols = columns[resource];
        const result = (
          await tx.query(
            `INSERT INTO app.${resource}(tenant_id,id,${cols.join(",")}) VALUES($1,$2,${cols.map((_, i) => `$${i + 3}`).join(",")}) RETURNING *`,
            [t, id, ...values],
          )
        ).rows[0];
        await evidence(tx, actor, t, `${resource}.created`, id, { version: 1 });
        return present(result);
      }),
    );
  }
  async student(actor: Actor, t: string, id: string) {
    return this.db.tenantWork(actor, t, "school.records.read", async (tx) => {
      const row = (
        await tx.query(
          "SELECT * FROM app.students WHERE tenant_id=$1 AND id=$2",
          [t, id],
        )
      ).rows[0];
      assert(row, 404, "NOT_FOUND");
      return present(row);
    });
  }
  async updateStudent(
    actor: Actor,
    t: string,
    id: string,
    input: unknown,
    key: string,
  ) {
    const body = studentPatch.parse(input);
    return this.db.tenantWork(actor, t, "school.records.write", (tx) =>
      once(tx, actor, t, `students.${id}.update`, key, body, async () => {
        const current = (
          await tx.query(
            "SELECT * FROM app.students WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [t, id],
          )
        ).rows[0];
        assert(current, 404, "NOT_FOUND");
        assert(
          current.version === body.expectedVersion,
          409,
          "VERSION_CONFLICT",
        );
        const section =
          body.sectionId === undefined ? current.section_id : body.sectionId;
        if (current.status !== "active" && body.status === "active")
          await admitStudent(tx, t);
        const row = (
          await tx.query(
            "UPDATE app.students SET display_name=$3,class_id=$4,section_id=$5,status=$6,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [
              t,
              id,
              body.displayName ?? current.display_name,
              body.classId ?? current.class_id,
              section,
              body.status ?? current.status,
            ],
          )
        ).rows[0];
        await evidence(tx, actor, t, "student.updated", id, {
          previousVersion: current.version,
          version: row.version,
          status: row.status,
        });
        return present(row);
      }),
    );
  }
  async link(
    actor: Actor,
    t: string,
    studentId: string,
    input: unknown,
    key: string,
  ) {
    const body = linkInput.parse(input);
    return this.db.tenantWork(actor, t, "guardians.manage", (tx) =>
      once(tx, actor, t, `students.${studentId}.link`, key, body, async () => {
        const guardian = (
          await tx.query(
            "SELECT status FROM app.guardians WHERE tenant_id=$1 AND id=$2 FOR SHARE",
            [t, body.guardianId],
          )
        ).rows[0];
        assert(guardian, 404, "NOT_FOUND");
        assert(guardian.status === "active", 409, "GUARDIAN_UNAVAILABLE");
        const id = randomUUID();
        const row = (
          await tx.query(
            "INSERT INTO app.guardian_links(tenant_id,id,student_id,guardian_id,role,relationship) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [t, id, studentId, body.guardianId, body.role, body.relationship],
          )
        ).rows[0];
        await evidence(tx, actor, t, "guardian.linked", id, {
          studentId,
          guardianId: body.guardianId,
          role: body.role,
        });
        return present(row);
      }),
    );
  }
  async guardianAccess(
    actor: Actor,
    t: string,
    id: string,
    input: unknown,
    key: string,
  ) {
    const body = accessInput.parse(input);
    return this.db.tenantWork(actor, t, "guardians.manage", (tx) =>
      once(tx, actor, t, `guardians.${id}.access`, key, body, async () => {
        const current = (
          await tx.query(
            "SELECT * FROM app.guardians WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [t, id],
          )
        ).rows[0];
        assert(current, 404, "NOT_FOUND");
        assert(
          current.version === body.expectedVersion,
          409,
          "VERSION_CONFLICT",
        );
        const status = body.action === "block" ? "blocked" : "deactivated";
        const row = (
          await tx.query(
            "UPDATE app.guardians SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [t, id, status],
          )
        ).rows[0];
        await evidence(tx, actor, t, "guardian.access_changed", id, {
          previousStatus: current.status,
          status,
          reason: body.reason,
          version: row.version,
        });
        return present(row);
      }),
    );
  }
  async audit(actor: Actor, t: string, input: unknown) {
    const query = auditInput.parse(input),
      scope = canonical({
        t,
        actor: actor.userId,
        resource: "audit",
        from: query.from,
        to: query.to,
      });
    const after = cursorDecode(this.config.CURSOR_SECRET, scope, query.cursor);
    return this.db.tenantWork(actor, t, "audit.read", async (tx) => {
      const rows = (
        await tx.query(
          "SELECT * FROM app.audit_events WHERE tenant_id=$1 AND created_at >= $2 AND created_at <= $3 AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT $5",
          [t, query.from, query.to, after, query.limit + 1],
        )
      ).rows;
      const page = rows.slice(0, query.limit);
      return {
        data: page.map(present),
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
