import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";
import pg from "pg";

const local = resolve(".local");
mkdirSync(local, { recursive: true });
const settingsFile = join(local, "settings.json");
const settings = existsSync(settingsFile)
  ? JSON.parse(readFileSync(settingsFile, "utf8"))
  : {
      admin: randomBytes(32).toString("hex"),
      runtime: Object.fromEntries(
        ["identity", "tenant", "control"].map((r) => [
          r,
          randomBytes(32).toString("hex"),
        ]),
      ),
      redis: randomBytes(32).toString("hex"),
    };
writeFileSync(settingsFile, JSON.stringify(settings), { mode: 0o600 });
const bin = process.env.PG_BIN ?? "C:/Program Files/PostgreSQL/18/bin";
function run(name, args) {
  const result = spawnSync(join(bin, `${name}.exe`), args, {
    encoding: "utf8",
    windowsHide: true,
    ...(name === "pg_ctl" ? { stdio: "ignore" } : {}),
  });
  if (result.status !== 0)
    throw new Error(`${name} failed: ${result.stderr || result.stdout}`);
}
const data = join(local, "postgres");
if (!existsSync(join(data, "PG_VERSION"))) {
  writeFileSync(join(local, "pg-password"), settings.admin, { mode: 0o600 });
  run("initdb", [
    "-D",
    data,
    "-U",
    "postgres",
    "--auth=scram-sha-256",
    "--encoding=UTF8",
    "--locale=C",
    `--pwfile=${join(local, "pg-password")}`,
  ]);
  writeFileSync(
    join(data, "postgresql.auto.conf"),
    "listen_addresses = '127.0.0.1'\nport = 55432\n",
  );
}
const status = spawnSync(join(bin, "pg_ctl.exe"), ["-D", data, "status"], {
  windowsHide: true,
});
if (status.status !== 0)
  run("pg_ctl", ["-D", data, "-l", join(local, "postgres.log"), "-w", "start"]);
const adminBase = `postgresql://postgres:${settings.admin}@127.0.0.1:55432/`;
const client = new pg.Client({ connectionString: `${adminBase}postgres` });
await client.connect();
try {
  for (const [role, password] of Object.entries(settings.runtime)) {
    const name = `hb_${role}`;
    if (
      !(await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [name]))
        .rowCount
    ) {
      // Role identifiers and hex passwords are generated locally, never user SQL.
      await client.query(
        `CREATE ROLE ${name} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${password}'`,
      );
    }
  }
  for (const name of ["homebell", "homebell_test"]) {
    if (
      !(
        await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [name])
      ).rowCount
    )
      await client.query(`CREATE DATABASE ${name}`);
  }
} finally {
  await client.end();
}
const privatePath = join(local, "signing.key");
const publicPath = join(local, "signing-public.pem");
if (!existsSync(privatePath)) {
  const pair = await generateKeyPair("RS256", { extractable: true });
  writeFileSync(privatePath, await exportPKCS8(pair.privateKey), {
    mode: 0o600,
  });
  writeFileSync(publicPath, await exportSPKI(pair.publicKey));
}
for (const [file, database, environment] of [
  [".env", "homebell", "development"],
  [".env.test", "homebell_test", "test"],
]) {
  if (existsSync(file)) {
    console.log(`${file} retained (already exists).`);
    continue;
  }
  const values = {
    NODE_ENV: environment,
    PORT: "3000",
    HOST: "127.0.0.1",
    MIGRATION_DATABASE_URL: `${adminBase}${database}`,
    ...Object.fromEntries(
      Object.entries(settings.runtime).map(([role, password]) => [
        `${role.toUpperCase()}_DATABASE_URL`,
        `postgresql://hb_${role}:${password}@127.0.0.1:55432/${database}`,
      ]),
    ),
    REDIS_URL: `redis://:${settings.redis}@127.0.0.1:56379`,
    SIGNING_KEY_PATH: privatePath.replaceAll("\\", "/"),
    VERIFY_KEY_PATH: publicPath.replaceAll("\\", "/"),
    TOKEN_ISSUER: "https://homebell.local",
    SIGNING_KEY_ID: "local-1",
    CURSOR_SECRET: randomBytes(32).toString("hex"),
    OTP_PEPPER: randomBytes(32).toString("hex"),
    WEB_ORIGIN: "https://localhost:3000",
    OIDC_ENABLED: "false",
    LOCAL_POSTGRES_PASSWORD: settings.admin,
  };
  writeFileSync(
    file,
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
}
// WSL reads this file from the workspace; no password appears in a process argument.
writeFileSync(
  join(local, "redis.conf"),
  `bind 127.0.0.1\nport 56379\nprotected-mode yes\nrequirepass ${settings.redis}\nsave ""\nappendonly no\ndaemonize yes\nlogfile /tmp/homebell-redis.log\npidfile /tmp/homebell-redis.pid\n`,
  { mode: 0o600 },
);
writeFileSync(
  join(local, "redis-container.conf"),
  `bind 0.0.0.0\nport 56379\nprotected-mode yes\nrequirepass ${settings.redis}\nsave ""\nappendonly no\n`,
  { mode: 0o600 },
);
console.log(
  "Isolated PostgreSQL is ready on 127.0.0.1:55432. Local secrets and test configuration created without printing credentials.",
);
