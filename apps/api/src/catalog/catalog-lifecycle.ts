export type ItemActivationConfiguration = Readonly<{
  stationConfigured: boolean;
  taxClassActive: boolean;
  effectivePrice: boolean;
}>;

export function itemActivationIssues(
  configuration: ItemActivationConfiguration,
): string[] {
  const issues: string[] = [];
  if (!configuration.stationConfigured) {
    issues.push("An active menu item requires an active production station.");
  }
  if (!configuration.taxClassActive) {
    issues.push("An active menu item requires an approved active tax class.");
  }
  if (!configuration.effectivePrice) {
    issues.push("An active menu item requires an effective base price.");
  }
  return issues;
}
