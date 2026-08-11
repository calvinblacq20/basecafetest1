import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { InventoryConsumptionModule } from "../inventory-consumption/inventory-consumption.module.js";
import { OrdersModule } from "../orders/orders.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import { SyncBootstrapService } from "./sync-bootstrap.service.js";
import { SyncController } from "./sync.controller.js";
import { SyncRecoveryService } from "./sync-recovery.service.js";
import { SyncService } from "./sync.service.js";

@Module({
  imports: [
    AuthModule,
    OrdersModule,
    PaymentsModule,
    InventoryConsumptionModule,
  ],
  controllers: [SyncController],
  providers: [SyncService, SyncBootstrapService, SyncRecoveryService],
})
export class SyncModule {}
