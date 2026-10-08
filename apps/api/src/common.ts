import { AsyncLocalStorage } from "node:async_hooks";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { Catch, HttpException } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import pino from "pino";

export const context = new AsyncLocalStorage<{
  requestId: string;
  correlationId: string;
  traceId?: string;
  actorId?: string;
}>();
export function requestId() {
  return context.getStore()?.requestId ?? randomUUID();
}
export const logOptions = {
  level: process.env.NODE_ENV === "test" ? "silent" : "info",
  redact: {
    paths: [
      "password",
      "token",
      "otp",
      "authorization",
      "cookie",
      "phone",
      "fullName",
      "displayName",
      "*.password",
      "*.token",
      "*.otp",
      "*.authorization",
      "*.cookie",
      "*.phone",
      "*.fullName",
      "*.displayName",
    ],
    censor: "[REDACTED]",
  },
};
export const logger = pino(logOptions);
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}
export function assert(
  value: unknown,
  status: number,
  code: string,
): asserts value {
  if (!value) throw new ApiError(status, code);
}
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const hmac = (secret: string, value: string) =>
  createHmac("sha256", secret).update(value).digest("base64url");
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function success(data: unknown, meta: Record<string, unknown> = {}) {
  return { data, meta: { requestId: requestId(), ...meta } };
}
export function safeError(error: unknown): { status: number; code: string } {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError)
    return { status: 400, code: "VALIDATION_FAILED" };
  const code = (error as { code?: string })?.code;
  if (code === "23505") return { status: 409, code: "RESOURCE_CONFLICT" };
  if (["23503", "23514", "22P02"].includes(code ?? ""))
    return { status: 400, code: "INVALID_REFERENCE" };
  if (["40001", "40P01"].includes(code ?? ""))
    return { status: 409, code: "RETRY_CONFLICT" };
  if (error instanceof HttpException)
    return {
      status: error.getStatus(),
      code: error.getStatus() === 404 ? "NOT_FOUND" : "REQUEST_REJECTED",
    };
  if (["ECONNREFUSED", "ETIMEDOUT", "57P01", "53300"].includes(code ?? ""))
    return { status: 503, code: "DEPENDENCY_UNAVAILABLE" };
  return { status: 500, code: "INTERNAL_ERROR" };
}
@Catch()
export class ErrorFilter implements ExceptionFilter {
  constructor(
    private readonly recordDenied?: (
      action: string,
      actorId: string | null,
    ) => Promise<void>,
  ) {}
  async catch(error: unknown, host: ArgumentsHost) {
    const { status, code } = safeError(error);
    if (this.recordDenied && [401, 403, 429].includes(status)) {
      try {
        await this.recordDenied(
          `request.denied.${code}`,
          context.getStore()?.actorId ?? null,
        );
      } catch {
        logger.error(
          { event: "audit.security_event_failed", requestId: requestId() },
          "Security audit unavailable",
        );
      }
    }
    if (status >= 500)
      logger.error(
        { event: "request.failed", errorCode: code, requestId: requestId() },
        "Request failed",
      );
    const res = host.switchToHttp().getResponse<Response>();
    if (status === 429) res.setHeader("Retry-After", "60");
    res.status(status).json({
      error: { code, message: code, requestId: requestId(), details: [] },
    });
  }
}
export function keyFrom(req: Request) {
  const key = req.get("Idempotency-Key");
  assert(
    key && /^[A-Za-z0-9_-]{8,128}$/.test(key),
    400,
    "IDEMPOTENCY_KEY_REQUIRED",
  );
  return key;
}
export function cursorEncode(secret: string, scope: string, id: string) {
  const data = Buffer.from(JSON.stringify({ scope, id })).toString("base64url");
  return `${data}.${hmac(secret, data)}`;
}
export function cursorDecode(
  secret: string,
  scope: string,
  cursor?: string,
): string | null {
  if (!cursor) return null;
  const [data, signature, ...extra] = cursor.split(".");
  assert(
    data && signature && !extra.length && equal(signature, hmac(secret, data)),
    400,
    "INVALID_CURSOR",
  );
  try {
    const value = JSON.parse(Buffer.from(data, "base64url").toString()) as {
      scope: string;
      id: string;
    };
    assert(
      value.scope === scope && /^[0-9a-f-]{36}$/i.test(value.id),
      400,
      "INVALID_CURSOR",
    );
    return value.id;
  } catch {
    throw new ApiError(400, "INVALID_CURSOR");
  }
}
