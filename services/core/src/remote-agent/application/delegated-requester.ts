import { buildAgentTaskKey } from "@openmeld/schemas";
import type { RemoteAgentWorkerSubmitTurnRequest } from "@openmeld/schemas/types";
import { readAgentDelegationByChildTask } from "../../agent-task-coordination/infrastructure/d1/agent-delegation-repo";
import {
  isCenterAgentDesignationActive,
  readCenterAgentDesignationRecord,
} from "../../center-agent/center-agent-repository";
import { type CoreBindings, wakeEvidenceDb } from "../../lib/bindings";
import { createCoreRpcHttpError } from "../../rpc/errors";
import {
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByDeliveryId,
} from "../infrastructure/d1/native-delivery-ledger-repo";
import type { requireRemoteAgentToolCaller } from "./remote-agent-tool-caller";
import { readActiveRepresentedHumanSender } from "./turn-envelope";

/** Connection selection still uses the existing owner and access policy. */
export async function resolveRemoteAgentConnectorRequester(input: {
  env: CoreBindings;
  authorization: Awaited<ReturnType<typeof requireRemoteAgentToolCaller>>;
  service: string;
  includeDelegatedRequester?: true;
  requesterUserId: string | null;
}) {
  const personal =
    "personalExecution" in input.authorization
      ? input.authorization.personalExecution
      : null;
  const sender = personal?.request.turnEnvelope.sender;
  if (!input.includeDelegatedRequester) {
    if (sender?.kind === "routine") {
      return sender.delegatedBy.ownerUserId;
    }
    return sender?.kind === "member" && sender.verified
      ? (sender.ownerUserId ?? null)
      : null;
  }
  const evidenceDb = wakeEvidenceDb(input.env);
  const delegated =
    personal &&
    evidenceDb &&
    input.service === "github" &&
    sender?.kind === "agent_profile"
      ? await readRemoteAgentDelegatedRequester({
          identityDb: input.authorization.db,
          evidenceDb,
          delivery: personal.delivery,
          request: personal.request,
        })
      : null;
  if (!delegated || input.requesterUserId !== delegated.userId) {
    throw createCoreRpcHttpError({
      code: "remote_agent.delegated_requester_unavailable",
      reason: "The recorded delegation no longer authorizes this requester.",
      status: 403,
    });
  }
  return delegated.userId;
}

/** A current projection of one recorded Center delegation, never a stored grant. */
export async function readRemoteAgentDelegatedRequester(input: {
  identityDb: D1Database;
  evidenceDb: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  request: RemoteAgentWorkerSubmitTurnRequest;
}) {
  const { delivery, request } = input;
  const sender = request.turnEnvelope.sender;
  if (
    request.v !== 4 ||
    request.conversationIdentity?.kind !== "personal_agent" ||
    sender.kind !== "agent_profile"
  ) {
    return null;
  }
  if (
    !sender.verified ||
    sender.profileId !== request.author.profileId ||
    !delivery.sourceClientMessageId
  ) {
    return null;
  }
  const task = {
    v: 1 as const,
    kind: "space_wake" as const,
    spaceId: delivery.spaceId,
    sourceClientMessageId: delivery.sourceClientMessageId,
    targetProfileId: delivery.profileId,
  };
  const delegation = await readAgentDelegationByChildTask({
    db: input.evidenceDb,
    task,
  });
  if (
    !delegation ||
    delegation.organizationId !== delivery.organizationId ||
    delegation.spaceId !== delivery.spaceId ||
    delegation.state !== "active" ||
    delegation.parentTask.kind !== "native_delivery" ||
    !delegation.children.some(
      (child) =>
        child.agentProfileId === delivery.profileId &&
        child.state === "active" &&
        buildAgentTaskKey(child.task) === buildAgentTaskKey(task)
    )
  ) {
    return null;
  }
  const [parent, designation] = await Promise.all([
    readRemoteAgentNativeDeliveryByDeliveryId({
      db: input.evidenceDb,
      deliveryId: delegation.parentTask.deliveryId,
    }),
    readCenterAgentDesignationRecord({
      db: input.identityDb,
      organizationId: delivery.organizationId,
    }),
  ]);
  if (
    !parent ||
    parent.organizationId !== delivery.organizationId ||
    parent.profileId !== sender.profileId ||
    !["accepted", "retry_observed", "completed"].includes(parent.status) ||
    !designation ||
    !isCenterAgentDesignationActive(designation) ||
    designation.agentProfileId !== parent.profileId
  ) {
    return null;
  }
  const parentRequest =
    parent.executionRecoverySubmitRequest ?? parent.workerSubmitRequest;
  const represented = parentRequest?.turnEnvelope.sender;
  if (
    !parentRequest ||
    parentRequest.organizationId !== parent.organizationId ||
    parentRequest.agentProfileId !== parent.profileId ||
    parentRequest.bindingId !== parent.bindingId ||
    parentRequest.dispatchId !== parent.dispatchId ||
    parentRequest.spaceId !== parent.spaceId ||
    parentRequest.idempotencyKey !== parent.idempotencyKey ||
    represented?.kind !== "member" ||
    !represented.verified ||
    !represented.ownerUserId ||
    !represented.profileId ||
    represented.ownerUserId !== request.agentProfileOwnerUserId
  ) {
    return null;
  }
  const [member, agent] = await Promise.all([
    readActiveRepresentedHumanSender({
      db: input.identityDb,
      organizationId: delivery.organizationId,
      profileId: represented.profileId,
      userId: represented.ownerUserId,
    }),
    input.identityDb
      .prepare(
        "SELECT profile_id FROM openmeld_profiles WHERE profile_id = ? AND organization_id = ? AND owner_user_id = ? AND profile_kind = 'agent' AND managed_role IS NULL AND status = 'active' LIMIT 1"
      )
      .bind(
        delivery.profileId,
        delivery.organizationId,
        represented.ownerUserId
      )
      .first(),
  ]);
  if (!member?.member_id || member.member_id !== represented.id || !agent) {
    return null;
  }
  return {
    delegationId: delegation.delegationId,
    parentDeliveryId: parent.deliveryId,
    memberId: member.member_id,
    userId: member.owner_user_id,
    profileId: member.profile_id,
  };
}
