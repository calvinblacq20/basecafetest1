import {
  resolveSyncCommandRequestSchema,
  syncRecoveryListResponseSchema,
} from "../src/sync";
import { describe, expect, it } from "vitest";

const id = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

describe("sync recovery contracts", () => {
  it("requires an applied successor identifier only for supersession", () => {
    expect(
      resolveSyncCommandRequestSchema.safeParse({
        branchId: id(1),
        action: "SUPERSEDED_BY_COMMAND",
        reason: "Corrected by a later command.",
      }).success,
    ).toBe(false);
    expect(
      resolveSyncCommandRequestSchema.parse({
        branchId: id(1),
        action: "SUPERSEDED_BY_COMMAND",
        successorCommandId: id(2),
        reason: "Corrected by a later command.",
      }).successorCommandId,
    ).toBe(id(2));
  });

  it("serializes bigint sequences as stable decimal strings", () => {
    expect(
      syncRecoveryListResponseSchema.parse({
        generatedAt: "2026-08-07T12:00:00.000Z",
        items: [
          {
            commandId: id(2),
            aggregateId: id(3),
            commandType: "ORDER_HOLD",
            status: "CONFLICT",
            errorCode: "STALE_REVISION",
            localSequence: "42",
            deviceCreatedAt: "2026-08-07T11:59:00.000Z",
            receivedAt: "2026-08-07T12:00:00.000Z",
            resolution: null,
          },
        ],
      }).items[0]?.localSequence,
    ).toBe("42");
  });
});
