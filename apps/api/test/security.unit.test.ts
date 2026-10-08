import { it, expect } from "vitest";
import pino from "pino";
import { logOptions } from "../../../dist/apps/api/src/common.js";
import {
  studentInput,
  studentPatch,
  tenantInput,
} from "../../../packages/contracts/src/index.js";
import {
  canonical,
  cursorEncode,
  cursorDecode,
  safeError,
} from "../../../dist/apps/api/src/common.js";
import { readConfig } from "../../../dist/apps/api/src/config.js";
it("redacts credentials and personal fields in structured diagnostic logs", () => {
  let output = "";
  const log = pino(
    { ...logOptions, level: "info" },
    {
      write(chunk) {
        output += chunk;
      },
    },
  );
  log.info(
    {
      token: "CANARY_TOKEN",
      otp: "CANARY_OTP",
      request: { authorization: "CANARY_AUTH", phone: "CANARY_PHONE" },
    },
    "security check",
  );
  expect(output).not.toContain("CANARY_");
  expect(output).toContain("[REDACTED]");
});
it("rejects mass assignment and unknown properties", () => {
  expect(
    studentInput.safeParse({
      displayName: "X",
      classId: "00000000-0000-4000-8000-000000000001",
      tenantId: "other",
    }).success,
  ).toBe(false);
  expect(studentPatch.safeParse({ expectedVersion: 1 }).success).toBe(false);
});
it("validates school time zones", () => {
  expect(
    tenantInput.safeParse({ name: "School", timeZone: "Invalid/Zone" }).success,
  ).toBe(false);
});
it("canonicalizes retry payloads without changing array order", () => {
  expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
  expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
});
it("rejects modified or cross-scope cursors", () => {
  const cursor = cursorEncode(
    "secret",
    "school-a",
    "00000000-0000-4000-8000-000000000001",
  );
  expect(() => cursorDecode("secret", "school-b", cursor)).toThrow(
    "INVALID_CURSOR",
  );
  expect(() => cursorDecode("secret", "school-a", cursor + "x")).toThrow(
    "INVALID_CURSOR",
  );
});
it("does not leak diagnostics, database details or secret input in errors", () => {
  const output = JSON.stringify(
    safeError(new Error("CANARY_SECRET postgres://password@host")),
  );
  expect(output).not.toContain("CANARY_SECRET");
  expect(output).not.toContain("password");
  expect(() => readConfig({ IDENTITY_DATABASE_URL: "CANARY_SECRET" })).toThrow(
    "Invalid configuration fields",
  );
  try {
    readConfig({ IDENTITY_DATABASE_URL: "CANARY_SECRET" });
  } catch (e) {
    expect(String(e)).not.toContain("CANARY_SECRET");
  }
});
