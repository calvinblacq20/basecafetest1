import type { PreparationTicketStatus } from "@prisma/client";

export type RoutableModifier = Readonly<{
  id: string;
  quantity: number;
  modifierNameSnapshot: string;
  modifierGroupNameSnapshot: string;
  stationId: string | null;
  stationNameSnapshot: string | null;
}>;

export type RoutableLine = Readonly<{
  id: string;
  quantity: number;
  itemNameSnapshot: string;
  variantNameSnapshot: string | null;
  note: string | null;
  stationId: string | null;
  stationNameSnapshot: string | null;
  modifiers: readonly RoutableModifier[];
}>;

export type RoutedEntry =
  | Readonly<{
      kind: "ITEM";
      orderLineId: string;
      orderLineModifierId: null;
      quantity: number;
      itemNameSnapshot: string;
      variantNameSnapshot: string | null;
      modifierNameSnapshot: null;
      modifierGroupSnapshot: null;
      modifierSummary: readonly Readonly<{
        name: string;
        group: string;
        quantity: number;
      }>[];
      noteSnapshot: string | null;
    }>
  | Readonly<{
      kind: "MODIFIER";
      orderLineId: string;
      orderLineModifierId: string;
      quantity: number;
      itemNameSnapshot: string;
      variantNameSnapshot: string | null;
      modifierNameSnapshot: string;
      modifierGroupSnapshot: string;
      modifierSummary: null;
      noteSnapshot: string | null;
    }>;

export function routePreparationEntries(lines: readonly RoutableLine[]) {
  const stations = new Map<
    string,
    { stationName: string; entries: RoutedEntry[] }
  >();
  for (const line of lines) {
    if (!line.stationId || !line.stationNameSnapshot) {
      return { issue: "PREPARATION_STATION_MISSING" as const };
    }
    const localModifiers = line.modifiers.filter(
      (modifier) =>
        !modifier.stationId || modifier.stationId === line.stationId,
    );
    const itemStation = stations.get(line.stationId) ?? {
      stationName: line.stationNameSnapshot,
      entries: [],
    };
    itemStation.entries.push({
      kind: "ITEM",
      orderLineId: line.id,
      orderLineModifierId: null,
      quantity: line.quantity,
      itemNameSnapshot: line.itemNameSnapshot,
      variantNameSnapshot: line.variantNameSnapshot,
      modifierNameSnapshot: null,
      modifierGroupSnapshot: null,
      modifierSummary: localModifiers.map((modifier) => ({
        name: modifier.modifierNameSnapshot,
        group: modifier.modifierGroupNameSnapshot,
        quantity: modifier.quantity,
      })),
      noteSnapshot: line.note,
    });
    stations.set(line.stationId, itemStation);

    for (const modifier of line.modifiers) {
      if (!modifier.stationId || modifier.stationId === line.stationId)
        continue;
      if (!modifier.stationNameSnapshot) {
        return { issue: "PREPARATION_STATION_MISSING" as const };
      }
      const modifierStation = stations.get(modifier.stationId) ?? {
        stationName: modifier.stationNameSnapshot,
        entries: [],
      };
      modifierStation.entries.push({
        kind: "MODIFIER",
        orderLineId: line.id,
        orderLineModifierId: modifier.id,
        quantity: line.quantity * modifier.quantity,
        itemNameSnapshot: line.itemNameSnapshot,
        variantNameSnapshot: line.variantNameSnapshot,
        modifierNameSnapshot: modifier.modifierNameSnapshot,
        modifierGroupSnapshot: modifier.modifierGroupNameSnapshot,
        modifierSummary: null,
        noteSnapshot: line.note,
      });
      stations.set(modifier.stationId, modifierStation);
    }
  }
  return { stations };
}

export function ticketTransitionAllowed(
  from: PreparationTicketStatus,
  to: PreparationTicketStatus,
) {
  return (
    (from === "QUEUED" && to === "PREPARING") ||
    (from === "PREPARING" && to === "READY") ||
    (from === "READY" && to === "COMPLETED")
  );
}
