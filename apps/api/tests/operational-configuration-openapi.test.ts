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
    new DocumentBuilder()
      .setTitle("Operational configuration")
      .setVersion("1")
      .build(),
  ).paths;
});

afterAll(async () => app.close());

describe("operational configuration OpenAPI", () => {
  it.each([
    "/catalog/branches/{branchId}/stations",
    "/catalog/stations",
    "/catalog/branches/{branchId}/categories",
    "/catalog/categories",
    "/catalog/branches/{branchId}/tax-classes",
    "/catalog/tax-classes",
    "/catalog/tax-classes/{taxClassId}/activate",
    "/catalog/branches/{branchId}/items",
    "/catalog/items",
    "/catalog/items/{menuItemId}",
    "/catalog/items/{menuItemId}/activate",
    "/catalog/items/{menuItemId}/deactivate",
    "/catalog/items/{menuItemId}/variants",
    "/catalog/items/{menuItemId}/variants/{variantId}/activate",
    "/catalog/branches/{branchId}/modifier-groups",
    "/catalog/modifier-groups",
    "/catalog/items/{menuItemId}/modifier-groups/{modifierGroupId}",
    "/catalog/prices",
    "/catalog/imports/menu/dry-run",
    "/catalog/imports/menu/apply",
    "/catalog/imports/branches/{branchId}/{importId}",
    "/layout/branches/{branchId}/areas",
    "/layout/branches/{branchId}/tables",
    "/layout/areas",
    "/layout/areas/{areaId}/update",
    "/layout/areas/{areaId}/activate",
    "/layout/areas/{areaId}/deactivate",
    "/layout/tables",
    "/layout/tables/{tableId}/update",
    "/layout/tables/{tableId}/activate",
    "/layout/tables/{tableId}/deactivate",
    "/branch-schedules/branches/{branchId}",
    "/branch-schedules",
    "/branch-schedules/{scheduleId}/update",
    "/branch-schedules/{scheduleId}/activate",
    "/branch-schedules/{scheduleId}/cancel",
    "/branch-schedules/special-days",
    "/branch-schedules/special-days/{specialHoursId}/update",
    "/branch-schedules/special-days/{specialHoursId}/activate",
    "/branch-schedules/special-days/{specialHoursId}/cancel",
    "/branch-schedules/resolve-preview",
    "/tax-profiles/branches/{branchId}",
    "/tax-profiles",
    "/tax-profiles/{profileId}/update",
    "/tax-profiles/{profileId}/confirm",
    "/tax-profiles/{profileId}/activate",
    "/tax-profiles/{profileId}/calculate-preview",
  ])("documents %s", (path) => expect(paths).toHaveProperty(path));
});
