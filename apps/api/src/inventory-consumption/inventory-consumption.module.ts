import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InventoryConsumptionController } from "./inventory-consumption.controller.js";
import { InventoryConsumptionService } from "./inventory-consumption.service.js";

@Module({
  imports: [AuthModule],
  controllers: [InventoryConsumptionController],
  providers: [InventoryConsumptionService],
  exports: [InventoryConsumptionService],
})
export class InventoryConsumptionModule {}
