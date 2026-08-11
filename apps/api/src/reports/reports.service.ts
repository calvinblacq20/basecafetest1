import type {
  ReportExceptionQuery,
  ReportExportDataset,
  ReportRangeQuery,
  SalesBreakdownQuery,
} from "@base-cafe/contracts";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { PrismaService } from "../database/prisma.service.js";
import { renderCsv, type CsvValue } from "./report-csv.js";
import {
  addMoney,
  broadUtcRange,
  checkedSum,
  inclusiveDates,
  inRange,
  localActivity,
  opaqueCursor,
  zeroMoney,
  type MoneyTotals,
} from "./report-policy.js";

type Tx = Prisma.TransactionClient;

const lineSelect = Prisma.validator<Prisma.OrderLineSelect>()({
  id: true,
  menuItemId: true,
  variantId: true,
  status: true,
  quantity: true,
  itemNameSnapshot: true,
  itemSkuSnapshot: true,
  categoryKeySnapshot: true,
  categoryNameSnapshot: true,
  variantNameSnapshot: true,
  taxTreatmentSnapshot: true,
  lineInputAmountMinor: true,
  netAmountMinor: true,
  taxTotalMinor: true,
  grossAmountMinor: true,
  taxComponents: {
    select: {
      codeSnapshot: true,
      receiptLabelSnapshot: true,
      ratePpmSnapshot: true,
      taxableBaseMinor: true,
      amountMinor: true,
      roundingAdjustmentMinor: true,
    },
  },
});

const sourceOrderSelect = Prisma.validator<Prisma.OrderSelect>()({
  id: true,
  orderNumber: true,
  inputSubtotalMinor: true,
  netTotalMinor: true,
  taxTotalMinor: true,
  grossTotalMinor: true,
  lines: { where: { status: "DRAFT" }, select: lineSelect },
});

const completedOrderSelect = Prisma.validator<Prisma.OrderSelect>()({
  id: true,
  orderNumber: true,
  businessDate: true,
  channel: true,
  completedAt: true,
  inputSubtotalMinor: true,
  netTotalMinor: true,
  taxTotalMinor: true,
  grossTotalMinor: true,
  lines: { where: { status: "DRAFT" }, select: lineSelect },
  mergesAsTarget: { select: { source: { select: sourceOrderSelect } } },
});

type CompletedOrder = Prisma.OrderGetPayload<{
  select: typeof completedOrderSelect;
}>;
type ReportLine = Prisma.OrderLineGetPayload<{ select: typeof lineSelect }>;

type CoreSnapshot = Readonly<{
  branch: { id: string; timezone: string; currency: string };
  generatedAt: Date;
  orders: CompletedOrder[];
  payments: Array<{
    id: string;
    method: string;
    amountMinor: number;
    confirmedAt: Date | null;
  }>;
  refunds: Array<{
    id: string;
    orderId: string;
    kind: string;
    amountMinor: number;
    confirmedAt: Date | null;
    payment: { method: string };
  }>;
  shifts: Array<{
    id: string;
    businessDate: Date;
    status: string;
    currency: string;
    openingFloatMinor: number;
    close: {
      expectedCashMinor: number;
      countedCashMinor: number;
      varianceMinor: number;
      closedAt: Date;
    } | null;
    payments: Array<{ amountMinor: number }>;
    refunds: Array<{ amountMinor: number }>;
    cashMovements: Array<{ direction: string; amountMinor: number }>;
  }>;
}>;

const unavailableMetrics = [
  "DISCOUNTS",
  "PROMOTIONS",
  "TIPS",
  "SERVICE_CHARGES",
  "DELIVERY_FEES",
  "REFUND_TAX_ALLOCATION",
] as const;

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function money(value: MoneyTotals): MoneyTotals {
  return value;
}

function orderMoney(value: {
  inputSubtotalMinor: number;
  netTotalMinor: number;
  taxTotalMinor: number;
  grossTotalMinor: number;
}): MoneyTotals {
  return {
    inputSubtotalMinor: value.inputSubtotalMinor,
    netTotalMinor: value.netTotalMinor,
    taxTotalMinor: value.taxTotalMinor,
    grossTotalMinor: value.grossTotalMinor,
  };
}

function compositionMoney(order: CompletedOrder) {
  return order.mergesAsTarget.reduce(
    (total, merge) => addMoney(total, orderMoney(merge.source)),
    orderMoney(order),
  );
}

function compositionLines(order: CompletedOrder): ReportLine[] {
  return [
    ...order.lines,
    ...order.mergesAsTarget.flatMap(({ source }) => source.lines),
  ];
}

@Injectable()
export class ReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  dailySummary(
    branchId: string,
    query: ReportRangeQuery,
    principal: AuthPrincipal,
    permission = "reports.read",
  ) {
    return this.withSnapshot(
      branchId,
      query,
      principal,
      permission,
      (snapshot) => this.dailySummaryFrom(snapshot, query),
    );
  }

  salesBreakdown(
    branchId: string,
    query: SalesBreakdownQuery,
    principal: AuthPrincipal,
    permission = "reports.read",
  ) {
    return this.withSnapshot(
      branchId,
      query,
      principal,
      permission,
      (snapshot) => {
        type MutableGroup = {
          key: string;
          label: string;
          orderIds: Set<string>;
          lineCount: number;
          quantity: number;
          totals: MoneyTotals;
        };
        const groups = new Map<string, MutableGroup>();
        const add = (
          key: string,
          label: string,
          orderId: string,
          totals: MoneyTotals,
          quantity = 0,
          lineCount = 0,
        ) => {
          const group = groups.get(key) ?? {
            key,
            label,
            orderIds: new Set<string>(),
            lineCount: 0,
            quantity: 0,
            totals: zeroMoney(),
          };
          group.orderIds.add(orderId);
          group.lineCount += lineCount;
          group.quantity += quantity;
          group.totals = addMoney(group.totals, totals);
          groups.set(key, group);
        };
        for (const order of snapshot.orders) {
          if (query.groupBy === "CHANNEL") {
            add(
              order.channel,
              order.channel,
              order.id,
              compositionMoney(order),
            );
            continue;
          }
          if (query.groupBy === "COMPLETION_HOUR") {
            const hour = localActivity(
              order.completedAt!,
              snapshot.branch.timezone,
            ).hour;
            add(hour, `${hour}:00`, order.id, compositionMoney(order));
            continue;
          }
          for (const line of compositionLines(order)) {
            const totals = orderMoney({
              inputSubtotalMinor: line.lineInputAmountMinor,
              netTotalMinor: line.netAmountMinor,
              taxTotalMinor: line.taxTotalMinor,
              grossTotalMinor: line.grossAmountMinor,
            });
            if (query.groupBy === "ITEM") {
              const key = `${line.menuItemId}:${line.variantId ?? "BASE"}`;
              const label = line.variantNameSnapshot
                ? `${line.itemNameSnapshot} — ${line.variantNameSnapshot}`
                : line.itemNameSnapshot;
              add(key, label, order.id, totals, line.quantity, 1);
            } else {
              add(
                line.categoryKeySnapshot ?? "UNSNAPSHOTTED",
                line.categoryNameSnapshot ?? "UNSNAPSHOTTED",
                order.id,
                totals,
                line.quantity,
                1,
              );
            }
          }
        }
        return {
          metadata: this.metadata(snapshot, query, ["ORDER_BUSINESS_DATE"]),
          groupBy: query.groupBy,
          rows: [...groups.values()]
            .sort((left, right) => left.key.localeCompare(right.key))
            .map(({ orderIds, totals, ...group }) => ({
              ...group,
              ...totals,
              orderCount: orderIds.size,
            })),
        };
      },
    );
  }

  tenderSummary(
    branchId: string,
    query: ReportRangeQuery,
    principal: AuthPrincipal,
    permission = "reports.read",
  ) {
    return this.withSnapshot(
      branchId,
      query,
      principal,
      permission,
      (snapshot) => {
        const rows = new Map<
          string,
          {
            activityDate: string;
            method: string;
            paymentCount: number;
            confirmedMinor: number;
            refundCount: number;
            refundedMinor: number;
          }
        >();
        const row = (date: string, method: string) => {
          const key = `${date}:${method}`;
          const value = rows.get(key) ?? {
            activityDate: date,
            method,
            paymentCount: 0,
            confirmedMinor: 0,
            refundCount: 0,
            refundedMinor: 0,
          };
          rows.set(key, value);
          return value;
        };
        for (const payment of snapshot.payments) {
          if (!payment.confirmedAt) continue;
          const date = localActivity(
            payment.confirmedAt,
            snapshot.branch.timezone,
          ).date;
          if (!inRange(date, query.fromDate, query.toDate)) continue;
          const target = row(date, payment.method);
          target.paymentCount += 1;
          target.confirmedMinor = checkedSum([
            target.confirmedMinor,
            payment.amountMinor,
          ]);
        }
        for (const refund of snapshot.refunds) {
          if (!refund.confirmedAt) continue;
          const date = localActivity(
            refund.confirmedAt,
            snapshot.branch.timezone,
          ).date;
          if (!inRange(date, query.fromDate, query.toDate)) continue;
          const target = row(date, refund.payment.method);
          target.refundCount += 1;
          target.refundedMinor = checkedSum([
            target.refundedMinor,
            refund.amountMinor,
          ]);
        }
        return {
          metadata: this.metadata(snapshot, query, [
            "PAYMENT_CONFIRMATION_LOCAL_DATE",
            "REFUND_CONFIRMATION_LOCAL_DATE",
          ]),
          rows: [...rows.values()]
            .sort((left, right) =>
              `${left.activityDate}:${left.method}`.localeCompare(
                `${right.activityDate}:${right.method}`,
              ),
            )
            .map((value) => ({
              ...value,
              netMinor: checkedSum([
                value.confirmedMinor,
                -value.refundedMinor,
              ]),
            })),
        };
      },
    );
  }

  taxSummary(
    branchId: string,
    query: ReportRangeQuery,
    principal: AuthPrincipal,
    permission = "reports.read",
  ) {
    return this.withSnapshot(
      branchId,
      query,
      principal,
      permission,
      (snapshot) => {
        const rows = new Map<
          string,
          {
            businessDate: string;
            code: string;
            label: string;
            ratePpm: number;
            treatment: string;
            taxableBaseMinor: number;
            taxMinor: number;
            roundingAdjustmentMinor: number;
          }
        >();
        for (const order of snapshot.orders) {
          const businessDate = dateOnly(order.businessDate);
          for (const line of compositionLines(order)) {
            for (const component of line.taxComponents) {
              const key = [
                businessDate,
                component.codeSnapshot,
                component.receiptLabelSnapshot,
                component.ratePpmSnapshot,
                line.taxTreatmentSnapshot,
              ].join(":");
              const target = rows.get(key) ?? {
                businessDate,
                code: component.codeSnapshot,
                label: component.receiptLabelSnapshot,
                ratePpm: component.ratePpmSnapshot,
                treatment: line.taxTreatmentSnapshot,
                taxableBaseMinor: 0,
                taxMinor: 0,
                roundingAdjustmentMinor: 0,
              };
              target.taxableBaseMinor = checkedSum([
                target.taxableBaseMinor,
                component.taxableBaseMinor,
              ]);
              target.taxMinor = checkedSum([
                target.taxMinor,
                component.amountMinor,
              ]);
              target.roundingAdjustmentMinor = checkedSum([
                target.roundingAdjustmentMinor,
                component.roundingAdjustmentMinor,
              ]);
              rows.set(key, target);
            }
          }
        }
        return {
          metadata: this.metadata(snapshot, query, ["ORDER_BUSINESS_DATE"]),
          refundsTaxAllocated: false,
          rows: [...rows.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([, value]) => value),
        };
      },
    );
  }

  shiftReconciliation(
    branchId: string,
    query: ReportRangeQuery,
    principal: AuthPrincipal,
    permission = "reports.read",
  ) {
    return this.withSnapshot(
      branchId,
      query,
      principal,
      permission,
      (snapshot) => ({
        metadata: this.metadata(snapshot, query, ["SHIFT_BUSINESS_DATE"]),
        rows: snapshot.shifts
          .map((shift) => {
            const confirmedCashPaymentsMinor = checkedSum(
              shift.payments.map(({ amountMinor }) => amountMinor),
            );
            const confirmedCashRefundsMinor = checkedSum(
              shift.refunds.map(({ amountMinor }) => amountMinor),
            );
            const postedCashInMinor = checkedSum(
              shift.cashMovements
                .filter(({ direction }) => direction === "IN")
                .map(({ amountMinor }) => amountMinor),
            );
            const postedCashOutMinor = checkedSum(
              shift.cashMovements
                .filter(({ direction }) => direction === "OUT")
                .map(({ amountMinor }) => amountMinor),
            );
            const recomputedExpectedCashMinor = checkedSum([
              shift.openingFloatMinor,
              confirmedCashPaymentsMinor,
              -confirmedCashRefundsMinor,
              postedCashInMinor,
              -postedCashOutMinor,
            ]);
            return {
              shiftId: shift.id,
              businessDate: dateOnly(shift.businessDate),
              shiftStatus: shift.status,
              openingFloatMinor: shift.openingFloatMinor,
              confirmedCashPaymentsMinor,
              confirmedCashRefundsMinor,
              postedCashInMinor,
              postedCashOutMinor,
              recomputedExpectedCashMinor,
              storedExpectedCashMinor: shift.close?.expectedCashMinor ?? null,
              countedCashMinor: shift.close?.countedCashMinor ?? null,
              varianceMinor: shift.close?.varianceMinor ?? null,
              reconciliationStatus: !shift.close
                ? "OPEN"
                : shift.close.expectedCashMinor === recomputedExpectedCashMinor
                  ? "MATCH"
                  : "MISMATCH",
              closedAt: shift.close?.closedAt.toISOString() ?? null,
            };
          })
          .sort((left, right) =>
            `${left.businessDate}:${left.shiftId}`.localeCompare(
              `${right.businessDate}:${right.shiftId}`,
            ),
          ),
      }),
    );
  }

  exceptions(
    branchId: string,
    query: ReportExceptionQuery,
    principal: AuthPrincipal,
    permission = "reports.read",
  ) {
    this.permission(principal, permission, branchId);
    return this.prisma.$transaction(
      async (tx) => {
        const branch = await this.branch(
          tx,
          branchId,
          principal.organizationId,
        );
        const generatedAt = new Date();
        const rows = await this.exceptionRows(
          tx,
          branchId,
          branch.timezone,
          query,
        );
        const filtered = query.type
          ? rows.filter(({ type }) => type === query.type)
          : rows;
        const start = query.cursor
          ? filtered.findIndex(
              (value) => opaqueCursor(value) === query.cursor,
            ) + 1
          : 0;
        if (query.cursor && start === 0) {
          throw new BadRequestException({ code: "INVALID_REPORT_CURSOR" });
        }
        const page = filtered.slice(start, start + query.limit);
        return {
          metadata: this.metadata(
            { branch, generatedAt } as CoreSnapshot,
            query,
            ["EXCEPTION_ACTIVITY_LOCAL_DATE"],
          ),
          rows: page,
          nextCursor:
            start + page.length < filtered.length && page.length
              ? opaqueCursor(page[page.length - 1]!)
              : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async export(
    branchId: string,
    dataset: ReportExportDataset,
    query: ReportRangeQuery,
    principal: AuthPrincipal,
  ) {
    this.permission(principal, "reports.export", branchId);
    let headers: string[];
    let rows: Readonly<Record<string, CsvValue>>[];
    if (dataset === "DAILY_SUMMARY") {
      const report = await this.dailySummary(
        branchId,
        query,
        principal,
        "reports.export",
      );
      headers = [
        "business_date",
        "completed_order_count",
        "input_subtotal_minor",
        "net_total_minor",
        "tax_total_minor",
        "gross_sales_minor",
        "confirmed_refund_count",
        "confirmed_refunds_minor",
        "commercial_net_after_refunds_minor",
      ];
      rows = report.rows.map((value) => ({
        business_date: value.businessDate,
        completed_order_count: value.completedOrderCount,
        input_subtotal_minor: value.inputSubtotalMinor,
        net_total_minor: value.netTotalMinor,
        tax_total_minor: value.taxTotalMinor,
        gross_sales_minor: value.grossSalesMinor,
        confirmed_refund_count: value.confirmedRefundCount,
        confirmed_refunds_minor: value.confirmedRefundsMinor,
        commercial_net_after_refunds_minor:
          value.commercialNetAfterRefundsMinor,
      }));
    } else if (dataset === "TENDERS") {
      const report = await this.tenderSummary(
        branchId,
        query,
        principal,
        "reports.export",
      );
      headers = [
        "activity_date",
        "method",
        "payment_count",
        "confirmed_minor",
        "refund_count",
        "refunded_minor",
        "net_minor",
      ];
      rows = report.rows.map((value) => ({
        activity_date: value.activityDate,
        method: value.method,
        payment_count: value.paymentCount,
        confirmed_minor: value.confirmedMinor,
        refund_count: value.refundCount,
        refunded_minor: value.refundedMinor,
        net_minor: value.netMinor,
      }));
    } else if (dataset === "TAX_COMPONENTS") {
      const report = await this.taxSummary(
        branchId,
        query,
        principal,
        "reports.export",
      );
      headers = [
        "business_date",
        "code",
        "label",
        "rate_ppm",
        "treatment",
        "taxable_base_minor",
        "tax_minor",
        "rounding_adjustment_minor",
      ];
      rows = report.rows.map((value) => ({
        business_date: value.businessDate,
        code: value.code,
        label: value.label,
        rate_ppm: value.ratePpm,
        treatment: value.treatment,
        taxable_base_minor: value.taxableBaseMinor,
        tax_minor: value.taxMinor,
        rounding_adjustment_minor: value.roundingAdjustmentMinor,
      }));
    } else if (dataset === "SHIFT_RECONCILIATION") {
      const report = await this.shiftReconciliation(
        branchId,
        query,
        principal,
        "reports.export",
      );
      headers = [
        "business_date",
        "shift_id",
        "shift_status",
        "opening_float_minor",
        "confirmed_cash_payments_minor",
        "confirmed_cash_refunds_minor",
        "posted_cash_in_minor",
        "posted_cash_out_minor",
        "recomputed_expected_cash_minor",
        "stored_expected_cash_minor",
        "counted_cash_minor",
        "variance_minor",
        "reconciliation_status",
        "closed_at",
      ];
      rows = report.rows.map((value) => ({
        business_date: value.businessDate,
        shift_id: value.shiftId,
        shift_status: value.shiftStatus,
        opening_float_minor: value.openingFloatMinor,
        confirmed_cash_payments_minor: value.confirmedCashPaymentsMinor,
        confirmed_cash_refunds_minor: value.confirmedCashRefundsMinor,
        posted_cash_in_minor: value.postedCashInMinor,
        posted_cash_out_minor: value.postedCashOutMinor,
        recomputed_expected_cash_minor: value.recomputedExpectedCashMinor,
        stored_expected_cash_minor: value.storedExpectedCashMinor,
        counted_cash_minor: value.countedCashMinor,
        variance_minor: value.varianceMinor,
        reconciliation_status: value.reconciliationStatus,
        closed_at: value.closedAt,
      }));
    } else if (dataset === "EXCEPTIONS") {
      const exceptionRows = await this.allExceptionRows(
        branchId,
        query,
        principal,
      );
      headers = [
        "occurred_at",
        "activity_date",
        "type",
        "entity_id",
        "status",
        "amount_minor",
        "reference",
      ];
      rows = exceptionRows.map((value) => ({
        occurred_at: value.occurredAt,
        activity_date: value.activityDate,
        type: value.type,
        entity_id: value.id,
        status: value.status,
        amount_minor: value.amountMinor,
        reference: value.reference,
      }));
    } else {
      const data = await this.exportDetailRows(
        branchId,
        dataset,
        query,
        principal,
      );
      headers = data.headers;
      rows = data.rows;
    }
    await this.prisma.auditLog.create({
      data: {
        organizationId: principal.organizationId,
        branchId,
        actorId: principal.userId,
        action: "reports.export",
        entityType: "report_export",
        entityId: dataset,
        reason: "Synchronous bounded CSV export",
        metadata: {
          deviceId: principal.deviceId,
          dataset,
          fromDate: query.fromDate,
          toDate: query.toDate,
          rowCount: rows.length,
        },
      },
    });
    return {
      filename: `${dataset.toLowerCase()}_${query.fromDate}_${query.toDate}.csv`,
      content: renderCsv(headers, rows),
    };
  }

  private dailySummaryFrom(snapshot: CoreSnapshot, query: ReportRangeQuery) {
    const rows = new Map(
      inclusiveDates(query.fromDate, query.toDate).map((businessDate) => [
        businessDate,
        {
          businessDate,
          completedOrderCount: 0,
          totals: zeroMoney(),
          confirmedRefundCount: 0,
          confirmedRefundsMinor: 0,
        },
      ]),
    );
    for (const order of snapshot.orders) {
      const target = rows.get(dateOnly(order.businessDate))!;
      target.completedOrderCount += 1;
      target.totals = addMoney(target.totals, compositionMoney(order));
    }
    for (const refund of snapshot.refunds) {
      if (!refund.confirmedAt) continue;
      const date = localActivity(
        refund.confirmedAt,
        snapshot.branch.timezone,
      ).date;
      const target = rows.get(date);
      if (!target) continue;
      target.confirmedRefundCount += 1;
      target.confirmedRefundsMinor = checkedSum([
        target.confirmedRefundsMinor,
        refund.amountMinor,
      ]);
    }
    return {
      metadata: this.metadata(snapshot, query, [
        "ORDER_BUSINESS_DATE",
        "REFUND_CONFIRMATION_LOCAL_DATE",
      ]),
      rows: [...rows.values()].map((value) => ({
        businessDate: value.businessDate,
        completedOrderCount: value.completedOrderCount,
        ...money(value.totals),
        grossSalesMinor: value.totals.grossTotalMinor,
        confirmedRefundCount: value.confirmedRefundCount,
        confirmedRefundsMinor: value.confirmedRefundsMinor,
        commercialNetAfterRefundsMinor: checkedSum([
          value.totals.grossTotalMinor,
          -value.confirmedRefundsMinor,
        ]),
      })),
    };
  }

  private async withSnapshot<T>(
    branchId: string,
    query: ReportRangeQuery,
    principal: AuthPrincipal,
    permission: string,
    project: (snapshot: CoreSnapshot) => T,
  ) {
    this.permission(principal, permission, branchId);
    return this.prisma.$transaction(
      async (tx) =>
        project(await this.loadCore(tx, branchId, query, principal)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async loadCore(
    tx: Tx,
    branchId: string,
    query: ReportRangeQuery,
    principal: AuthPrincipal,
  ): Promise<CoreSnapshot> {
    const branch = await this.branch(tx, branchId, principal.organizationId);
    const activityRange = broadUtcRange(query.fromDate, query.toDate);
    const businessRange = {
      gte: new Date(`${query.fromDate}T00:00:00.000Z`),
      lte: new Date(`${query.toDate}T00:00:00.000Z`),
    };
    const [orders, payments, refunds, shifts] = await Promise.all([
      tx.order.findMany({
        where: { branchId, status: "COMPLETED", businessDate: businessRange },
        select: completedOrderSelect,
        orderBy: [{ businessDate: "asc" }, { orderNumber: "asc" }],
      }),
      tx.payment.findMany({
        where: { branchId, status: "CONFIRMED", confirmedAt: activityRange },
        select: {
          id: true,
          method: true,
          amountMinor: true,
          confirmedAt: true,
        },
      }),
      tx.refund.findMany({
        where: { branchId, status: "CONFIRMED", confirmedAt: activityRange },
        select: {
          id: true,
          orderId: true,
          kind: true,
          amountMinor: true,
          confirmedAt: true,
          payment: { select: { method: true } },
        },
      }),
      tx.staffShift.findMany({
        where: { branchId, businessDate: businessRange },
        select: {
          id: true,
          businessDate: true,
          status: true,
          currency: true,
          openingFloatMinor: true,
          close: {
            select: {
              expectedCashMinor: true,
              countedCashMinor: true,
              varianceMinor: true,
              closedAt: true,
            },
          },
          payments: {
            where: { status: "CONFIRMED", method: "CASH" },
            select: { amountMinor: true },
          },
          refunds: {
            where: { status: "CONFIRMED", payment: { method: "CASH" } },
            select: { amountMinor: true },
          },
          cashMovements: {
            where: { status: "POSTED" },
            select: { direction: true, amountMinor: true },
          },
        },
        orderBy: [{ businessDate: "asc" }, { id: "asc" }],
      }),
    ]);
    return {
      branch,
      generatedAt: new Date(),
      orders,
      payments,
      refunds,
      shifts,
    };
  }

  private metadata(
    snapshot: Pick<CoreSnapshot, "branch" | "generatedAt">,
    query: ReportRangeQuery,
    basis: string[],
  ) {
    return {
      branchId: snapshot.branch.id,
      fromDate: query.fromDate,
      toDate: query.toDate,
      timezone: snapshot.branch.timezone,
      currency: snapshot.branch.currency,
      generatedAt: snapshot.generatedAt.toISOString(),
      basis,
      unavailableMetrics: [...unavailableMetrics],
    };
  }

  private async branch(tx: Tx, id: string, organizationId: string) {
    const branch = await tx.branch.findFirst({
      where: { id, organizationId },
      select: { id: true, timezone: true, currency: true },
    });
    if (!branch) throw new NotFoundException("Branch not found.");
    try {
      localActivity(new Date(), branch.timezone);
    } catch {
      throw new BadRequestException({ code: "BRANCH_TIMEZONE_INVALID" });
    }
    return branch;
  }

  private permission(principal: AuthPrincipal, key: string, branchId: string) {
    if (!hasPermission(principal, key, branchId)) {
      throw new ForbiddenException("Permission denied for branch.");
    }
  }

  private allExceptionRows(
    branchId: string,
    query: ReportRangeQuery,
    principal: AuthPrincipal,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const branch = await this.branch(
          tx,
          branchId,
          principal.organizationId,
        );
        return this.exceptionRows(tx, branchId, branch.timezone, query);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async exceptionRows(
    tx: Tx,
    branchId: string,
    timezone: string,
    query: ReportRangeQuery,
  ) {
    const range = broadUtcRange(query.fromDate, query.toDate);
    const [orders, sent, conflicts, payments, refunds, cash, closes] =
      await Promise.all([
        tx.order.findMany({
          where: { branchId, status: "CANCELLED", cancelledAt: range },
          select: { id: true, orderNumber: true, cancelledAt: true },
        }),
        tx.orderSentLineCancellation.findMany({
          where: { order: { branchId }, createdAt: range },
          select: { id: true, orderId: true, createdAt: true },
        }),
        tx.orderTableConflict.findMany({
          where: { order: { branchId }, createdAt: range },
          select: { id: true, orderId: true, createdAt: true },
        }),
        tx.payment.findMany({
          where: {
            branchId,
            status: {
              in: ["PENDING", "REQUIRES_VERIFICATION", "FAILED", "CANCELLED"],
            },
            OR: [
              { createdAt: range },
              { failedAt: range },
              { cancelledAt: range },
            ],
          },
          select: {
            id: true,
            status: true,
            amountMinor: true,
            createdAt: true,
            failedAt: true,
            cancelledAt: true,
          },
        }),
        tx.refund.findMany({
          where: {
            branchId,
            status: {
              in: [
                "AWAITING_APPROVAL",
                "PENDING_PROVIDER",
                "FAILED",
                "REJECTED",
              ],
            },
            OR: [
              { createdAt: range },
              { failedAt: range },
              { rejectedAt: range },
            ],
          },
          select: {
            id: true,
            status: true,
            amountMinor: true,
            createdAt: true,
            failedAt: true,
            rejectedAt: true,
          },
        }),
        tx.cashMovement.findMany({
          where: {
            branchId,
            OR: [
              {
                status: { in: ["AWAITING_APPROVAL", "REJECTED"] },
                createdAt: range,
              },
              {
                type: "CORRECTION",
                OR: [{ postedAt: range }, { createdAt: range }],
              },
            ],
          },
          select: {
            id: true,
            type: true,
            status: true,
            amountMinor: true,
            createdAt: true,
            postedAt: true,
            rejectedAt: true,
          },
        }),
        tx.shiftClose.findMany({
          where: {
            shift: { branchId },
            varianceMinor: { not: 0 },
            closedAt: range,
          },
          select: {
            id: true,
            shiftId: true,
            varianceMinor: true,
            closedAt: true,
          },
        }),
      ]);
    const raw = [
      ...orders.map((value) => ({
        id: value.id,
        type: "ORDER_CANCELLED",
        occurredAt: value.cancelledAt!,
        status: "CANCELLED",
        amountMinor: null,
        reference: value.orderNumber,
      })),
      ...sent.map((value) => ({
        id: value.id,
        type: "SENT_LINE_CANCELLED",
        occurredAt: value.createdAt,
        status: "CANCELLED",
        amountMinor: null,
        reference: value.orderId,
      })),
      ...conflicts.map((value) => ({
        id: value.id,
        type: "TABLE_CONFLICT_OVERRIDDEN",
        occurredAt: value.createdAt,
        status: "OVERRIDDEN",
        amountMinor: null,
        reference: value.orderId,
      })),
      ...payments.map((value) => ({
        id: value.id,
        type: ["PENDING", "REQUIRES_VERIFICATION"].includes(value.status)
          ? "PAYMENT_UNRESOLVED"
          : "PAYMENT_FAILED",
        occurredAt: value.failedAt ?? value.cancelledAt ?? value.createdAt,
        status: value.status,
        amountMinor: value.amountMinor,
        reference: null,
      })),
      ...refunds.map((value) => ({
        id: value.id,
        type: ["AWAITING_APPROVAL", "PENDING_PROVIDER"].includes(value.status)
          ? "REFUND_UNRESOLVED"
          : "REFUND_FAILED",
        occurredAt: value.failedAt ?? value.rejectedAt ?? value.createdAt,
        status: value.status,
        amountMinor: value.amountMinor,
        reference: null,
      })),
      ...cash.map((value) => ({
        id: value.id,
        type:
          value.type === "CORRECTION"
            ? "CASH_MOVEMENT_CORRECTION"
            : value.status === "REJECTED"
              ? "CASH_MOVEMENT_REJECTED"
              : "CASH_MOVEMENT_PENDING",
        occurredAt: value.postedAt ?? value.rejectedAt ?? value.createdAt,
        status: value.status,
        amountMinor: value.amountMinor,
        reference: null,
      })),
      ...closes.map((value) => ({
        id: value.id,
        type: "SHIFT_VARIANCE",
        occurredAt: value.closedAt,
        status: "CLOSED",
        amountMinor: value.varianceMinor,
        reference: value.shiftId,
      })),
    ];
    return raw
      .map((value) => ({
        ...value,
        occurredAt: value.occurredAt.toISOString(),
        activityDate: localActivity(value.occurredAt, timezone).date,
      }))
      .filter(({ activityDate }) =>
        inRange(activityDate, query.fromDate, query.toDate),
      )
      .sort(
        (left, right) =>
          right.occurredAt.localeCompare(left.occurredAt) ||
          left.type.localeCompare(right.type) ||
          left.id.localeCompare(right.id),
      );
  }

  private async exportDetailRows(
    branchId: string,
    dataset: ReportExportDataset,
    query: ReportRangeQuery,
    principal: AuthPrincipal,
  ) {
    return this.withSnapshot(
      branchId,
      query,
      principal,
      "reports.export",
      (snapshot) => {
        if (dataset === "SALES_LINES") {
          return {
            headers: [
              "business_date",
              "commercial_order_id",
              "order_number",
              "channel",
              "completed_at",
              "line_id",
              "item",
              "variant",
              "category_key",
              "category_name",
              "quantity",
              "input_minor",
              "net_minor",
              "tax_minor",
              "gross_minor",
            ],
            rows: snapshot.orders
              .flatMap((order) =>
                compositionLines(order).map((line) => ({
                  business_date: dateOnly(order.businessDate),
                  commercial_order_id: order.id,
                  order_number: order.orderNumber,
                  channel: order.channel,
                  completed_at: order.completedAt!.toISOString(),
                  line_id: line.id,
                  item: line.itemNameSnapshot,
                  variant: line.variantNameSnapshot,
                  category_key: line.categoryKeySnapshot ?? "UNSNAPSHOTTED",
                  category_name: line.categoryNameSnapshot ?? "UNSNAPSHOTTED",
                  quantity: line.quantity,
                  input_minor: line.lineInputAmountMinor,
                  net_minor: line.netAmountMinor,
                  tax_minor: line.taxTotalMinor,
                  gross_minor: line.grossAmountMinor,
                })),
              )
              .sort((left, right) =>
                `${left.business_date}:${left.order_number}:${left.line_id}`.localeCompare(
                  `${right.business_date}:${right.order_number}:${right.line_id}`,
                ),
              ),
          };
        }
        return {
          headers: [
            "activity_date",
            "refund_id",
            "order_id",
            "kind",
            "method",
            "amount_minor",
            "confirmed_at",
          ],
          rows: snapshot.refunds
            .filter(
              (refund) =>
                refund.confirmedAt &&
                inRange(
                  localActivity(refund.confirmedAt, snapshot.branch.timezone)
                    .date,
                  query.fromDate,
                  query.toDate,
                ),
            )
            .map((refund) => ({
              activity_date: localActivity(
                refund.confirmedAt!,
                snapshot.branch.timezone,
              ).date,
              refund_id: refund.id,
              order_id: refund.orderId,
              kind: refund.kind,
              method: refund.payment.method,
              amount_minor: refund.amountMinor,
              confirmed_at: refund.confirmedAt!.toISOString(),
            }))
            .sort((left, right) =>
              `${left.activity_date}:${left.refund_id}`.localeCompare(
                `${right.activity_date}:${right.refund_id}`,
              ),
            ),
        };
      },
    );
  }
}
