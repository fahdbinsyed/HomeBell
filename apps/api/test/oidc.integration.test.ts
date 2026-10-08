import { beforeAll, afterAll, it, expect } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID, createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import request from "supertest";
import { fixture } from "./helpers.js";

let f: Awaited<ReturnType<typeof fixture>>;
let issuer: string;
let mode = "valid";
let server: ReturnType<typeof createServer>;
beforeAll(async () => {
  const keys = await generateKeyPair("RS256"),
    attackerKeys = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  };
  const codes = new Map<
    string,
    { nonce: string; challenge: string; subject: string }
  >();
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer);
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/.well-known/openid-configuration") {
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: [
            "client_secret_post",
            "client_secret_basic",
          ],
          code_challenge_methods_supported: ["S256"],
        }),
      );
      return;
    }
    if (url.pathname === "/jwks") {
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (url.pathname === "/authorize") {
      const code = randomUUID();
      codes.set(code, {
        nonce: url.searchParams.get("nonce")!,
        challenge: url.searchParams.get("code_challenge")!,
        subject: f.ids.school,
      });
      const redirect = new URL(url.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", url.searchParams.get("state")!);
      res.writeHead(302, { location: redirect.href });
      res.end();
      return;
    }
    if (url.pathname === "/token") {
      let body = "";
      for await (const part of req) body += String(part);
      const params = new URLSearchParams(body);
      const data = codes.get(params.get("code")!);
      codes.delete(params.get("code")!);
      const secretValid =
        params.get("client_secret") === "fixture-secret" ||
        req.headers.authorization ===
          `Basic ${Buffer.from("homebell-test:fixture-secret").toString("base64")}`;
      if (
        !data ||
        !secretValid ||
        createHash("sha256")
          .update(params.get("code_verifier") ?? "")
          .digest("base64url") !== data.challenge
      ) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      const jwt = await new SignJWT({
        nonce: mode === "nonce" ? "wrong-nonce" : data.nonce,
        acr: mode === "mfa" ? "weak" : "urn:test:mfa",
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(mode === "issuer" ? "https://wrong.invalid" : issuer)
        .setAudience(mode === "audience" ? "other-client" : "homebell-test")
        .setSubject(data.subject)
        .setIssuedAt()
        .setExpirationTime(
          mode === "expired" ? Math.floor(Date.now() / 1000) - 600 : "5m",
        )
        .sign(mode === "signature" ? attackerKeys.privateKey : keys.privateKey);
      res.end(
        JSON.stringify({
          access_token: "test-provider-access-token",
          token_type: "Bearer",
          expires_in: 300,
          id_token: jwt,
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  f = await fixture({
    OIDC_ENABLED: "true",
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: "homebell-test",
    OIDC_CLIENT_SECRET: "fixture-secret",
    OIDC_CALLBACK_URL: "http://localhost:3000/api/v1/auth/oidc/callback",
    OIDC_MFA_ACR: "urn:test:mfa",
  });
});
afterAll(async () => {
  await f?.close();
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
});
async function flow() {
  const start = await request(f.app.getHttpServer()).get(
    "/api/v1/auth/oidc/start?audience=school",
  );
  expect(start.status).toBe(302);
  const cookie = (start.headers["set-cookie"] as unknown as string[])[0]!.split(
    ";",
  )[0]!;
  const auth = await fetch(start.headers.location!, { redirect: "manual" });
  const callback = new URL(auth.headers.get("location")!);
  return { cookie, path: callback.pathname + callback.search };
}
it("executes authorization code + PKCE and sets protected session cookies", async () => {
  mode = "valid";
  const x = await flow();
  const result = await request(f.app.getHttpServer())
    .get(x.path)
    .set("Cookie", x.cookie);
  expect(result.status).toBe(303);
  const headers = result.headers["set-cookie"] as unknown as string[];
  expect(headers.find((c) => c.startsWith("hb_access="))).toMatch(/HttpOnly/);
  expect(headers.find((c) => c.startsWith("hb_refresh="))).toMatch(/Secure/);
  expect(result.headers.location).toBe(f.config.WEB_ORIGIN + "/");
  expect(
    (await request(f.app.getHttpServer()).get(x.path).set("Cookie", x.cookie))
      .status,
  ).toBe(401);
});
it.each(["nonce", "issuer", "audience", "expired", "signature"])(
  "rejects invalid signed OIDC %s claims",
  async (invalid) => {
    mode = invalid;
    const x = await flow();
    expect(
      (await request(f.app.getHttpServer()).get(x.path).set("Cookie", x.cookie))
        .status,
    ).toBe(401);
  },
);
it("rejects callback state tampering", async () => {
  mode = "valid";
  const x = await flow();
  const path = x.path.replace(/state=[^&]+/, "state=wrong-state");
  expect(
    (await request(f.app.getHttpServer()).get(path).set("Cookie", x.cookie))
      .status,
  ).toBe(401);
});
