import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import pg from "pg";
loadEnvFile(process.env.ENV_FILE ?? ".env");
const { values } = parseArgs({
  options: {
    issuer: { type: "string" },
    subject: { type: "string" },
    kind: { type: "string" },
    tenant: { type: "string" },
    role: { type: "string" },
    operator: { type: "string" },
    reason: { type: "string" },
  },
});
if (
  !values.issuer ||
  !values.subject ||
  !["platform", "school"].includes(values.kind) ||
  !values.operator ||
  !values.reason
)
  throw new Error(
    "Required: --issuer --subject --kind platform|school --operator --reason; school also requires --tenant and --role",
  );
if (!values.issuer.startsWith("https://"))
  throw new Error("An HTTPS identity issuer is required");
if (values.kind === "school" && (!values.tenant || !values.role))
  throw new Error("School mapping requires --tenant and --role");
const db = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
await db.connect();
try {
  await db.query("BEGIN");
  const mapping = (
    await db.query(
      "SELECT user_id FROM identity.external_identities WHERE issuer=$1 AND subject=$2",
      [values.issuer, values.subject],
    )
  ).rows[0];
  const id = mapping?.user_id ?? randomUUID();
  if (!mapping) {
    await db.query("INSERT INTO identity.users(id) VALUES($1)", [id]);
    await db.query(
      "INSERT INTO identity.external_identities(issuer,subject,user_id) VALUES($1,$2,$3)",
      [values.issuer, values.subject, id],
    );
  }
  await db.query("SELECT id FROM identity.users WHERE id=$1 FOR UPDATE", [id]);
  if (values.kind === "platform" && values.role) {
    if (
      !(
        await db.query("SELECT 1 FROM identity.platform_roles WHERE name=$1", [
          values.role,
        ])
      ).rowCount
    )
      throw new Error("Unknown platform role");
    await db.query(
      "INSERT INTO identity.platform_role_assignments(user_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [id, values.role],
    );
  } else if (values.kind === "platform")
    for (const permission of ["tenant.create", "tenant.read"])
      await db.query(
        "INSERT INTO identity.platform_permissions(user_id,permission) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id, permission],
      );
  else {
    const role = (
      await db.query(
        "SELECT id FROM app.roles WHERE tenant_id=$1 AND name=$2",
        [values.tenant, values.role],
      )
    ).rows[0];
    if (!role) throw new Error("Unknown tenant role");
    await db.query(
      "INSERT INTO app.memberships(tenant_id,user_id,role_id) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET role_id=EXCLUDED.role_id,active=true",
      [values.tenant, id, role.id],
    );
  }
  // Provisioning is a database-operator action, not impersonation of the new user.
  await db.query(
    "INSERT INTO control.audit_events(id,actor_type,operator_name,action,resource_id,request_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      randomUUID(),
      "database_operator",
      values.operator,
      "operator.identity_provisioned",
      id,
      randomUUID(),
      JSON.stringify({
        reason: values.reason,
        kind: values.kind,
        role: values.role ?? null,
        tenantId: values.tenant ?? null,
      }),
    ],
  );
  await db.query("COMMIT");
  console.log(
    `Provisioned user ${id}. No session or default password was generated.`,
  );
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
