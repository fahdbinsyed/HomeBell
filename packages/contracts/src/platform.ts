import { z } from "zod";
import { name, uuid, listInput } from "./index.js";
export const capabilities = z.enum([
  "tenant.read",
  "school.records.read",
  "school.records.write",
  "guardians.read",
  "guardians.manage",
  "audit.read",
]);
export const command = z.strictObject({
  expectedVersion: z.number().int().positive(),
  reason: name(500),
});
const period = { startsAt: z.iso.datetime(), endsAt: z.iso.datetime() };
const validPeriod = (v: { startsAt: string; endsAt: string }) =>
  Date.parse(v.endsAt) > Date.parse(v.startsAt);
export const grantInput = command
  .extend({
    action: z.enum(["start_trial", "grant_free", "grant_manual"]),
    ...period,
    childCap: z.number().int().min(0).max(1000000),
    capabilities: z.array(capabilities).min(1).max(6),
  })
  .strict()
  .refine(validPeriod);
export const lifecycleInput = command
  .extend({
    action: z.enum([
      "activate",
      "suspend",
      "deactivate",
      "cancel",
      "offboard",
      "reinstate",
    ]),
  })
  .strict();
export const planInput = z.strictObject({
  name: name(120),
  code: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/),
  reason: name(500),
});
export const versionInput = command
  .extend({
    amountMinor: z.number().int().min(0).max(2147483647),
    childCap: z.number().int().min(0).max(1000000),
    capabilities: z.array(capabilities).min(1).max(6),
  })
  .strict();
export const subscriptionInput = command
  .extend({
    planVersionId: uuid,
    startsAt: z.iso.datetime(),
    manualReference: name(200),
  })
  .strict();
export const extensionInput = command
  .extend({ grantId: uuid, endsAt: z.iso.datetime() })
  .strict();
export const overrideInput = command
  .extend({
    ...period,
    target: z.union([capabilities, z.literal("childCap")]),
    value: z.union([z.boolean(), z.number().int().min(0).max(1000000)]),
  })
  .strict()
  .refine(validPeriod)
  .refine((v) =>
    v.target === "childCap"
      ? typeof v.value === "number"
      : typeof v.value === "boolean",
  );
export const noteInput = command
  .extend({
    text: name(2000),
    refundStatus: z
      .enum(["requested", "reviewing", "manually_recorded", "declined"])
      .optional(),
  })
  .strict();
export const tenantListInput = listInput
  .extend({
    search: z.string().trim().max(120).optional(),
    status: z
      .enum([
        "draft",
        "trial",
        "pilot_free",
        "active_paid",
        "manual_override",
        "suspended",
        "deactivated",
        "cancelled",
        "offboarding",
        "expired",
      ])
      .optional(),
  })
  .strict();
export const platformAuditInput = listInput
  .extend({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    tenantId: uuid.optional(),
    actorId: uuid.optional(),
    action: name(100).optional(),
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.to) >= Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 31 * 86400000,
  );
