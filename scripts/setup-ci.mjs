import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";
import pg from "pg";
if (
  !process.env.CI ||
  !process.env.CI_ADMIN_URL ||
  !new URL(process.env.CI_ADMIN_URL).pathname.endsWith("_test")
)
  throw new Error("CI setup requires a dedicated CI *_test database");
const admin = new pg.Client({ connectionString: process.env.CI_ADMIN_URL });
await admin.connect();
const values = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "3000",
  MIGRATION_DATABASE_URL: process.env.CI_ADMIN_URL,
  REDIS_URL: "redis://127.0.0.1:6379",
  TOKEN_ISSUER: "https://homebell.test",
  SIGNING_KEY_ID: "ci-1",
  CURSOR_SECRET: randomBytes(32).toString("hex"),
  OTP_PEPPER: randomBytes(32).toString("hex"),
  WEB_ORIGIN: "https://localhost:3000",
  OIDC_ENABLED: "false",
};
try {
  for (const role of ["identity", "tenant", "control"]) {
    const password = randomBytes(32).toString("hex");
    await admin.query(
      `CREATE ROLE hb_${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
    );
    const url = new URL(process.env.CI_ADMIN_URL);
    url.username = `hb_${role}`;
    url.password = password;
    values[`${role.toUpperCase()}_DATABASE_URL`] = url.href;
  }
} finally {
  await admin.end();
}
mkdirSync(".local", { recursive: true });
const keys = await generateKeyPair("RS256", { extractable: true });
writeFileSync(".local/signing.key", await exportPKCS8(keys.privateKey));
writeFileSync(".local/verify.pem", await exportSPKI(keys.publicKey));
values.SIGNING_KEY_PATH = resolve(".local/signing.key");
values.VERIFY_KEY_PATH = resolve(".local/verify.pem");
writeFileSync(
  ".env.test",
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
console.log("Disposable CI roles and test settings generated.");
