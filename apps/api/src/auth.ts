import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { importPKCS8, importSPKI, SignJWT, jwtVerify } from "jose";
import type { Request, Response } from "express";
import type { Config } from "./config.js";
import type { Audience } from "../../../packages/contracts/src/index.js";
import { Database, type Actor } from "./database.js";
import {
  ApiError,
  assert,
  digest,
  equal,
  requestId,
  context,
} from "./common.js";

const token = () => randomBytes(32).toString("base64url");
export class Auth {
  private readonly privateKey;
  private readonly publicKey;
  constructor(
    readonly config: Config,
    readonly db: Database,
  ) {
    this.privateKey = importPKCS8(
      readFileSync(config.SIGNING_KEY_PATH, "utf8"),
      "RS256",
    );
    this.publicKey = importSPKI(
      readFileSync(config.VERIFY_KEY_PATH, "utf8"),
      "RS256",
    );
  }
  async ready() {
    await Promise.all([this.privateKey, this.publicKey]);
  }
  async access(actor: Actor) {
    return new SignJWT({ sid: actor.sessionId })
      .setProtectedHeader({ alg: "RS256", kid: this.config.SIGNING_KEY_ID })
      .setSubject(actor.userId)
      .setAudience(actor.audience)
      .setIssuer(this.config.TOKEN_ISSUER)
      .setIssuedAt()
      .setExpirationTime("5m")
      .setJti(randomUUID())
      .sign(await this.privateKey);
  }
  async login(
    issuer: string,
    subject: string,
    audience: "school" | "platform",
    mfa: boolean,
  ) {
    if (audience === "platform") assert(mfa, 403, "MFA_REQUIRED");
    const csrf = token(),
      refresh = token(),
      id = randomUUID();
    const userId = await this.db.transaction(this.db.identity, async (tx) => {
      const mapping = (
        await tx.query(
          "SELECT user_id FROM identity.external_identities WHERE issuer=$1 AND subject=$2",
          [issuer, subject],
        )
      ).rows[0];
      assert(mapping, 403, "ACCOUNT_NOT_PROVISIONED");
      const user = (
        await tx.query(
          "SELECT id,status,security_version FROM identity.users WHERE id=$1 FOR UPDATE",
          [mapping.user_id],
        )
      ).rows[0];
      assert(user?.status === "active", 401, "SESSION_INVALID");
      if (audience === "platform")
        assert(
          (
            await tx.query(
              "SELECT 1 FROM identity.effective_platform_permissions WHERE user_id=$1 LIMIT 1",
              [user.id],
            )
          ).rowCount,
          403,
          "FORBIDDEN",
        );
      await tx.query(
        "INSERT INTO identity.sessions(id,user_id,audience,security_version,csrf_digest,mfa,expires_at,idle_until) VALUES($1,$2,$3,$4,$5,$6,now()+interval '8 hours',now()+interval '30 minutes')",
        [id, user.id, audience, user.security_version, digest(csrf), mfa],
      );
      await tx.query(
        "INSERT INTO identity.refresh_tokens(digest,session_id) VALUES($1,$2)",
        [digest(refresh), id],
      );
      await tx.query(
        "INSERT INTO identity.security_events(id,actor_id,action,request_id) VALUES($1,$2,$3,$4)",
        [randomUUID(), user.id, "login.succeeded", requestId()],
      );
      return user.id as string;
    });
    const actor = { userId, sessionId: id, audience };
    return { actor, csrf, refresh, access: await this.access(actor) };
  }
  async actor(req: Request): Promise<Actor> {
    const platformContext =
      req.path.startsWith("/api/v1/platform") ||
      req.get("x-homebell-context") === "platform";
    const raw = (req.cookies?.[
      platformContext ? "hb_platform_access" : "hb_access"
    ] ??
      req.cookies?.[
        platformContext ? "hb_access" : "hb_platform_access"
      ]) as unknown;
    assert(
      typeof raw === "string" && raw.length < 8192,
      401,
      "SESSION_INVALID",
    );
    let actor: Actor;
    try {
      const { payload, protectedHeader } = await jwtVerify(
        raw,
        await this.publicKey,
        {
          algorithms: ["RS256"],
          issuer: this.config.TOKEN_ISSUER,
          audience: ["school", "platform", "guardian"],
          maxTokenAge: "5m",
        },
      );
      assert(
        protectedHeader.kid === this.config.SIGNING_KEY_ID &&
          typeof payload.sub === "string" &&
          typeof payload.sid === "string" &&
          typeof payload.aud === "string",
        401,
        "SESSION_INVALID",
      );
      actor = {
        userId: payload.sub,
        sessionId: payload.sid,
        audience: payload.aud as Audience,
      };
    } catch {
      throw new ApiError(401, "SESSION_INVALID");
    }
    assert(
      platformContext
        ? actor.audience === "platform"
        : actor.audience !== "platform",
      403,
      "WRONG_AUDIENCE",
    );
    await this.db.transaction(this.db.identity, async (tx) => {
      await this.db.checkSession(tx, actor, "update");
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const s = (
          await tx.query(
            "SELECT csrf_digest FROM identity.sessions WHERE id=$1",
            [actor.sessionId],
          )
        ).rows[0];
        this.checkCsrf(req, s.csrf_digest as string, actor.audience);
      }
      await tx.query(
        "UPDATE identity.sessions SET idle_until=LEAST(expires_at,now()+CASE WHEN audience='guardian' THEN interval '7 days' ELSE interval '30 minutes' END) WHERE id=$1",
        [actor.sessionId],
      );
    });
    const ctx = context.getStore();
    if (ctx) ctx.actorId = actor.userId;
    return actor;
  }
  checkCsrf(req: Request, expected: string, audience: Audience = "school") {
    const proof = req.get("x-csrf-token");
    assert(
      req.get("origin") ===
        (audience === "platform"
          ? this.config.PLATFORM_ORIGIN
          : this.config.WEB_ORIGIN) &&
        proof &&
        equal(digest(proof), expected),
      403,
      "CSRF_INVALID",
    );
  }
  async refresh(req: Request) {
    const platformContext = req.path.startsWith("/api/v1/platform-auth");
    const raw = req.cookies?.[
      platformContext ? "hb_platform_refresh" : "hb_refresh"
    ] as unknown;
    assert(typeof raw === "string" && raw.length < 256, 401, "SESSION_INVALID");
    // Keep the session-bound CSRF proof stable so a spent refresh token can be
    // detected even when the client lost the previous rotation response.
    const replacement = token(),
      csrf = req.get("x-csrf-token") ?? "";
    const result = await this.db.transaction(this.db.identity, async (tx) => {
      const ref = (
        await tx.query(
          "SELECT s.user_id,s.id,s.audience FROM identity.refresh_tokens r JOIN identity.sessions s ON s.id=r.session_id WHERE r.digest=$1",
          [digest(raw)],
        )
      ).rows[0];
      assert(ref, 401, "SESSION_INVALID");
      assert(
        platformContext
          ? ref.audience === "platform"
          : ref.audience !== "platform",
        401,
        "SESSION_INVALID",
      );
      // Account before session: same lock order as revocation/device changes.
      await tx.query("SELECT id FROM identity.users WHERE id=$1 FOR UPDATE", [
        ref.user_id,
      ]);
      const s = (
        await tx.query(
          "SELECT csrf_digest FROM identity.sessions WHERE id=$1 FOR UPDATE",
          [ref.id],
        )
      ).rows[0];
      this.checkCsrf(req, s.csrf_digest as string, ref.audience);
      const r = (
        await tx.query(
          "SELECT consumed_at FROM identity.refresh_tokens WHERE digest=$1 FOR UPDATE",
          [digest(raw)],
        )
      ).rows[0];
      if (r.consumed_at) {
        await tx.query(
          "UPDATE identity.sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1",
          [ref.id],
        );
        await tx.query(
          "INSERT INTO identity.security_events(id,actor_id,action,request_id) VALUES($1,$2,$3,$4)",
          [randomUUID(), ref.user_id, "refresh.reuse", requestId()],
        );
        return null;
      }
      const actor = {
        userId: ref.user_id as string,
        sessionId: ref.id as string,
        audience: ref.audience as Audience,
      };
      await this.db.checkSession(tx, actor);
      await tx.query(
        "UPDATE identity.refresh_tokens SET consumed_at=now() WHERE digest=$1",
        [digest(raw)],
      );
      await tx.query(
        "INSERT INTO identity.refresh_tokens(digest,session_id) VALUES($1,$2)",
        [digest(replacement), ref.id],
      );
      await tx.query(
        "UPDATE identity.sessions SET csrf_digest=$2,idle_until=LEAST(expires_at,now()+interval '30 minutes') WHERE id=$1",
        [ref.id, digest(csrf)],
      );
      return actor;
    });
    assert(result, 401, "SESSION_INVALID");
    return {
      actor: result,
      csrf,
      refresh: replacement,
      access: await this.access(result),
    };
  }
  async logout(actor: Actor) {
    await this.db.transaction(this.db.identity, async (tx) => {
      await tx.query("SELECT id FROM identity.users WHERE id=$1 FOR UPDATE", [
        actor.userId,
      ]);
      await tx.query(
        "UPDATE identity.sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2",
        [actor.sessionId, actor.userId],
      );
      await tx.query(
        "INSERT INTO identity.security_events(id,actor_id,action,request_id) VALUES($1,$2,$3,$4)",
        [randomUUID(), actor.userId, "logout", requestId()],
      );
    });
  }
  cookies(
    res: Response,
    tokens: { access: string; refresh: string; csrf: string; actor?: Actor },
  ) {
    const base = {
      secure: true,
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
    };
    const prefix = tokens.actor?.audience === "platform" ? "hb_platform" : "hb";
    const authPath =
      prefix === "hb_platform" ? "/api/v1/platform-auth" : "/api/v1/auth";
    res.cookie(`${prefix}_access`, tokens.access, { ...base, maxAge: 300000 });
    res.cookie(`${prefix}_refresh`, tokens.refresh, {
      ...base,
      path: authPath,
      maxAge: 8 * 3600000,
    });
    res.cookie(`${prefix}_csrf`, tokens.csrf, {
      ...base,
      httpOnly: false,
      maxAge: 8 * 3600000,
    });
  }
  clearCookies(res: Response, audience: Audience = "school") {
    const prefix = audience === "platform" ? "hb_platform" : "hb";
    for (const name of [
      `${prefix}_access`,
      `${prefix}_csrf`,
      `${prefix}_refresh`,
    ])
      res.clearCookie(name, {
        secure: true,
        httpOnly: !name.endsWith("_csrf"),
        sameSite: "lax",
        path: name.endsWith("_refresh")
          ? audience === "platform"
            ? "/api/v1/platform-auth"
            : "/api/v1/auth"
          : "/",
      });
  }
  async tenants(actor: Actor) {
    assert(actor.audience === "school", 403, "WRONG_AUDIENCE");
    return this.db.transaction(this.db.identity, async (tx) => {
      await this.db.checkSession(tx, actor);
      await tx.query("SELECT set_config('app.actor_id',$1,true)", [
        actor.userId,
      ]);
      return (
        await tx.query(
          "SELECT t.id,t.name,t.status FROM control.tenants t JOIN app.memberships m ON m.tenant_id=t.id WHERE m.user_id=$1 AND m.active ORDER BY t.id",
          [actor.userId],
        )
      ).rows;
    });
  }
  async claimPrimaryDevice(userId: string, deviceId: string) {
    return this.db.transaction(this.db.identity, async (tx) => {
      const user = (
        await tx.query(
          "SELECT status,active_device_id FROM identity.users WHERE id=$1 FOR UPDATE",
          [userId],
        )
      ).rows[0];
      assert(user?.status === "active", 401, "SESSION_INVALID");
      assert(
        !user.active_device_id || user.active_device_id === deviceId,
        409,
        "DEVICE_TRANSFER_REQUIRED",
      );
      await tx.query(
        "INSERT INTO identity.devices(id,user_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
        [deviceId, userId],
      );
      await tx.query(
        "UPDATE identity.users SET active_device_id=$2 WHERE id=$1",
        [userId, deviceId],
      );
      await tx.query(
        "INSERT INTO identity.security_events(id,actor_id,action,request_id) VALUES($1,$2,$3,$4)",
        [randomUUID(), userId, "device.claimed", requestId()],
      );
    });
  }
}
