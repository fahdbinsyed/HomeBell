import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID, createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
export async function signedIssuer(subject: () => string) {
  const keys = await generateKeyPair("RS256"),
    jwk = {
      ...(await exportJWK(keys.publicKey)),
      kid: "browser-test",
      alg: "RS256",
      use: "sig",
    };
  let issuer = "";
  const codes = new Map<string, { nonce: string; challenge: string }>();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer);
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/.well-known/openid-configuration")
      return res.end(
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
    if (url.pathname === "/jwks")
      return res.end(JSON.stringify({ keys: [jwk] }));
    if (url.pathname === "/authorize") {
      const code = randomUUID();
      codes.set(code, {
        nonce: url.searchParams.get("nonce")!,
        challenge: url.searchParams.get("code_challenge")!,
      });
      const redirect = new URL(url.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", url.searchParams.get("state")!);
      res.writeHead(302, { location: redirect.href });
      return res.end();
    }
    if (url.pathname === "/token") {
      let body = "";
      for await (const part of req) body += String(part);
      const params = new URLSearchParams(body),
        data = codes.get(params.get("code")!);
      codes.delete(params.get("code")!);
      if (
        !data ||
        createHash("sha256")
          .update(params.get("code_verifier") ?? "")
          .digest("base64url") !== data.challenge ||
        (params.get("client_secret") !== "browser-secret" &&
          req.headers.authorization !==
            `Basic ${Buffer.from("browser-client:browser-secret").toString("base64")}`)
      ) {
        res.statusCode = 400;
        return res.end("{}");
      }
      const idToken = await new SignJWT({
        nonce: data.nonce,
        acr: "urn:test:mfa",
      })
        .setProtectedHeader({ alg: "RS256", kid: "browser-test" })
        .setIssuer(issuer)
        .setAudience("browser-client")
        .setSubject(subject())
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(keys.privateKey);
      return res.end(
        JSON.stringify({
          access_token: "isolated-test-provider-token",
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken,
        }),
      );
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    issuer,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
