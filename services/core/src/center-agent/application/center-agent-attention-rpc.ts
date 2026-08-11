import {
  centerAgentRequestMemberAttentionResponseSchema,
  centerAgentRequestMemberAttentionRpcInputSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentRequestMemberAttentionResponse,
  CenterAgentRequestMemberAttentionRpcInput,
  InboxSourceCandidate,
} from "@openmeld/schemas/types";
import { projectCenterAgentTaskNeedsAttention } from "../../center-agent-tasks/application/center-agent-task-attention-projector";
import { readCenterAgentTaskAttemptByTaskHandle } from "../../center-agent-tasks/infrastructure/d1/center-agent-task-repo";
import {
  type CoreBindings,
  inboxDb,
  localStateDb,
  wakeEvidenceDb,
} from "../../lib/bindings";
import { readRemoteAgentNativeDeliveryBySubmissionId } from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { prepareSpaceInboxCandidateForCenterAgent } from "../../space/application/space-inbox-center-agent-candidate";
import { createCenterAgentAttentionRequest } from "./center-agent-attention-service";
import { prepareHostedCenterAgentRequest } from "./represented-member-request";

export async function rpcCenterAgentRequestMemberAttention(
  env: CoreBindings,
  input: CenterAgentRequestMemberAttentionRpcInput
): Promise<CenterAgentRequestMemberAttentionResponse> {
  const request = centerAgentRequestMemberAttentionRpcInputSchema.parse(input);
  const authorization = await prepareHostedCenterAgentRequest(
    env,
    request.context
  );
  const conversationSubmissionId =
    request.context.agentControllerConversationId?.trim();
  const deliveryDb = wakeEvidenceDb(env);
  const attentionDb = inboxDb(env);
  const taskDb = localStateDb(env);
  if (!(conversationSubmissionId && deliveryDb && attentionDb && taskDb)) {
    throw attentionRequestUnavailableError();
  }
  if (conversationSubmissionId !== request.submissionId) {
    throw attentionRequestMismatchError();
  }

  const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: deliveryDb,
    submissionId: conversationSubmissionId,
  });
  if (
    !delivery ||
    (delivery.status !== "accepted" && delivery.status !== "retry_observed") ||
    delivery.routineRunId !== null ||
    delivery.organizationId !==
      authorization.activeOrganization.organizationId ||
    delivery.profileId !== authorization.actorProfileId ||
    !delivery.onBehalfOfUserId ||
    !delivery.onBehalfOfProfileId
  ) {
    throw attentionRequestMismatchError();
  }
  const taskAttempt = await readCenterAgentTaskAttemptByTaskHandle({
    db: taskDb,
    organizationId: delivery.organizationId,
    taskHandle: {
      deliveryId: delivery.deliveryId,
      kind: "native_delivery",
      v: 1,
    },
  });
  if (!taskAttempt && delivery.conversationKind !== "space") {
    throw attentionRequestMismatchError();
  }

  const activeMember = await authorization.db
    .prepare(
      `
        SELECT 1 AS active
        FROM members
        WHERE organization_id = ?
          AND user_id = ?
        LIMIT 1
      `
    )
    .bind(delivery.organizationId, delivery.onBehalfOfUserId)
    .first<{ active: number }>();
  if (!activeMember) {
    throw attentionRequestMemberRequiredError();
  }

  const nowMs = Date.now();
  if (taskAttempt) {
    const importance =
      request.impact === "response_needed" ? "normal" : "urgent";
    const projected = await projectCenterAgentTaskNeedsAttention({
      deliveryId: delivery.deliveryId,
      importance,
      inboxDb: attentionDb,
      nowMs,
      organizationId: delivery.organizationId,
      prompt: request.prompt,
      requestId: request.submissionId,
      taskDb,
    });
    if (!projected) {
      throw attentionRequestMismatchError();
    }
    return centerAgentRequestMemberAttentionResponseSchema.parse({
      importance,
      instruction:
        importance === "urgent"
          ? "This urgent request is now in Needs action and uses the member's urgent notification preferences. Explain the concrete time-sensitive or blocking risk without exaggeration."
          : "This request is now in Needs action. Tell the member exactly what response is needed, and do not describe it as urgent.",
      organizationId: delivery.organizationId,
      requestId: request.submissionId,
    });
  }
  const sourceCandidate: InboxSourceCandidate = {
    attention: "action_required",
    contextLabel: "Center Agent",
    importance: request.impact === "response_needed" ? "normal" : "urgent",
    kind: "agent_interaction",
    occurredAtMs: nowMs,
    organizationId: delivery.organizationId,
    preview: request.prompt,
    recipientUserId: delivery.onBehalfOfUserId,
    sourceKey: request.submissionId,
    sourceKind: "remote_agent_native_interaction",
    sourceTarget: {
      kind: "space",
      signalId: delivery.triggerMessageId,
      spaceId: delivery.spaceId,
    },
    title: request.title,
  };
  const canonicalCandidate = await prepareSpaceInboxCandidateForCenterAgent({
    candidate: sourceCandidate,
    db: authorization.db,
  });
  const created = await createCenterAgentAttentionRequest({
    db: attentionDb,
    impact: request.impact,
    nativeDeliveryId: delivery.deliveryId,
    nowMs,
    organizationId: delivery.organizationId,
    prompt: request.prompt,
    recipientUserId: delivery.onBehalfOfUserId,
    sourceTarget: canonicalCandidate.sourceTarget,
    spaceId: delivery.spaceId,
    submissionId: request.submissionId,
    title: request.title,
    triggerSignalId: delivery.triggerMessageId,
  });

  return centerAgentRequestMemberAttentionResponseSchema.parse({
    importance: created.importance,
    instruction:
      created.importance === "urgent"
        ? "This urgent request is now in Needs action and uses the member's urgent notification preferences. Explain the concrete time-sensitive or blocking risk without exaggeration."
        : "This request is now in Needs action. Tell the member exactly what response is needed, and do not describe it as urgent.",
    organizationId: delivery.organizationId,
    requestId: created.requestId,
  });
}

function attentionRequestUnavailableError() {
  return createCoreRpcHttpError({
    code: "center_agent.attention_request_unavailable",
    reason: "Center Agent attention requests are unavailable right now.",
    status: 503,
  });
}

function attentionRequestMismatchError() {
  return createCoreRpcHttpError({
    code: "center_agent.attention_request_delivery_mismatch",
    reason:
      "This attention request does not match the current verified Space conversation.",
    status: 403,
  });
}

function attentionRequestMemberRequiredError() {
  return createCoreRpcHttpError({
    code: "center_agent.attention_request_member_required",
    reason:
      "Attention requests require a current verified Organization member.",
    status: 403,
  });
}
