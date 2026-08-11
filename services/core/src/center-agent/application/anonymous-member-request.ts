import {
  centerAgentAuthorizeAnonymousMemberToolResponseSchema,
  centerAgentAuthorizeAnonymousMemberToolRpcInputSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentAuthorizeAnonymousMemberToolResponse,
  CenterAgentAuthorizeAnonymousMemberToolRpcInput,
  CenterAgentToolSpeaker,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { type CoreBindings, wakeEvidenceDb } from "../../lib/bindings";
import { readOrganizationAccountIdentityProjection } from "../../organizations/organization-context";
import { readRemoteAgentNativeDeliveryBySubmissionId } from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { createCoreRpcHttpError } from "../../rpc/errors";
import type { CurrentDesignatedCenterAgentAuthorization } from "../current-designated-center-agent";
import {
  prepareCenterAgentRepresentedMemberRequest,
  prepareHostedCenterAgentRequest,
} from "./represented-member-request";

export type CenterAgentOrganizationMember = {
  displayName: string;
  memberId: string | null;
  profileId: string | null;
  role: "admin" | "member" | "owner";
  sourceNativeDeliveryId: string | null;
  userId: string | null;
};

export async function rpcCenterAgentAuthorizeAnonymousMemberTool(
  env: CoreBindings,
  input: CenterAgentAuthorizeAnonymousMemberToolRpcInput
): Promise<CenterAgentAuthorizeAnonymousMemberToolResponse> {
  const request = parseRequest(input);
  const prepared = await prepareCenterAgentOrganizationMemberRequest(
    env,
    request.context,
    request.speakerMember
  );
  if (!prepared.member.sourceNativeDeliveryId) {
    throw anonymousMemberDeliveryRequiredError();
  }
  if (request.connectToUserId) {
    if (
      request.toolName !== "openmeld_get_navigation_action" ||
      request.messageChannelIdentityLinkCapabilityVersion !== 2
    ) {
      throw createCoreRpcHttpError({
        code: "center_agent.account_connection_target_invalid",
        reason:
          "An account connection target is valid only for the current Message Channel connection action.",
        status: 400,
      });
    }
    const projection = await readOrganizationAccountIdentityProjection({
      account: { kind: "user_id", userId: request.connectToUserId },
      authWorker: env.OPENMELD_AUTH_WORKER,
      organizationId: prepared.authorization.activeOrganization.organizationId,
    });
    if (!projection?.ok) {
      throw createCoreRpcHttpError({
        code: "center_agent.account_connection_dependency_unavailable",
        reason:
          "OpenMeld could not confirm the selected account because Organization identity is temporarily unavailable.",
        status: 503,
      });
    }
    if (!projection.account?.membership) {
      throw createCoreRpcHttpError({
        code: "center_agent.account_connection_member_unavailable",
        reason:
          "The selected OpenMeld account is not a current member of this Organization.",
        status: 409,
      });
    }
  }
  return centerAgentAuthorizeAnonymousMemberToolResponseSchema.parse({
    authorized: true,
    ...(request.toolName === "openmeld_get_navigation_action"
      ? {
          ...(request.messageChannelIdentityLinkCapabilityVersion === 1 ||
          request.messageChannelIdentityLinkCapabilityVersion === 2
            ? { messageChannelAccountTargetSupported: true }
            : {}),
          ...(request.messageChannelIdentityLinkCapabilityVersion === 1 ||
          request.messageChannelIdentityLinkCapabilityVersion === 2
            ? { messageChannelIdentityLinkSupported: true }
            : {}),
          // Compatibility for Remote Agent versions that still request the
          // original Slack-only capability field.
          slackIdentityLinkSupported: true,
        }
      : {}),
    sourceNativeDeliveryId: prepared.member.sourceNativeDeliveryId,
  });
}

export async function prepareCenterAgentOrganizationMemberRequest(
  env: CoreBindings,
  context: OpenMeldRequestContext,
  speakerMember: CenterAgentToolSpeaker
): Promise<{
  authorization: CurrentDesignatedCenterAgentAuthorization;
  member: CenterAgentOrganizationMember;
}> {
  if (!("kind" in speakerMember)) {
    const represented = await prepareCenterAgentRepresentedMemberRequest(
      env,
      context,
      speakerMember
    );
    return {
      authorization: represented.authorization,
      member: {
        ...represented.representedHuman,
        sourceNativeDeliveryId: represented.sourceNativeDeliveryId,
      },
    };
  }

  const authorization = await prepareHostedCenterAgentRequest(env, context);
  const submissionId = context.agentControllerConversationId;
  const db = wakeEvidenceDb(env);
  if (!(submissionId && db)) {
    throw anonymousMemberDeliveryRequiredError();
  }
  const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db,
    submissionId,
  });
  if (!delivery?.anonymousMemberSpeaker) {
    throw anonymousMemberDeliveryRequiredError();
  }
  if (delivery.status !== "accepted" && delivery.status !== "retry_observed") {
    throw anonymousMemberDeliveryInactiveError();
  }

  const recordedSpeaker = delivery.anonymousMemberSpeaker;
  const identity = recordedSpeaker.messageChannelIdentity;
  const expectedIdentity = speakerMember.messageChannelIdentity;
  const deliveryMatches =
    (expectedIdentity.provider === "slack" &&
      delivery.conversationKind === "slack" &&
      delivery.slackTeamId === expectedIdentity.connectionId) ||
    (delivery.conversationKind === "message_channel" &&
      delivery.messageChannelLocator?.provider === expectedIdentity.provider &&
      delivery.messageChannelLocator.connectionId ===
        expectedIdentity.connectionId);
  if (
    delivery.organizationId !==
      authorization.activeOrganization.organizationId ||
    delivery.profileId !== authorization.actorProfileId ||
    recordedSpeaker.displayName !== speakerMember.displayName ||
    identity.provider !== expectedIdentity.provider ||
    identity.connectionId !== expectedIdentity.connectionId ||
    identity.providerUserId !== expectedIdentity.providerUserId ||
    !deliveryMatches
  ) {
    throw createCoreRpcHttpError({
      code: "center_agent.anonymous_member_delivery_mismatch",
      reason:
        "This connected member identity does not match the current Message Channel conversation.",
      status: 403,
    });
  }

  return {
    authorization,
    member: {
      displayName: speakerMember.displayName,
      memberId: null,
      profileId: null,
      role: "member",
      sourceNativeDeliveryId: delivery.deliveryId,
      userId: null,
    },
  };
}

function parseRequest(
  input: CenterAgentAuthorizeAnonymousMemberToolRpcInput
): CenterAgentAuthorizeAnonymousMemberToolRpcInput {
  const parsed =
    centerAgentAuthorizeAnonymousMemberToolRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: parsed.error.message,
      status: 400,
    });
  }
  return parsed.data;
}

function anonymousMemberDeliveryRequiredError(): Error {
  return createCoreRpcHttpError({
    code: "center_agent.anonymous_member_delivery_required",
    reason:
      "Connected member access requires the current Message Channel delivery.",
    status: 403,
  });
}

function anonymousMemberDeliveryInactiveError(): Error {
  return createCoreRpcHttpError({
    code: "center_agent.anonymous_member_delivery_inactive",
    reason:
      "Connected member access requires the current active Message Channel delivery.",
    status: 403,
  });
}
