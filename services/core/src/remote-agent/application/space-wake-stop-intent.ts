import {
  remoteAgentWorkerCancellationResponseSchema,
  spaceWakeStopIntentQuerySchema,
  spaceWakeStopIntentResponseSchema,
} from "@openmeld/schemas";
import type {
  RemoteAgentWorkerSubmitMessagesResult,
  RemoteAgentWorkerSubmitTurnRequest,
  SpaceWakeStopIntentQuery,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { resolveSpaceStub } from "../../rpc/space-ref";
import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/d1/native-delivery-ledger-repo";
import {
  resolveRemoteAgentNativeDeliveryRuntimeConversationId,
  resolveRemoteAgentRuntimeConversationId,
} from "./remote-agent-conversation-continuity";

/** The current Worker derives submission identity from dispatchId before its
 * ACK. Use that exact identity for pending admission, never invent a legacy ID.
 * A negative read/cancel still cannot establish that execution was stopped. */
export function resolvePendingRemoteAgentCancellationTarget(
  delivery: RemoteAgentNativeDeliveryRecord | null
) {
  if (!delivery || delivery.status !== "submitted") {
    return null;
  }
  const request =
    delivery.workerSubmitRequest ?? delivery.executionRecoverySubmitRequest;
  if (
    !request ||
    request.dispatchId !== delivery.dispatchId ||
    request.idempotencyKey !== delivery.idempotencyKey
  ) {
    return null;
  }
  const conversationId =
    resolveRemoteAgentNativeDeliveryRuntimeConversationId(delivery);
  return {
    ...(conversationId ? { conversationId } : {}),
    idempotencyKey: delivery.idempotencyKey,
    organizationId: delivery.organizationId,
    spaceId: delivery.spaceId,
    submissionId: delivery.submissionId ?? request.dispatchId,
  };
}

export class RemoteAgentWakeStoppedBeforeAdmissionError extends Error {
  constructor() {
    super("This request was stopped.");
  }
}

export async function readRemoteAgentSpaceWakeStopIntent(
  env: CoreBindings,
  query: SpaceWakeStopIntentQuery,
  authorizeAdmission = false
): Promise<boolean> {
  const parsed = spaceWakeStopIntentQuerySchema.parse(query);
  const space = resolveSpaceStub(env.OPENMELD_SPACES, parsed.spaceId) as {
    rpcReadWakeStopIntent: (
      input: SpaceWakeStopIntentQuery
    ) => Promise<unknown>;
    rpcAuthorizeNativeWakeAdmission: (
      input: SpaceWakeStopIntentQuery
    ) => Promise<unknown>;
  } | null;
  if (!space) {
    throw new Error("remote_agent.wake_stop_space_unavailable");
  }
  const result = spaceWakeStopIntentResponseSchema.safeParse(
    authorizeAdmission
      ? await space.rpcAuthorizeNativeWakeAdmission(parsed)
      : await space.rpcReadWakeStopIntent(parsed)
  );
  if (!result.success) {
    throw new Error("remote_agent.wake_stop_response_invalid");
  }
  if (result.data.status === "not_found") {
    throw new Error("remote_agent.wake_stop_target_unavailable");
  }
  return result.data.status === "requested";
}

function isInteractiveSpaceWake(
  request: RemoteAgentWorkerSubmitTurnRequest
): boolean {
  const source = request.turnEnvelope.trigger.source;
  return source === "web_dm" || source === "space_wake";
}

export async function isRemoteAgentRequestStopRequested(
  env: CoreBindings,
  request: RemoteAgentWorkerSubmitTurnRequest,
  authorizeAdmission = false
): Promise<boolean> {
  return (
    isInteractiveSpaceWake(request) &&
    (await readRemoteAgentSpaceWakeStopIntent(
      env,
      {
        dispatchId: request.dispatchId,
        spaceId: request.spaceId,
        targetProfileId: request.agentProfileId,
      },
      authorizeAdmission
    ))
  );
}

export async function isRemoteAgentSpaceWakeStopRequested(input: {
  delivery: RemoteAgentNativeDeliveryRecord;
  env: CoreBindings;
}): Promise<boolean> {
  if (
    input.delivery.conversationKind !== "space" ||
    input.delivery.routineRunId
  ) {
    return false;
  }
  const request =
    input.delivery.workerSubmitRequest ??
    input.delivery.executionRecoverySubmitRequest;
  if (request && !isInteractiveSpaceWake(request)) {
    return false;
  }
  return await readRemoteAgentSpaceWakeStopIntent(input.env, {
    dispatchId: input.delivery.dispatchId,
    spaceId: input.delivery.spaceId,
    targetProfileId: input.delivery.profileId,
  });
}

/** Keep the known ACK even if cancellation transport is unavailable. The
 * persisted admission/probe path retries Stop; this is never terminal proof. */
export async function forwardSpaceStopAfterRemoteAgentAdmission(input: {
  ack: RemoteAgentWorkerSubmitMessagesResult;
  env: CoreBindings;
  request: RemoteAgentWorkerSubmitTurnRequest;
  worker: NonNullable<CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]>;
}): Promise<void> {
  try {
    if (!(await isRemoteAgentRequestStopRequested(input.env, input.request))) {
      return;
    }
    if (!input.worker.cancelExecution) {
      throw new Error("remote_agent.cancellation_receiver_unavailable");
    }
    const conversationId = resolveRemoteAgentRuntimeConversationId(
      input.request
    );
    const response = remoteAgentWorkerCancellationResponseSchema.parse(
      await input.worker.cancelExecution({
        ...(conversationId ? { conversationId } : {}),
        idempotencyKey: input.request.idempotencyKey,
        organizationId: input.request.organizationId,
        spaceId: input.request.spaceId,
        submissionId: input.ack.submissionId,
        reason: "User stopped this Wake.",
        v: 1,
      })
    );
    if (
      response.status === "not_found" ||
      response.status === "identity_mismatch"
    ) {
      throw new Error("remote_agent.cancellation_execution_unavailable");
    }
  } catch (error) {
    console.warn("[core.remote_agent.admission_stop_forwarding_deferred]", {
      dispatchId: input.request.dispatchId,
      submissionId: input.ack.submissionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
