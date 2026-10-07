import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type {
  OpenMeldRequestContext,
  SessionHistoryRequester,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { resolveOrganizationMembershipById } from "../organizations/organization-context";
import { readRemoteAgentDelegatedRequester } from "../remote-agent/application/delegated-requester";
import { requireRemoteAgentToolCaller } from "../remote-agent/application/remote-agent-tool-caller";
import { readRemoteAgentNativeDeliveryBySubmissionId } from "../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { createCoreRpcHttpError } from "../rpc/errors";

function deny(): never {
  throw createCoreRpcHttpError({
    status: 403,
    code: "session_history.denied",
    reason:
      "Session history requires a current, verified request from its owner.",
  });
}

export async function requireSessionHistoryHostedRequester(
  env: CoreBindings,
  context: OpenMeldRequestContext
): Promise<{ organizationId: string; requester: SessionHistoryRequester }> {
  const authorization = await requireRemoteAgentToolCaller({ env, context });
  const submissionId = authorization.context.agentControllerConversationId;
  const db = getPostgresDatabase(env);
  if (!(submissionId && db && authorization.actorProfileId)) {
    return deny();
  }
  const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db,
    submissionId,
  });
  const admitted =
    delivery?.executionRecoverySubmitRequest ?? delivery?.workerSubmitRequest;
  if (
    !(delivery && admitted) ||
    delivery.routineRunId ||
    delivery.profileId !== authorization.actorProfileId ||
    delivery.organizationId !==
      authorization.activeOrganization.organizationId ||
    (delivery.status !== "accepted" && delivery.status !== "retry_observed")
  ) {
    return deny();
  }
  const sender = admitted.turnEnvelope.sender;
  const delegated =
    sender.kind === "agent_profile"
      ? await readRemoteAgentDelegatedRequester({
          identityDb: db,
          evidenceDb: db,
          delivery,
          request: admitted,
        })
      : null;
  const ownerUserId =
    sender.kind === "member" && sender.verified
      ? sender.ownerUserId
      : delegated?.userId;
  if (!ownerUserId) {
    return deny();
  }
  const membership = await resolveOrganizationMembershipById({
    env,
    organizationId: delivery.organizationId,
    userId: ownerUserId,
  });
  if (!membership.ok) {
    return deny();
  }
  const environment =
    admitted.turnEnvelope.contextScopePlan?.interactionEnvironment ??
    admitted.turnEnvelope.interactionEnvironment;
  return {
    organizationId: delivery.organizationId,
    requester: {
      requestRootId: delegated?.parentDeliveryId ?? delivery.deliveryId,
      ownerUserId,
      requesterUserId: ownerUserId,
      readerProfileId: authorization.actorProfileId,
      delegatorProfileId:
        delegated && sender.kind === "agent_profile"
          ? (sender.profileId ?? null)
          : null,
      spaceId:
        delivery.conversationKind === "space"
          ? (delivery.spaceId ?? null)
          : null,
      audience: audience(environment),
    },
  };
}

function audience(
  environment: string | undefined
): SessionHistoryRequester["audience"] {
  if (environment === "requester_private") {
    return "owner_private";
  }
  return environment === "organization_shared" ? "space" : "externally_shared";
}
