import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Runtime } from "./runtime.js";
import { ApiError, keyFrom, success } from "./common.js";
import { uuid } from "../../../packages/contracts/src/index.js";

@Controller("/api/v1")
export class IdentityController {
  constructor(@Inject(Runtime) private readonly r: Runtime) {}
  @Get(["auth/oidc/start", "platform-auth/oidc/start"]) start(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.r.oidc.start(req, res);
  }
  @Get(["auth/oidc/callback", "platform-auth/oidc/callback"]) callback(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.r.oidc.callback(req, res);
  }
  @Post(["auth/refresh", "platform-auth/refresh"]) @HttpCode(200) async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.r.coordination.limit("refresh", req.ip ?? "unknown", 120, 60);
    const tokens = await this.r.auth.refresh(req);
    this.r.auth.cookies(res, tokens);
    return success({
      sessionId: tokens.actor.sessionId,
      audience: tokens.actor.audience,
    });
  }
  @Post(["auth/logout", "platform-auth/logout"]) @HttpCode(204) async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const actor = await this.r.auth.actor(req);
    await this.r.auth.logout(actor);
    this.r.auth.clearCookies(res, actor.audience);
  }
  @Get(["me", "platform-auth/me"]) async me(@Req() req: Request) {
    const a = await this.r.auth.actor(req);
    return success({
      userId: a.userId,
      sessionId: a.sessionId,
      audience: a.audience,
      permissions:
        a.audience === "platform"
          ? (
              await this.r.db.control.query(
                "SELECT permission FROM identity.effective_platform_permissions WHERE user_id=$1",
                [a.userId],
              )
            ).rows.map((r) => r.permission)
          : [],
    });
  }
  @Get("platform-auth/config") config() {
    return success({
      configured:
        this.r.config.OIDC_ENABLED === "true" &&
        !!this.r.config.OIDC_PLATFORM_CALLBACK_URL,
    });
  }
  @Get("me/tenants") async tenants(@Req() req: Request) {
    return success(await this.r.auth.tenants(await this.r.auth.actor(req)));
  }
}
@Controller("/api/v1/platform")
export class PlatformController {
  constructor(@Inject(Runtime) private readonly r: Runtime) {}
  @Get("tenants") async list(@Req() req: Request, @Query() query: unknown) {
    const page = await this.r.platform.list(
      await this.r.auth.actor(req),
      query,
    );
    return success(page.data, { nextCursor: page.nextCursor });
  }
  @Post("tenants") async create(@Req() req: Request, @Body() body: unknown) {
    return success(
      await this.r.platform.create(
        await this.r.auth.actor(req),
        body,
        keyFrom(req),
      ),
    );
  }
}
@Controller("/api/v1/tenants/:t")
export class SchoolController {
  constructor(@Inject(Runtime) private readonly r: Runtime) {}
  @Get() async tenant(@Req() req: Request, @Param("t") t: string) {
    return success(
      await this.r.records.tenant(await this.r.auth.actor(req), uuid.parse(t)),
    );
  }
  @Get("classes") async classes(
    @Req() req: Request,
    @Param("t") t: string,
    @Query() q: unknown,
  ) {
    const p = await this.r.records.list(
      await this.r.auth.actor(req),
      uuid.parse(t),
      "classes",
      q,
    );
    return success(p.data, { nextCursor: p.nextCursor });
  }
  @Post("classes") async createClass(
    @Req() req: Request,
    @Param("t") t: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.records.create(
        await this.r.auth.actor(req),
        uuid.parse(t),
        "classes",
        b,
        keyFrom(req),
      ),
    );
  }
  @Get("sections") async sections(
    @Req() req: Request,
    @Param("t") t: string,
    @Query() q: unknown,
  ) {
    const p = await this.r.records.list(
      await this.r.auth.actor(req),
      uuid.parse(t),
      "sections",
      q,
    );
    return success(p.data, { nextCursor: p.nextCursor });
  }
  @Post("sections") async createSection(
    @Req() req: Request,
    @Param("t") t: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.records.create(
        await this.r.auth.actor(req),
        uuid.parse(t),
        "sections",
        b,
        keyFrom(req),
      ),
    );
  }
  @Get("students") async students(
    @Req() req: Request,
    @Param("t") t: string,
    @Query() q: unknown,
  ) {
    const p = await this.r.records.list(
      await this.r.auth.actor(req),
      uuid.parse(t),
      "students",
      q,
    );
    return success(p.data, { nextCursor: p.nextCursor });
  }
  @Post("students") async createStudent(
    @Req() req: Request,
    @Param("t") t: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.records.create(
        await this.r.auth.actor(req),
        uuid.parse(t),
        "students",
        b,
        keyFrom(req),
      ),
    );
  }
  @Get("students/:id") async student(
    @Req() req: Request,
    @Param("t") t: string,
    @Param("id") id: string,
  ) {
    return success(
      await this.r.records.student(
        await this.r.auth.actor(req),
        uuid.parse(t),
        uuid.parse(id),
      ),
    );
  }
  @Patch("students/:id") async updateStudent(
    @Req() req: Request,
    @Param("t") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.records.updateStudent(
        await this.r.auth.actor(req),
        uuid.parse(t),
        uuid.parse(id),
        b,
        keyFrom(req),
      ),
    );
  }
  @Post("students/:id/guardian-links") async link(
    @Req() req: Request,
    @Param("t") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.records.link(
        await this.r.auth.actor(req),
        uuid.parse(t),
        uuid.parse(id),
        b,
        keyFrom(req),
      ),
    );
  }
  @Get("guardians") async guardians(
    @Req() req: Request,
    @Param("t") t: string,
    @Query() q: unknown,
  ) {
    const p = await this.r.records.list(
      await this.r.auth.actor(req),
      uuid.parse(t),
      "guardians",
      q,
    );
    return success(p.data, { nextCursor: p.nextCursor });
  }
  @Post("guardians") async createGuardian(
    @Req() req: Request,
    @Param("t") t: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.records.create(
        await this.r.auth.actor(req),
        uuid.parse(t),
        "guardians",
        b,
        keyFrom(req),
      ),
    );
  }
  @Post("guardians/:id/access-actions") @HttpCode(200) async access(
    @Req() req: Request,
    @Param("t") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.records.guardianAccess(
        await this.r.auth.actor(req),
        uuid.parse(t),
        uuid.parse(id),
        b,
        keyFrom(req),
      ),
    );
  }
  @Get("audit-events") async audit(
    @Req() req: Request,
    @Param("t") t: string,
    @Query() q: unknown,
  ) {
    const p = await this.r.records.audit(
      await this.r.auth.actor(req),
      uuid.parse(t),
      q,
    );
    return success(p.data, { nextCursor: p.nextCursor });
  }
}
@Controller("/health")
export class HealthController {
  constructor(@Inject(Runtime) private readonly r: Runtime) {}
  @Get("live") live() {
    return { status: "ok" };
  }
  @Get("ready") async ready() {
    try {
      await Promise.all([
        this.r.db.identity.query("SELECT 1"),
        this.r.db.tenant.query("SELECT 1"),
        this.r.db.control.query("SELECT 1"),
        this.r.coordination.client.ping(),
      ]);
      return { status: "ready" };
    } catch {
      throw new ApiError(503, "NOT_READY");
    }
  }
}
