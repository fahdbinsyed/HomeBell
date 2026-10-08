import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { readConfig } from "../../../dist/apps/api/src/config.js";
import { createApplication } from "../../../dist/apps/api/src/app.js";
import { schoolPermissions } from "../../../dist/apps/api/src/platform.js";
export async function fixture(extra: Record<string, string> = {}) {
  try {
    loadEnvFile(".env.test");
  } catch {
    /* CI provides test environment. */
  }
  if (
    !process.env.MIGRATION_DATABASE_URL ||
    !new URL(process.env.MIGRATION_DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Tests require a dedicated *_test database");
  const config = readConfig({
    ...process.env,
    NODE_ENV: "test",
    REDIS_NAMESPACE: `test-${randomUUID()}`,
    PLATFORM_ORIGIN: process.env.WEB_ORIGIN!,
    ...extra,
  });
  const admin = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const { app, runtime } = await createApplication(config);
  const issuer = extra.OIDC_ISSUER ?? `https://test-${randomUUID()}.invalid`;
  const ids = {
    platform: randomUUID(),
    school: randomUUID(),
    reader: randomUUID(),
    other: randomUUID(),
    tenant: randomUUID(),
    otherTenant: randomUUID(),
    role: randomUUID(),
    readerRole: randomUUID(),
  };
  for (const id of [ids.platform, ids.school, ids.reader, ids.other]) {
    await admin.query("INSERT INTO identity.users(id) VALUES($1)", [id]);
    await admin.query(
      "INSERT INTO identity.external_identities(issuer,subject,user_id) VALUES($1,$2,$3)",
      [issuer, id, id],
    );
  }
  for (const p of ["tenant.create", "tenant.read"])
    await admin.query(
      "INSERT INTO identity.platform_permissions(user_id,permission) VALUES($1,$2)",
      [ids.platform, p],
    );
  for (const t of [ids.tenant, ids.otherTenant]) {
    await admin.query(
      "INSERT INTO control.tenants(id,name,time_zone,status,access_until) VALUES($1,'Synthetic School','Asia/Kolkata','trial',now()+interval '1 day')",
      [t],
    );
    await admin.query(
      "INSERT INTO control.tenant_usage(tenant_id) VALUES($1)",
      [t],
    );
    await admin.query(
      "INSERT INTO control.access_grants(tenant_id,id,kind,starts_at,ends_at,child_cap,capabilities,provenance) VALUES($1,$2,'trial',now()-interval '1 day',now()+interval '1 day',100,$3,'test_fixture')",
      [t, randomUUID(), schoolPermissions],
    );
  }
  for (const [role, name] of [
    [ids.role, "School Admin"],
    [ids.readerRole, "Read Only"],
  ])
    await admin.query(
      "INSERT INTO app.roles(tenant_id,id,name) VALUES($1,$2,$3)",
      [ids.tenant, role, name],
    );
  for (const p of schoolPermissions)
    await admin.query(
      "INSERT INTO app.role_permissions(tenant_id,role_id,permission) VALUES($1,$2,$3)",
      [ids.tenant, ids.role, p],
    );
  for (const p of ["tenant.read", "school.records.read"])
    await admin.query(
      "INSERT INTO app.role_permissions(tenant_id,role_id,permission) VALUES($1,$2,$3)",
      [ids.tenant, ids.readerRole, p],
    );
  for (const [user, role] of [
    [ids.school, ids.role],
    [ids.reader, ids.readerRole],
  ])
    await admin.query(
      "INSERT INTO app.memberships(tenant_id,user_id,role_id) VALUES($1,$2,$3)",
      [ids.tenant, user, role],
    );
  const tokens = await runtime.auth.login(issuer, ids.school, "school", true);
  const platform = await runtime.auth.login(
    issuer,
    ids.platform,
    "platform",
    true,
  );
  const reader = await runtime.auth.login(issuer, ids.reader, "school", false);
  return {
    app,
    runtime,
    admin,
    ids,
    issuer,
    tokens,
    platform,
    reader,
    config,
    close: async () => {
      await app.close();
      await admin.end();
    },
  };
}
export const cookies = (tokens: {
  access: string;
  refresh: string;
  csrf: string;
  actor?: { audience: string };
}) =>
  tokens.actor?.audience === "platform"
    ? `hb_platform_access=${tokens.access}; hb_platform_refresh=${tokens.refresh}; hb_platform_csrf=${tokens.csrf}`
    : `hb_access=${tokens.access}; hb_refresh=${tokens.refresh}; hb_csrf=${tokens.csrf}`;
