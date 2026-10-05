import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import {
  finalizeOrganizationMemberDeparture,
  type OrganizationMemberDepartureDependencies,
  prepareOrganizationMemberDeparture,
} from "../organization/member-departure-lifecycle";
import { requireSpaceOwnershipHandoff } from "../organization/space-owner-departure";
export function createOrganizationMemberDeparturePlugin(
  input: OrganizationMemberDepartureDependencies
): BetterAuthPlugin {
  return {
    id: "openmeld-organization-member-departure",
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
                const member = await context.context.adapter.findOne({
                  model: "member",
                  where: [
                    { field: "organizationId", value: organizationId },
                    { field: "userId", value: session.user.id },
                  ],
                });
                if (!member) {
                  return;
                }
                await prepareOrganizationMemberDeparture({
                  ...input,
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
            const memberships = await input.db.query<{
              organization_id: string;
            }>({
              text: 'SELECT organization_id FROM "openmeld"."members" WHERE user_id = $1',
              values: [session.user.id],
            });
            for (const membership of memberships.rows) {
              await requireSpaceOwnershipHandoff({
                coreWorker: input.coreWorker,
                organizationId: membership.organization_id,
                userId: session.user.id,
              });
            }
          }),
        },
      ],
      after: [
        {
          matcher: (context) => context.path === "/organization/leave",
          handler: createAuthMiddleware(async (context) => {
            // Better Auth's leave endpoint does not run organization member
            // hooks. Its successful response is the deleted membership;
            // API errors have no membership identity and must not purge data.
            const member = context.context.returned;
            if (
              !member ||
              typeof member !== "object" ||
              !("id" in member) ||
              typeof member.id !== "string" ||
              !("organizationId" in member) ||
              typeof member.organizationId !== "string" ||
              !("userId" in member) ||
              typeof member.userId !== "string"
            ) {
              return;
            }
            await finalizeOrganizationMemberDeparture({
              ...input,
              organizationId: member.organizationId,
              userId: member.userId,
            });
          }),
        },
      ],
    },
  };
}
