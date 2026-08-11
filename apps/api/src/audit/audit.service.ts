import type { AuditReviewQuery } from "@base-cafe/contracts";
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { AuditOutcome, Prisma } from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { PrismaService } from "../database/prisma.service.js";
import { renderCsv } from "../reports/report-csv.js";

export type AuditEvent = Readonly<{
  organizationId: string;
  branchId?: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  outcome?: AuditOutcome;
  reason?: string;
  metadata?: Prisma.InputJsonValue;
}>;

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(event: AuditEvent): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        organizationId: event.organizationId,
        branchId: event.branchId,
        actorId: event.actorId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        outcome: event.outcome,
        reason: event.reason,
        metadata: event.metadata,
      },
    });
  }

  async list(query: AuditReviewQuery, principal: AuthPrincipal) {
    const branchFilter = this.branchFilter(principal, query.branchId);
    const cursor = query.cursor
      ? await this.prisma.auditLog.findFirst({
          where: {
            id: query.cursor,
            organizationId: principal.organizationId,
            ...branchFilter,
          },
          select: { id: true, occurredAt: true },
        })
      : null;
    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId: principal.organizationId,
        ...branchFilter,
        action: query.action,
        outcome: query.outcome,
        actorId: query.actorId,
        entityType: query.entityType,
        occurredAt: {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(query.to) : undefined,
        },
        ...(cursor && {
          OR: [
            { occurredAt: { lt: cursor.occurredAt } },
            { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
          ],
        }),
      },
      include: {
        actor: { select: { id: true, displayName: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map((event) => ({
      id: event.id,
      branch: event.branch,
      actor: event.actor,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      outcome: event.outcome,
      reason: event.reason,
      metadata: sanitizeAuditMetadata(event.metadata),
      occurredAt: event.occurredAt.toISOString(),
    }));
    return {
      generatedAt: new Date().toISOString(),
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async export(query: AuditReviewQuery, principal: AuthPrincipal) {
    if (!hasPermission(principal, "audit.export"))
      throw new ForbiddenException({
        code: "AUDIT_EXPORT_PERMISSION_REQUIRED",
      });
    const page = await this.list(
      { ...query, limit: Math.min(query.limit, 200) },
      principal,
    );
    const content = renderCsv(
      [
        "occurred_at",
        "action",
        "outcome",
        "actor_id",
        "actor_name",
        "branch_id",
        "branch_name",
        "entity_type",
        "entity_id",
        "reason",
        "metadata_json",
      ],
      page.items.map((event) => ({
        occurred_at: event.occurredAt,
        action: event.action,
        outcome: event.outcome,
        actor_id: event.actor?.id,
        actor_name: event.actor?.displayName,
        branch_id: event.branch?.id,
        branch_name: event.branch?.name,
        entity_type: event.entityType,
        entity_id: event.entityId,
        reason: event.reason,
        metadata_json: stableJson(event.metadata),
      })),
    );
    await this.prisma.auditLog.create({
      data: {
        organizationId: principal.organizationId,
        actorId: principal.userId,
        action: "audit.export",
        entityType: "audit_log",
        reason: "Authorized bounded audit CSV export.",
        metadata: {
          deviceId: principal.deviceId,
          branchId: query.branchId ?? null,
          rowCount: page.items.length,
          from: query.from ?? null,
          to: query.to ?? null,
        },
      },
    });
    return {
      filename: `base-cafe-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      content,
    };
  }

  private branchFilter(principal: AuthPrincipal, requested?: string) {
    const organizationAccess = hasPermission(principal, "audit.read");
    const allowed = principal.assignments
      .filter(
        (assignment) =>
          assignment.scope === "BRANCH" &&
          assignment.branchId &&
          assignment.permissions.includes("audit.read"),
      )
      .map(({ branchId }) => branchId as string);
    if (requested && !organizationAccess && !allowed.includes(requested))
      throw new ForbiddenException({
        code: "AUDIT_BRANCH_PERMISSION_REQUIRED",
      });
    if (requested) return { branchId: requested };
    if (organizationAccess) return {};
    return { branchId: { in: allowed } };
  }
}

const sensitiveKey =
  /(phone|email|direction|address|password|token|secret|credential|pin|evidence|external.*reference)/i;

function sanitizeAuditMetadata(
  value: Prisma.JsonValue | null | undefined,
  depth = 0,
): Prisma.JsonValue | null {
  if (value === undefined) return null;
  if (value === null || depth > 4) return value;
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value))
    return value
      .slice(0, 100)
      .map((entry) => sanitizeAuditMetadata(entry, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [
        key,
        sensitiveKey.test(key)
          ? "[REDACTED]"
          : sanitizeAuditMetadata(entry, depth + 1),
      ]),
  );
}

function stableJson(value: Prisma.JsonValue | null | undefined) {
  return JSON.stringify(sanitizeAuditMetadata(value));
}
