import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { TaxController } from "./tax.controller.js";
import { TaxService } from "./tax.service.js";

@Module({
  imports: [AuthModule],
  controllers: [TaxController],
  providers: [TaxService],
  exports: [TaxService],
})
export class TaxModule {}
