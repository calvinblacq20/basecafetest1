import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { InventoryConsumptionModule } from "../inventory-consumption/inventory-consumption.module.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";

@Module({
  imports: [AuthModule, InventoryConsumptionModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
