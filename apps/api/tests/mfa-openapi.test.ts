import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";

let app: Awaited<ReturnType<typeof NestFactory.create>>;
let paths: Record<string, unknown>;

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  paths = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle("Optional TOTP MFA").setVersion("1").build(),
  ).paths;
});

afterAll(async () => app.close());

describe("MFA OpenAPI", () => {
  it.each([
    "/auth/mfa/status",
    "/auth/mfa/enroll",
    "/auth/mfa/activate",
    "/auth/mfa/reset-pending",
    "/auth/mfa/disable",
  ])("documents %s", (path) => expect(paths).toHaveProperty(path));
});
