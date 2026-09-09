import type {
  CenterAgentToolSpeaker,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { prepareCenterAgentOrganizationMemberRequest } from "../../center-agent/application/anonymous-member-request";
import { requireActiveHumanMember } from "../../center-agent/application/represented-member-request";
import type { CoreBindings } from "../../lib/bindings";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { requireRemoteAgentToolCaller } from "./remote-agent-tool-caller";

/** Reuse member-backed tools without granting the personal Agent Center duties. */
export async function prepareRemoteAgentMemberRequest(
  env: CoreBindings,
  context: OpenMeldRequestContext,
  speakerMember: CenterAgentToolSpeaker
) {
  if (
    context.actorContext.agentControllerRef !==
    HOSTED_REMOTE_AGENT_CONTROLLER_REF
  ) {
    return await prepareCenterAgentOrganizationMemberRequest(
      env,
      context,
      speakerMember
    );
  }
  const authorization = await requireRemoteAgentToolCaller({ env, context });
  if (!("personalExecution" in authorization)) {
    throw new Error("Expected an admitted personal Remote Agent execution.");
  }
  const { request, delivery } = authorization.personalExecution;
  const sender = request.turnEnvelope.sender;
  if (
    "kind" in speakerMember ||
    sender.kind !== "member" ||
    !sender.verified ||
    sender.id !== speakerMember.memberId ||
    sender.ownerUserId !== speakerMember.userId
  ) {
    throw createCoreRpcHttpError({
      code: "remote_agent.requester_identity_mismatch",
      reason:
        "This action requires the verified requester of the active delivery.",
      status: 403,
    });
  }
  const member = await requireActiveHumanMember({
    db: authorization.db,
    organizationId: authorization.activeOrganization.organizationId,
    speakerMember,
  });
  return {
    authorization,
    member: {
      ...member,
      sourceNativeDeliveryId: delivery.deliveryId,
      sourceSpaceId: delivery.spaceId,
    },
  };
}

import { HOSTED_REMOTE_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
