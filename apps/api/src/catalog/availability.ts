export type AvailabilityInput = Readonly<{
  isAvailable: boolean;
  unavailableFrom?: string | null;
  unavailableTo?: string | null;
  unavailableReason?: string | null;
}>;

export function availabilityIssue(input: AvailabilityInput): string | null {
  if (!input.isAvailable && !input.unavailableReason?.trim()) {
    return "An unavailable catalog entry requires a reason.";
  }

  if (
    input.unavailableFrom &&
    input.unavailableTo &&
    new Date(input.unavailableTo).getTime() <=
      new Date(input.unavailableFrom).getTime()
  ) {
    return "The unavailable end must be after the start.";
  }

  return null;
}

export function availabilityData(input: AvailabilityInput) {
  return {
    isAvailable: input.isAvailable,
    unavailableFrom: input.unavailableFrom
      ? new Date(input.unavailableFrom)
      : null,
    unavailableTo: input.unavailableTo ? new Date(input.unavailableTo) : null,
    unavailableReason: input.unavailableReason?.trim() || null,
  };
}
