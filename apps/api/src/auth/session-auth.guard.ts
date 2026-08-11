import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

import { PrismaService } from "../database/prisma.service.js";
import type { AuthenticatedRequest } from "./auth-request.js";
import { hashSessionToken } from "./token.js";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";

    if (!token) {
      throw new UnauthorizedException("A bearer session token is required.");
    }

    const session = await this.prisma.session.findFirst({
      where: {
        tokenHash: hashSessionToken(token),
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
        user: { status: "ACTIVE" },
        device: { status: "ACTIVE" },
      },
      include: {
        user: {
          include: {
            roles: {
              where: { revokedAt: null },
              include: {
                role: { include: { permissions: true } },
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new UnauthorizedException("The session is invalid or expired.");
    }

    const now = new Date();
    if (now.getTime() - session.lastUsedAt.getTime() >= 5 * 60_000) {
      await this.prisma.session.updateMany({
        where: { id: session.id, revision: session.revision, status: "ACTIVE" },
        data: { lastUsedAt: now, revision: { increment: 1 } },
      });
    }

    request.user = {
      userId: session.user.id,
      organizationId: session.user.organizationId,
      deviceId: session.deviceId,
      displayName: session.user.displayName,
      email: session.user.email,
      mustChangePassword: session.user.mustChangePassword,
      assignments: session.user.roles.map((assignment) => ({
        branchId: assignment.branchId,
        scope: assignment.role.scope,
        permissions: assignment.role.permissions.map(
          ({ permissionKey }) => permissionKey,
        ),
      })),
    };

    return true;
  }
}
