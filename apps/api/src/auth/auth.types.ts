export type PermissionAssignment = Readonly<{
  branchId: string | null;
  scope: "ORGANIZATION" | "BRANCH";
  permissions: readonly string[];
}>;

export type AuthPrincipal = Readonly<{
  userId: string;
  organizationId: string;
  deviceId: string;
  displayName: string;
  email: string;
  mustChangePassword: boolean;
  assignments: readonly PermissionAssignment[];
}>;

export function hasPermission(
  principal: AuthPrincipal,
  permission: string,
  branchId?: string,
): boolean {
  return principal.assignments.some(
    (assignment) =>
      assignment.permissions.includes(permission) &&
      (assignment.scope === "ORGANIZATION" ||
        (branchId !== undefined && assignment.branchId === branchId)),
  );
}

export function hasAnyScopePermission(
  principal: AuthPrincipal,
  permission: string,
): boolean {
  return principal.assignments.some((assignment) =>
    assignment.permissions.includes(permission),
  );
}
