import { describe, it, expect } from "vitest";
import {
  annualEnd,
  resolvePolicy,
} from "../../../dist/apps/api/src/entitlements.js";
const now = new Date("2026-10-08T00:00:00Z");
const grant = {
  id: "g",
  kind: "trial",
  starts_at: new Date("2026-01-01Z"),
  ends_at: new Date("2027-01-01Z"),
  child_cap: 10,
  capabilities: ["school.records.write"],
  provenance: "test",
};
describe("entitlement boundaries", () => {
  it("uses calendar anniversaries and clamps leap days", () => {
    expect(annualEnd("2024-02-29T12:30:00Z")).toBe("2025-02-28T12:30:00.000Z");
    expect(annualEnd("2023-03-01T12:30:00Z")).toBe("2024-03-01T12:30:00.000Z");
  });
  it("enforces half-open grant intervals without a worker", () => {
    expect(
      resolvePolicy("trial", 1, [grant], [], grant.starts_at).allowed,
    ).toBe(true);
    expect(resolvePolicy("trial", 1, [grant], [], grant.ends_at).allowed).toBe(
      false,
    );
    expect(
      resolvePolicy("trial", 1, [grant], [], new Date(+grant.starts_at - 1))
        .allowed,
    ).toBe(false);
  });
  it("lifecycle denial defeats every capability allow", () => {
    expect(resolvePolicy("suspended", 2, [grant], [], now)).toMatchObject({
      allowed: false,
      capabilities: [],
      reason: "LIFECYCLE_DENIED",
    });
  });
  it("capability denials beat allows and revoked overrides have no effect", () => {
    const o = {
      target: "school.records.write",
      bool_value: true,
      int_value: null,
      starts_at: grant.starts_at,
      ends_at: grant.ends_at,
      revoked_at: null,
    };
    expect(
      resolvePolicy("trial", 1, [grant], [o, { ...o, bool_value: false }], now)
        .capabilities,
    ).toEqual([]);
    expect(
      resolvePolicy(
        "trial",
        1,
        [grant],
        [{ ...o, bool_value: false, revoked_at: now }],
        now,
      ).capabilities,
    ).toEqual(["school.records.write"]);
  });
});
