import type { SpaceOwnerDepartureWorker } from "@openmeld/schemas";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { requireSpaceOwnershipHandoff } from "../organization/space-owner-departure";

export function createSpaceOwnerDeparturePlugin(input: {
  coreWorker?: SpaceOwnerDepartureWorker;
  db?: D1Database;
}): BetterAuthPlugin {
  return {
    id: "openmeld-space-owner-departure",
    hooks: {
      before: [
        {
          matcher: (context) =>
            context.path === "/organization/leave" ||
            context.path === "/delete-user",
          handler: createAuthMiddleware(async (context) => {
            const session = await getSessionFromCtx(context);
            if (!session) {
              return;
            }
            if (context.path === "/organization/leave") {
              const organizationId = context.body?.organizationId;
              if (
                typeof organizationId === "string" &&
                organizationId.length > 0
              ) {
                await requireSpaceOwnershipHandoff({
                  coreWorker: input.coreWorker,
                  organizationId,
                  userId: session.user.id,
                });
              }
              return;
            }
            if (!input.db) {
              throw new APIError("SERVICE_UNAVAILABLE", {
                code: "space.ownership_unavailable",
                message: "Couldn't check Space ownership. Try again.",
              });
            }
            const memberships = await input.db
              .prepare("SELECT organization_id FROM members WHERE user_id = ?")
              .bind(session.user.id)
              .all<{ organization_id: string }>();
            for (const membership of memberships.results) {
              await requireSpaceOwnershipHandoff({
                coreWorker: input.coreWorker,
                organizationId: membership.organization_id,
                userId: session.user.id,
              });
            }
          }),
        },
      ],
    },
  };
}
