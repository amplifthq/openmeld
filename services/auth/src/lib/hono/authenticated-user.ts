import type { Context } from "hono";
import type { AppContext } from "../context";

type AuthenticatedUser = NonNullable<AppContext["Variables"]["user"]>;

export type RequireAuthenticatedUserResult =
  | {
      ok: true;
      user: AuthenticatedUser;
    }
  | {
      ok: false;
      response: Response;
    };

export function requireAuthenticatedUser(
  c: Context<AppContext>
): RequireAuthenticatedUserResult {
  const user = c.var.user;
  if (!user) {
    return {
      ok: false,
      response: c.json(
        {
          ok: false,
          code: "auth.unauthenticated",
          message: "authentication required",
        },
        401
      ),
    };
  }

  return {
    ok: true,
    user,
  };
}
