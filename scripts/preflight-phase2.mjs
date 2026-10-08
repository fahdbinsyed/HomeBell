import { loadEnvFile } from "node:process";
import pg from "pg";
loadEnvFile(process.env.ENV_FILE ?? ".env");
const db = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
await db.connect();
try {
  const applied = !!(
    await db.query(
      "SELECT 1 FROM homebell_migrations WHERE name='1780000000004-control-plane'",
    )
  ).rowCount;
  const states = (
    await db.query(
      "SELECT status,count(*)::int AS tenants FROM control.tenants GROUP BY status ORDER BY status",
    )
  ).rows;
  const expired = (
    await db.query(
      "SELECT count(*)::int AS count FROM control.tenants WHERE status IN ('trial','pilot_free','manual_override') AND (access_until IS NULL OR access_until<=now())",
    )
  ).rows[0].count;
  const allocated = (
    await db.query(
      "SELECT count(*)::int AS count FROM app.students WHERE status='active'",
    )
  ).rows[0].count;
  console.log(
    JSON.stringify({
      schemaAlreadyApplied: applied,
      states,
      expiredAccessRows: expired,
      allocatedStudents: allocated,
    }),
  );
  if (!applied && states.some((s) => s.status === "active_paid"))
    throw new Error(
      "Reconcile paid assignments before migration. No commercial history will be invented.",
    );
} finally {
  await db.end();
}
