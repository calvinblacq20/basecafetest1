import type { Request } from "express";

import type { AuthPrincipal } from "./auth.types.js";

export type AuthenticatedRequest = Request & { user: AuthPrincipal };
