import type { DelegatedAccess, AuthenticatedUser } from "@tinyboilerplate/server";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      delegatedAccess?: DelegatedAccess;
    }
  }
}
