import {
  createAuthDatabase,
  createDrizzleOrganizationJoinLinkRepository,
  createOrganizationJoinLinkService,
} from "@openmeld/auth/server";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  type SpaceInvitationRpcInput,
  spaceInvitationRpcResultSchema,
} from "@openmeld/schemas";
import type { Context } from "hono";
import { getOrganizationServerApi } from "../better-auth/organization-server-api";
import type { AppContext } from "../context";
export async function readInvitationAccount(
  c: Context<AppContext>,
  userId: string
) {
  const user = await getPostgresDatabase(c.env)
    .query<{
      id: string;
      email: string;
      email_verified: number;
    }>({
      text: 'SELECT id, email, email_verified FROM "openmeld"."users" WHERE id = $1',
      values: [userId],
    })
    .then((result) => result.rows[0] ?? null);
  return user
    ? {
        id: user.id,
        email: user.email,
        emailVerified: user.email_verified === 1,
      }
    : null;
}
// Auth fulfills an already authorized invitation. The caller must establish the
// direct-link or approved-request authority before using this membership writer.
export async function fulfillInvitationMembership(
  c: Context<AppContext>,
  input: {
    organizationId: string;
    applicant: {
      id: string;
      email: string;
      emailVerified: boolean;
    };
    spaceInvitation?: {
      actor: {
        id: string;
        email: string;
        emailVerified: boolean;
      };
      request: SpaceInvitationRpcInput["request"];
    };
  }
) {
  const core = c.env.OPENMELD_CORE_WORKER;
  const applicant = {
    userId: input.applicant.id,
    email: input.applicant.email,
    emailVerified: input.applicant.emailVerified,
  };
  let invitationId: string | undefined;
  if (input.spaceInvitation) {
    if (!core) {
      throw new Error("Core is required for Space invitations");
    }
    const actor = input.spaceInvitation.actor;
    const created = spaceInvitationRpcResultSchema.parse(
      await core.spaceInvitation({
        userId: actor.id,
        email: actor.email,
        emailVerified: actor.emailVerified,
        request: input.spaceInvitation.request,
      })
    );
    if (!created.result.ok) {
      throw new Error(created.result.message);
    }
    invitationId = created.result.invitations[0]?.id;
    if (!invitationId) {
      throw new Error("The Space invitation was not created.");
    }
    const claimed = spaceInvitationRpcResultSchema.parse(
      await core.spaceInvitation({
        ...applicant,
        request: { action: "claim", invitationId },
      })
    );
    if (!claimed.result.ok) {
      throw new Error(claimed.result.message);
    }
  }
  const result = await createOrganizationJoinLinkService({
    repository: createDrizzleOrganizationJoinLinkRepository(
      createAuthDatabase()
    ),
    webAppUrl: c.env.WEB_APP_URL ?? c.req.url,
  }).enrollVerifiedWorkspaceMember({
    organizationId: input.organizationId,
    userId: applicant.userId,
    emailVerified: applicant.emailVerified,
    addMember: (body) =>
      getOrganizationServerApi(c.var.betterAuth).addMember({ body }),
  });
  if (invitationId && core) {
    const completed = spaceInvitationRpcResultSchema.parse(
      await core.spaceInvitation({
        ...applicant,
        request: { action: "complete", invitationId },
      })
    );
    if (!completed.result.ok) {
      throw new Error(completed.result.message);
    }
  }
  return result;
}
