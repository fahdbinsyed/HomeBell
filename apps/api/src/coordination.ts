import { createClient } from "redis";
import type { Config } from "./config.js";
import { ApiError, digest, logger } from "./common.js";
export class Coordination {
  readonly client;
  readonly prefix: string;
  constructor(config: Config) {
    this.prefix = `${config.REDIS_NAMESPACE}:${config.NODE_ENV}:`;
    this.client = createClient({
      url: config.REDIS_URL,
      socket: { connectTimeout: 3000, reconnectStrategy: false },
    });
    this.client.on("error", () =>
      logger.error({ event: "redis.error" }, "Coordination unavailable"),
    );
  }
  async connect() {
    await this.client.connect();
  }
  async limit(scope: string, subject: string, limit: number, seconds: number) {
    try {
      const count = await this.client.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
        {
          keys: [`${this.prefix}limit:${scope}:${digest(subject)}`],
          arguments: [String(seconds)],
        },
      );
      if (Number(count) > limit) throw new ApiError(429, "RATE_LIMITED");
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "COORDINATION_UNAVAILABLE");
    }
  }
  async put(key: string, value: unknown, seconds: number) {
    try {
      await this.client.set(this.prefix + key, JSON.stringify(value), {
        expiration: { type: "EX", value: seconds },
      });
    } catch {
      throw new ApiError(503, "COORDINATION_UNAVAILABLE");
    }
  }
  async take(key: string): Promise<string | null> {
    try {
      return (await this.client.eval(
        "local v=redis.call('GET',KEYS[1]); redis.call('DEL',KEYS[1]); return v",
        { keys: [this.prefix + key], arguments: [] },
      )) as string | null;
    } catch {
      throw new ApiError(503, "COORDINATION_UNAVAILABLE");
    }
  }
  async close() {
    if (this.client.isOpen) await this.client.quit();
  }
}
