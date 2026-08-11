import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { AuthenticatedRequest } from "./auth-request.js";
import { hasAnyScopePermission } from "./auth.types.js";
import { REQUIRED_PERMISSIONS_KEY } from "./require-permissions.decorator.js";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permissions = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!permissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user.mustChangePassword) {
      throw new ForbiddenException(
        "A password change is required before protected actions.",
      );
    }

    const allowed = permissions.every((permission) =>
      hasAnyScopePermission(request.user, permission),
    );

    if (!allowed) {
      throw new ForbiddenException("The user lacks a required permission.");
    }

    return true;
  }
}
