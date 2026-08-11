import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";

export function ungrantablePermissions(
  principal: AuthPrincipal,
  permissionKeys: readonly string[],
  scope: "ORGANIZATION" | "BRANCH",
  branchId: string,
): string[] {
  return permissionKeys.filter((permission) =>
    scope === "ORGANIZATION"
      ? !hasPermission(principal, permission)
      : !hasPermission(principal, permission, branchId),
  );
}
export function roleRemovalIssue(
  actorId: string,
  targetUserId: string,
  activeAssignmentCount: number,
): "SELF_REMOVAL" | "LAST_ACTIVE_ASSIGNMENT" | null {
  if (actorId === targetUserId) return "SELF_REMOVAL";
  if (activeAssignmentCount <= 1) return "LAST_ACTIVE_ASSIGNMENT";
  return null;
}
