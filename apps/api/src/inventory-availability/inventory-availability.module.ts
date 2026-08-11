import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { InventoryAvailabilityController } from "./inventory-availability.controller.js";
import { InventoryAvailabilityService } from "./inventory-availability.service.js";

@Module({
  imports: [AuthModule],
  controllers: [InventoryAvailabilityController],
  providers: [InventoryAvailabilityService],
  exports: [InventoryAvailabilityService],
})
export class InventoryAvailabilityModule {}
