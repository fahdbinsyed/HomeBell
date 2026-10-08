import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { fixture, cookies } from "./helpers.js";
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f?.close();
});
const key = () => randomUUID();
function api(
  method: "get" | "post" | "patch",
  path: string,
  tokens = f.tokens,
) {
  const agent = request(f.app.getHttpServer());
  return agent[method](path)
    .set("Cookie", cookies(tokens))
    .set("Origin", f.config.WEB_ORIGIN)
    .set("X-CSRF-Token", tokens.csrf)
    .set("Idempotency-Key", key());
}
describe("real PostgreSQL isolation and core API", () => {
  it("runs as a non-owner without RLS bypass and clears transaction-local context", async () => {
    const role = (
      await f.runtime.db.tenant.query(
        "SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    expect(role.current_user).toBe("hb_tenant");
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
    expect(
      (await f.runtime.db.tenant.query("SELECT * FROM app.classes")).rowCount,
    ).toBe(0);
    const id = randomUUID();
    await f.admin.query(
      "INSERT INTO app.classes(tenant_id,id,name) VALUES($1,$2,'Private')",
      [f.ids.otherTenant, id],
    );
    await f.runtime.db.transaction(f.runtime.db.tenant, async (tx) => {
      await tx.query("SELECT set_config('app.tenant_id',$1,true)", [
        f.ids.tenant,
      ]);
      expect(
        (await tx.query("SELECT * FROM app.classes WHERE id=$1", [id]))
          .rowCount,
      ).toBe(0);
    });
    expect(
      (await f.runtime.db.tenant.query("SELECT * FROM control.tenants"))
        .rowCount,
    ).toBe(0);
  });
  it("cannot insert a cross-tenant row despite a chosen object ID", async () => {
    await expect(
      f.runtime.db.transaction(f.runtime.db.tenant, async (tx) => {
        await tx.query("SELECT set_config('app.tenant_id',$1,true)", [
          f.ids.tenant,
        ]);
        await tx.query(
          "INSERT INTO app.classes(tenant_id,id,name) VALUES($1,$2,'Attack')",
          [f.ids.otherTenant, key()],
        );
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("denies unauthenticated, other-school and platform-to-school requests", async () => {
    expect(
      (
        await request(f.app.getHttpServer()).get(
          `/api/v1/tenants/${f.ids.tenant}/students`,
        )
      ).status,
    ).toBe(401);
    expect(
      (await api("get", `/api/v1/tenants/${f.ids.otherTenant}/students`))
        .status,
    ).toBe(404);
    expect(
      (await api("get", `/api/v1/tenants/${f.ids.tenant}/students`, f.platform))
        .status,
    ).toBe(403);
  });
  it("enforces roles, strict input and CSRF independently of the UI", async () => {
    const url = `/api/v1/tenants/${f.ids.tenant}/classes`;
    expect((await api("post", url, f.reader).send({ name: "No" })).status).toBe(
      403,
    );
    expect(
      (await api("post", url).send({ name: "No", tenantId: f.ids.otherTenant }))
        .status,
    ).toBe(400);
    expect(
      (
        await api("post", url)
          .set("Origin", "https://attacker.invalid")
          .send({ name: "No" })
      ).status,
    ).toBe(403);
  });
  it("deduplicates simultaneous creates with one audit and outbox effect", async () => {
    const id = key(),
      url = `/api/v1/tenants/${f.ids.tenant}/classes`;
    const responses = await Promise.all(
      [1, 2].map(() =>
        api("post", url)
          .set("Idempotency-Key", id)
          .send({ name: "Concurrent" }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses[0]!.body.data).toEqual(responses[1]!.body.data);
    const resource = responses[0]!.body.data.id;
    expect(
      (
        await f.admin.query(
          "SELECT * FROM app.audit_events WHERE tenant_id=$1 AND resource_id=$2",
          [f.ids.tenant, resource],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await f.admin.query(
          "SELECT * FROM app.outbox WHERE tenant_id=$1 AND resource_id=$2",
          [f.ids.tenant, resource],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await api("post", url)
          .set("Idempotency-Key", id)
          .send({ name: "Changed" })
      ).status,
    ).toBe(409);
  });
  it("rejects cross-tenant and inconsistent class/section references; updates by version", async () => {
    const base = `/api/v1/tenants/${f.ids.tenant}`;
    const c = await api("post", `${base}/classes`).send({ name: "Class A" });
    expect(c.status).toBe(201);
    const other = randomUUID();
    await f.admin.query(
      "INSERT INTO app.classes(tenant_id,id,name) VALUES($1,$2,'Other')",
      [f.ids.otherTenant, other],
    );
    expect(
      (
        await api("post", `${base}/students`).send({
          displayName: "Synthetic",
          classId: other,
        })
      ).status,
    ).toBe(400);
    const s = await api("post", `${base}/students`).send({
      displayName: "Synthetic",
      classId: c.body.data.id,
    });
    expect(s.status).toBe(201);
    const p = await api("patch", `${base}/students/${s.body.data.id}`).send({
      status: "inactive",
      expectedVersion: 1,
    });
    expect(p.status).toBe(200);
    expect(p.body.data.version).toBe(2);
    expect(
      (
        await api("patch", `${base}/students/${s.body.data.id}`).send({
          status: "active",
          expectedVersion: 1,
        })
      ).status,
    ).toBe(409);
    const foreign = await api(
      "get",
      `/api/v1/tenants/${f.ids.otherTenant}/students/${s.body.data.id}`,
    );
    expect(foreign.status).toBe(404);
  });
  it("binds pagination cursors to actor and tenant", async () => {
    const url = `/api/v1/tenants/${f.ids.tenant}/classes`;
    const page = await api("get", `${url}?limit=1`);
    expect(page.status).toBe(200);
    expect(page.body.meta.nextCursor).toBeTruthy();
    expect(
      (await api("get", `${url}?cursor=${page.body.meta.nextCursor}`, f.reader))
        .status,
    ).toBe(400);
  });
  it("creates draft tenants and default roles without granting operational access", async () => {
    const response = await api(
      "post",
      "/api/v1/platform/tenants",
      f.platform,
    ).send({ name: "New Synthetic School", timeZone: "Asia/Kolkata" });
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe("draft");
    expect(
      (
        await f.admin.query("SELECT * FROM app.campuses WHERE tenant_id=$1", [
          response.body.data.id,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (await api("get", `/api/v1/tenants/${response.body.data.id}/students`))
        .status,
    ).toBe(404);
  });
  it("resolves own memberships without showing another school", async () => {
    const r = await api("get", "/api/v1/me/tenants");
    expect(r.status).toBe(200);
    expect(r.body.data.map((x: { id: string }) => x.id)).toEqual([
      f.ids.tenant,
    ]);
  });
  it("blocks suspended schools immediately on existing sessions", async () => {
    await f.admin.query(
      "UPDATE control.tenants SET status='suspended' WHERE id=$1",
      [f.ids.tenant],
    );
    expect(
      (await api("get", `/api/v1/tenants/${f.ids.tenant}/students`)).status,
    ).toBe(403);
    await f.admin.query(
      "UPDATE control.tenants SET status='trial' WHERE id=$1",
      [f.ids.tenant],
    );
  });
  it("prevents audit edits through the runtime role", async () => {
    await expect(
      f.runtime.db.tenant.query(
        "UPDATE app.audit_events SET action='tampered'",
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("rolls back the business write if required audit storage fails", async () => {
    const name = `Rollback-${key()}`;
    await f.admin.query("REVOKE INSERT ON app.audit_events FROM hb_tenant");
    try {
      const result = await api(
        "post",
        `/api/v1/tenants/${f.ids.tenant}/classes`,
      ).send({ name });
      expect(result.status).toBe(500);
      expect(JSON.stringify(result.body)).not.toContain("permission denied");
      expect(
        (
          await f.admin.query(
            "SELECT id FROM app.classes WHERE tenant_id=$1 AND name=$2",
            [f.ids.tenant, name],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await f.admin.query("GRANT INSERT ON app.audit_events TO hb_tenant");
    }
  });
  it("takes membership changes into account on an existing session", async () => {
    await f.admin.query(
      "UPDATE app.memberships SET active=false WHERE tenant_id=$1 AND user_id=$2",
      [f.ids.tenant, f.ids.reader],
    );
    try {
      expect(
        (await api("get", `/api/v1/tenants/${f.ids.tenant}/classes`, f.reader))
          .status,
      ).toBe(404);
    } finally {
      await f.admin.query(
        "UPDATE app.memberships SET active=true WHERE tenant_id=$1 AND user_id=$2",
        [f.ids.tenant, f.ids.reader],
      );
    }
  });
  it("checks access expiry without waiting for a scheduled worker", async () => {
    await f.admin.query(
      "UPDATE control.access_grants SET ends_at=now()-interval '1 second' WHERE tenant_id=$1",
      [f.ids.tenant],
    );
    try {
      expect(
        (await api("get", `/api/v1/tenants/${f.ids.tenant}/classes`)).status,
      ).toBe(403);
    } finally {
      await f.admin.query(
        "UPDATE control.access_grants SET ends_at=now()+interval '1 day' WHERE tenant_id=$1",
        [f.ids.tenant],
      );
    }
  });
  it("keeps guardian access changes, links and their evidence tenant-scoped", async () => {
    const base = `/api/v1/tenants/${f.ids.tenant}`;
    const cls = await api("post", `${base}/classes`).send({
      name: "Link class",
    });
    const student = await api("post", `${base}/students`).send({
      displayName: "Synthetic child",
      classId: cls.body.data.id,
    });
    const guardian = await api("post", `${base}/guardians`).send({
      fullName: "Synthetic guardian",
      phone: "+15555550123",
    });
    expect(guardian.status).toBe(201);
    const link = await api(
      "post",
      `${base}/students/${student.body.data.id}/guardian-links`,
    ).send({
      guardianId: guardian.body.data.id,
      role: "primary",
      relationship: "Parent",
    });
    expect(link.status).toBe(201);
    expect(
      (
        await api(
          "post",
          `${base}/guardians/${guardian.body.data.id}/access-actions`,
        ).send({
          action: "block",
          reason: "Synthetic test",
          expectedVersion: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api(
          "post",
          `${base}/students/${student.body.data.id}/guardian-links`,
        ).send({
          guardianId: guardian.body.data.id,
          role: "additional",
          relationship: "Delegate",
        })
      ).status,
    ).toBe(409);
    const from = new Date(Date.now() - 86400000).toISOString(),
      to = new Date(Date.now() + 86400000).toISOString();
    expect(
      (await api("get", `${base}/audit-events?from=${from}&to=${to}`)).status,
    ).toBe(200);
  });
});
describe("session and distributed security foundations", () => {
  it("allows only one concurrently claimed primary device", async () => {
    const result = await Promise.allSettled([
      f.runtime.auth.claimPrimaryDevice(f.ids.other, key()),
      f.runtime.auth.claimPrimaryDevice(f.ids.other, key()),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("revokes a refresh family on reuse and invalidates the access token", async () => {
    const tokens = await f.runtime.auth.login(
      f.issuer,
      f.ids.school,
      "school",
      true,
    );
    expect((await api("post", "/api/v1/auth/refresh", tokens)).status).toBe(
      200,
    );
    expect((await api("post", "/api/v1/auth/refresh", tokens)).status).toBe(
      401,
    );
    expect((await api("get", "/api/v1/me", tokens)).status).toBe(401);
  });
  it("logout revokes an already issued access token", async () => {
    const tokens = await f.runtime.auth.login(
      f.issuer,
      f.ids.school,
      "school",
      true,
    );
    expect((await api("post", "/api/v1/auth/logout", tokens)).status).toBe(204);
    expect((await api("get", "/api/v1/me", tokens)).status).toBe(401);
  });
  it("counts concurrent attempts atomically in real Redis", async () => {
    const subject = key();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        f.runtime.coordination.limit("race", subject, 3, 60),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
  });
  it("binds OTP to purpose, consumes proofs once and never stores the code", async () => {
    const subject = key(),
      challenge = await f.runtime.otp.create(
        subject,
        "transfer",
        "123456",
        key(),
      );
    await expect(
      f.runtime.otp.verify(challenge, subject, "recovery", "123456"),
    ).rejects.toMatchObject({ code: "OTP_INVALID" });
    const proof = await f.runtime.otp.verify(
      challenge,
      subject,
      "transfer",
      "123456",
    );
    expect(
      JSON.stringify(
        (
          await f.admin.query(
            "SELECT * FROM identity.otp_challenges WHERE id=$1",
            [challenge],
          )
        ).rows,
      ),
    ).not.toContain("123456");
    await f.runtime.otp.consume(proof, challenge, "transfer");
    await expect(
      f.runtime.otp.consume(proof, challenge, "transfer"),
    ).rejects.toMatchObject({ code: "OTP_PROOF_INVALID" });
  });
  it("reports service readiness", async () => {
    expect(
      (await request(f.app.getHttpServer()).get("/health/ready")).status,
    ).toBe(200);
  });
  it("rejects a school-admin session lacking issuer MFA assurance", async () => {
    const tokens = await f.runtime.auth.login(
      f.issuer,
      f.ids.school,
      "school",
      false,
    );
    expect(
      (await api("get", `/api/v1/tenants/${f.ids.tenant}/classes`, tokens))
        .status,
    ).toBe(403);
    await expect(
      f.runtime.auth.login(f.issuer, f.ids.platform, "platform", false),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });
  it("invalidates all old account sessions after the security version changes", async () => {
    const tokens = await f.runtime.auth.login(
      f.issuer,
      f.ids.reader,
      "school",
      false,
    );
    await f.admin.query(
      "UPDATE identity.users SET security_version=security_version+1 WHERE id=$1",
      [f.ids.reader],
    );
    expect((await api("get", "/api/v1/me", tokens)).status).toBe(401);
  });
  it("enforces OTP attempt limits across new challenges for a subject", async () => {
    const subject = key(),
      challenge = await f.runtime.otp.create(
        subject,
        "activation",
        "123456",
        key(),
      );
    for (let i = 0; i < 5; i++)
      await expect(
        f.runtime.otp.verify(challenge, subject, "activation", "000000"),
      ).rejects.toMatchObject({ code: "OTP_INVALID" });
    await expect(
      f.runtime.otp.verify(challenge, subject, "activation", "123456"),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(
      (
        await f.admin.query(
          "SELECT attempts FROM identity.otp_challenges WHERE id=$1",
          [challenge],
        )
      ).rows[0].attempts,
    ).toBe(5);
  });
});
