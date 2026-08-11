import type {
  AuditIntegrityBatchListQuery,
  CreateAuditIntegrityBatchRequest,
  VerifyAuditIntegrityRequest,
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
import {
  AUDIT_INTEGRITY_GENESIS_HASH,
  hashAuditBatch,
  type IntegrityAuditEvent,
} from "./audit-integrity-hash.js";

type Tx = Prisma.TransactionClient;

function asJson(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function batchResponse(batch: {
  id: string;
  sequence: number;
  algorithm: string;
  schemaVersion: number;
  previousHash: string;
  batchHash: string;
  eventCount: number;
  firstEventId: string;
  firstEventOccurredAt: Date;
  lastEventId: string;
  lastEventOccurredAt: Date;
  throughAt: Date;
  createdById: string;
  reason: string;
  createdAt: Date;
}) {
  return {
    ...batch,
    firstEventOccurredAt: batch.firstEventOccurredAt.toISOString(),
    lastEventOccurredAt: batch.lastEventOccurredAt.toISOString(),
    throughAt: batch.throughAt.toISOString(),
    createdAt: batch.createdAt.toISOString(),
  };
}

@Injectable()
export class AuditIntegrityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: AuditIntegrityBatchListQuery, principal: AuthPrincipal) {
    this.assertPermission(principal, "audit.integrity.read");
    const cursor = query.cursor
      ? await this.prisma.auditIntegrityBatch.findFirst({
          where: { id: query.cursor, organizationId: principal.organizationId },
          select: { sequence: true },
        })
      : null;
    const rows = await this.prisma.auditIntegrityBatch.findMany({
      where: {
        organizationId: principal.organizationId,
        sequence: cursor ? { lt: cursor.sequence } : undefined,
      },
      include: { createdBy: { select: { id: true, displayName: true } } },
      orderBy: { sequence: "desc" },
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map((row) => ({
      ...batchResponse(row),
      createdBy: row.createdBy,
    }));
    return {
      generatedAt: new Date().toISOString(),
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async create(
    input: CreateAuditIntegrityBatchRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "audit.integrity.manage");
    const throughAt = new Date(input.through);
    if (throughAt.getTime() > Date.now())
      throw new ConflictException({ code: "AUDIT_INTEGRITY_THROUGH_FUTURE" });
    return this.idempotent(
      "audit.integrity.batch.create",
      key,
      input,
      principal,
      async (tx) => {
        const previous = await tx.auditIntegrityBatch.findFirst({
          where: { organizationId: principal.organizationId },
          orderBy: { sequence: "desc" },
        });
        const events = await tx.auditLog.findMany({
          where: {
            organizationId: principal.organizationId,
            occurredAt: {
              lte: throughAt,
              gte: previous?.lastEventOccurredAt,
            },
            ...(previous && {
              NOT: {
                AND: [
                  { occurredAt: previous.lastEventOccurredAt },
                  { id: { lte: previous.lastEventId } },
                ],
              },
            }),
          },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          take: input.maxEvents,
        });
        if (events.length === 0)
          throw new ConflictException({ code: "AUDIT_INTEGRITY_NO_EVENTS" });
        const sequence = (previous?.sequence ?? 0) + 1;
        const previousHash =
          previous?.batchHash ?? AUDIT_INTEGRITY_GENESIS_HASH;
        const batchHash = hashAuditBatch({
          organizationId: principal.organizationId,
          sequence,
          previousHash,
          events,
        });
        const first = events[0]!;
        const last = events.at(-1)!;
        const batch = await tx.auditIntegrityBatch.create({
          data: {
            id: input.batchId,
            organizationId: principal.organizationId,
            sequence,
            previousHash,
            batchHash,
            eventCount: events.length,
            firstEventId: first.id,
            firstEventOccurredAt: first.occurredAt,
            lastEventId: last.id,
            lastEventOccurredAt: last.occurredAt,
            throughAt,
            createdById: principal.userId,
            reason: input.reason,
          },
        });
        return {
          entityId: batch.id,
          reason: input.reason,
          eventType: "audit.integrity.batch.created",
          response: batchResponse(batch),
          metadata: { sequence, eventCount: events.length, batchHash },
        };
      },
    );
  }

  async verify(
    input: VerifyAuditIntegrityRequest,
    key: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, "audit.integrity.read");
    return this.idempotent(
      "audit.integrity.verify",
      key,
      input,
      principal,
      async (tx) => {
        const predecessor =
          input.fromSequence > 1
            ? await tx.auditIntegrityBatch.findUnique({
                where: {
                  organizationId_sequence: {
                    organizationId: principal.organizationId,
                    sequence: input.fromSequence - 1,
                  },
                },
              })
            : null;
        const batches = await tx.auditIntegrityBatch.findMany({
          where: {
            organizationId: principal.organizationId,
            sequence: { gte: input.fromSequence },
          },
          orderBy: { sequence: "asc" },
          take: input.maxBatches + 1,
        });
        const issues: Array<{
          code: string;
          sequence: number;
          batchId: string | null;
        }> = [];
        let prior = predecessor;
        let verifiedBatchCount = 0;
        for (const batch of batches.slice(0, input.maxBatches)) {
          if (
            batch.algorithm !== "SHA256" ||
            batch.schemaVersion !== 1 ||
            batch.throughAt < batch.lastEventOccurredAt
          ) {
            issues.push({
              code: "AUDIT_CHAIN_FORMAT_MISMATCH",
              sequence: batch.sequence,
              batchId: batch.id,
            });
            break;
          }
          const expectedSequence = (prior?.sequence ?? 0) + 1;
          const expectedPreviousHash =
            prior?.batchHash ?? AUDIT_INTEGRITY_GENESIS_HASH;
          if (batch.sequence !== expectedSequence) {
            issues.push({
              code: "AUDIT_CHAIN_SEQUENCE_GAP",
              sequence: batch.sequence,
              batchId: batch.id,
            });
            break;
          }
          if (batch.previousHash !== expectedPreviousHash) {
            issues.push({
              code: "AUDIT_CHAIN_PREVIOUS_HASH_MISMATCH",
              sequence: batch.sequence,
              batchId: batch.id,
            });
            break;
          }
          const events = await this.eventsForBatch(
            tx,
            principal.organizationId,
            prior,
            batch,
          );
          const first = events[0];
          const last = events.at(-1);
          if (
            events.length !== batch.eventCount ||
            first?.id !== batch.firstEventId ||
            last?.id !== batch.lastEventId ||
            first?.occurredAt.getTime() !==
              batch.firstEventOccurredAt.getTime() ||
            last?.occurredAt.getTime() !== batch.lastEventOccurredAt.getTime()
          ) {
            issues.push({
              code: "AUDIT_CHAIN_EVENT_RANGE_MISMATCH",
              sequence: batch.sequence,
              batchId: batch.id,
            });
            break;
          }
          const calculated = hashAuditBatch({
            organizationId: principal.organizationId,
            sequence: batch.sequence,
            previousHash: batch.previousHash,
            events,
          });
          if (calculated !== batch.batchHash) {
            issues.push({
              code: "AUDIT_CHAIN_HASH_MISMATCH",
              sequence: batch.sequence,
              batchId: batch.id,
            });
            break;
          }
          verifiedBatchCount += 1;
          prior = batch;
        }
        const status =
          issues.length > 0
            ? "INVALID"
            : batches.length === 0
              ? "EMPTY"
              : batches.length > input.maxBatches
                ? "PARTIAL"
                : "VALID";
        const response = {
          status,
          generatedAt: new Date().toISOString(),
          fromSequence: input.fromSequence,
          throughSequence: verifiedBatchCount
            ? input.fromSequence + verifiedBatchCount - 1
            : null,
          verifiedBatchCount,
          nextSequence:
            status === "PARTIAL"
              ? input.fromSequence + verifiedBatchCount
              : null,
          issues,
        };
        return {
          entityId: prior?.id ?? principal.organizationId,
          reason: input.reason,
          eventType: "audit.integrity.verified",
          response,
          metadata: {
            status,
            fromSequence: input.fromSequence,
            verifiedBatchCount,
            issueCodes: issues.map(({ code }) => code),
          },
        };
      },
    );
  }

  private async eventsForBatch(
    tx: Tx,
    organizationId: string,
    prior: { lastEventOccurredAt: Date; lastEventId: string } | null,
    batch: { lastEventOccurredAt: Date; lastEventId: string },
  ): Promise<IntegrityAuditEvent[]> {
    return tx.auditLog.findMany({
      where: {
        organizationId,
        occurredAt: {
          lte: batch.lastEventOccurredAt,
          gte: prior?.lastEventOccurredAt,
        },
        AND: [
          {
            OR: [
              { occurredAt: { lt: batch.lastEventOccurredAt } },
              {
                occurredAt: batch.lastEventOccurredAt,
                id: { lte: batch.lastEventId },
              },
            ],
          },
          ...(prior
            ? [
                {
                  OR: [
                    { occurredAt: { gt: prior.lastEventOccurredAt } },
                    {
                      occurredAt: prior.lastEventOccurredAt,
                      id: { gt: prior.lastEventId },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 5001,
    });
  }

  private async idempotent(
    scope: string,
    key: string,
    command: unknown,
    principal: AuthPrincipal,
    work: (tx: Tx) => Promise<{
      entityId: string;
      reason: string;
      eventType: string;
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
              entityType: "audit_integrity_batch",
              entityId: result.entityId,
              reason: result.reason,
              metadata: { ...result.metadata, deviceId: principal.deviceId },
            },
          });
          await tx.outboxEvent.create({
            data: {
              aggregateType: "audit_integrity_batch",
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
        throw new ConflictException({ code: "AUDIT_INTEGRITY_CONFLICT" });
      throw error;
    }
  }

  private assertPermission(principal: AuthPrincipal, permission: string) {
    if (!hasPermission(principal, permission))
      throw new ForbiddenException({
        code: "AUDIT_INTEGRITY_ORGANIZATION_PERMISSION_REQUIRED",
      });
  }
}
