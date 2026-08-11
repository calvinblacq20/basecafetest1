import type {
  OperationalEvidenceListQuery,
  OperationsDiagnosticsResponse,
  RecordOperationalEvidenceRequest,
} from "@base-cafe/contracts";
import {
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

const APPLICATION_VERSION = process.env.APP_VERSION ?? "0.1.0";

function evidenceResponse(evidence: {
  id: string;
  organizationId: string;
  kind: string;
  outcome: string;
  source: string;
  startedAt: Date;
  completedAt: Date;
  encrypted: boolean;
  checksumSha256: string | null;
  artifactReference: string | null;
  retentionUntil: Date | null;
  applicationVersion: string;
  schemaVersion: string;
  checks: Prisma.JsonValue;
  failureCode: string | null;
  safeFailureMessage: string | null;
  recordedById: string;
  reason: string;
  recordedAt: Date;
}) {
  return {
    ...evidence,
    kind: evidence.kind as "BACKUP" | "RESTORE_DRILL",
    outcome: evidence.outcome as "SUCCEEDED" | "FAILED",
    source: evidence.source as
      "LOCAL_ENCRYPTED_ARCHIVE" | "MANAGED_PROVIDER" | "MANUAL_EVIDENCE",
    startedAt: evidence.startedAt.toISOString(),
    completedAt: evidence.completedAt.toISOString(),
    retentionUntil: evidence.retentionUntil?.toISOString() ?? null,
    checks: evidence.checks as Record<string, boolean | number | string>,
    recordedAt: evidence.recordedAt.toISOString(),
  };
}

function latestSummary(
  evidence: null | Readonly<{
    id: string;
    outcome: string;
    completedAt: Date;
    recordedAt: Date;
    failureCode: string | null;
  }>,
) {
  if (!evidence) return null;
  return {
    id: evidence.id,
    outcome: evidence.outcome as "SUCCEEDED" | "FAILED",
    completedAt: evidence.completedAt.toISOString(),
    recordedAt: evidence.recordedAt.toISOString(),
    failureCode: evidence.failureCode,
  };
}

@Injectable()
export class OperationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: OperationalEvidenceListQuery, principal: AuthPrincipal) {
    this.assertOrganizationPermission(principal, "operations.read");
    const evidence = await this.prisma.operationalEvidence.findMany({
      where: {
        organizationId: principal.organizationId,
        kind: query.kind,
        outcome: query.outcome,
      },
      orderBy: [{ completedAt: "desc" }, { id: "asc" }],
      take: query.limit,
    });
    return {
      generatedAt: new Date().toISOString(),
      items: evidence.map(evidenceResponse),
    };
  }

  async record(
    input: RecordOperationalEvidenceRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertOrganizationPermission(principal, "operations.manage");
    const scope = "operations.evidence.record";
    const hash = requestHash(input);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        actorId_scope_key: {
          actorId: principal.userId,
          scope,
          key: idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== hash)
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
      return existing.responseBody;
    }

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const evidence = await transaction.operationalEvidence.create({
            data: {
              id: input.evidenceId,
              organizationId: principal.organizationId,
              kind: input.kind,
              outcome: input.outcome,
              source: input.source,
              startedAt: new Date(input.startedAt),
              completedAt: new Date(input.completedAt),
              encrypted: input.encrypted,
              checksumSha256: input.checksumSha256?.toLowerCase() ?? null,
              artifactReference: input.artifactReference ?? null,
              retentionUntil: input.retentionUntil
                ? new Date(input.retentionUntil)
                : null,
              applicationVersion: input.applicationVersion,
              schemaVersion: input.schemaVersion,
              checks: input.checks,
              failureCode: input.failureCode ?? null,
              safeFailureMessage: input.safeFailureMessage ?? null,
              recordedById: principal.userId,
              reason: input.reason,
            },
          });
          const response = evidenceResponse(evidence);
          await transaction.auditLog.create({
            data: {
              organizationId: principal.organizationId,
              actorId: principal.userId,
              action: scope,
              entityType: "operational_evidence",
              entityId: evidence.id,
              outcome: input.outcome === "FAILED" ? "FAILURE" : "SUCCESS",
              reason: input.reason,
              metadata: {
                deviceId: principal.deviceId,
                kind: input.kind,
                outcome: input.outcome,
                source: input.source,
                failureCode: input.failureCode ?? null,
              },
            },
          });
          await transaction.outboxEvent.create({
            data: {
              aggregateType: "operational_evidence",
              aggregateId: evidence.id,
              eventType:
                input.outcome === "FAILED"
                  ? "operations.recovery.failed"
                  : "operations.recovery.succeeded",
              payload: {
                organizationId: principal.organizationId,
                evidenceId: evidence.id,
                kind: input.kind,
                outcome: input.outcome,
                failureCode: input.failureCode ?? null,
              },
            },
          });
          await transaction.idempotencyRecord.create({
            data: {
              actorId: principal.userId,
              scope,
              key: idempotencyKey,
              requestHash: hash,
              responseBody: response,
              expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
            },
          });
          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException({ code: "EVIDENCE_ALREADY_RECORDED" });
      throw error;
    }
  }

  async diagnostics(
    principal: AuthPrincipal,
  ): Promise<OperationsDiagnosticsResponse> {
    this.assertOrganizationPermission(principal, "operations.read");
    const outboxRows = await this.prisma.$queryRaw<
      Array<{
        unpublishedCount: bigint;
        oldestUnpublishedAt: Date | null;
        maximumAttempts: number | null;
      }>
    >`
      SELECT
        count(*)::bigint AS "unpublishedCount",
        min("occurred_at") AS "oldestUnpublishedAt",
        max("attempts") AS "maximumAttempts"
      FROM "outbox_events"
      WHERE "published_at" IS NULL
        AND "payload" ->> 'organizationId' = ${principal.organizationId}
    `;
    const outbox = outboxRows[0] ?? {
      unpublishedCount: 0n,
      oldestUnpublishedAt: null,
      maximumAttempts: 0,
    };
    if (outbox.unpublishedCount > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Operational outbox count exceeds safe JSON range.");
    const [unresolvedCommands, latestBackup, latestRestore] =
      await this.prisma.$transaction([
        this.prisma.syncCommandReceipt.count({
          where: {
            organizationId: principal.organizationId,
            status: { in: ["CONFLICT", "REJECTED"] },
            resolution: null,
          },
        }),
        this.prisma.operationalEvidence.findFirst({
          where: {
            organizationId: principal.organizationId,
            kind: "BACKUP",
          },
          orderBy: [{ completedAt: "desc" }, { id: "asc" }],
        }),
        this.prisma.operationalEvidence.findFirst({
          where: {
            organizationId: principal.organizationId,
            kind: "RESTORE_DRILL",
          },
          orderBy: [{ completedAt: "desc" }, { id: "asc" }],
        }),
      ]);

    const alerts: OperationsDiagnosticsResponse["alerts"] = [];
    if (!latestBackup) {
      alerts.push({
        code: "BACKUP_EVIDENCE_MISSING",
        severity: "WARNING",
        message: "No backup evidence has been recorded for this organization.",
      });
    } else if (latestBackup.outcome === "FAILED") {
      alerts.push({
        code: "LATEST_BACKUP_FAILED",
        severity: "CRITICAL",
        message: "The latest recorded backup attempt failed.",
      });
    }
    if (!latestRestore) {
      alerts.push({
        code: "RESTORE_DRILL_EVIDENCE_MISSING",
        severity: "WARNING",
        message: "No successful isolated restore drill has been recorded.",
      });
    } else if (latestRestore.outcome === "FAILED") {
      alerts.push({
        code: "LATEST_RESTORE_DRILL_FAILED",
        severity: "CRITICAL",
        message: "The latest recorded restore drill failed.",
      });
    }
    if (unresolvedCommands > 0) {
      alerts.push({
        code: "SYNC_RECOVERY_REQUIRED",
        severity: "WARNING",
        message: "Offline synchronization commands require manager review.",
      });
    }

    const configuredMaximumAgeMinutes = Number.parseInt(
      process.env.BACKUP_MAX_AGE_MINUTES ?? "",
      10,
    );
    if (
      latestBackup?.outcome === "SUCCEEDED" &&
      Number.isInteger(configuredMaximumAgeMinutes) &&
      configuredMaximumAgeMinutes > 0 &&
      Date.now() - latestBackup.completedAt.getTime() >
        configuredMaximumAgeMinutes * 60_000
    ) {
      alerts.push({
        code: "BACKUP_EVIDENCE_STALE",
        severity: "CRITICAL",
        message: "The latest successful backup exceeds the configured age.",
      });
    }

    return {
      service: "base-cafe-api",
      version: APPLICATION_VERSION,
      generatedAt: new Date().toISOString(),
      database: "up",
      outbox: {
        unpublishedCount: Number(outbox.unpublishedCount),
        oldestUnpublishedAt: outbox.oldestUnpublishedAt?.toISOString() ?? null,
        maximumAttempts: outbox.maximumAttempts ?? 0,
      },
      synchronization: {
        unresolvedTerminalCommandCount: unresolvedCommands,
      },
      recovery: {
        latestBackup: latestSummary(latestBackup),
        latestRestoreDrill: latestSummary(latestRestore),
      },
      alerts,
    };
  }

  private assertOrganizationPermission(
    principal: AuthPrincipal,
    permission: string,
  ) {
    if (!hasPermission(principal, permission))
      throw new ForbiddenException({
        code: "ORGANIZATION_PERMISSION_REQUIRED",
      });
  }
}
