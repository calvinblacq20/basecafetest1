import {
  identifierSchema,
  reportExceptionQuerySchema,
  reportExportDatasetSchema,
  reportRangeQuerySchema,
  salesBreakdownQuerySchema,
  type ReportExceptionQuery,
  type ReportExportDataset,
  type ReportRangeQuery,
  type SalesBreakdownQuery,
} from "@base-cafe/contracts";
import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../auth/auth-request.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { ReportsService } from "./reports.service.js";

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, PermissionsGuard)
@Controller("reports/branches/:branchId")
export class ReportsController {
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}

  @Get("daily-summary")
  @RequirePermissions("reports.read")
  @ApiOperation({
    summary:
      "Report completed sales and confirmed refunds by labeled date basis",
  })
  dailySummary(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(reportRangeQuerySchema))
    query: ReportRangeQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.dailySummary(branchId, query, request.user);
  }

  @Get("sales-breakdown")
  @RequirePermissions("reports.read")
  salesBreakdown(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(salesBreakdownQuerySchema))
    query: SalesBreakdownQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.salesBreakdown(branchId, query, request.user);
  }

  @Get("tender-summary")
  @RequirePermissions("reports.read")
  tenderSummary(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(reportRangeQuerySchema))
    query: ReportRangeQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.tenderSummary(branchId, query, request.user);
  }

  @Get("tax-summary")
  @RequirePermissions("reports.read")
  taxSummary(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(reportRangeQuerySchema))
    query: ReportRangeQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.taxSummary(branchId, query, request.user);
  }

  @Get("shift-reconciliation")
  @RequirePermissions("reports.read")
  shiftReconciliation(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(reportRangeQuerySchema))
    query: ReportRangeQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.shiftReconciliation(branchId, query, request.user);
  }

  @Get("exceptions")
  @RequirePermissions("reports.read")
  exceptions(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Query(new ZodValidationPipe(reportExceptionQuerySchema))
    query: ReportExceptionQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.exceptions(branchId, query, request.user);
  }

  @Get("exports/:dataset.csv")
  @RequirePermissions("reports.export")
  @ApiProduces("text/csv")
  @ApiOperation({ summary: "Generate an audited deterministic CSV export" })
  async export(
    @Param("branchId", new ZodValidationPipe(identifierSchema))
    branchId: string,
    @Param("dataset", new ZodValidationPipe(reportExportDatasetSchema))
    dataset: ReportExportDataset,
    @Query(new ZodValidationPipe(reportRangeQuerySchema))
    query: ReportRangeQuery,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.reports.export(
      branchId,
      dataset,
      query,
      request.user,
    );
    response.type("text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`,
    );
    return result.content;
  }
}
