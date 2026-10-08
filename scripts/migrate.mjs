import { loadEnvFile } from "node:process";
import { runner } from "node-pg-migrate";
try {
  loadEnvFile(process.env.ENV_FILE ?? ".env");
} catch {
  /* CI supplies environment directly. */
}
if (!process.env.MIGRATION_DATABASE_URL)
  throw new Error("MIGRATION_DATABASE_URL is required");
await runner({
  databaseUrl: process.env.MIGRATION_DATABASE_URL,
  dir: "apps/api/migrations",
  ignorePattern: "(?:.*\\.md|\\..*)",
  direction: "up",
  migrationsTable: "homebell_migrations",
  singleTransaction: true,
  log: (message) => {
    if (!message.includes("://")) console.log(message);
  },
});
