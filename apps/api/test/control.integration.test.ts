import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers.js";
import { schoolPermissions } from "../../../dist/apps/api/src/platform.js";
let f: Awaited<ReturnType<typeof fixture>>;
const reason = "Synthetic Phase 2 verification";
const interval = () => ({
  startsAt: new Date(Date.now() - 1000).toISOString(),
  endsAt: new Date(Date.now() + 86400000).toISOString(),
});
beforeAll(async () => {
  f = await fixture();
  await f.admin.query(
    "INSERT INTO identity.platform_role_assignments VALUES($1,'Super Admin')",
    [f.ids.platform],
  );
});
afterAll(async () => {
  await f?.close();
});
describe("owner control plane", () => {
  it("isolates entitlement rows and serializes suspension against in-flight school work", async () => {
    expect(
      (await f.runtime.db.tenant.query("SELECT * FROM control.access_grants"))
        .rowCount,
    ).toBe(0);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
    const school = f.runtime.db.tenantWork(
      f.tokens.actor,
      f.ids.tenant,
      "tenant.read",
      async () => {
        entered();
        await hold;
      },
    );
    await started;
    let finished = false;
    const suspension = f.runtime.accessManagement
      .lifecycle(
        f.platform.actor,
        f.ids.tenant,
        { action: "suspend", expectedVersion: 1, reason },
        randomUUID(),
      )
      .finally(() => {
        finished = true;
      });
    await new Promise((r) => setTimeout(r, 50));
    expect(finished).toBe(false);
    release();
    await school;
    await suspension;
    await expect(
      f.runtime.records.tenant(f.tokens.actor, f.ids.tenant),
    ).rejects.toMatchObject({ code: "TENANT_UNAVAILABLE" });
    await f.runtime.accessManagement.lifecycle(
      f.platform.actor,
      f.ids.tenant,
      { action: "reinstate", expectedVersion: 2, reason },
      randomUUID(),
    );
    // Restore the fixture version for the independent tests below; real API callers cannot do this.
    await f.admin.query("UPDATE control.tenants SET version=1 WHERE id=$1", [
      f.ids.tenant,
    ]);
  });
  it("rolls business changes back when required control audit storage fails", async () => {
    const id = randomUUID().replaceAll("-", "");
    await f.admin.query(
      `CREATE FUNCTION control.fail_${id}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='${f.ids.otherTenant}'::uuid THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_${id} BEFORE INSERT ON control.audit_events FOR EACH ROW EXECUTE FUNCTION control.fail_${id}()`,
    );
    try {
      await expect(
        f.runtime.accessManagement.lifecycle(
          f.platform.actor,
          f.ids.otherTenant,
          { action: "suspend", expectedVersion: 1, reason },
          randomUUID(),
        ),
      ).rejects.toThrow("synthetic audit failure");
      expect(
        (
          await f.runtime.controlQueries.detail(
            f.platform.actor,
            f.ids.otherTenant,
          )
        ).entitlements.effectiveState,
      ).toBe("trial");
      expect(
        (
          await f.admin.query(
            "SELECT * FROM control.lifecycle_history WHERE tenant_id=$1",
            [f.ids.otherTenant],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await f.admin.query(
        `DROP TRIGGER fail_${id} ON control.audit_events; DROP FUNCTION control.fail_${id}()`,
      );
    }
  });
  it("rejects overlapping overrides and denies capability access until revocation", async () => {
    const b = {
      ...interval(),
      expectedVersion: 1,
      reason,
      target: "school.records.write",
      value: false,
    };
    await f.runtime.accessManagement.override(
      f.platform.actor,
      f.ids.tenant,
      b,
      randomUUID(),
    );
    await expect(
      f.runtime.records.create(
        f.tokens.actor,
        f.ids.tenant,
        "classes",
        { name: "Denied" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "ENTITLEMENT_DENIED" });
    await expect(
      f.runtime.accessManagement.override(
        f.platform.actor,
        f.ids.tenant,
        { ...b, expectedVersion: 2 },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "OVERLAPPING_GRANT" });
    const id = (
      await f.admin.query(
        "SELECT id FROM control.entitlement_overrides WHERE tenant_id=$1",
        [f.ids.tenant],
      )
    ).rows[0].id;
    await f.runtime.accessManagement.revoke(
      f.platform.actor,
      f.ids.tenant,
      id,
      { expectedVersion: 2, reason },
      randomUUID(),
    );
    await f.admin.query("UPDATE control.tenants SET version=1 WHERE id=$1", [
      f.ids.tenant,
    ]);
  });
  it("does not expose school records through the control role", async () => {
    await expect(
      f.runtime.db.control.query("SELECT * FROM app.students"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      f.runtime.db.control.query("SELECT * FROM app.guardians"),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("persists bounded grants, immediate suspension, valid reinstatement and atomic evidence", async () => {
    const a = f.platform.actor;
    const draft = await f.runtime.platform.create(
      a,
      { name: "Phase 2 lifecycle", timeZone: "UTC" },
      randomUUID(),
    );
    const t = draft.id as string;
    await expect(
      f.runtime.accessManagement.lifecycle(
        a,
        t,
        { action: "activate", expectedVersion: 1, reason },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "NO_VALID_ACCESS_BASIS" });
    const body = {
      action: "start_trial",
      expectedVersion: 1,
      reason,
      ...interval(),
      childCap: 2,
      capabilities: schoolPermissions,
    };
    const key = randomUUID();
    const granted = await f.runtime.accessManagement.lifecycle(a, t, body, key);
    expect(granted.entitlements.allowed).toBe(true);
    expect(await f.runtime.accessManagement.lifecycle(a, t, body, key)).toEqual(
      granted,
    );
    await expect(
      f.runtime.accessManagement.lifecycle(
        a,
        t,
        { action: "suspend", expectedVersion: 1, reason },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(
      (
        await f.runtime.accessManagement.lifecycle(
          a,
          t,
          { action: "suspend", expectedVersion: 2, reason },
          randomUUID(),
        )
      ).entitlements.allowed,
    ).toBe(false);
    expect(
      (
        await f.runtime.accessManagement.lifecycle(
          a,
          t,
          { action: "reinstate", expectedVersion: 3, reason },
          randomUUID(),
        )
      ).entitlements.allowed,
    ).toBe(true);
    expect(
      Number(
        (
          await f.admin.query(
            "SELECT count(*) FROM app.outbox WHERE tenant_id=$1",
            [t],
          )
        ).rows[0].count,
      ),
    ).toBe(4);
    expect(
      (
        await f.admin.query(
          "SELECT metadata FROM app.audit_events WHERE tenant_id=$1",
          [t],
        )
      ).rows.every((r) => !r.metadata.reason),
    ).toBe(true);
  });
  it("publishes immutable annual USD versions and records manual assignments", async () => {
    const a = f.platform.actor,
      plan = await f.runtime.plans.create(
        a,
        {
          name: "Synthetic plan",
          code: `t${randomUUID().slice(0, 8)}`,
          reason,
        },
        randomUUID(),
      );
    await f.runtime.plans.change(
      a,
      plan.id as string,
      {
        expectedVersion: 1,
        reason,
        amountMinor: 10000,
        childCap: 5,
        capabilities: schoolPermissions,
      },
      randomUUID(),
    );
    const version = (
      await f.admin.query(
        "SELECT id FROM control.plan_versions WHERE plan_id=$1",
        [plan.id],
      )
    ).rows[0].id;
    await expect(
      f.runtime.db.control.query(
        "UPDATE control.plan_versions SET amount_minor=0 WHERE id=$1",
        [version],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    const draft = await f.runtime.platform.create(
      a,
      { name: "Synthetic annual school", timeZone: "UTC" },
      randomUUID(),
    );
    const result = await f.runtime.plans.subscribe(
      a,
      draft.id as string,
      {
        planVersionId: version,
        startsAt: new Date(Date.now() - 1000).toISOString(),
        manualReference: "TEST-NO-PAYMENT",
        expectedVersion: 1,
        reason,
      },
      randomUUID(),
    );
    expect(result.entitlements).toMatchObject({ allowed: true, childCap: 5 });
    expect(result.entitlements.provenance[0]?.source).toBe(
      "manual_commercial_assignment",
    );
    const trial = await f.runtime.platform.create(
      a,
      { name: "Trial upgrade", timeZone: "UTC" },
      randomUUID(),
    );
    await f.runtime.accessManagement.lifecycle(
      a,
      trial.id as string,
      {
        action: "start_trial",
        expectedVersion: 1,
        reason,
        ...interval(),
        childCap: 3,
        capabilities: schoolPermissions,
      },
      randomUUID(),
    );
    const upgraded = await f.runtime.plans.subscribe(
      a,
      trial.id as string,
      {
        planVersionId: version,
        startsAt: new Date(Date.now() - 1000).toISOString(),
        manualReference: "TEST-TRIAL-UPGRADE",
        expectedVersion: 2,
        reason,
      },
      randomUUID(),
    );
    expect(upgraded.entitlements.provenance).toHaveLength(1);
    expect(upgraded.entitlements.provenance[0]?.kind).toBe("active_paid");
  });
  it("serializes allocations and rejects reductions below usage", async () => {
    await f.admin.query(
      "UPDATE control.access_grants SET child_cap=1 WHERE tenant_id=$1",
      [f.ids.tenant],
    );
    const cls = await f.runtime.records.create(
      f.tokens.actor,
      f.ids.tenant,
      "classes",
      { name: "Cap test" },
      randomUUID(),
    );
    const results = await Promise.allSettled(
      [1, 2].map((i) =>
        f.runtime.records.create(
          f.tokens.actor,
          f.ids.tenant,
          "students",
          { displayName: `Synthetic ${i}`, classId: cls.id },
          randomUUID(),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const usage = (
      await f.runtime.controlQueries.detail(f.platform.actor, f.ids.tenant)
    ).usage;
    expect(usage.activeStudents).toBe(1);
    await expect(
      f.runtime.accessManagement.override(
        f.platform.actor,
        f.ids.tenant,
        {
          ...interval(),
          expectedVersion: 1,
          reason,
          target: "childCap",
          value: 0,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "CAP_BELOW_USAGE" });
    const student = results.find((r) => r.status === "fulfilled");
    if (student?.status !== "fulfilled")
      throw new Error("Missing successful allocation");
    await f.runtime.records.updateStudent(
      f.tokens.actor,
      f.ids.tenant,
      student.value.id as string,
      { status: "inactive", expectedVersion: 1 },
      randomUUID(),
    );
    expect(
      (await f.runtime.controlQueries.detail(f.platform.actor, f.ids.tenant))
        .usage.activeStudents,
    ).toBe(0);
    await f.runtime.records.updateStudent(
      f.tokens.actor,
      f.ids.tenant,
      student.value.id as string,
      { status: "active", expectedVersion: 2 },
      randomUUID(),
    );
    expect(
      (await f.runtime.controlQueries.detail(f.platform.actor, f.ids.tenant))
        .usage.activeStudents,
    ).toBe(1);
  });
  it("limits role authority and keeps internal notes out of school evidence", async () => {
    await f.admin.query(
      "DELETE FROM identity.platform_role_assignments WHERE user_id=$1",
      [f.ids.platform],
    );
    await f.admin.query(
      "INSERT INTO identity.platform_role_assignments VALUES($1,'Billing Operations')",
      [f.ids.platform],
    );
    await expect(
      f.runtime.accessManagement.lifecycle(
        f.platform.actor,
        f.ids.tenant,
        { action: "suspend", expectedVersion: 1, reason },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await f.runtime.controlQueries.note(
      f.platform.actor,
      f.ids.tenant,
      {
        expectedVersion: 1,
        reason,
        text: "Private billing discussion",
        refundStatus: "requested",
      },
      randomUUID(),
    );
    expect(
      (await f.runtime.controlQueries.notes(f.platform.actor, f.ids.tenant, {}))
        .data[0]?.body,
    ).toBe("Private billing discussion");
    const audit = await f.runtime.controlQueries.audit(f.platform.actor, {
      from: new Date(Date.now() - 86400000).toISOString(),
      to: new Date().toISOString(),
    });
    expect(audit.data.every((r) => r.category === "billing")).toBe(true);
    await f.admin.query(
      "DELETE FROM identity.platform_role_assignments WHERE user_id=$1",
      [f.ids.platform],
    );
    await f.admin.query(
      "INSERT INTO identity.platform_role_assignments VALUES($1,'Super Admin')",
      [f.ids.platform],
    );
  });
});
