import type { PaymentMethod, PaymentStatus } from "@prisma/client";

export function initialPaymentState(
  method: PaymentMethod,
  amountMinor: number,
  tenderedAmountMinor?: number,
): Readonly<{
  status: PaymentStatus;
  changeMinor: number;
  confirmedAt: Date | null;
}> {
  if (method === "CASH") {
    if (tenderedAmountMinor === undefined || tenderedAmountMinor < amountMinor)
      throw new Error("CASH_TENDER_INVALID");
    return {
      status: "CONFIRMED",
      changeMinor: tenderedAmountMinor - amountMinor,
      confirmedAt: new Date(),
    };
  }
  return {
    status: "REQUIRES_VERIFICATION",
    changeMinor: 0,
    confirmedAt: null,
  };
}

export function outstandingMinor(grossMinor: number, confirmedMinor: number) {
  if (
    !Number.isSafeInteger(grossMinor) ||
    !Number.isSafeInteger(confirmedMinor)
  )
    throw new Error("PAYMENT_AMOUNT_OVERFLOW");
  return Math.max(0, grossMinor - confirmedMinor);
}

export function verifiedPaymentState(decision: "CONFIRM" | "FAIL") {
  return decision === "CONFIRM"
    ? ({
        status: "CONFIRMED",
        confirmedAt: new Date(),
        failedAt: null,
      } as const)
    : ({ status: "FAILED", confirmedAt: null, failedAt: new Date() } as const);
}
