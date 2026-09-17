import {
  remoteAgentStreamDeltaCallbackBodySchema,
  remoteAgentStreamDeltaCallbackResponseSchema,
} from "@openmeld/schemas";
import type {
  RemoteAgentStreamDeltaCallbackBody,
  RemoteAgentStreamDeltaCallbackResponse,
  SpaceAgentStreamTerminal,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { localStateDb, wakeEvidenceDb } from "../../lib/bindings";
import { resolveSpaceStub } from "../../rpc/space-ref";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";
import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/d1/native-delivery-ledger-repo";
import { publishRemoteAgentMessageChannelCardStreamDelta } from "./message-channel-card-stream-service";
import { createConfiguredMessageChannelProviderRegistry } from "./message-channel-provider-runtime";
import { resolveNativeDeliveryReplyPlacement } from "./reply-placement";
import {
  type AgentStreamSpaceStub,
  buildRemoteAgentStreamId,
  buildRemoteAgentStreamRejectedResponse,
  resolveRemoteAgentStreamCallbackTarget,
} from "./stream-callback-target";

type RemoteAgentStreamDelivery = {
  conversationKind: "message_channel" | "slack" | "space";
  dispatchId: string;
  profileId: string;
  routineRunId?: string | null;
  spaceId: string;
};

export async function submitRemoteAgentStreamDelta(
  env: CoreBindings,
  input: RemoteAgentStreamDeltaCallbackBody
): Promise<RemoteAgentStreamDeltaCallbackResponse> {
  const parsed = remoteAgentStreamDeltaCallbackBodySchema.safeParse(input);
  if (!parsed.success) {
    return buildRemoteAgentStreamRejectedResponse({
      partKind: "text",
      reasonCode: "agent_stream.invalid",
      context: { validationIssues: parsed.error.issues },
    });
  }
  const target = await resolveRemoteAgentStreamCallbackTarget({
    body: parsed.data,
    env,
    partKind: "text",
  });
  if (target.kind === "response") {
    return target.response;
  }
  const delta = normalizeRemoteAgentStreamDelta(parsed.data);
  if (target.kind === "message_channel_target") {
    return publishMessageChannelStreamDelta({
      body: parsed.data,
      delivery: target.delivery,
      delta,
      env,
    });
  }

  try {
    const placement = await resolveNativeDeliveryReplyPlacement({
      env,
      delivery: target.delivery,
      lock: delta.kind === "text",
    });
    return remoteAgentStreamDeltaCallbackResponseSchema.parse(
      await target.stub.rpcApplyAgentStreamDelta({
        ...(placement
          ? {
              replyThreadRootSignalId:
                placement.threadContext?.rootSignalId ?? null,
            }
          : {}),
        v: 1,
        spaceId: parsed.data.spaceId,
        streamId: parsed.data.streamId,
        sequence: parsed.data.sequence,
        profileId: parsed.data.agentProfileId,
        triggerMessageId: parsed.data.triggerMessageId,
        dispatchId: parsed.data.dispatchId,
        ...(delta.kind === "thinking"
          ? {
              kind: "thinking" as const,
              thinkingSnapshot: delta.snapshot,
            }
          : {
              kind: "text" as const,
              textSnapshot: delta.snapshot,
            }),
      })
    );
  } catch (error) {
    console.warn("[core.remote_agent.stream_delta.projection_failed]", {
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

async function publishMessageChannelStreamDelta(input: {
  body: RemoteAgentStreamDeltaCallbackBody;
  delivery: RemoteAgentNativeDeliveryRecord;
  delta: { kind: "text" | "thinking"; snapshot: string };
  env: CoreBindings;
}): Promise<RemoteAgentStreamDeltaCallbackResponse> {
  if (input.delta.kind === "thinking") {
    return remoteAgentStreamDeltaCallbackResponseSchema.parse({
      lastSequence: input.body.sequence,
      status: "accepted",
    });
  }
  const providerDb = localStateDb(input.env);
  const evidenceDb = wakeEvidenceDb(input.env);
  const registry = providerDb
    ? createConfiguredMessageChannelProviderRegistry({
        db: providerDb,
        env: input.env,
      })
    : undefined;
  if (!(evidenceDb && providerDb && registry)) {
    return remoteAgentStreamDeltaCallbackResponseSchema.parse({
      lastSequence: input.delivery.providerProgressSequence ?? 0,
      reasonCode: "agent_stream.message_channel_provider_unavailable",
      status: "retryable",
    });
  }
  try {
    return await publishRemoteAgentMessageChannelCardStreamDelta({
      delivery: input.delivery,
      evidenceDb,
      nowMs: Date.now(),
      providerDb,
      registry,
      sequence: input.body.sequence,
      textSnapshot: input.delta.snapshot,
    });
  } catch (error) {
    console.warn("[core.remote_agent.stream_delta.card_update_failed]", {
      event: CORE_LOG_EVENTS.coreInternalError,
      dispatchId: input.body.dispatchId,
      kind: input.delta.kind,
      errorName: error instanceof Error ? error.name : typeof error,
      sequence: input.body.sequence,
      submissionId: input.body.submissionId,
    });
    return remoteAgentStreamDeltaCallbackResponseSchema.parse({
      lastSequence: input.delivery.providerProgressSequence ?? 0,
      reasonCode: "agent_stream.message_channel_card_update_unavailable",
      status: "retryable",
    });
  }
}

function normalizeRemoteAgentStreamDelta(
  body: RemoteAgentStreamDeltaCallbackBody
): { kind: "text" | "thinking"; snapshot: string } {
  return body.v === 1
    ? { kind: "text", snapshot: body.textSnapshot }
    : { kind: body.kind, snapshot: body.snapshot };
}

export async function closeRemoteAgentStreamProjection(input: {
  delivery: RemoteAgentStreamDelivery;
  env: CoreBindings;
  submissionId: string | null;
  terminal: SpaceAgentStreamTerminal;
}): Promise<boolean> {
  if (input.delivery.routineRunId) {
    console.info("[core.remote_agent.stream_terminal.skipped]", {
      event: CORE_LOG_EVENTS.remoteAgentStreamTerminalSkipped,
      dispatchId: input.delivery.dispatchId,
      reason: "routine_delivery_has_no_stream",
      submissionId: input.submissionId,
    });
    return false;
  }
  if (input.delivery.conversationKind !== "space") {
    console.info("[core.remote_agent.stream_terminal.skipped]", {
      event: CORE_LOG_EVENTS.remoteAgentStreamTerminalSkipped,
      conversationKind: input.delivery.conversationKind,
      dispatchId: input.delivery.dispatchId,
      reason: "unsupported_conversation",
      submissionId: input.submissionId,
    });
    return false;
  }
  const streamId = buildRemoteAgentStreamId(input.submissionId);
  if (!streamId) {
    console.info("[core.remote_agent.stream_terminal.skipped]", {
      event: CORE_LOG_EVENTS.remoteAgentStreamTerminalSkipped,
      dispatchId: input.delivery.dispatchId,
      reason: "missing_submission_id",
      submissionId: input.submissionId,
    });
    return false;
  }
  const stub = resolveSpaceStub(
    input.env.OPENMELD_SPACES,
    input.delivery.spaceId
  ) as (DurableObjectStub & AgentStreamSpaceStub) | null;
  if (!stub?.rpcCloseAgentStream) {
    console.info("[core.remote_agent.stream_terminal.skipped]", {
      event: CORE_LOG_EVENTS.remoteAgentStreamTerminalSkipped,
      dispatchId: input.delivery.dispatchId,
      reason: "space_stub_unavailable",
      streamId,
      submissionId: input.submissionId,
    });
    return false;
  }

  try {
    await stub.rpcCloseAgentStream({
      spaceId: input.delivery.spaceId,
      streamId,
      terminal: input.terminal,
    });
    return true;
  } catch (error) {
    console.warn("[core.remote_agent.stream_terminal.projection_failed]", {
      event: CORE_LOG_EVENTS.coreInternalError,
      dispatchId: input.delivery.dispatchId,
      errorName: error instanceof Error ? error.name : typeof error,
      streamId,
      submissionId: input.submissionId,
      targetProfileId: input.delivery.profileId,
      terminalKind: input.terminal.kind,
    });
    return false;
  }
}
