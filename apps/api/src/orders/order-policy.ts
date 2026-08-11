import type {
  OrderChannel,
  OrderLineStatus,
  OrderStatus,
} from "@prisma/client";

export function officialOrderNumber(businessDate: Date, sequence: number) {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999_999)
    throw new RangeError("Order sequence must be between 1 and 999999.");
  return `${businessDate.toISOString().slice(0, 10).replaceAll("-", "")}-${String(sequence).padStart(4, "0")}`;
}

export function orderTransitionAllowed(from: OrderStatus, to: OrderStatus) {
  return (
    (from === "OPEN" && (to === "HELD" || to === "CANCELLED")) ||
    (from === "HELD" && (to === "OPEN" || to === "CANCELLED"))
  );
}

export function lineTransitionAllowed(
  from: OrderLineStatus,
  to: OrderLineStatus,
) {
  return from === "DRAFT" && (to === "REPLACED" || to === "REMOVED");
}

export function customerDataVisible<
  T extends { customerPhone: string | null; deliveryDirections: string | null },
>(order: T, allowed: boolean) {
  return allowed
    ? order
    : { ...order, customerPhone: null, deliveryDirections: null };
}

export function validateChannelFacts(
  channel: OrderChannel,
  input: {
    tableId?: string | null;
    guestCount?: number | null;
    customerReference?: string | null;
    tabName?: string | null;
  },
) {
  if (channel === "PHONE_DELIVERY" && !input.customerReference)
    return "PHONE_DELIVERY_CUSTOMER_REFERENCE_REQUIRED" as const;
  if (channel === "BAR_TAB" && !input.tabName)
    return "BAR_TAB_NAME_REQUIRED" as const;
  if (!["DINE_IN", "BAR_TAB"].includes(channel) && input.tableId)
    return "ORDER_CHANNEL_TABLE_INVALID" as const;
  if (channel !== "DINE_IN" && input.guestCount)
    return "ORDER_CHANNEL_GUEST_COUNT_INVALID" as const;
  return null;
}

export function assignFreeSelections<
  T extends { id: string; deltaMinor: number; quantity: number },
>(selections: readonly T[], freeSelectionCount: number) {
  const expanded = selections.flatMap((selection) =>
    Array.from({ length: selection.quantity }, (_, index) => ({
      selection,
      index,
    })),
  );
  const deltas = new Set(expanded.map(({ selection }) => selection.deltaMinor));
  if (
    freeSelectionCount > 0 &&
    (deltas.size > 1 || [...deltas].some((value) => value < 0))
  )
    return { issue: "MODIFIER_FREE_SELECTION_POLICY_UNCONFIRMED" as const };
  expanded.sort(
    (a, b) => a.selection.id.localeCompare(b.selection.id) || a.index - b.index,
  );
  const freeById = new Map<string, number>();
  expanded
    .slice(0, freeSelectionCount)
    .forEach(({ selection }) =>
      freeById.set(selection.id, (freeById.get(selection.id) ?? 0) + 1),
    );
  return {
    selections: selections.map((selection) => {
      const freeQuantity = freeById.get(selection.id) ?? 0;
      return {
        ...selection,
        freeQuantity,
        chargedDeltaMinor:
          selection.deltaMinor * (selection.quantity - freeQuantity),
      };
    }),
  };
}
