import { loadEnvFile } from "node:process";
import pg from "pg";
import { createClient } from "redis";
loadEnvFile(".env");
const db = new pg.Client({
  connectionString: process.env.TENANT_DATABASE_URL,
  connectionTimeoutMillis: 3000,
});
const redis = createClient({
  url: process.env.REDIS_URL,
  socket: { connectTimeout: 3000, reconnectStrategy: false },
});
redis.on("error", () => console.error("Redis unavailable"));
try {
  await db.connect();
  await redis.connect();
  console.log(
    "PostgreSQL:",
    (await db.query("SELECT current_user")).rows[0].current_user,
  );
  console.log("Redis:", await redis.ping());
} finally {
  await db.end();
  if (redis.isOpen) await redis.quit();
}
