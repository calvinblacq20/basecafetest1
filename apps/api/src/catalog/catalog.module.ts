import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { CatalogConfigurationController } from "./catalog-configuration.controller.js";
import { CatalogConfigurationService } from "./catalog-configuration.service.js";
import { CatalogLifecycleController } from "./catalog-lifecycle.controller.js";
import { CatalogLifecycleService } from "./catalog-lifecycle.service.js";
import { CatalogController } from "./catalog.controller.js";
import { CatalogService } from "./catalog.service.js";
import { MenuImportController } from "./menu-import.controller.js";
import { MenuImportService } from "./menu-import.service.js";

@Module({
  imports: [AuthModule],
  controllers: [
    CatalogController,
    CatalogConfigurationController,
    CatalogLifecycleController,
    MenuImportController,
  ],
  providers: [
    CatalogService,
    CatalogConfigurationService,
    CatalogLifecycleService,
    MenuImportService,
  ],
})
export class CatalogModule {}
