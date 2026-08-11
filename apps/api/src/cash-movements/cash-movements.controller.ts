import {
  approveCashMovementSchema,
  cashMovementListQuerySchema,
  idempotencyKeySchema,
  identifierSchema,
  requestCashMovementSchema,
  type ApproveCashMovement,
  type CashMovementListQuery,
  type RequestCashMovement,
} from "@base-cafe/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/auth-request.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { CashMovementsService } from "./cash-movements.service.js";

const idempotencyKey = (value: string | undefined) =>
  new ZodValidationPipe(idempotencyKeySchema).transform(value);

@ApiTags("cash-movements")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller()
export class CashMovementsController {
  constructor(
    @Inject(CashMovementsService)
    private readonly cashMovements: CashMovementsService,
  ) {}

  @Get("cash-movements/branches/:branchId")
  @RequirePermissions("cash-movements.read")
  list(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(cashMovementListQuerySchema))
    query: CashMovementListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.cashMovements.list(branchId, query, request.user);
  }

  @Post("cash-movements")
  @RequirePermissions("cash-movements.request")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  request(
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(requestCashMovementSchema))
    input: RequestCashMovement,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.cashMovements.request(
      input,
      idempotencyKey(value),
      request.user,
    );
  }

  @Post("cash-movements/:movementId/approve")
  @RequirePermissions("cash-movements.approve")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  approve(
    @Param("movementId", new ZodValidationPipe(identifierSchema))
    movementId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(approveCashMovementSchema))
    input: ApproveCashMovement,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.cashMovements.approve(
      movementId,
      input,
      idempotencyKey(value),
      request.user,
    );
  }
}
