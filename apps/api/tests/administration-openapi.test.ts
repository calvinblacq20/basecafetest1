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
    new DocumentBuilder().setTitle("Administration").setVersion("1").build(),
  ).paths;
});

afterAll(async () => app.close());

describe("administration OpenAPI", () => {
  it.each([
    "/administration/branches/{branchId}/permissions",
    "/administration/branches/{branchId}/roles",
    "/administration/roles",
    "/administration/branches/{branchId}/staff",
    "/administration/staff",
    "/administration/staff/{userId}/roles",
    "/administration/staff/{userId}/roles/{assignmentId}/remove",
    "/administration/staff/{userId}/disable",
    "/administration/staff/{userId}/reactivate",
    "/administration/branches/{branchId}/devices",
    "/administration/devices",
    "/administration/devices/{deviceId}/activate",
    "/administration/devices/{deviceId}/revoke",
  ])("documents %s", (path) => expect(paths).toHaveProperty(path));
});
