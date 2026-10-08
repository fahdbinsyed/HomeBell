import * as oidc from "openid-client";
import type { Config } from "./config.js";
import { Coordination } from "./coordination.js";
import { Auth } from "./auth.js";
import { ApiError, assert } from "./common.js";
import { z } from "zod";
import type { Request, Response } from "express";
const startInput = z.strictObject({ audience: z.enum(["school", "platform"]) });
const callbackInput = z.strictObject({
  code: z.string().min(1).max(4096),
  state: z.string().min(1).max(256),
  iss: z.string().optional(),
  session_state: z.string().optional(),
});
export class Oidc {
  private client: oidc.Configuration | undefined;
  constructor(
    private readonly config: Config,
    private readonly coordination: Coordination,
    private readonly auth: Auth,
  ) {}
  async connect() {
    if (this.config.OIDC_ENABLED === "false") return;
    this.client = await oidc.discovery(
      new URL(this.config.OIDC_ISSUER!),
      this.config.OIDC_CLIENT_ID!,
      this.config.OIDC_CLIENT_SECRET!,
      undefined,
      this.config.NODE_ENV === "test"
        ? { execute: [oidc.allowInsecureRequests] }
        : undefined,
    );
    oidc.enableNonRepudiationChecks(this.client);
  }
  async start(req: Request, res: Response) {
    assert(this.client, 503, "STAFF_LOGIN_NOT_CONFIGURED");
    const { audience } = startInput.parse(req.query);
    const platformContext = req.path.startsWith("/api/v1/platform-auth");
    assert(
      platformContext ? audience === "platform" : audience === "school",
      400,
      "WRONG_AUDIENCE",
    );
    const callbackUrl = platformContext
      ? this.config.OIDC_PLATFORM_CALLBACK_URL
      : this.config.OIDC_CALLBACK_URL;
    assert(callbackUrl, 503, "STAFF_LOGIN_NOT_CONFIGURED");
    await this.coordination.limit("oidc", req.ip ?? "unknown", 20, 3600);
    const state = oidc.randomState(),
      nonce = oidc.randomNonce(),
      verifier = oidc.randomPKCECodeVerifier(),
      cookie = oidc.randomState();
    await this.coordination.put(
      `oidc:${cookie}`,
      { state, nonce, verifier, audience, callbackUrl },
      300,
    );
    const url = oidc.buildAuthorizationUrl(this.client, {
      redirect_uri: callbackUrl,
      scope: "openid",
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      acr_values: this.config.OIDC_MFA_ACR!,
    });
    res.cookie(platformContext ? "hb_platform_oidc" : "hb_oidc", cookie, {
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: platformContext ? "/api/v1/platform-auth" : "/api/v1/auth",
      maxAge: 300000,
    });
    res.redirect(302, url.href);
  }
  async callback(req: Request, res: Response) {
    assert(this.client, 503, "STAFF_LOGIN_NOT_CONFIGURED");
    callbackInput.parse(req.query);
    await this.coordination.limit(
      "oidc-callback",
      req.ip ?? "unknown",
      60,
      3600,
    );
    const platformContext = req.path.startsWith("/api/v1/platform-auth");
    const cookie = req.cookies?.[
      platformContext ? "hb_platform_oidc" : "hb_oidc"
    ] as unknown;
    assert(
      typeof cookie === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(cookie),
      401,
      "OIDC_INVALID",
    );
    const stored = await this.coordination.take(`oidc:${cookie}`);
    assert(stored, 401, "OIDC_INVALID");
    const state = JSON.parse(stored) as {
      state: string;
      nonce: string;
      verifier: string;
      audience: "school" | "platform";
      callbackUrl: string;
    };
    assert(
      platformContext
        ? state.audience === "platform"
        : state.audience === "school",
      401,
      "OIDC_INVALID",
    );
    const url = new URL(state.callbackUrl);
    for (const [key, value] of Object.entries(req.query)) {
      assert(typeof value === "string", 400, "VALIDATION_FAILED");
      url.searchParams.set(key, value);
    }
    let claims;
    try {
      const result = await oidc.authorizationCodeGrant(this.client, url, {
        pkceCodeVerifier: state.verifier,
        expectedState: state.state,
        expectedNonce: state.nonce,
        idTokenExpected: true,
      });
      claims = result.claims();
      assert(claims?.sub, 401, "OIDC_INVALID");
    } catch {
      await this.auth.db.securityEvent("oidc.rejected");
      throw new ApiError(401, "OIDC_INVALID");
    }
    const tokens = await this.auth.login(
      this.config.OIDC_ISSUER!,
      claims.sub,
      state.audience,
      claims.acr === this.config.OIDC_MFA_ACR,
    );
    this.auth.cookies(res, tokens);
    res.clearCookie(platformContext ? "hb_platform_oidc" : "hb_oidc", {
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: platformContext ? "/api/v1/platform-auth" : "/api/v1/auth",
    });
    res.redirect(
      303,
      (platformContext ? this.config.PLATFORM_ORIGIN : this.config.WEB_ORIGIN) +
        "/",
    );
  }
}
