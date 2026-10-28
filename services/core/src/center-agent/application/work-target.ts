import {
  centerAgentWorkTargetRequestSchema,
  centerAgentWorkTargetResponseSchema,
} from "@openmeld/schemas";
import { createDispatchContinuationSpaceAccessContext } from "@openmeld/space";
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
  const { context, selection } = parsed.data;
  const submissionId = context.agentControllerConversationId;
  if (!submissionId) {
    throw new Error("center_agent.work_target.execution_required");
  }
  const { caller, delivery, request } = await prepareRemoteAgentExecutionAccess(
    env,
    {
      context,
      submissionId,
      effect: selection ? "write" : "read",
    }
  );
  if ("personalExecution" in caller || delivery.conversationKind !== "space") {
    throw new Error("center_agent.work_target.unsupported_conversation");
  }
  const sender = request.turnEnvelope.sender;
  const trigger = request.turnEnvelope.trigger.source;
  const interactive =
    sender.kind === "member" &&
    sender.verified &&
    (trigger === "space_wake" || trigger === "web_dm") &&
    !request.sourceClientMessageId?.startsWith("plugin-continue:");
  if (selection && !interactive) {
    throw new Error("center_agent.work_target.human_source_required");
  }
  const stub = resolveSpaceStub(env.OPENMELD_SPACES, delivery.spaceId);
  if (!stub) {
    throw new Error("center_agent.work_target.space_unavailable");
  }
  const record = await stub.rpcCenterAgentWorkTarget({
    spaceAccess: createDispatchContinuationSpaceAccessContext({
      requestContext: context,
      dispatchId: delivery.dispatchId,
      sourceSignalId: delivery.triggerMessageId,
      targetProfileId: delivery.profileId,
      spaceId: delivery.spaceId,
    }),
    scopeKey: request.taskId
      ? `task:${request.taskId}`
      : `conversation:${resolveRemoteAgentLogicalConversationId(request)}`,
    sourceSignalId: delivery.triggerMessageId,
    admittedAtMs: delivery.createdAtMs,
    requesterProfileId:
      sender.kind === "member" ? (sender.profileId ?? null) : null,
    ...(selection ? { selection } : {}),
  });
  return centerAgentWorkTargetResponseSchema.parse({
    record,
    selectionRequired:
      interactive && record?.selectionSignalId !== delivery.triggerMessageId,
  });
}
