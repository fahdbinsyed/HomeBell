import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { Runtime } from "./runtime.js";
import { keyFrom, success } from "./common.js";
import { uuid } from "../../../packages/contracts/src/index.js";
@Controller("/api/v1/platform")
export class ControlController {
  constructor(@Inject(Runtime) private r: Runtime) {}
  @Get("overview") async overview(@Req() req: Request) {
    return success(
      await this.r.controlQueries.overview(await this.r.auth.actor(req)),
    );
  }
  @Get("tenants/:id") async detail(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return success(
      await this.r.controlQueries.detail(
        await this.r.auth.actor(req),
        uuid.parse(id),
      ),
    );
  }
  @Get("tenants/:id/entitlements") async entitlements(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return success(
      (
        await this.r.controlQueries.detail(
          await this.r.auth.actor(req),
          uuid.parse(id),
        )
      ).entitlements,
    );
  }
  @Get("tenants/:id/usage") async usage(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return success(
      (
        await this.r.controlQueries.detail(
          await this.r.auth.actor(req),
          uuid.parse(id),
        )
      ).usage,
    );
  }
  @Get("plans") async plans(@Req() req: Request, @Query() q: unknown) {
    const p = await this.r.plans.list(await this.r.auth.actor(req), q);
    return success(p.data, { nextCursor: p.nextCursor });
  }
  @Post("plans") async createPlan(@Req() req: Request, @Body() b: unknown) {
    return success(
      await this.r.plans.create(await this.r.auth.actor(req), b, keyFrom(req)),
    );
  }
  @Post("plans/:id/versions") async version(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.plans.change(
        await this.r.auth.actor(req),
        uuid.parse(id),
        b,
        keyFrom(req),
      ),
    );
  }
  @Post("plans/:id/archive") async archive(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.plans.change(
        await this.r.auth.actor(req),
        uuid.parse(id),
        b,
        keyFrom(req),
        true,
      ),
    );
  }
  @Post("tenants/:id/subscriptions") async subscription(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.plans.subscribe(
        await this.r.auth.actor(req),
        uuid.parse(id),
        b,
        keyFrom(req),
      ),
    );
  }
  @Post("tenants/:id/lifecycle-actions") async lifecycle(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.accessManagement.lifecycle(
        await this.r.auth.actor(req),
        uuid.parse(id),
        b,
        keyFrom(req),
      ),
    );
  }
  @Post("tenants/:id/access-extensions") async extend(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.accessManagement.extend(
        await this.r.auth.actor(req),
        uuid.parse(id),
        b,
        keyFrom(req),
      ),
    );
  }
  @Post("tenants/:id/entitlement-overrides") async override(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.accessManagement.override(
        await this.r.auth.actor(req),
        uuid.parse(id),
        b,
        keyFrom(req),
      ),
    );
  }
  @Post("tenants/:id/entitlement-overrides/:overrideId/revoke") async revoke(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("overrideId") overrideId: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.accessManagement.revoke(
        await this.r.auth.actor(req),
        uuid.parse(id),
        uuid.parse(overrideId),
        b,
        keyFrom(req),
      ),
    );
  }
  @Post("tenants/:id/notes") async note(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return success(
      await this.r.controlQueries.note(
        await this.r.auth.actor(req),
        uuid.parse(id),
        b,
        keyFrom(req),
      ),
    );
  }
  @Get("tenants/:id/notes") async notes(
    @Req() req: Request,
    @Param("id") id: string,
    @Query() q: unknown,
  ) {
    const p = await this.r.controlQueries.notes(
      await this.r.auth.actor(req),
      uuid.parse(id),
      q,
    );
    return success(p.data, { nextCursor: p.nextCursor });
  }
  @Get("audit-events") async audit(@Req() req: Request, @Query() q: unknown) {
    const p = await this.r.controlQueries.audit(
      await this.r.auth.actor(req),
      q,
    );
    return success(p.data, { nextCursor: p.nextCursor });
  }
}
