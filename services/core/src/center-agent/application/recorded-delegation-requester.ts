import { buildAgentTaskKey } from "@openmeld/schemas";
import { readAgentDelegationByChildTask } from "../../agent-task-coordination/infrastructure/d1/agent-delegation-repo";
import { readActiveRepresentedHumanSender } from "../../remote-agent/application/turn-envelope";
import { readRemoteAgentNativeDeliveryByDeliveryId } from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  isCenterAgentDesignationActive,
  readCenterAgentDesignationRecord,
} from "../center-agent-repository";

/** Current one-hop requester projection shared by Local and Remote admission. */
export async function readRecordedDelegationRequester(input: {
  identityDb: D1Database;
  evidenceDb: D1Database;
  organizationId: string;
  spaceId: string;
  sourceClientMessageId: string;
  sourceProfileId: string;
  targetProfileId: string;
  targetOwnerUserId: string | null | undefined;
}) {
  const task = {
    v: 1 as const,
    kind: "space_wake" as const,
    spaceId: input.spaceId,
    sourceClientMessageId: input.sourceClientMessageId,
    targetProfileId: input.targetProfileId,
  };
  const delegation = await readAgentDelegationByChildTask({
    db: input.evidenceDb,
    task,
  });
  if (
    !delegation ||
    delegation.organizationId !== input.organizationId ||
    delegation.state !== "active" ||
    delegation.parentTask.kind !== "native_delivery" ||
    !delegation.children.some(
      (child) =>
        child.agentProfileId === input.targetProfileId &&
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
      organizationId: input.organizationId,
    }),
  ]);
  if (
    !parent ||
    parent.organizationId !== input.organizationId ||
    parent.profileId !== input.sourceProfileId ||
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
    represented.ownerUserId !== input.targetOwnerUserId
  ) {
    return null;
  }
  const [member, agent] = await Promise.all([
    readActiveRepresentedHumanSender({
      db: input.identityDb,
      organizationId: input.organizationId,
      profileId: represented.profileId,
      userId: represented.ownerUserId,
    }),
    input.identityDb
      .prepare(
        "SELECT profile_id FROM openmeld_profiles WHERE profile_id = ? AND organization_id = ? AND owner_user_id = ? AND profile_kind = 'agent' AND managed_role IS NULL AND status = 'active' LIMIT 1"
      )
      .bind(
        input.targetProfileId,
        input.organizationId,
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
