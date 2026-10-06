import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { requireActiveAccount } from "../account/active-account";

/** Cached cookies and secondary session storage cannot revive a deleted account. */
export function createActiveAccountPlugin(
  db: PostgresDatabase
): BetterAuthPlugin {
  return {
    id: "openmeld-active-account",
    hooks: {
      before: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (context) => {
            if (context.path === "/sign-out") {
              return;
            }
            const session = await getSessionFromCtx(context, {
              disableRefresh: true,
            });
            if (session) {
              await requireActiveAccount(db, session.user.id);
            }
          }),
        },
      ],
    },
  };
}
