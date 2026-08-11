import {
  remoteAgentStreamDeltaCallbackResponseSchema,
  remoteAgentStreamPartCallbackBodySchema,
} from "@openmeld/schemas";
import type {
  RemoteAgentStreamDeltaCallbackResponse,
  RemoteAgentStreamPartCallbackBody,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";
import {
  buildRemoteAgentStreamRejectedResponse,
  resolveRemoteAgentStreamCallbackTarget,
} from "./stream-callback-target";

export async function submitRemoteAgentStreamPart(
  env: CoreBindings,
  input: RemoteAgentStreamPartCallbackBody
): Promise<RemoteAgentStreamDeltaCallbackResponse> {
  const parsed = remoteAgentStreamPartCallbackBodySchema.safeParse(input);
  if (!parsed.success) {
    return buildRemoteAgentStreamRejectedResponse({
      partKind: "tool",
      reasonCode: "agent_stream.invalid",
      context: { validationIssues: parsed.error.issues },
    });
  }
  const target = await resolveRemoteAgentStreamCallbackTarget({
    body: parsed.data,
    env,
    partKind: "tool",
  });
  if (target.kind === "response") {
    return target.response;
  }
  if (target.kind !== "space_target") {
    return buildRemoteAgentStreamRejectedResponse({
      body: parsed.data,
      partKind: "tool",
      reasonCode: "agent_stream.unsupported_conversation",
    });
  }

  try {
    return remoteAgentStreamDeltaCallbackResponseSchema.parse(
      await target.stub.rpcApplyAgentStreamPart({
        v: parsed.data.v,
        spaceId: parsed.data.spaceId,
        streamId: parsed.data.streamId,
        sequence: parsed.data.sequence,
        profileId: parsed.data.agentProfileId,
        triggerMessageId: parsed.data.triggerMessageId,
        dispatchId: parsed.data.dispatchId,
        part: parsed.data.part,
      })
    );
  } catch (error) {
    console.warn("[core.remote_agent.stream_part.projection_failed]", {
      event: CORE_LOG_EVENTS.coreInternalError,
      dispatchId: parsed.data.dispatchId,
      errorName: error instanceof Error ? error.name : typeof error,
      sequence: parsed.data.sequence,
      streamId: parsed.data.streamId,
      submissionId: parsed.data.submissionId,
      targetProfileId: parsed.data.agentProfileId,
    });
    return remoteAgentStreamDeltaCallbackResponseSchema.parse({
      status: "retryable",
      reasonCode: "agent_stream.projection_unavailable",
      lastSequence: 0,
    });
  }
}
