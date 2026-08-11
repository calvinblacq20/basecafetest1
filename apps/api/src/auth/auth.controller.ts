import {
  changePasswordRequestSchema,
  idempotencyKeySchema,
  loginRequestSchema,
  mfaActivationRequestSchema,
  mfaDisableRequestSchema,
  mfaEnrollmentRequestSchema,
  mfaPendingResetRequestSchema,
  offlineUnlockEnrollmentRequestSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type MfaActivationRequest,
  type MfaDisableRequest,
  type MfaEnrollmentRequest,
  type MfaPendingResetRequest,
  type OfflineUnlockEnrollmentRequest,
} from "@base-cafe/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import type { Request, Response } from "express";

import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import type { AuthenticatedRequest } from "./auth-request.js";
import { AuthService } from "./auth.service.js";
import { LoginThrottledException } from "./login-throttle.service.js";
import { MfaService } from "./mfa.service.js";
import { SessionAuthGuard } from "./session-auth.guard.js";

function parseIdempotencyKey(value: string | undefined): string {
  return new ZodValidationPipe(idempotencyKeySchema).transform(value);
}

@ApiTags("authentication")
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(MfaService) private readonly mfaService: MfaService,
  ) {}

  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Create a device-bound staff session" })
  @ApiResponse({
    status: 429,
    description: "Account, device, or IP login throttle is temporarily locked",
    headers: {
      "Retry-After": {
        description: "Whole seconds until another attempt is allowed",
        schema: { type: "integer", minimum: 1 },
      },
    },
  })
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) input: LoginRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      return await this.authService.login(
        input,
        request.ip || request.socket.remoteAddress || "unavailable",
      );
    } catch (error) {
      if (error instanceof LoginThrottledException) {
        response.setHeader("Retry-After", error.retryAfterSeconds.toString());
      }
      throw error;
    }
  }

  @Get("mfa/status")
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Read the current user's optional MFA posture" })
  mfaStatus(@Req() request: AuthenticatedRequest) {
    return this.mfaService.status(request.user);
  }

  @Post("mfa/enroll")
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Begin optional TOTP enrollment" })
  enrollMfa(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(mfaEnrollmentRequestSchema))
    input: MfaEnrollmentRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mfaService.enroll(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("mfa/activate")
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Confirm and activate a pending TOTP credential" })
  activateMfa(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(mfaActivationRequestSchema))
    input: MfaActivationRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mfaService.activate(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("mfa/reset-pending")
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Retain and reset an incomplete MFA enrollment" })
  resetPendingMfa(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(mfaPendingResetRequestSchema))
    input: MfaPendingResetRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mfaService.resetPending(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("mfa/disable")
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Disable the current user's TOTP credential" })
  disableMfa(
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(mfaDisableRequestSchema))
    input: MfaDisableRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.mfaService.disable(
      input,
      parseIdempotencyKey(key),
      request.user,
    );
  }

  @Post("change-password")
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary: "Replace the current password and revoke other sessions",
  })
  changePassword(
    @Headers("authorization") authorization: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(changePasswordRequestSchema))
    input: ChangePasswordRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const token = authorization.slice("Bearer ".length).trim();
    return this.authService.changePassword(
      input,
      parseIdempotencyKey(key),
      token,
      request.user,
    );
  }
  @Post("offline-unlock/enroll")
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary: "Audit and issue a bounded local-only offline unlock lease",
  })
  enrollOfflineUnlock(
    @Headers("authorization") authorization: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new ZodValidationPipe(offlineUnlockEnrollmentRequestSchema))
    input: OfflineUnlockEnrollmentRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.authService.enrollOfflineUnlock(
      input,
      parseIdempotencyKey(key),
      authorization.slice("Bearer ".length).trim(),
      request.user,
    );
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke the current session" })
  async logout(
    @Headers("authorization") authorization: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.authService.logout(
      authorization.slice("Bearer ".length).trim(),
      request.user,
    );
  }
}
