import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import type { Config } from "./config.js";
import { Runtime } from "./runtime.js";
import { ControlController } from "./control-controller.js";
import { ErrorFilter, context, logger } from "./common.js";
import {
  HealthController,
  IdentityController,
  PlatformController,
  SchoolController,
} from "./controllers.js";
export async function createApplication(config: Config) {
  const runtime = new Runtime(config);
  try {
    await runtime.connect();
  } catch (error) {
    await runtime.onModuleDestroy();
    throw error;
  }
  @Module({
    controllers: [
      HealthController,
      IdentityController,
      PlatformController,
      SchoolController,
      ControlController,
    ],
    providers: [{ provide: Runtime, useValue: runtime }],
  })
  class ApplicationModule {}
  const app = await NestFactory.create(ApplicationModule, {
    logger: false,
    bodyParser: false,
  });
  const express = await import("express");
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  // No proxy is trusted by default: network-derived rate limits cannot be spoofed via forwarded headers.
  app.getHttpAdapter().getInstance().set("trust proxy", false);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = randomUUID(),
      traceId = randomUUID().replaceAll("-", ""),
      started = performance.now();
    res.setHeader("X-Request-Id", id);
    context.run({ requestId: id, correlationId: id, traceId }, () => {
      res.on("finish", () => {
        const durationMs = Math.round(performance.now() - started);
        runtime.metrics.requests++;
        runtime.metrics.totalDurationMs += durationMs;
        if (res.statusCode >= 500) runtime.metrics.errors++;
        logger.info(
          {
            event: "http.completed",
            requestId: id,
            correlationId: id,
            traceId,
            route:
              typeof req.route?.path === "string"
                ? req.route.path
                : "unmatched",
            method: req.method,
            statusCode: res.statusCode,
            durationMs,
          },
          "Request completed",
        );
      });
      next();
    });
  });
  app.use(helmet());
  app.use(cookieParser());
  app.use(express.json({ limit: "32kb", strict: true }));
  app.use(async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.path.startsWith("/health/"))
        await runtime.coordination.limit("http", req.ip ?? "unknown", 600, 60);
      next();
    } catch (error) {
      next(error);
    }
  });
  app.enableCors({
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "Idempotency-Key"],
  });
  app.useGlobalFilters(
    new ErrorFilter((action, actorId) =>
      runtime.db.securityEvent(action, actorId),
    ),
  );
  app.enableShutdownHooks();
  await app.init();
  return { app, runtime };
}
