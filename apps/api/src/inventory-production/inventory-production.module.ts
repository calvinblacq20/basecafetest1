import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InventoryProductionController } from "./inventory-production.controller.js";
import { InventoryProductionService } from "./inventory-production.service.js";

@Module({
  imports: [AuthModule],
  controllers: [InventoryProductionController],
  providers: [InventoryProductionService],
})
export class InventoryProductionModule {}
