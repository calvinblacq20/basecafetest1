import { createHash } from "node:crypto";

import type {
  EvaluateSecurityMonitoringRequest,
  LegacyCustomerPiiPreviewRequest,
  RevokeSecuritySessionRequest,
  RewrapCustomerPiiRequest,
  SecurityAlertListQuery,
  SecuritySessionListQuery,
  TransitionSecurityAlertRequest,
} from "@base-cafe/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  type SecurityAlertSeverity,
  type SecurityAlertStatus,
} from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { requestHash } from "../common/request-hash.js";
import { PrismaService } from "../database/prisma.service.js";
import { CustomerPiiCryptoService } from "../privacy/customer-pii-crypto.service.js";

type Tx = Prisma.TransactionClient;
type Signal = Readonly<{
  branchId: string | null;
  code: string;
  severity: SecurityAlertSeverity;
  source: string;
  subject: string;
  summary: string;
  observedAt: Date;
  count: number;
  mode: "EVENT" | "GAUGE";
}>;

const severityRank: Readonly<Record<SecurityAlertSeverity, number>> = {
  INFO: 1,
  WARNING: 2,
  CRITICAL: 3,
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function withoutKeys<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Omit<T, K> {
  const excluded = new Set<PropertyKey>(keys);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !excluded.has(key)),
  ) as Omit<T, K>;
}

function fail(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

@Injectable()
export class SecurityOperationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CustomerPiiCryptoService)
    private readonly customerPii: CustomerPiiCryptoService,
  ) {}

  async listAlerts(query: SecurityAlertListQuery, principal: AuthPrincipal) {
    this.organizationPermission(principal, "security.alerts.read");
    await this.assertOptionalBranch(query.branchId, principal.organizationId);
    const cursor = query.cursor
      ? await this.prisma.securityAlert.findFirst({
          where: { id: query.cursor, organizationId: principal.organizationId },
          select: { id: true, lastSeenAt: true },
        })
      : null;
    const rows = await this.prisma.securityAlert.findMany({
      where: {
        organizationId: principal.organizationId,
        ...(query.branchId && { branchId: query.branchId }),
        severity: query.severity,
        status: query.status,
        code: query.code,
        ...(cursor && {
          OR: [
            { lastSeenAt: { lt: cursor.lastSeenAt } },
            { lastSeenAt: cursor.lastSeenAt, id: { lt: cursor.id } },
          ],
        }),
      },
      include: {
        branch: { select: { id: true, name: true } },
        acknowledgedBy: { select: { id: true, displayName: true } },
        resolvedBy: { select: { id: true, displayName: true } },
        events: {
          include: { actor: { select: { id: true, displayName: true } } },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          take: 10,
        },
      },
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map((alert) => {
      const safeAlert = withoutKeys(alert, ["fingerprintHash"]);
      return {
        ...safeAlert,
        firstSeenAt: alert.firstSeenAt.toISOString(),
        lastSeenAt: alert.lastSeenAt.toISOString(),
        acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: alert.resolvedAt?.toISOString() ?? null,
        createdAt: alert.createdAt.toISOString(),
        updatedAt: alert.updatedAt.toISOString(),
        events: alert.events.map((event) => ({
          ...event,
          occurredAt: event.occurredAt.toISOString(),
        })),
      };
    });
    return {
      generatedAt: new Date().toISOString(),
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async evaluate(
    input: EvaluateSecurityMonitoringRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.organizationPermission(principal, "security.alerts.manage");
    const scope = "security.monitoring.evaluate";
    const command = { ...input, organizationId: principal.organizationId };
    return this.idempotent(scope, key, command, principal, async (tx) => {
      const asOf = new Date(input.asOf);
      const from = new Date(asOf.getTime() - input.windowMinutes * 60_000);
      const signals = await this.detectSignals(
        tx,
        principal.organizationId,
        from,
        asOf,
      );
      const result = await this.applySignals(
        tx,
        principal.organizationId,
        signals,
      );
      const response = {
        evaluationId: input.evaluationId,
        evaluatedAt: asOf.toISOString(),
        windowStartedAt: from.toISOString(),
        signalCount: signals.reduce((total, signal) => total + signal.count, 0),
        createdAlertCount: result.created,
        updatedAlertCount: result.updated,
        reopenedAlertCount: result.reopened,
        externalDeliveryEnabled: false,
      };
      return {
        entityType: "security_monitoring_evaluation",
        entityId: input.evaluationId,
        eventType: "security.monitoring.evaluated",
        reason: input.reason,
        response: json(response),
        metadata: {
          windowMinutes: input.windowMinutes,
          signalCount: response.signalCount,
          createdAlertCount: result.created,
          updatedAlertCount: result.updated,
          reopenedAlertCount: result.reopened,
        },
      };
    });
  }

  acknowledgeAlert(
    alertId: string,
    input: TransitionSecurityAlertRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    return this.transitionAlert(alertId, input, key, principal, "ACKNOWLEDGED");
  }

  resolveAlert(
    alertId: string,
    input: TransitionSecurityAlertRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    return this.transitionAlert(alertId, input, key, principal, "RESOLVED");
  }

  async listSessions(
    query: SecuritySessionListQuery,
    principal: AuthPrincipal,
  ) {
    this.organizationPermission(principal, "security.sessions.read");
    await this.assertOptionalBranch(query.branchId, principal.organizationId);
    const cursor = query.cursor
      ? await this.prisma.session.findFirst({
          where: {
            id: query.cursor,
            user: { organizationId: principal.organizationId },
          },
          select: { id: true, lastUsedAt: true },
        })
      : null;
    const rows = await this.prisma.session.findMany({
      where: {
        user: { organizationId: principal.organizationId },
        ...(query.branchId && { device: { branchId: query.branchId } }),
        userId: query.userId,
        status: query.status,
        ...(cursor && {
          OR: [
            { lastUsedAt: { lt: cursor.lastUsedAt } },
            { lastUsedAt: cursor.lastUsedAt, id: { lt: cursor.id } },
          ],
        }),
      },
      include: {
        user: { select: { id: true, displayName: true, status: true } },
        device: {
          select: {
            id: true,
            name: true,
            status: true,
            branch: { select: { id: true, name: true } },
          },
        },
        revokedBy: { select: { id: true, displayName: true } },
      },
      orderBy: [{ lastUsedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map((row) => {
      const session = withoutKeys(row, ["tokenHash"]);
      return {
        ...session,
        effectiveStatus:
          session.status === "ACTIVE" && session.expiresAt <= new Date()
            ? "EXPIRED"
            : session.status,
        expiresAt: session.expiresAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        revokedAt: session.revokedAt?.toISOString() ?? null,
        createdAt: session.createdAt.toISOString(),
      };
    });
    return {
      generatedAt: new Date().toISOString(),
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async revokeSession(
    sessionId: string,
    input: RevokeSecuritySessionRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.organizationPermission(principal, "security.sessions.manage");
    return this.idempotent(
      "security.session.revoke",
      key,
      { sessionId, ...input },
      principal,
      async (tx) => {
        const session = await tx.session.findFirst({
          where: {
            id: sessionId,
            user: { organizationId: principal.organizationId },
          },
          include: { device: { select: { branchId: true } } },
        });
        if (!session)
          throw new NotFoundException({ code: "SESSION_NOT_FOUND" });
        if (session.revision !== input.revision)
          fail("STALE_REVISION", "The session changed.");
        if (session.status !== "ACTIVE" || session.expiresAt <= new Date())
          fail(
            "SESSION_NOT_ACTIVE",
            "Only an active unexpired session can be revoked.",
          );
        const revokedAt = new Date();
        const updated = await tx.session.updateMany({
          where: { id: sessionId, revision: input.revision, status: "ACTIVE" },
          data: {
            status: "REVOKED",
            revision: { increment: 1 },
            revokedById: principal.userId,
            revokedAt,
            revocationReason: input.reason,
          },
        });
        if (updated.count !== 1) fail("STALE_REVISION", "The session changed.");
        return {
          entityType: "session",
          entityId: sessionId,
          eventType: "security.session.revoked",
          reason: input.reason,
          branchId: session.device.branchId,
          response: json({
            id: sessionId,
            status: "REVOKED",
            revision: input.revision + 1,
            revokedAt: revokedAt.toISOString(),
          }),
        };
      },
    );
  }

  async keyPosture(principal: AuthPrincipal) {
    this.organizationPermission(principal, "privacy.keys.read");
    const [profiles, contacts, legacyPhoneCount, legacyDirectionCount] =
      await this.prisma.$transaction([
        this.prisma.customerProfile.groupBy({
          by: ["piiKeyVersion"],
          orderBy: { piiKeyVersion: "asc" },
          where: {
            organizationId: principal.organizationId,
            piiKeyVersion: { not: null },
          },
          _count: { _all: true },
        }),
        this.prisma.orderCustomerContact.groupBy({
          by: ["piiKeyVersion"],
          orderBy: { piiKeyVersion: "asc" },
          where: {
            organizationId: principal.organizationId,
            piiKeyVersion: { not: null },
          },
          _count: { _all: true },
        }),
        this.prisma.order.count({
          where: {
            branch: { organizationId: principal.organizationId },
            customerPhone: { not: null },
          },
        }),
        this.prisma.order.count({
          where: {
            branch: { organizationId: principal.organizationId },
            deliveryDirections: { not: null },
          },
        }),
      ]);
    const posture = this.customerPii.posture();
    return {
      generatedAt: new Date().toISOString(),
      ...posture,
      customerProfileEnvelopes: profiles.map((row) => ({
        keyVersion: row.piiKeyVersion,
        count: (row._count as { _all?: number } | undefined)?._all ?? 0,
      })),
      orderContactEnvelopes: contacts.map((row) => ({
        keyVersion: row.piiKeyVersion,
        count: (row._count as { _all?: number } | undefined)?._all ?? 0,
      })),
      legacyPlaintext: {
        phoneRowCount: legacyPhoneCount,
        deliveryDirectionRowCount: legacyDirectionCount,
      },
    };
  }

  rewrapCustomerPii(
    input: RewrapCustomerPiiRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.organizationPermission(principal, "privacy.keys.manage");
    const targetKeyVersion = this.customerPii.activeKeyVersion();
    if (input.sourceKeyVersion === targetKeyVersion)
      fail("PII_KEY_ALREADY_ACTIVE", "The source key is already active.");
    return this.idempotent(
      "privacy.keys.rewrap",
      key,
      { ...input, targetKeyVersion },
      principal,
      async (tx) => {
        const profiles = await tx.customerProfile.findMany({
          where: {
            organizationId: principal.organizationId,
            piiKeyVersion: input.sourceKeyVersion,
            status: { not: "ANONYMIZED" },
          },
          orderBy: { id: "asc" },
          take: input.limit,
        });
        const remaining = input.limit - profiles.length;
        const contacts = remaining
          ? await tx.orderCustomerContact.findMany({
              where: {
                organizationId: principal.organizationId,
                piiKeyVersion: input.sourceKeyVersion,
                anonymizedAt: null,
              },
              orderBy: { orderId: "asc" },
              take: remaining,
            })
          : [];
        for (const profile of profiles) {
          if (
            !profile.piiCiphertext ||
            !profile.piiIv ||
            !profile.piiAuthTag ||
            !profile.piiKeyVersion
          )
            fail(
              "CUSTOMER_PII_INCOMPLETE",
              "A customer profile envelope is incomplete.",
            );
          const value = this.customerPii.unprotect(
            {
              ciphertext: profile.piiCiphertext,
              iv: profile.piiIv,
              authTag: profile.piiAuthTag,
              keyVersion: profile.piiKeyVersion,
            },
            {
              organizationId: principal.organizationId,
              resourceType: "customer-profile",
              resourceId: profile.id,
            },
          );
          const envelope = this.customerPii.protect(value, {
            organizationId: principal.organizationId,
            resourceType: "customer-profile",
            resourceId: profile.id,
          });
          if (!envelope)
            fail(
              "CUSTOMER_PII_INCOMPLETE",
              "A customer profile envelope is empty.",
            );
          const updated = await tx.customerProfile.updateMany({
            where: { id: profile.id, revision: profile.revision },
            data: {
              revision: { increment: 1 },
              piiCiphertext: envelope.ciphertext,
              piiIv: envelope.iv,
              piiAuthTag: envelope.authTag,
              piiKeyVersion: envelope.keyVersion,
            },
          });
          if (updated.count !== 1)
            fail(
              "STALE_REVISION",
              "A customer profile changed during rewrapping.",
            );
        }
        for (const contact of contacts) {
          if (
            !contact.piiCiphertext ||
            !contact.piiIv ||
            !contact.piiAuthTag ||
            !contact.piiKeyVersion
          )
            fail(
              "CUSTOMER_PII_INCOMPLETE",
              "An order contact envelope is incomplete.",
            );
          const value = this.customerPii.unprotect(
            {
              ciphertext: contact.piiCiphertext,
              iv: contact.piiIv,
              authTag: contact.piiAuthTag,
              keyVersion: contact.piiKeyVersion,
            },
            {
              organizationId: principal.organizationId,
              resourceType: "order-contact",
              resourceId: contact.orderId,
            },
          );
          const envelope = this.customerPii.protect(value, {
            organizationId: principal.organizationId,
            resourceType: "order-contact",
            resourceId: contact.orderId,
          });
          if (!envelope)
            fail(
              "CUSTOMER_PII_INCOMPLETE",
              "An order contact envelope is empty.",
            );
          await tx.orderCustomerContact.update({
            where: { orderId: contact.orderId },
            data: {
              piiCiphertext: envelope.ciphertext,
              piiIv: envelope.iv,
              piiAuthTag: envelope.authTag,
              piiKeyVersion: envelope.keyVersion,
            },
          });
        }
        const processed = profiles.length + contacts.length;
        const response = {
          sourceKeyVersion: input.sourceKeyVersion,
          targetKeyVersion,
          processedCustomerProfileCount: profiles.length,
          processedOrderContactCount: contacts.length,
          processedCount: processed,
          batchLimit: input.limit,
        };
        return {
          entityType: "customer_pii_key_rotation",
          entityId: `${input.sourceKeyVersion}:${targetKeyVersion}`,
          eventType: "privacy.keys.rewrapped",
          reason: input.reason,
          response: json(response),
          metadata: response,
        };
      },
    );
  }

  async legacyPiiPreview(
    input: LegacyCustomerPiiPreviewRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.organizationPermission(principal, "privacy.keys.manage");
    await this.assertOptionalBranch(input.branchId, principal.organizationId);
    return this.idempotent(
      "privacy.legacy-pii.preview",
      key,
      input,
      principal,
      async (tx) => {
        const where: Prisma.OrderWhereInput = {
          branch: { organizationId: principal.organizationId },
          ...(input.branchId && { branchId: input.branchId }),
        };
        const [phoneRowCount, directionRowCount, eitherRowCount] =
          await Promise.all([
            tx.order.count({
              where: { ...where, customerPhone: { not: null } },
            }),
            tx.order.count({
              where: { ...where, deliveryDirections: { not: null } },
            }),
            tx.order.count({
              where: {
                ...where,
                OR: [
                  { customerPhone: { not: null } },
                  { deliveryDirections: { not: null } },
                ],
              },
            }),
          ]);
        const response = {
          generatedAt: new Date().toISOString(),
          branchId: input.branchId ?? null,
          phoneRowCount,
          deliveryDirectionRowCount: directionRowCount,
          affectedOrderCount: eitherRowCount,
          executionEnabled: false,
          issues:
            eitherRowCount > 0
              ? ["REVIEWED_LEGACY_PII_MIGRATION_REQUIRED"]
              : [],
        };
        return {
          branchId: input.branchId,
          entityType: "order_customer_contact",
          entityId: input.branchId ?? principal.organizationId,
          eventType: "privacy.legacy-pii.previewed",
          reason: input.reason,
          response: json(response),
          metadata: {
            affectedOrderCount: eitherRowCount,
            executionEnabled: false,
          },
        };
      },
    );
  }

  private async detectSignals(
    tx: Tx,
    organizationId: string,
    from: Date,
    asOf: Date,
  ): Promise<Signal[]> {
    const [auditEvents, exports, failedRecovery, unresolvedSyncCount] =
      await Promise.all([
        tx.auditLog.findMany({
          where: {
            organizationId,
            occurredAt: { gte: from, lte: asOf },
            OR: [
              { action: "auth.login.locked" },
              { action: { startsWith: "administration.staff.role." } },
              { action: "administration.device.revoked" },
              { action: "security.session.revoke" },
            ],
          },
          select: {
            id: true,
            branchId: true,
            action: true,
            entityId: true,
            occurredAt: true,
          },
        }),
        tx.customerDataAccessEvent.findMany({
          where: {
            organizationId,
            accessType: "EXPORT",
            occurredAt: { gte: from, lte: asOf },
          },
          select: { id: true, occurredAt: true },
        }),
        tx.operationalEvidence.findMany({
          where: {
            organizationId,
            outcome: "FAILED",
            recordedAt: { gte: from, lte: asOf },
          },
          select: { id: true, kind: true, recordedAt: true },
        }),
        tx.syncCommandReceipt.count({
          where: {
            organizationId,
            status: { in: ["CONFLICT", "REJECTED"] },
            resolution: null,
          },
        }),
      ]);
    const signals: Signal[] = [];
    for (const event of auditEvents) {
      const subject = event.entityId ?? event.id;
      if (event.action === "auth.login.locked")
        signals.push({
          branchId: event.branchId,
          code: "AUTH_LOGIN_LOCKED",
          severity: "WARNING",
          source: "AUDIT_LOG",
          subject,
          summary: "A login subject reached an authentication lockout.",
          observedAt: event.occurredAt,
          count: 1,
          mode: "EVENT",
        });
      else if (event.action.startsWith("administration.staff.role."))
        signals.push({
          branchId: event.branchId,
          code: "ACCESS_CONTROL_CHANGED",
          severity: "INFO",
          source: "AUDIT_LOG",
          subject,
          summary:
            "A staff role assignment changed and is available for review.",
          observedAt: event.occurredAt,
          count: 1,
          mode: "EVENT",
        });
      else
        signals.push({
          branchId: event.branchId,
          code: "SESSION_OR_DEVICE_REVOKED",
          severity: "INFO",
          source: "AUDIT_LOG",
          subject,
          summary: "A device or staff session was revoked.",
          observedAt: event.occurredAt,
          count: 1,
          mode: "EVENT",
        });
    }
    for (const event of exports)
      signals.push({
        branchId: null,
        code: "CUSTOMER_DATA_EXPORTED",
        severity: "INFO",
        source: "CUSTOMER_DATA_ACCESS",
        subject: event.id,
        summary: "A reasoned customer-data export was completed.",
        observedAt: event.occurredAt,
        count: 1,
        mode: "EVENT",
      });
    for (const evidence of failedRecovery)
      signals.push({
        branchId: null,
        code: `${evidence.kind}_FAILED`,
        severity: "CRITICAL",
        source: "OPERATIONAL_EVIDENCE",
        subject: evidence.kind,
        summary:
          evidence.kind === "BACKUP"
            ? "A recorded backup attempt failed."
            : "A recorded restore drill failed.",
        observedAt: evidence.recordedAt,
        count: 1,
        mode: "EVENT",
      });
    if (unresolvedSyncCount > 0)
      signals.push({
        branchId: null,
        code: "SYNC_RECOVERY_REQUIRED",
        severity: "WARNING",
        source: "SYNC_RECEIPTS",
        subject: "organization",
        summary: "Offline synchronization commands require manager review.",
        observedAt: asOf,
        count: unresolvedSyncCount,
        mode: "GAUGE",
      });
    return signals;
  }

  private async applySignals(
    tx: Tx,
    organizationId: string,
    signals: Signal[],
  ) {
    const grouped = new Map<
      string,
      { signal: Signal; occurrences: Date[]; gaugeCount: number }
    >();
    for (const signal of signals) {
      const fingerprint = this.fingerprint(
        organizationId,
        signal.code,
        signal.branchId,
        signal.subject,
      );
      const current = grouped.get(fingerprint);
      if (!current) {
        grouped.set(fingerprint, {
          signal,
          occurrences: [signal.observedAt],
          gaugeCount: signal.count,
        });
      } else {
        current.occurrences.push(signal.observedAt);
        current.gaugeCount = Math.max(current.gaugeCount, signal.count);
        if (
          severityRank[signal.severity] > severityRank[current.signal.severity]
        )
          current.signal = signal;
      }
    }
    let created = 0;
    let updated = 0;
    let reopened = 0;
    for (const [fingerprintHash, group] of grouped) {
      const observedAt = new Date(
        Math.max(...group.occurrences.map((value) => value.getTime())),
      );
      const firstObservedAt = new Date(
        Math.min(...group.occurrences.map((value) => value.getTime())),
      );
      const existing = await tx.securityAlert.findUnique({
        where: {
          organizationId_fingerprintHash: { organizationId, fingerprintHash },
        },
      });
      if (!existing) {
        const alert = await tx.securityAlert.create({
          data: {
            organizationId,
            branchId: group.signal.branchId,
            fingerprintHash,
            code: group.signal.code,
            severity: group.signal.severity,
            source: group.signal.source,
            summary: group.signal.summary,
            occurrenceCount:
              group.signal.mode === "GAUGE"
                ? group.gaugeCount
                : group.occurrences.length,
            firstSeenAt: firstObservedAt,
            lastSeenAt: observedAt,
          },
        });
        await tx.securityAlertEvent.create({
          data: {
            alertId: alert.id,
            type: "DETECTED",
            data: { occurrenceCount: alert.occurrenceCount },
            occurredAt: observedAt,
          },
        });
        created += 1;
        continue;
      }
      const newEventCount = group.occurrences.filter(
        (value) => value > existing.lastSeenAt,
      ).length;
      const nextCount =
        group.signal.mode === "GAUGE"
          ? Math.max(existing.occurrenceCount, group.gaugeCount)
          : existing.occurrenceCount + newEventCount;
      const shouldObserve = group.signal.mode === "GAUGE" || newEventCount > 0;
      if (!shouldObserve) continue;
      const shouldReopen = existing.status === "RESOLVED";
      const severity =
        severityRank[group.signal.severity] > severityRank[existing.severity]
          ? group.signal.severity
          : existing.severity;
      await tx.securityAlert.update({
        where: { id: existing.id },
        data: {
          severity,
          status: shouldReopen ? "OPEN" : existing.status,
          occurrenceCount: nextCount,
          revision: { increment: 1 },
          lastSeenAt:
            observedAt > existing.lastSeenAt ? observedAt : existing.lastSeenAt,
          ...(shouldReopen && {
            acknowledgedById: null,
            acknowledgedAt: null,
            acknowledgementReason: null,
            resolvedById: null,
            resolvedAt: null,
            resolutionReason: null,
          }),
        },
      });
      await tx.securityAlertEvent.create({
        data: {
          alertId: existing.id,
          type: shouldReopen ? "REOPENED" : "OBSERVED",
          data: { occurrenceCount: nextCount },
          occurredAt: observedAt,
        },
      });
      updated += 1;
      if (shouldReopen) reopened += 1;
    }
    return { created, updated, reopened };
  }

  private transitionAlert(
    alertId: string,
    input: TransitionSecurityAlertRequest,
    key: string,
    principal: AuthPrincipal,
    target: Extract<SecurityAlertStatus, "ACKNOWLEDGED" | "RESOLVED">,
  ) {
    this.organizationPermission(principal, "security.alerts.manage");
    return this.idempotent(
      `security.alert.${target.toLowerCase()}`,
      key,
      { alertId, ...input },
      principal,
      async (tx) => {
        const alert = await tx.securityAlert.findFirst({
          where: { id: alertId, organizationId: principal.organizationId },
        });
        if (!alert)
          throw new NotFoundException({ code: "SECURITY_ALERT_NOT_FOUND" });
        if (alert.revision !== input.revision)
          fail("STALE_REVISION", "The alert changed.");
        if (target === "ACKNOWLEDGED" && alert.status !== "OPEN")
          fail(
            "SECURITY_ALERT_STATE_INVALID",
            "Only open alerts can be acknowledged.",
          );
        if (target === "RESOLVED" && alert.status !== "ACKNOWLEDGED")
          fail(
            "SECURITY_ALERT_STATE_INVALID",
            "Only acknowledged alerts can be resolved.",
          );
        const now = new Date();
        const updated = await tx.securityAlert.update({
          where: { id: alert.id },
          data: {
            status: target,
            revision: { increment: 1 },
            ...(target === "ACKNOWLEDGED"
              ? {
                  acknowledgedById: principal.userId,
                  acknowledgedAt: now,
                  acknowledgementReason: input.reason,
                }
              : {
                  resolvedById: principal.userId,
                  resolvedAt: now,
                  resolutionReason: input.reason,
                }),
            events: {
              create: {
                type: target,
                actorId: principal.userId,
                reason: input.reason,
                occurredAt: now,
              },
            },
          },
        });
        return {
          entityType: "security_alert",
          entityId: alert.id,
          eventType: `security.alert.${target.toLowerCase()}`,
          reason: input.reason,
          branchId: alert.branchId ?? undefined,
          response: json({
            id: updated.id,
            status: updated.status,
            revision: updated.revision,
            updatedAt: updated.updatedAt.toISOString(),
          }),
          metadata: {
            code: alert.code,
            fromStatus: alert.status,
            toStatus: target,
          },
        };
      },
    );
  }

  private fingerprint(
    organizationId: string,
    code: string,
    branchId: string | null,
    subject: string,
  ) {
    return createHash("sha256")
      .update(
        `${organizationId}:${branchId ?? "ORGANIZATION"}:${code}:${subject}`,
      )
      .digest("hex");
  }

  private async assertOptionalBranch(
    branchId: string | undefined,
    organizationId: string,
  ) {
    if (!branchId) return;
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException({ code: "BRANCH_NOT_FOUND" });
  }

  private organizationPermission(principal: AuthPrincipal, permission: string) {
    if (!hasPermission(principal, permission))
      throw new ForbiddenException({
        code: "ORGANIZATION_PERMISSION_REQUIRED",
        permission,
      });
  }

  private async idempotent(
    scope: string,
    key: string,
    command: unknown,
    principal: AuthPrincipal,
    work: (tx: Tx) => Promise<{
      entityType: string;
      entityId: string;
      eventType: string;
      reason: string;
      response: Prisma.InputJsonValue;
      branchId?: string;
      metadata?: Prisma.InputJsonValue;
    }>,
  ) {
    const hash = requestHash(command);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { actorId_scope_key: { actorId: principal.userId, scope, key } },
    });
    if (existing) {
      if (existing.requestHash !== hash)
        fail("IDEMPOTENCY_KEY_CONFLICT", "The key was reused.");
      return existing.responseBody;
    }
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const result = await work(tx);
          await tx.auditLog.create({
            data: {
              organizationId: principal.organizationId,
              branchId: result.branchId,
              actorId: principal.userId,
              action: scope,
              entityType: result.entityType,
              entityId: result.entityId,
              reason: result.reason,
              metadata: {
                deviceId: principal.deviceId,
                ...((result.metadata as Prisma.InputJsonObject | undefined) ??
                  {}),
              },
            },
          });
          await tx.outboxEvent.create({
            data: {
              aggregateType: result.entityType,
              aggregateId: result.entityId,
              eventType: result.eventType,
              payload: {
                organizationId: principal.organizationId,
                branchId: result.branchId ?? null,
                entityId: result.entityId,
              },
            },
          });
          await tx.idempotencyRecord.create({
            data: {
              actorId: principal.userId,
              scope,
              key,
              requestHash: hash,
              responseBody: result.response,
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
        ["P2002", "P2034"].includes(error.code)
      )
        fail(
          "SECURITY_OPERATION_CONFLICT",
          "The operation conflicted with another change.",
        );
      throw error;
    }
  }
}
