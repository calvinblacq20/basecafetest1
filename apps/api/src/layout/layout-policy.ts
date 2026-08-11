export function diningAreaDeactivationIssue(
  activeTableCount: number,
): "ACTIVE_TABLES" | null {
  return activeTableCount > 0 ? "ACTIVE_TABLES" : null;
}

export function diningTableActivationIssue(
  tableActive: boolean,
  areaActive: boolean,
): "ALREADY_ACTIVE" | "AREA_INACTIVE" | null {
  if (tableActive) return "ALREADY_ACTIVE";
  if (!areaActive) return "AREA_INACTIVE";
  return null;
}
