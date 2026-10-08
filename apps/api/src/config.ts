import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  IDENTITY_DATABASE_URL: z.url(),
  TENANT_DATABASE_URL: z.url(),
  CONTROL_DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  SIGNING_KEY_PATH: z.string().min(1),
  VERIFY_KEY_PATH: z.string().min(1),
  SIGNING_KEY_ID: z.string().min(1),
  TOKEN_ISSUER: z.url(),
  CURSOR_SECRET: z.string().min(64),
  OTP_PEPPER: z.string().min(64),
  WEB_ORIGIN: z.url(),
  PLATFORM_ORIGIN: z.url().default("https://localhost:3100"),
  OIDC_PLATFORM_CALLBACK_URL: z.url().optional(),
  OIDC_ENABLED: z.enum(["true", "false"]).default("false"),
  OIDC_ISSUER: z.url().optional(),
  REDIS_NAMESPACE: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,80}$/)
    .default("homebell"),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  OIDC_CALLBACK_URL: z.url().optional(),
  OIDC_MFA_ACR: z.string().min(1).optional(),
});
export type Config = z.infer<typeof schema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid configuration fields: ${[...new Set(parsed.error.issues.map((i) => i.path[0]))].join(", ")}`,
    );
  const c = parsed.data;
  for (const field of [
    "IDENTITY_DATABASE_URL",
    "TENANT_DATABASE_URL",
    "CONTROL_DATABASE_URL",
  ] as const) {
    if (!["postgresql:", "postgres:"].includes(new URL(c[field]).protocol))
      throw new Error(`Invalid protocol: ${field}`);
  }
  if (!["redis:", "rediss:"].includes(new URL(c.REDIS_URL).protocol))
    throw new Error("Invalid REDIS_URL protocol");
  if (new URL(c.WEB_ORIGIN).origin !== c.WEB_ORIGIN)
    throw new Error("WEB_ORIGIN must be an origin");
  if (new URL(c.PLATFORM_ORIGIN).origin !== c.PLATFORM_ORIGIN)
    throw new Error("PLATFORM_ORIGIN must be an origin");
  if (
    c.NODE_ENV !== "test" &&
    (!c.PLATFORM_ORIGIN.startsWith("https://") ||
      (c.OIDC_PLATFORM_CALLBACK_URL &&
        !c.OIDC_PLATFORM_CALLBACK_URL.startsWith("https://")))
  )
    throw new Error("Platform requires HTTPS");
  if (c.OIDC_ENABLED === "true") {
    if (
      !c.OIDC_ISSUER ||
      !c.OIDC_CLIENT_ID ||
      !c.OIDC_CLIENT_SECRET ||
      !c.OIDC_CALLBACK_URL ||
      !c.OIDC_MFA_ACR
    )
      throw new Error(
        "Enabled OIDC requires issuer, client, callback and MFA assurance configuration",
      );
    if (
      c.NODE_ENV !== "test" &&
      [c.OIDC_ISSUER, c.OIDC_CALLBACK_URL, c.WEB_ORIGIN].some(
        (v) => !v.startsWith("https://"),
      )
    )
      throw new Error("OIDC requires HTTPS");
  }
  return c;
}
