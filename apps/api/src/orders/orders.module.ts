import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { InventoryAvailabilityModule } from "../inventory-availability/inventory-availability.module.js";
import { InventoryConsumptionModule } from "../inventory-consumption/inventory-consumption.module.js";
import { PrivacyModule } from "../privacy/privacy.module.js";
import { OrderOperationsController } from "./order-operations.controller.js";
import { OrderOperationsService } from "./order-operations.service.js";
import { OrderSendingController } from "./order-sending.controller.js";
import { OrderSendingService } from "./order-sending.service.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";

@Module({
  imports: [
    AuthModule,
    InventoryAvailabilityModule,
    InventoryConsumptionModule,
    PrivacyModule,
  ],
  controllers: [
    OrdersController,
    OrderSendingController,
    OrderOperationsController,
  ],
  providers: [OrdersService, OrderSendingService, OrderOperationsService],
  exports: [OrdersService, OrderSendingService, OrderOperationsService],
})
export class OrdersModule {}
