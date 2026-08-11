import type {
  CapturePilotReadinessReviewRequest,
  PilotEvidenceCode,
  PilotReadinessListQuery,
  RecordPilotEvidenceRequest,
} from "@base-cafe/contracts";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  deploymentPreflight,
  readinessResult,
  type PilotReadinessCheck,
} from "./pilot-readiness-policy.js";

type Tx = Prisma.TransactionClient;
const sensitiveReference =
  /(password|secret|token|credential|pin|api[-_ ]?key)/i;

function asJson(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

@Injectable()
export class PilotReadinessService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async live(principal: AuthPrincipal) {
    this.assertPermission(principal, "release.read");
    return this.prisma.$transaction(
      (tx) => this.evaluate(tx, principal.organizationId),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async listEvidence(query: PilotReadinessListQuery, principal: AuthPrincipal) {
    this.assertPermission(principal, "release.read");
    const cursor = query.cursor
      ? await this.prisma.pilotReadinessEvidence.findFirst({
          where: { id: query.cursor, organizationId: principal.organizationId },
          select: { id: true, recordedAt: true },
        })
      : null;
    const rows = await this.prisma.pilotReadinessEvidence.findMany({
      where: {
        organizationId: principal.organizationId,
        ...(cursor && {
          OR: [
            { recordedAt: { lt: cursor.recordedAt } },
            { recordedAt: cursor.recordedAt, id: { lt: cursor.id } },
          ],
        }),
      },
      include: { recordedBy: { select: { id: true, displayName: true } } },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit).map((row) => ({
      ...row,
      observedAt: row.observedAt.toISOString(),
      recordedAt: row.recordedAt.toISOString(),
    }));
    return {
      generatedAt: new Date().toISOString(),
      items,
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async listReviews(query: PilotReadinessListQuery, principal: AuthPrincipal) {
    this.assertPermission(principal, "release.read");
    const cursor = query.cursor
      ? await this.prisma.pilotReadinessReview.findFirst({
          where: { id: query.cursor, organizationId: principal.organizationId },
          select: { id: true, recordedAt: true },
        })
      : null;
    const rows = await this.prisma.pilotReadinessReview.findMany({
      where: {
        organizationId: principal.organizationId,
        ...(cursor && {
          OR: [
            { recordedAt: { lt: cursor.recordedAt } },
            { recordedAt: cursor.recordedAt, id: { lt: cursor.id } },
          ],
        }),
      },
      include: { recordedBy: { select: { id: true, displayName: true } } },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit).map((row) => ({
      ...row,
      recordedAt: row.recordedAt.toISOString(),
    }));
    return {
      generatedAt: new Date().toISOString(),
      items,
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async recordEvidence(
    input: RecordPilotEvidenceRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "release.manage");
    if (new Date(input.observedAt).getTime() > Date.now())
      throw new BadRequestException({ code: "READINESS_EVIDENCE_IN_FUTURE" });
    if (input.safeReference && sensitiveReference.test(input.safeReference))
      throw new BadRequestException({ code: "READINESS_REFERENCE_SENSITIVE" });
    return this.idempotent(
      "release.evidence.record",
      key,
      input,
      principal,
      async (tx) => {
        const evidence = await tx.pilotReadinessEvidence.create({
          data: {
            id: input.evidenceId,
            organizationId: principal.organizationId,
            code: input.code,
            outcome: input.outcome,
            observedAt: new Date(input.observedAt),
            safeReference: input.safeReference,
            recordedById: principal.userId,
            reason: input.reason,
          },
        });
        const response = {
          ...evidence,
          observedAt: evidence.observedAt.toISOString(),
          recordedAt: evidence.recordedAt.toISOString(),
        };
        return {
          entityId: evidence.id,
          eventType: "release.readiness.evidence.recorded",
          reason: input.reason,
          response,
          metadata: { code: input.code, outcome: input.outcome },
        };
      },
    );
  }

  async captureReview(
    input: CapturePilotReadinessReviewRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "release.manage");
    return this.idempotent(
      "release.readiness.review.capture",
      key,
      input,
      principal,
      async (tx) => {
        const result = await this.evaluate(tx, principal.organizationId);
        const review = await tx.pilotReadinessReview.create({
          data: {
            id: input.reviewId,
            organizationId: principal.organizationId,
            status: result.status,
            blockedCount: result.counts.blocked,
            unconfirmedCount: result.counts.unconfirmed,
            passedCount: result.counts.passed,
            checks: asJson(result.checks),
            recordedById: principal.userId,
            reason: input.reason,
          },
        });
        const response = {
          ...review,
          recordedAt: review.recordedAt.toISOString(),
          blockingCodes: result.blockingCodes,
          unconfirmedCodes: result.unconfirmedCodes,
        };
        return {
          entityId: review.id,
          eventType: "release.readiness.review.captured",
          reason: input.reason,
          response,
          metadata: {
            status: result.status,
            blockedCount: result.counts.blocked,
            unconfirmedCount: result.counts.unconfirmed,
          },
        };
      },
    );
  }

  private async evaluate(tx: Tx, organizationId: string) {
    const now = new Date();
    const branches = await tx.branch.findMany({
      where: { organizationId },
      select: { id: true, name: true, timezone: true, currency: true },
      orderBy: { id: "asc" },
    });
    const automated: PilotReadinessCheck[] = [];
    automated.push(deploymentPreflight(process.env));
    const [activeUsers, passwordChangeUsers] = await Promise.all([
      tx.user.count({ where: { organizationId, status: "ACTIVE" } }),
      tx.user.count({
        where: { organizationId, status: "ACTIVE", mustChangePassword: true },
      }),
    ]);
    automated.push({
      code: "STAFF_ACCESS_CONFIGURED",
      category: "AUTOMATED",
      status: activeUsers > 0 && passwordChangeUsers === 0 ? "PASS" : "BLOCKED",
      summary: "Active staff use named accounts without temporary credentials.",
      details: { activeUsers, passwordChangeUsers },
    });
    automated.push({
      code: "BRANCH_EXISTS",
      category: "AUTOMATED",
      status: branches.length > 0 ? "PASS" : "BLOCKED",
      summary: "At least one organization branch is configured.",
      details: { branchCount: branches.length },
    });
    for (const branch of branches) {
      const activePrice: Prisma.MenuPriceWhereInput = {
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      };
      const [
        devices,
        stations,
        items,
        incompleteItems,
        incompleteVariants,
        taxProfile,
        schedule,
      ] = await Promise.all([
        tx.device.count({ where: { branchId: branch.id, status: "ACTIVE" } }),
        tx.station.count({ where: { branchId: branch.id, isActive: true } }),
        tx.menuItem.count({ where: { branchId: branch.id, isActive: true } }),
        tx.menuItem.count({
          where: {
            branchId: branch.id,
            isActive: true,
            OR: [
              { taxClassId: null },
              { defaultStationId: null },
              { prices: { none: activePrice } },
            ],
          },
        }),
        tx.menuVariant.count({
          where: {
            isActive: true,
            menuItem: { branchId: branch.id, isActive: true },
            prices: { none: activePrice },
          },
        }),
        tx.taxProfile.findFirst({
          where: {
            branchId: branch.id,
            status: "ACTIVE",
            confirmedAt: { not: null },
            approvalReference: { not: null },
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
          select: { id: true },
        }),
        tx.branchScheduleVersion.findFirst({
          where: {
            branchId: branch.id,
            status: "ACTIVE",
            effectiveFrom: { lte: now },
          },
          select: { id: true },
        }),
      ]);
      automated.push({
        code: `BRANCH_CONFIGURATION:${branch.id}`,
        category: "AUTOMATED",
        status:
          devices > 0 &&
          stations > 0 &&
          taxProfile &&
          schedule &&
          branch.timezone === "Africa/Accra" &&
          branch.currency === "GHS"
            ? "PASS"
            : "BLOCKED",
        summary: `Core launch configuration for ${branch.name}.`,
        details: {
          activeDevices: devices,
          activeStations: stations,
          activeTaxProfile: Boolean(taxProfile),
          activeSchedule: Boolean(schedule),
          timezoneIsAfricaAccra: branch.timezone === "Africa/Accra",
          currencyIsGhs: branch.currency === "GHS",
        },
      });
      automated.push({
        code: `SALE_CATALOG:${branch.id}`,
        category: "AUTOMATED",
        status:
          items > 0 && incompleteItems === 0 && incompleteVariants === 0
            ? "PASS"
            : "BLOCKED",
        summary: `Active sale catalog for ${branch.name} has exact price, tax, and station routing.`,
        details: { activeItems: items, incompleteItems, incompleteVariants },
      });
    }
    const [
      backup,
      restore,
      criticalAlerts,
      auditBatches,
      unresolvedSync,
      retentionCategories,
    ] = await Promise.all([
      tx.operationalEvidence.findFirst({
        where: {
          organizationId,
          kind: "BACKUP",
          outcome: "SUCCEEDED",
          encrypted: true,
          checksumSha256: { not: null },
        },
        orderBy: { completedAt: "desc" },
        select: { id: true },
      }),
      tx.operationalEvidence.findFirst({
        where: { organizationId, kind: "RESTORE_DRILL", outcome: "SUCCEEDED" },
        orderBy: { completedAt: "desc" },
        select: { id: true },
      }),
      tx.securityAlert.count({
        where: {
          organizationId,
          severity: "CRITICAL",
          status: { not: "RESOLVED" },
        },
      }),
      tx.auditIntegrityBatch.count({ where: { organizationId } }),
      tx.syncCommandReceipt.count({
        where: {
          organizationId,
          status: { in: ["CONFLICT", "REJECTED"] },
          resolution: { is: null },
        },
      }),
      tx.retentionPolicyVersion.findMany({
        where: {
          organizationId,
          status: "ACTIVE",
          effectiveFrom: { lte: now },
        },
        distinct: ["category"],
        select: { category: true },
      }),
    ]);
    automated.push({
      code: "RECOVERY_EVIDENCE",
      category: "AUTOMATED",
      status: backup && restore ? "PASS" : "BLOCKED",
      summary:
        "Encrypted backup and successful isolated restore evidence exist.",
      details: {
        encryptedBackup: Boolean(backup),
        restoreDrill: Boolean(restore),
      },
    });
    automated.push({
      code: "SECURITY_AND_SYNC_POSTURE",
      category: "AUTOMATED",
      status:
        criticalAlerts === 0 && auditBatches > 0 && unresolvedSync === 0
          ? "PASS"
          : "BLOCKED",
      summary:
        "No unresolved critical alerts or terminal sync commands and audit integrity is sealed.",
      details: { criticalAlerts, auditBatches, unresolvedSync },
    });
    automated.push({
      code: "PRIVACY_RETENTION_CONFIGURED",
      category: "AUTOMATED",
      status: retentionCategories.length === 3 ? "PASS" : "BLOCKED",
      summary:
        "All required customer-data retention categories have active approved versions.",
      details: {
        activeRetentionCategories: retentionCategories.length,
        requiredCategories: 3,
      },
    });
    const evidenceRows = await tx.pilotReadinessEvidence.findMany({
      where: { organizationId },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
    });
    const latest = new Map<
      PilotEvidenceCode,
      { id: string; outcome: string; observedAt: Date }
    >();
    for (const row of evidenceRows)
      if (!latest.has(row.code as PilotEvidenceCode))
        latest.set(row.code as PilotEvidenceCode, row);
    return readinessResult(organizationId, now, automated, latest);
  }

  private async idempotent(
    scope: string,
    key: string,
    command: unknown,
    principal: AuthPrincipal,
    work: (tx: Tx) => Promise<{
      entityId: string;
      eventType: string;
      reason: string;
      response: unknown;
      metadata: Prisma.InputJsonObject;
    }>,
  ) {
    const hash = requestHash(command);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { actorId_scope_key: { actorId: principal.userId, scope, key } },
    });
    if (existing) {
      if (existing.requestHash !== hash)
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
      return existing.responseBody;
    }
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const result = await work(tx);
          await tx.auditLog.create({
            data: {
              organizationId: principal.organizationId,
              actorId: principal.userId,
              action: scope,
              entityType: "pilot_readiness",
              entityId: result.entityId,
              reason: result.reason,
              metadata: { ...result.metadata, deviceId: principal.deviceId },
            },
          });
          await tx.outboxEvent.create({
            data: {
              aggregateType: "pilot_readiness",
              aggregateId: result.entityId,
              eventType: result.eventType,
              payload: {
                organizationId: principal.organizationId,
                ...result.metadata,
              },
            },
          });
          await tx.idempotencyRecord.create({
            data: {
              actorId: principal.userId,
              scope,
              key,
              requestHash: hash,
              responseBody: asJson(result.response),
              expiresAt: new Date(Date.now() + 86_400_000),
            },
          });
          return result.response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2004", "P2034"].includes(error.code)
      )
        throw new ConflictException({ code: "PILOT_READINESS_CONFLICT" });
      throw error;
    }
  }

  private assertPermission(principal: AuthPrincipal, permission: string) {
    if (!hasPermission(principal, permission))
      throw new ForbiddenException({
        code: "RELEASE_ORGANIZATION_PERMISSION_REQUIRED",
      });
  }
}
