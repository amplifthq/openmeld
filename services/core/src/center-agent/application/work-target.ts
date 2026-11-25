import {
  centerAgentWorkTargetRequestSchema,
  centerAgentWorkTargetResponseSchema,
} from "@openmeld/schemas";
import { createDispatchContinuationSpaceAccessContext } from "@openmeld/space";
import { readSpacePluginConnectionOriginalSource } from "../../connectors/plugin-connection-execution-binding";
import type { CoreBindings } from "../../lib/bindings";
import { resolveRemoteAgentLogicalConversationId } from "../../remote-agent/application/remote-agent-conversation-continuity";
import { prepareRemoteAgentExecutionAccess } from "../../remote-agent/application/remote-agent-execution-access";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { resolveSpaceStub } from "../../rpc/space-ref";

/** Scope and source come only from the active admission, never model arguments. */
export async function centerAgentWorkTarget(env: CoreBindings, value: unknown) {
  const parsed = centerAgentWorkTargetRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "center_agent.work_target.invalid_input",
      reason: "Invalid work target request.",
    });
  }
  const { context, selection, referenceSourceSignalId } = parsed.data;
  const submissionId = context.agentControllerConversationId;
  if (!submissionId) {
    throw new Error("center_agent.work_target.execution_required");
  }
  const { projection, caller, delivery, request } =
    await prepareRemoteAgentExecutionAccess(env, {
      context,
      submissionId,
      effect: selection ? "write" : "read",
    });
  if ("personalExecution" in caller || delivery.conversationKind !== "space") {
    throw new Error("center_agent.work_target.unsupported_conversation");
  }
  const sender = request.turnEnvelope.sender;
  const trigger = request.turnEnvelope.trigger.source;
  const canSelect =
    Boolean(request.author.profileId) &&
    (sender.kind === "member" || sender.kind === "agent_profile") &&
    sender.verified &&
    [
      "space_wake",
      "web_dm",
      "task_continuation",
      "task_watch_continuation",
    ].includes(trigger) &&
    !request.sourceClientMessageId?.startsWith("plugin-continue:");
  if (selection && !canSelect) {
    throw new Error("center_agent.work_target.source_authority_required");
  }
  const stub = resolveSpaceStub(env.OPENMELD_SPACES, delivery.spaceId);
  if (!stub) {
    throw new Error("center_agent.work_target.space_unavailable");
  }
  let sourceSignalId = delivery.triggerMessageId;
  let sourceAuthorProfileId = request.author.profileId;
  if (request.sourceClientMessageId?.startsWith("plugin-continue:")) {
    if (projection.scope.principal.kind !== "member") {
      throw new Error("center_agent.work_target.source_authority_required");
    }
    const original = await readSpacePluginConnectionOriginalSource(env, {
      organizationId: delivery.organizationId,
      spaceId: delivery.spaceId,
      signalId: delivery.triggerMessageId,
      targetProfileId: delivery.profileId,
      requesterUserId: projection.scope.principal.userId,
    });
    if (!original) {
      throw new Error("center_agent.work_target.source_authority_required");
    }
    sourceSignalId = original.signalId;
    sourceAuthorProfileId = original.requesterProfileId;
  }
  const result = await stub.rpcCenterAgentWorkTarget({
    spaceAccess: createDispatchContinuationSpaceAccessContext({
      requestContext: context,
      dispatchId: delivery.dispatchId,
      sourceSignalId: delivery.triggerMessageId,
      targetProfileId: delivery.profileId,
      spaceId: delivery.spaceId,
    }),
    logicalConversationId: resolveRemoteAgentLogicalConversationId(request),
    sourceSignalId,
    admittedAtMs: delivery.createdAtMs,
    sourceAuthorProfileId,
    sourceOwnerUserId:
      projection.scope.principal.kind === "member"
        ? projection.scope.principal.userId
        : null,
    executorProfileId: delivery.profileId,
    ...(referenceSourceSignalId ? { referenceSourceSignalId } : {}),
    ...(selection ? { selection } : {}),
  });
  return centerAgentWorkTargetResponseSchema.parse(result);
}
