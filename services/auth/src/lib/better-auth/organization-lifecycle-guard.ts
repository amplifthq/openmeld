import { requireSpaceOwnershipHandoff } from "@openmeld/auth/server";
import type { SpaceOwnerDepartureWorker } from "@openmeld/schemas";
import {
  type AuthMiddleware,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { createOrganizationDeletionGuard } from "./organization-deletion-guard";

export function createOrganizationLifecycleGuard(
  db: D1Database,
  coreWorker?: SpaceOwnerDepartureWorker
): AuthMiddleware {
  const deletionGuard = createOrganizationDeletionGuard(db);
  return createAuthMiddleware(async (context) => {
    await deletionGuard(context);
    if (
      context.path !== "/organization/leave" &&
      context.path !== "/delete-user"
    ) {
      return;
    }
    const session = await getSessionFromCtx(context);
    if (!session) {
      return; // Better Auth owns authentication errors.
    }
    if (context.path === "/organization/leave") {
      const organizationId = context.body?.organizationId;
      if (typeof organizationId === "string" && organizationId.length > 0) {
        await requireSpaceOwnershipHandoff({
          coreWorker,
          organizationId,
          userId: session.user.id,
        });
      }
      return;
    }
    const memberships = await db
      .prepare("SELECT organization_id FROM members WHERE user_id = ?")
      .bind(session.user.id)
      .all<{ organization_id: string }>();
    for (const membership of memberships.results) {
      await requireSpaceOwnershipHandoff({
        coreWorker,
        organizationId: membership.organization_id,
        userId: session.user.id,
      });
    }
  });
}
