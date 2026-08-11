import { Module } from "@nestjs/common";

import { CustomerPiiCryptoService } from "./customer-pii-crypto.service.js";
import { PrivacyAccessService } from "./privacy-access.service.js";
import { PrivacyController } from "./privacy.controller.js";
import { PrivacyService } from "./privacy.service.js";

@Module({
  controllers: [PrivacyController],
  providers: [CustomerPiiCryptoService, PrivacyAccessService, PrivacyService],
  exports: [CustomerPiiCryptoService, PrivacyAccessService, PrivacyService],
})
export class PrivacyModule {}
