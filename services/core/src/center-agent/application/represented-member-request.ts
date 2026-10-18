import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  CENTER_AGENT_OPENMELD_IDENTITY_REQUIRED_CODE,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";
import type {
  CenterAgentToolSpeaker,
  CenterAgentVerifiedMemberToolSpeaker,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { isRequestChainEnforced } from "../../member-agent/member-agents-feature";
import { readRemoteAgentNativeDeliveryBySubmissionId } from "../../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { createCoreRpcHttpError } from "../../rpc/errors";
import {
  type CurrentDesignatedCenterAgentAuthorization,
  requireCurrentDesignatedCenterAgentCaller,
} from "../current-designated-center-agent";
import { resolveNativeDeliverySourceSpaceId } from "./native-delivery-source-space";
export type VerifiedCenterAgentRepresentedMember = {
  displayName: string;
  memberId: string;
  profileId: string;
  role: "admin" | "member" | "owner";
  userId: string;
};
export async function prepareCenterAgentRepresentedMemberRequest(
  env: CoreBindings,
  context: OpenMeldRequestContext,
  speakerMember: CenterAgentToolSpeaker,
  memberActorError?: {
    code: string;
    reason: string;
  }
) {
  const centerAgent = await prepareHostedCenterAgentRequest(env, context);
  const representedHuman = await requireActiveHumanMember({
    db: centerAgent.db,
    memberActorError,
    organizationId: centerAgent.activeOrganization.organizationId,
    speakerMember,
  });
  const sourceDelivery = await resolveSourceNativeDelivery({
    authorization: centerAgent,
    context,
    env,
    representedHuman,
  });
  if (isRequestChainEnforced() && !sourceDelivery) {
    // The represented member must be the root Core recorded on this turn's
    // native delivery, never only the speaker named in the request.
    throw createCoreRpcHttpError({
      code: "center_agent.request_chain_root_mismatch",
      reason:
        "Only the member who asked in this conversation can be represented here.",
      status: 403,
    });
  }
  return {
    authorization: centerAgent,
    representedHuman,
    sourceNativeDeliveryId: sourceDelivery?.deliveryId ?? null,
    sourceSpaceId: sourceDelivery?.sourceSpaceId ?? null,
  };
}
async function resolveSourceNativeDelivery(input: {
  authorization: CurrentDesignatedCenterAgentAuthorization;
  context: OpenMeldRequestContext;
  env: CoreBindings;
  representedHuman: VerifiedCenterAgentRepresentedMember;
}): Promise<{
  deliveryId: string;
  sourceSpaceId: string | null;
} | null> {
  const submissionId = input.context.agentControllerConversationId?.trim();
  const db = getPostgresDatabase(input.env);
  if (!(submissionId && db)) {
    return null;
  }
  let delivery: Awaited<
    ReturnType<typeof readRemoteAgentNativeDeliveryBySubmissionId>
  >;
  try {
    delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
      db,
      submissionId,
    });
  } catch (error) {
    console.warn("Could not resolve Center Agent request provenance.", {
      error: error instanceof Error ? error.message : String(error),
      organizationId: input.authorization.activeOrganization.organizationId,
      submissionId,
    });
    return null;
  }
  const active =
    delivery?.status === "accepted" || delivery?.status === "retry_observed";
  if (
    !(
      delivery &&
      active &&
      delivery.organizationId ===
        input.authorization.activeOrganization.organizationId &&
      delivery.profileId === input.authorization.actorProfileId &&
      delivery.onBehalfOfProfileId === input.representedHuman.profileId &&
      delivery.onBehalfOfUserId === input.representedHuman.userId
    )
  ) {
    return null;
  }
  return {
    deliveryId: delivery.deliveryId,
    sourceSpaceId: resolveNativeDeliverySourceSpaceId(delivery),
  };
}
export async function prepareHostedCenterAgentRequest(
  env: CoreBindings,
  context: OpenMeldRequestContext
) {
  const centerAgent = await requireCurrentDesignatedCenterAgentCaller({
    context,
    env,
  });
  requireHostedCenterAgentActor(centerAgent);
  return centerAgent;
}
function requireHostedCenterAgentActor(
  authorization: CurrentDesignatedCenterAgentAuthorization
): void {
  const actorContext = authorization.context.actorContext;
  const actorProfile = authorization.actorProfile;
  if (
    actorContext.agentControllerRef !== HOSTED_CENTER_AGENT_CONTROLLER_REF ||
    actorContext.ownerUserId !== undefined ||
    actorContext.callerPrincipalId !== actorProfile.profileId ||
    actorProfile.profileKind !== "agent" ||
    actorProfile.status !== "active" ||
    actorProfile.managedRole !== "center_agent" ||
    actorProfile.organizationId !==
      authorization.activeOrganization.organizationId ||
    actorProfile.ownerUserId !== null
  ) {
    throw centerAgentNotDesignatedError();
  }
}
export async function requireActiveHumanMember(input: {
  db: PostgresDatabase;
  memberActorError?: {
    code: string;
    reason: string;
  };
  organizationId: string;
  speakerMember: CenterAgentToolSpeaker;
}): Promise<VerifiedCenterAgentRepresentedMember> {
  const speakerMember = requireVerifiedCenterAgentToolSpeaker(
    input.speakerMember
  );
  const row = await input.db
    .query<{
      member_id: string;
      profile_id: string;
      profile_name: string;
      role: string;
      user_id: string;
    }>({
      text: `
        SELECT
          members.id AS member_id,
          members.user_id,
          members.role,
          profiles.profile_id,
          profiles.profile_name
        FROM "openmeld"."members"
        INNER JOIN "openmeld"."openmeld_profiles" AS profiles
          ON profiles.owner_user_id = members.user_id
          AND profiles.profile_kind = 'human'
          AND profiles.is_default = 1
          AND profiles.status = 'active'
        WHERE members.organization_id = $1
          AND members.id = $2
          AND members.user_id = $3
        LIMIT 1
      `,
      values: [
        input.organizationId,
        speakerMember.memberId,
        speakerMember.userId,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  if (
    !row ||
    (row.role !== "owner" && row.role !== "admin" && row.role !== "member")
  ) {
    throw memberActorRequiredError(input.memberActorError);
  }
  return {
    displayName: row.profile_name,
    memberId: row.member_id,
    profileId: row.profile_id,
    role: row.role,
    userId: row.user_id,
  };
}
export function requireVerifiedCenterAgentToolSpeaker(
  speakerMember: CenterAgentToolSpeaker
): CenterAgentVerifiedMemberToolSpeaker {
  if (!("kind" in speakerMember)) {
    return speakerMember;
  }
  throw openMeldIdentityRequiredError();
}
export function openMeldIdentityRequiredError(): Error {
  return createCoreRpcHttpError({
    code: CENTER_AGENT_OPENMELD_IDENTITY_REQUIRED_CODE,
    reason:
      "This action requires your OpenMeld identity. Join or link your account so OpenMeld can verify your permissions and record who performed the action.",
    status: 403,
  });
}
function centerAgentNotDesignatedError(): Error {
  return createCoreRpcHttpError({
    code: "center_agent.not_designated",
    reason: "This action requires the designated Center Agent profile.",
    status: 403,
  });
}
function memberActorRequiredError(override?: {
  code: string;
  reason: string;
}): Error {
  return createCoreRpcHttpError({
    code: override?.code ?? "center_agent.member_actor_required",
    reason:
      override?.reason ??
      "A verified active human Organization member is required.",
    status: 403,
  });
}
