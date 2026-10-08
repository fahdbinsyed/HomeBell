import { loadEnvFile } from "node:process";
import pg from "pg";
loadEnvFile(process.env.ENV_FILE ?? ".env");
const db = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
await db.connect();
try {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const { rows } =
    await db.query(`SELECT count(*)::int AS mismatches FROM control.tenants t JOIN control.tenant_usage u ON u.tenant_id=t.id WHERE
    u.total_students<>(SELECT count(*) FROM app.students WHERE tenant_id=t.id) OR
    u.active_students<>(SELECT count(*) FROM app.students WHERE tenant_id=t.id AND status='active') OR
    u.active_guardians<>(SELECT count(*) FROM app.guardians WHERE tenant_id=t.id AND status='active') OR
    u.blocked_guardians<>(SELECT count(*) FROM app.guardians WHERE tenant_id=t.id AND status='blocked') OR
    u.active_staff<>(SELECT count(*) FROM app.memberships WHERE tenant_id=t.id AND active)`);
  await db.query("COMMIT");
  console.log(
    JSON.stringify({
      event: "usage.reconciliation",
      mismatchedTenants: rows[0].mismatches,
    }),
  );
  if (rows[0].mismatches) process.exitCode = 1;
} finally {
  await db.end();
}
