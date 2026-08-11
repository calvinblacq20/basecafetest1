import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { LoginThrottleService } from "./login-throttle.service.js";
import { MfaService } from "./mfa.service.js";
import { PermissionsGuard } from "./permissions.guard.js";
import { SessionAuthGuard } from "./session-auth.guard.js";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginThrottleService,
    MfaService,
    SessionAuthGuard,
    PermissionsGuard,
  ],
  exports: [SessionAuthGuard, PermissionsGuard, MfaService],
})
export class AuthModule {}
