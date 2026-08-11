import { z } from "zod";

const identifierSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(1).max(500);
const moneyMinorSchema = z.number().int().min(0).max(2_147_483_647);

export const cashDenominationSchema = z.object({
  denominationMinor: z.number().int().positive().max(2_147_483_647),
  count: z.number().int().min(0).max(1_000_000),
});

function denominationTotal(
  lines: readonly { denominationMinor: number; count: number }[],
): number {
  return lines.reduce(
    (total, line) => total + line.denominationMinor * line.count,
    0,
  );
}

export const openShiftRequestSchema = z
  .object({
    shiftId: identifierSchema,
    branchId: identifierSchema,
    drawerKey: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
      .nullable()
      .optional(),
    openingFloatMinor: moneyMinorSchema,
    denominations: z.array(cashDenominationSchema).max(50).optional(),
    reason: reasonSchema,
  })
  .superRefine((value, context) => {
    if (
      value.denominations !== undefined &&
      denominationTotal(value.denominations) !== value.openingFloatMinor
    ) {
      context.addIssue({
        code: "custom",
        path: ["denominations"],
        message: "Opening denominations must equal the opening float.",
      });
    }
  });

export type OpenShiftRequest = z.infer<typeof openShiftRequestSchema>;

export const handoverShiftRequestSchema = z.object({
  branchId: identifierSchema,
  revision: z.number().int().positive(),
  receivingCashierId: identifierSchema,
  reason: reasonSchema,
});

export type HandoverShiftRequest = z.infer<typeof handoverShiftRequestSchema>;

export const closeShiftRequestSchema = z
  .object({
    branchId: identifierSchema,
    revision: z.number().int().positive(),
    countedCashMinor: moneyMinorSchema,
    denominations: z.array(cashDenominationSchema).max(50).optional(),
    declaration: z.string().trim().min(1).max(500),
    reason: reasonSchema,
  })
  .superRefine((value, context) => {
    if (
      value.denominations !== undefined &&
      denominationTotal(value.denominations) !== value.countedCashMinor
    ) {
      context.addIssue({
        code: "custom",
        path: ["denominations"],
        message: "Closing denominations must equal counted cash.",
      });
    }
  });

export type CloseShiftRequest = z.infer<typeof closeShiftRequestSchema>;
