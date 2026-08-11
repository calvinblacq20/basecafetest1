import { z } from "zod";

const reason = z.string().trim().min(3).max(500);

export const totpCodeSchema = z.string().regex(/^\d{6}$/);
export const recoveryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/i)
  .transform((value) => value.toUpperCase());

export const mfaEnrollmentRequestSchema = z.object({
  currentPassword: z.string().min(12).max(200),
  reason,
});
export type MfaEnrollmentRequest = z.infer<typeof mfaEnrollmentRequestSchema>;

export const mfaActivationRequestSchema = z.object({
  code: totpCodeSchema,
  revision: z.number().int().positive(),
  reason,
});
export type MfaActivationRequest = z.infer<typeof mfaActivationRequestSchema>;

export const mfaPendingResetRequestSchema = z.object({
  currentPassword: z.string().min(12).max(200),
  revision: z.number().int().positive(),
  reason,
});
export type MfaPendingResetRequest = z.infer<
  typeof mfaPendingResetRequestSchema
>;

export const mfaDisableRequestSchema = z
  .object({
    currentPassword: z.string().min(12).max(200),
    code: totpCodeSchema.optional(),
    recoveryCode: recoveryCodeSchema.optional(),
    revision: z.number().int().positive(),
    reason,
  })
  .refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), {
    message: "Provide exactly one TOTP or recovery code.",
  });
export type MfaDisableRequest = z.infer<typeof mfaDisableRequestSchema>;

export const mfaStatusResponseSchema = z.object({
  enrollmentEnabled: z.boolean(),
  enforcementEnabled: z.boolean(),
  status: z.enum(["NOT_ENROLLED", "PENDING", "ACTIVE", "DISABLED"]),
  revision: z.number().int().positive().nullable(),
  recoveryCodesRemaining: z.number().int().nonnegative(),
});
export type MfaStatusResponse = z.infer<typeof mfaStatusResponseSchema>;

export const mfaEnrollmentResponseSchema = z.object({
  status: z.literal("PENDING"),
  revision: z.number().int().positive(),
  manualEntryKey: z.string().regex(/^[A-Z2-7]+$/),
  otpauthUri: z.string().startsWith("otpauth://totp/"),
  recoveryCodes: z.array(recoveryCodeSchema).length(8),
});
export type MfaEnrollmentResponse = z.infer<typeof mfaEnrollmentResponseSchema>;

export const mfaActivationResponseSchema = z.object({
  active: z.literal(true),
  revision: z.number().int().positive(),
});
export type MfaActivationResponse = z.infer<typeof mfaActivationResponseSchema>;

export const mfaDisableResponseSchema = z.object({
  disabled: z.literal(true),
  revision: z.number().int().positive(),
});
export type MfaDisableResponse = z.infer<typeof mfaDisableResponseSchema>;
