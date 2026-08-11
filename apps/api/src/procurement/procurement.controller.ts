import {
  createPurchaseOrderSchema,
  createSupplierItemSchema,
  createSupplierSchema,
  idempotencyKeySchema,
  identifierSchema,
  postGoodsReceiptSchema,
  postPurchaseReturnSchema,
  procurementListQuerySchema,
  procurementValuationQuerySchema,
  transitionPurchaseOrderSchema,
  type CreatePurchaseOrder,
  type CreateSupplier,
  type CreateSupplierItem,
  type PostGoodsReceipt,
  type PostPurchaseReturn,
  type ProcurementListQuery,
  type ProcurementValuationQuery,
  type TransitionPurchaseOrder,
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
import { ProcurementService } from "./procurement.service.js";

const key = (value: string | undefined) =>
  new ZodValidationPipe(idempotencyKeySchema).transform(value);

@ApiTags("procurement")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("procurement")
export class ProcurementController {
  constructor(
    @Inject(ProcurementService)
    private readonly procurement: ProcurementService,
  ) {}

  @Get("branches/:branchId/suppliers")
  @RequirePermissions("procurement.read")
  suppliers(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(procurementListQuerySchema))
    query: ProcurementListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.procurement.listSuppliers(branchId, query, request.user);
  }

  @Get("branches/:branchId/purchase-orders")
  @RequirePermissions("procurement.read")
  orders(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(procurementListQuerySchema))
    query: ProcurementListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.procurement.listOrders(branchId, query, request.user);
  }

  @Get("branches/:branchId/goods-receipts")
  @RequirePermissions("procurement.read")
  receipts(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(procurementListQuerySchema))
    query: ProcurementListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.procurement.listReceipts(branchId, query, request.user);
  }

  @Get("branches/:branchId/purchase-returns")
  @RequirePermissions("procurement.read")
  returns(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(procurementListQuerySchema))
    query: ProcurementListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.procurement.listReturns(branchId, query, request.user);
  }

  @Get("branches/:branchId/valuation-preview")
  @RequirePermissions("procurement.read")
  valuation(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(procurementValuationQuerySchema))
    query: ProcurementValuationQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.procurement.valuationPreview(branchId, query, request.user);
  }

  @Post("suppliers")
  @RequirePermissions("procurement.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createSupplier(
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(createSupplierSchema)) input: CreateSupplier,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.procurement.createSupplier(input, key(value), request.user);
  }

  @Post("supplier-items")
  @RequirePermissions("procurement.configure")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createSupplierItem(
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(createSupplierItemSchema))
    input: CreateSupplierItem,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.procurement.createSupplierItem(input, key(value), request.user);
  }

  @Post("purchase-orders")
  @RequirePermissions("procurement.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createOrder(
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(createPurchaseOrderSchema))
    input: CreatePurchaseOrder,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.procurement.createOrder(input, key(value), request.user);
  }

  @Post("purchase-orders/:orderId/submit")
  @RequirePermissions("procurement.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  submit(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(transitionPurchaseOrderSchema))
    input: TransitionPurchaseOrder,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.procurement.transitionOrder(
      orderId,
      "submit",
      input,
      key(value),
      request.user,
    );
  }

  @Post("purchase-orders/:orderId/cancel")
  @RequirePermissions("procurement.manage")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  cancel(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(transitionPurchaseOrderSchema))
    input: TransitionPurchaseOrder,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.procurement.transitionOrder(
      orderId,
      "cancel",
      input,
      key(value),
      request.user,
    );
  }

  @Post("purchase-orders/:orderId/receipts")
  @RequirePermissions("procurement.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  receive(
    @Param("orderId", new ZodValidationPipe(identifierSchema)) orderId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(postGoodsReceiptSchema))
    input: PostGoodsReceipt,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.procurement.postReceipt(
      orderId,
      input,
      key(value),
      request.user,
    );
  }

  @Post("goods-receipts/:receiptId/returns")
  @RequirePermissions("procurement.write")
  @ApiSecurity("idempotency-key")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  returnGoods(
    @Param("receiptId", new ZodValidationPipe(identifierSchema))
    receiptId: string,
    @Headers("idempotency-key") value: string | undefined,
    @Body(new ZodValidationPipe(postPurchaseReturnSchema))
    input: PostPurchaseReturn,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.procurement.postReturn(
      receiptId,
      input,
      key(value),
      request.user,
    );
  }
}
