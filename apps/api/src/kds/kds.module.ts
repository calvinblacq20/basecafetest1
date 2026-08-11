import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { InventoryConsumptionModule } from "../inventory-consumption/inventory-consumption.module.js";
import { KdsController } from "./kds.controller.js";
import { KdsService } from "./kds.service.js";

@Module({
  imports: [AuthModule, InventoryConsumptionModule],
  controllers: [KdsController],
  providers: [KdsService],
})
export class KdsModule {}
