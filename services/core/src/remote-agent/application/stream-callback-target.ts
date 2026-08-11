import { remoteAgentStreamDeltaCallbackResponseSchema } from "@openmeld/schemas";
import type {
  RemoteAgentStreamDeltaCallbackBody,
  RemoteAgentStreamDeltaCallbackResponse,
  RemoteAgentStreamPartCallbackBody,
  SpaceAgentStreamTerminalFrame,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { wakeEvidenceDb } from "../../lib/bindings";
import type {
  ApplySpaceAgentStreamDeltaInput,
  ApplySpaceAgentStreamPartInput,
  CloseSpaceAgentStreamInput,
} from "../../rpc/methods";
import { resolveSpaceStub } from "../../rpc/space-ref";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";
import {
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryBySubmissionId,
  recordRemoteAgentNativeDeliveryExecutionProgress,
} from "../infrastructure/d1/native-delivery-ledger-repo";
import { resolveRemoteAgentNativeDeliveryIdentityMismatch } from "./native-delivery-identity";

export type RemoteAgentStreamCallbackBody =
  | RemoteAgentStreamDeltaCallbackBody
  | RemoteAgentStreamPartCallbackBody;

export type AgentStreamSpaceStub = {
  rpcApplyAgentStreamDelta(
    input: ApplySpaceAgentStreamDeltaInput
  ): Promise<RemoteAgentStreamDeltaCallbackResponse>;
  rpcApplyAgentStreamPart(
    input: ApplySpaceAgentStreamPartInput
  ): Promise<RemoteAgentStreamDeltaCallbackResponse>;
  rpcCloseAgentStream(
    input: CloseSpaceAgentStreamInput
  ): Promise<SpaceAgentStreamTerminalFrame | null>;
};

type ResolveRemoteAgentStreamCallbackTargetResult =
  | {
      kind: "space_target";
      delivery: RemoteAgentNativeDeliveryRecord;
      stub: DurableObjectStub & AgentStreamSpaceStub;
    }
  | {
      kind: "message_channel_target";
      delivery: RemoteAgentNativeDeliveryRecord;
    }
  | {
      kind: "response";
      response: RemoteAgentStreamDeltaCallbackResponse;
    };

type RemoteAgentStreamCallbackResponseResult = Extract<
  ResolveRemoteAgentStreamCallbackTargetResult,
  { kind: "response" }
>;

export async function resolveRemoteAgentStreamCallbackTarget(input: {
  body: RemoteAgentStreamCallbackBody;
  env: CoreBindings;
  partKind: "text" | "tool";
}): Promise<ResolveRemoteAgentStreamCallbackTargetResult> {
  const db = wakeEvidenceDb(input.env);
  if (!db) {
    return reject("agent_stream.db_unavailable", input);
  }
  let delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db,
    submissionId: input.body.submissionId,
  });
  if (!delivery) {
    return reject("agent_stream.unknown_submission", input);
  }
  const identityMismatch = resolveRemoteAgentNativeDeliveryIdentityMismatch(
    delivery,
    input.body
  );
  if (identityMismatch) {
    return reject(`agent_stream.${identityMismatch}_mismatch`, input, {
      dispatchId: delivery.dispatchId,
    });
  }
  if (
    delivery.conversationKind !== "space" &&
    delivery.conversationKind !== "message_channel"
  ) {
    return reject("agent_stream.unsupported_conversation", input, {
      dispatchId: delivery.dispatchId,
    });
  }
  if (input.body.streamId !== buildRemoteAgentStreamId(delivery.submissionId)) {
    return reject("agent_stream.stream_id_mismatch", input, {
      dispatchId: delivery.dispatchId,
    });
  }
  if (delivery.status !== "accepted" && delivery.status !== "retry_observed") {
    return reject(
      delivery.status === "completed" || delivery.status === "failed"
        ? "agent_stream.terminal"
        : "agent_stream.delivery_not_active",
      input,
      { dispatchId: delivery.dispatchId }
    );
  }
  const progress = await resolveDeliveryWithExecutionProgress({
    db,
    delivery,
    ...input,
  });
  if (progress.kind === "response") {
    return progress;
  }
  delivery = progress.delivery;
  if (delivery.routineRunId) {
    console.info("[core.remote_agent.stream_callback.routine_suppressed]", {
      event: "remote_agent_stream_callback_routine_suppressed",
      partKind: input.partKind,
      routineRunId: delivery.routineRunId,
      sequence: input.body.sequence,
      submissionId: input.body.submissionId,
    });
    return {
      kind: "response",
      response: remoteAgentStreamDeltaCallbackResponseSchema.parse({
        status: "accepted",
        lastSequence: input.body.sequence,
      }),
    };
  }
  if (delivery.conversationKind === "message_channel") {
    if (input.partKind === "tool") {
      return {
        kind: "response",
        response: remoteAgentStreamDeltaCallbackResponseSchema.parse({
          status: "accepted",
          lastSequence: input.body.sequence,
        }),
      };
    }
    return { delivery, kind: "message_channel_target" };
  }

  const stub = resolveSpaceStub(
    input.env.OPENMELD_SPACES,
    input.body.spaceId
  ) as (DurableObjectStub & AgentStreamSpaceStub) | null;
  if (!stub) {
    return reject("agent_stream.space_not_found", input, {
      dispatchId: delivery.dispatchId,
    });
  }
  return { kind: "space_target", delivery, stub };
}

async function resolveDeliveryWithExecutionProgress(input: {
  body: RemoteAgentStreamCallbackBody;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  partKind: "text" | "tool";
}): Promise<
  | { delivery: RemoteAgentNativeDeliveryRecord; kind: "delivery" }
  | RemoteAgentStreamCallbackResponseResult
> {
  let deliveryWithProgress: RemoteAgentNativeDeliveryRecord | null;
  try {
    deliveryWithProgress =
      await recordRemoteAgentNativeDeliveryExecutionProgress({
        db: input.db,
        idempotencyKey: input.body.idempotencyKey,
        nowMs: Date.now(),
        sequence: input.body.sequence,
        submissionId: input.body.submissionId,
      });
  } catch (error) {
    console.warn("[core.remote_agent.stream_callback.evidence_failed]", {
      event: CORE_LOG_EVENTS.coreInternalError,
      dispatchId: input.delivery.dispatchId,
      errorName: error instanceof Error ? error.name : typeof error,
      partKind: input.partKind,
      sequence: input.body.sequence,
      streamId: input.body.streamId,
      submissionId: input.body.submissionId,
    });
    return retryExecutionEvidence(input, input.delivery.dispatchId);
  }
  if (!deliveryWithProgress) {
    return retryExecutionEvidence(input, input.delivery.dispatchId);
  }
  if (
    deliveryWithProgress.status !== "accepted" &&
    deliveryWithProgress.status !== "retry_observed"
  ) {
    return reject(
      deliveryWithProgress.status === "completed" ||
        deliveryWithProgress.status === "failed"
        ? "agent_stream.terminal"
        : "agent_stream.delivery_not_active",
      input,
      { dispatchId: deliveryWithProgress.dispatchId }
    );
  }
  return { delivery: deliveryWithProgress, kind: "delivery" };
}

function retryExecutionEvidence(
  input: {
    body: RemoteAgentStreamCallbackBody;
    partKind: "text" | "tool";
  },
  dispatchId: string
): RemoteAgentStreamCallbackResponseResult {
  console.info("[core.remote_agent.stream_callback.retryable]", {
    event:
      input.partKind === "tool"
        ? CORE_LOG_EVENTS.remoteAgentStreamPartRejected
        : CORE_LOG_EVENTS.remoteAgentStreamDeltaRejected,
    dispatchId,
    partKind: input.partKind,
    reasonCode: "agent_stream.evidence_unavailable",
    sequence: input.body.sequence,
    streamId: input.body.streamId,
    submissionId: input.body.submissionId,
  });
  return {
    kind: "response",
    response: remoteAgentStreamDeltaCallbackResponseSchema.parse({
      lastSequence: 0,
      reasonCode: "agent_stream.evidence_unavailable",
      status: "retryable",
    }),
  };
}

export function buildRemoteAgentStreamRejectedResponse(input: {
  body?: Partial<RemoteAgentStreamCallbackBody>;
  context?: Record<string, unknown>;
  partKind: "text" | "tool";
  reasonCode: string;
}): RemoteAgentStreamDeltaCallbackResponse {
  console.info("[core.remote_agent.stream_callback.rejected]", {
    event:
      input.partKind === "tool"
        ? CORE_LOG_EVENTS.remoteAgentStreamPartRejected
        : CORE_LOG_EVENTS.remoteAgentStreamDeltaRejected,
    partKind: input.partKind,
    reasonCode: input.reasonCode,
    dispatchId: input.body?.dispatchId,
    sequence: input.body?.sequence,
    streamId: input.body?.streamId,
    submissionId: input.body?.submissionId,
    ...input.context,
  });
  return remoteAgentStreamDeltaCallbackResponseSchema.parse({
    status: "rejected",
    reasonCode: input.reasonCode,
    lastSequence: 0,
  });
}

export function buildRemoteAgentStreamId(submissionId: string): string;
export function buildRemoteAgentStreamId(submissionId: null): null;
export function buildRemoteAgentStreamId(
  submissionId: string | null
): string | null;
export function buildRemoteAgentStreamId(
  submissionId: string | null
): string | null {
  return submissionId ? `stream:${submissionId}` : null;
}

function reject(
  reasonCode: string,
  input: {
    body: RemoteAgentStreamCallbackBody;
    partKind: "text" | "tool";
  },
  context?: Record<string, unknown>
): RemoteAgentStreamCallbackResponseResult {
  return {
    kind: "response",
    response: buildRemoteAgentStreamRejectedResponse({
      body: input.body,
      context,
      partKind: input.partKind,
      reasonCode,
    }),
  };
}
