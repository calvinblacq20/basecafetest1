import { z } from "zod";

const identifierSchema = z.string().uuid();
const branchCommandFields = {
  branchId: identifierSchema,
};
const revisionReasonFields = {
  ...branchCommandFields,
  revision: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
};
const strongPasswordSchema = z.string().min(12).max(200);

export const roleScopeSchema = z.enum(["ORGANIZATION", "BRANCH"]);

export const createRoleRequestSchema = z
  .object({
    ...branchCommandFields,
    name: z.string().trim().min(1).max(100),
    scope: roleScopeSchema,
    reason: z.string().trim().min(1).max(500),
    permissionKeys: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
  })
  .refine(
    (value) =>
      new Set(value.permissionKeys).size === value.permissionKeys.length,
    {
      path: ["permissionKeys"],
      message: "Permission keys must be unique.",
    },
  );

export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>;

export const createStaffRequestSchema = z
  .object({
    ...branchCommandFields,
    displayName: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(254),
    initialPassword: strongPasswordSchema,
    reason: z.string().trim().min(1).max(500),
    roleIds: z.array(identifierSchema).min(1).max(20),
  })
  .refine((value) => new Set(value.roleIds).size === value.roleIds.length, {
    path: ["roleIds"],
    message: "Role assignments must be unique.",
  });

export type CreateStaffRequest = z.infer<typeof createStaffRequestSchema>;

export const assignStaffRoleRequestSchema = z.object({
  ...branchCommandFields,
  revision: z.number().int().positive(),
  roleId: identifierSchema,
  reason: z.string().trim().min(1).max(500),
});

export type AssignStaffRoleRequest = z.infer<
  typeof assignStaffRoleRequestSchema
>;

export const disableStaffRequestSchema = z.object(revisionReasonFields);

export type DisableStaffRequest = z.infer<typeof disableStaffRequestSchema>;

export const reactivateStaffRequestSchema = z.object(revisionReasonFields);

export type ReactivateStaffRequest = z.infer<
  typeof reactivateStaffRequestSchema
>;

export const removeStaffRoleRequestSchema = z.object(revisionReasonFields);

export type RemoveStaffRoleRequest = z.infer<
  typeof removeStaffRoleRequestSchema
>;

export const createDeviceRequestSchema = z.object({
  ...branchCommandFields,
  name: z.string().trim().min(1).max(120),
});

export type CreateDeviceRequest = z.infer<typeof createDeviceRequestSchema>;

export const activateDeviceRequestSchema = z.object({
  ...revisionReasonFields,
  fingerprintHash: z.string().regex(/^[a-f0-9]{64}$/i),
});

export type ActivateDeviceRequest = z.infer<typeof activateDeviceRequestSchema>;

export const revokeDeviceRequestSchema = z.object(revisionReasonFields);

export type RevokeDeviceRequest = z.infer<typeof revokeDeviceRequestSchema>;

export const permissionResponseSchema = z.object({
  key: z.string().min(1).max(120),
  description: z.string().min(1).max(240),
});
export type PermissionResponse = z.infer<typeof permissionResponseSchema>;

export const roleResponseSchema = z.object({
  id: identifierSchema,
  name: z.string().min(1).max(100),
  scope: roleScopeSchema,
  isSystem: z.boolean(),
  permissionKeys: z.array(z.string().min(1).max(120)),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RoleResponse = z.infer<typeof roleResponseSchema>;

export const staffResponseSchema = z.object({
  id: identifierSchema,
  email: z.string().email(),
  displayName: z.string().min(1).max(120),
  status: z.enum(["ACTIVE", "DISABLED"]),
  mustChangePassword: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  assignments: z.array(
    z.object({
      id: identifierSchema,
      branchId: identifierSchema.nullable(),
      assignedAt: z.string().datetime(),
      revokedAt: z.string().datetime().nullable(),
      revokedById: identifierSchema.nullable(),
      revocationReason: z.string().max(500).nullable(),
      role: z.object({
        id: identifierSchema,
        name: z.string().min(1).max(100),
        scope: roleScopeSchema,
      }),
    }),
  ),
});
export type StaffResponse = z.infer<typeof staffResponseSchema>;

export const deviceResponseSchema = z.object({
  id: identifierSchema,
  branchId: identifierSchema,
  name: z.string().min(1).max(120),
  status: z.enum(["PENDING", "ACTIVE", "REVOKED"]),
  revision: z.number().int().positive(),
  fingerprintBound: z.boolean(),
  enrolledAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DeviceResponse = z.infer<typeof deviceResponseSchema>;

export const permissionListResponseSchema = z.array(permissionResponseSchema);
export const roleListResponseSchema = z.array(roleResponseSchema);
export const staffListResponseSchema = z.array(staffResponseSchema);
export const deviceListResponseSchema = z.array(deviceResponseSchema);

export const changePasswordRequestSchema = z
  .object({
    currentPassword: strongPasswordSchema,
    newPassword: strongPasswordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ["newPassword"],
    message: "The new password must differ from the current password.",
  });

export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
