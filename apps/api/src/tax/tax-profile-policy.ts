export type TaxProfileActivationIssue =
  "APPROVAL_NOT_RECORDED" | "ALREADY_EXPIRED" | null;

export function taxProfileActivationIssue(input: {
  status: "DRAFT" | "CONFIRMED" | "ACTIVE";
  approvalReference: string | null;
  confirmationRecordedById: string | null;
  confirmedAt: Date | null;
  effectiveTo: Date | null;
  now: Date;
}): TaxProfileActivationIssue {
  if (
    input.status !== "CONFIRMED" ||
    !input.approvalReference ||
    !input.confirmationRecordedById ||
    !input.confirmedAt
  ) {
    return "APPROVAL_NOT_RECORDED";
  }
  if (input.effectiveTo && input.effectiveTo <= input.now) {
    return "ALREADY_EXPIRED";
  }
  return null;
}

export function taxProfileIntervalsOverlap(
  left: { effectiveFrom: Date; effectiveTo: Date | null },
  right: { effectiveFrom: Date; effectiveTo: Date | null },
): boolean {
  return (
    (!left.effectiveTo || right.effectiveFrom < left.effectiveTo) &&
    (!right.effectiveTo || left.effectiveFrom < right.effectiveTo)
  );
}
