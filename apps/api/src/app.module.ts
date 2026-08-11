import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

import { AdministrationModule } from "./administration/administration.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { BranchHoursModule } from "./branch-hours/branch-hours.module.js";
import { CashMovementsModule } from "./cash-movements/cash-movements.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { InventoryAvailabilityModule } from "./inventory-availability/inventory-availability.module.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { InventoryConsumptionModule } from "./inventory-consumption/inventory-consumption.module.js";
import { InventoryProductionModule } from "./inventory-production/inventory-production.module.js";
import { KdsModule } from "./kds/kds.module.js";
import { LayoutModule } from "./layout/layout.module.js";
import { OrdersModule } from "./orders/orders.module.js";
import { OperationsModule } from "./operations/operations.module.js";
import { PaymentsModule } from "./payments/payments.module.js";
import { ReceiptsModule } from "./receipts/receipts.module.js";
import { RefundsModule } from "./refunds/refunds.module.js";
import { ReportsModule } from "./reports/reports.module.js";
import { SecurityOperationsModule } from "./security-operations/security-operations.module.js";
import { ProcurementModule } from "./procurement/procurement.module.js";
import { PrivacyModule } from "./privacy/privacy.module.js";
import { ShiftsModule } from "./shifts/shifts.module.js";
import { SyncModule } from "./sync/sync.module.js";
import { TaxModule } from "./tax/tax.module.js";

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.body.password",
            "req.body.initialPassword",
            "req.body.currentPassword",
            "req.body.newPassword",
            "req.body.deviceFingerprintHash",
            "req.body.customerPhone",
            "req.body.deliveryDirections",
            "req.body.displayName",
            "req.body.phone",
            "req.body.email",
            "req.body.notes",
          ],
          censor: "[REDACTED]",
        },
      },
    }),
    DatabaseModule,
    AdministrationModule,
    AuditModule,
    AuthModule,
    BranchHoursModule,
    CashMovementsModule,
    CatalogModule,
    HealthModule,
    InventoryAvailabilityModule,
    InventoryModule,
    InventoryConsumptionModule,
    InventoryProductionModule,
    KdsModule,
    LayoutModule,
    OrdersModule,
    OperationsModule,
    PaymentsModule,
    ReceiptsModule,
    RefundsModule,
    ReportsModule,
    SecurityOperationsModule,
    ProcurementModule,
    PrivacyModule,
    ShiftsModule,
    SyncModule,
    TaxModule,
  ],
})
export class AppModule {}
