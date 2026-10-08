import { beforeAll, afterAll, it, expect } from "vitest";
import {
  chromium,
  expect as browserExpect,
  type Browser,
  type Page,
} from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { fixture } from "./helpers.js";
import { signedIssuer } from "./signed-issuer.js";
let f: Awaited<ReturnType<typeof fixture>>,
  issuer: Awaited<ReturnType<typeof signedIssuer>>,
  browser: Browser,
  web: ChildProcess,
  page: Page;
const schoolName = `Browser School ${Date.now()}`,
  planName = `Browser Plan ${Date.now()}`;
const origin = "https://localhost:3101";
beforeAll(async () => {
  issuer = await signedIssuer(() => f.ids.platform);
  f = await fixture({
    OIDC_ENABLED: "true",
    OIDC_ISSUER: issuer.issuer,
    OIDC_CLIENT_ID: "browser-client",
    OIDC_CLIENT_SECRET: "browser-secret",
    OIDC_CALLBACK_URL: "http://localhost:3000/api/v1/auth/oidc/callback",
    OIDC_PLATFORM_CALLBACK_URL: `${origin}/api/v1/platform-auth/oidc/callback`,
    PLATFORM_ORIGIN: origin,
    OIDC_MFA_ACR: "urn:test:mfa",
  });
  await f.admin.query(
    "INSERT INTO identity.platform_role_assignments VALUES($1,'Super Admin')",
    [f.ids.platform],
  );
  await f.app.listen(0, "127.0.0.1");
  const address = f.app.getHttpServer().address();
  web = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "apps/platform-admin",
      "--hostname",
      "localhost",
      "--port",
      "3101",
      "--experimental-https",
      "--experimental-https-key",
      resolve(".local/localhost.key"),
      "--experimental-https-cert",
      resolve(".local/localhost.pem"),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "development",
        PLATFORM_ORIGIN: origin,
        HOMEBELL_API_ORIGIN: `http://127.0.0.1:${address.port}`,
      },
      stdio: "ignore",
      windowsHide: true,
    },
  );
  browser = await chromium.launch();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies([
    {
      name: "hb_access",
      value: "school-cookie-isolation-fixture",
      url: origin,
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  page = await context.newPage();
  for (let i = 0; i < 90; i++) {
    try {
      await page.goto(origin);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await mkdir(".local/screenshots", { recursive: true });
}, 120000);
afterAll(async () => {
  await browser?.close();
  web?.kill();
  await f?.close();
  await issuer?.close();
});
async function confirm() {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await browserExpect(page.getByRole("dialog")).toHaveCount(0, {
    timeout: 15000,
  });
}
async function reason() {
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic browser verification");
}
it("signs in through signed OIDC and completes tenant, access, note, plan and audit workflows", async () => {
  await page
    .getByRole("link", { name: "Sign in with your organization" })
    .click();
  await browserExpect(
    page.getByRole("heading", { name: "Schools", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "+ Create school" }).click();
  await page.getByLabel("School name", { exact: true }).fill(schoolName);
  await confirm();
  await page.getByLabel("Find a school").fill(schoolName);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: `Open ${schoolName}` }).click();
  await browserExpect(
    page.getByRole("heading", { name: schoolName }),
  ).toBeVisible();
  await page.getByRole("button", { name: "access", exact: true }).click();
  await page.getByRole("button", { name: "Start trial", exact: true }).click();
  await reason();
  await confirm();
  await browserExpect(
    page.getByText("operator_assignment", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "overview", exact: true }).click();
  await page.getByRole("button", { name: "suspend", exact: true }).click();
  await reason();
  await confirm();
  await browserExpect(page.getByText("LIFECYCLE_DENIED")).toBeVisible();
  await page.getByRole("button", { name: "reinstate", exact: true }).click();
  await reason();
  await confirm();
  await browserExpect(page.getByText("ACCESS_GRANTED")).toBeVisible();
  await page.getByRole("button", { name: "notes", exact: true }).click();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page
    .getByLabel("Internal note", { exact: true })
    .fill("Browser-only internal note");
  await reason();
  await confirm();
  await browserExpect(
    page.getByText("Browser-only internal note"),
  ).toBeVisible();
  await page.getByRole("button", { name: "audit", exact: true }).click();
  await browserExpect(
    page.getByRole("cell", { name: "tenant.suspend", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/screenshots/phase2-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Plans", exact: true }).click();
  await page.getByRole("button", { name: "+ Create plan" }).click();
  await page.getByLabel("Plan name", { exact: true }).fill(planName);
  await page.getByLabel("Unique plan code").fill(`browser-${Date.now()}`);
  await reason();
  await confirm();
  const plan = page.locator("section").filter({
    has: page.getByRole("heading", { name: planName }),
  });
  await plan.getByRole("button", { name: "Publish version" }).click();
  await page.getByLabel("Annual USD amount in cents").fill("10000");
  await page.getByLabel("Licensed children", { exact: true }).fill("50");
  await reason();
  await confirm();
  await browserExpect(
    plan.getByText("Version 1 · USD 100.00 / year"),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/screenshots/phase2-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}, 120000);
it("rejects proxy school routes and cross-origin mutations", async () => {
  expect(
    (await page.context().cookies()).find((c) => c.name === "hb_access")?.value,
  ).toBe("school-cookie-isolation-fixture");
  expect(
    (
      await page.request.get(`${origin}/api/v1/tenants/${f.ids.tenant}`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.post(`${origin}/api/v1/platform/tenants`, {
        headers: { origin: "https://untrusted.invalid" },
        data: { name: "Rejected", timeZone: "UTC" },
      })
    ).status(),
  ).toBe(403);
});
it("assigns an annual term and creates a separately labeled complimentary extension", async () => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Schools", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "+ Create school" }).click();
  await page
    .getByLabel("School name", { exact: true })
    .fill(`${schoolName} Annual`);
  await confirm();
  await page.getByLabel("Find a school").fill(`${schoolName} Annual`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("button", { name: `Open ${schoolName} Annual`, exact: true })
    .click();
  await page.getByRole("button", { name: "access", exact: true }).click();
  await page
    .getByRole("button", { name: "Assign annual plan", exact: true })
    .click();
  const version = (
    await f.admin.query(
      "SELECT v.id FROM control.plan_versions v JOIN control.plans p ON p.id=v.plan_id WHERE p.name=$1",
      [planName],
    )
  ).rows[0].id;
  await page.getByLabel("Immutable annual plan version").selectOption(version);
  await page
    .getByLabel("Manual commercial reference")
    .fill("BROWSER-MANUAL-REFERENCE");
  await reason();
  await browserExpect(
    page.getByText("Annual term ends:", { exact: false }),
  ).toBeVisible();
  await confirm();
  await browserExpect(
    page.getByText("Manual reference: BROWSER-MANUAL-REFERENCE"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Extend access", exact: true })
    .click();
  await page
    .getByLabel("New access end (UTC)")
    .fill(new Date(Date.now() + 800 * 86400000).toISOString().slice(0, 16));
  await reason();
  await confirm();
  await browserExpect(
    page.getByText("Source: complimentary_extension"),
  ).toBeVisible();
}, 60000);
it("grants free access, enforces bounded overrides and displays stale-edit conflicts", async () => {
  await page
    .getByRole("button", { name: "Schools", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "+ Create school" }).click();
  await page
    .getByLabel("School name", { exact: true })
    .fill(`${schoolName} Free`);
  await confirm();
  await page.getByLabel("Find a school").fill(`${schoolName} Free`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("button", { name: `Open ${schoolName} Free`, exact: true })
    .click();
  await page.getByRole("button", { name: "access", exact: true }).click();
  await page
    .getByRole("button", { name: "Grant free access", exact: true })
    .click();
  await reason();
  await confirm();
  await page.getByRole("button", { name: "Add override", exact: true }).click();
  await page
    .getByLabel("Target", { exact: true })
    .selectOption("school.records.write");
  await page.getByLabel("Value: child count or true / false").fill("false");
  await reason();
  await confirm();
  await browserExpect(
    page.getByText("school.records.write: false"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await reason();
  await confirm();
  await page.getByRole("button", { name: "notes", exact: true }).click();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page
    .getByLabel("Internal note", { exact: true })
    .fill("Stale note must not be saved");
  await reason();
  const tenant = (
    await f.admin.query(
      "SELECT id,version FROM control.tenants WHERE name=$1",
      [`${schoolName} Free`],
    )
  ).rows[0];
  await f.runtime.controlQueries.note(
    f.platform.actor,
    tenant.id,
    {
      expectedVersion: tenant.version,
      reason: "Concurrent test writer",
      text: "Committed concurrent note",
    },
    crypto.randomUUID(),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await browserExpect(
    page.getByRole("dialog").getByRole("alert"),
  ).toContainText("VERSION_CONFLICT");
  await page.screenshot({
    path: ".local/screenshots/phase2-conflict.png",
    fullPage: true,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await browserExpect(
    page.getByText("Committed concurrent note"),
  ).toBeVisible();
}, 60000);
it("enforces a restricted operator role and returns expired sessions to sign-in", async () => {
  await f.admin.query(
    "DELETE FROM identity.platform_role_assignments WHERE user_id=$1",
    [f.ids.platform],
  );
  await f.admin.query(
    "DELETE FROM identity.platform_permissions WHERE user_id=$1",
    [f.ids.platform],
  );
  await f.admin.query(
    "INSERT INTO identity.platform_role_assignments VALUES($1,'Support Analyst')",
    [f.ids.platform],
  );
  await page.goto(origin);
  await browserExpect(
    page.getByRole("heading", { name: "Schools", exact: true }),
  ).toBeVisible();
  await browserExpect(
    page.getByRole("button", { name: "+ Create school" }),
  ).toHaveCount(0);
  await browserExpect(
    page.getByRole("button", { name: "Plans", exact: true }),
  ).toHaveCount(0);
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "hb_platform_csrf",
  )!.value;
  expect(
    (
      await page.request.post(`${origin}/api/v1/platform/tenants`, {
        headers: {
          origin,
          "x-csrf-token": csrf,
          "idempotency-key": crypto.randomUUID(),
        },
        data: { name: "Forbidden", timeZone: "UTC" },
      })
    ).status(),
  ).toBe(403);
  await f.admin.query(
    "UPDATE identity.sessions SET revoked_at=now() WHERE user_id=$1",
    [f.ids.platform],
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await browserExpect(
    page.getByRole("link", { name: "Sign in with your organization" }),
  ).toBeVisible();
});
