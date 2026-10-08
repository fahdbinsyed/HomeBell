import { loadEnvFile } from "node:process";
import { createClient } from "redis";
loadEnvFile(".env");
const url = new URL(process.env.REDIS_URL);
if (url.hostname !== "127.0.0.1" || url.port !== "56379" || !url.password)
  throw new Error(
    "Only the authenticated local HomeBell Redis instance may be stopped",
  );
const client = createClient({
  url: url.href,
  socket: { connectTimeout: 3000, reconnectStrategy: false },
});
client.on("error", () => {});
await client.connect();
try {
  await client.sendCommand(["SHUTDOWN", "NOSAVE"]);
} catch (error) {
  if (error?.constructor?.name !== "SocketClosedUnexpectedlyError") throw error;
} finally {
  if (client.isOpen) client.destroy();
}
console.log("Local HomeBell Redis stopped.");
