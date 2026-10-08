import { z } from "zod";
export const uuid = z.uuid();
export const name = (max: number) => z.string().trim().min(1).max(max);
export const listInput = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(2048).optional(),
});
export const tenantInput = z.strictObject({
  name: name(120),
  timeZone: z
    .string()
    .max(80)
    .refine((s) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: s });
        return true;
      } catch {
        return false;
      }
    }),
});
export const classInput = z.strictObject({ name: name(80) });
export const sectionInput = z.strictObject({ name: name(80), classId: uuid });
export const studentInput = z.strictObject({
  displayName: name(120),
  classId: uuid,
  sectionId: uuid.nullable().optional(),
});
export const studentPatch = studentInput
  .partial()
  .extend({
    status: z.enum(["active", "inactive"]).optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1);
export const guardianInput = z.strictObject({
  fullName: name(120),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
});
export const linkInput = z.strictObject({
  guardianId: uuid,
  role: z.enum(["primary", "additional"]),
  relationship: name(80),
});
export const accessInput = z.strictObject({
  action: z.enum(["block", "deactivate"]),
  reason: name(500),
  expectedVersion: z.number().int().positive(),
});
export const auditInput = listInput
  .extend({ from: z.iso.datetime(), to: z.iso.datetime() })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.to) >= Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 31 * 86400000,
  );
export type Audience = "school" | "platform" | "guardian";
