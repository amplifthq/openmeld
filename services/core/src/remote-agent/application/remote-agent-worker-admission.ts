import {
  REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_PUBLIC_COPY,
  REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE,
  remoteAgentWorkerCancellationResponseSchema,
  remoteAgentWorkerSubmitTurnResponseSchema,
  resolveMappedPublicAgentFailureReason,
} from "@openmeld/schemas";
import type {
  RemoteAgentWorkerSubmitMessagesResult,
  RemoteAgentWorkerSubmitTurnRequest,
  RemoteAgentWorkerSubmitTurnResponse,
} from "@openmeld/schemas/types";
import {
  isCenterAgentDesignationActive,
  readCenterAgentDesignationRecord,
} from "../../center-agent/center-agent-repository";
import type { CoreBindings } from "../../lib/bindings";
import { identityDb } from "../../lib/bindings";
import { isRpcReceiverMethodNotImplementedError } from "../../rpc/errors";
import {
  advanceRemoteAgentConversationGeneration,
  markRemoteAgentConversationGenerationStarted,
  type RemoteAgentConversationGeneration,
  readRemoteAgentConversationGeneration,
} from "../infrastructure/d1/conversation-generation-repo";
import { admitRemoteAgentDailyDelivery } from "../infrastructure/d1/daily-admission-repo";
import { replaceRemoteAgentWorkerSubmitRequestForGeneration } from "../infrastructure/d1/native-delivery-ledger-repo";
import {
  REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_MESSAGE,
  REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_REASON_CODE,
  resolveRemoteAgentDailyAdmissionLimit,
} from "./daily-admission-policy";
import {
  buildRemoteAgentConversationContinuityContext,
  buildRemoteAgentWorkerSubmitTurnRequestV4,
  resolveRemoteAgentLogicalConversationId,
  resolveRemoteAgentRuntimeConversationId,
} from "./remote-agent-conversation-continuity";

export type RemoteAgentWorkerAdmission =
  | {
      ack: RemoteAgentWorkerSubmitMessagesResult;
      status: "acknowledged";
    }
  | {
      response: {
        message: string;
        reasonCode: string;
      };
      status: "rejected";
    }
  | {
      error: unknown;
      status: "outcome_unknown";
    }
  | {
      error: unknown;
      status: "protocol_error";
    }
  | {
      error: unknown;
      status: "receiver_unavailable";
    };

type RequiredRemoteAgentWorkerSubmitter = {
  submitConversationTurn(
    input: RemoteAgentWorkerSubmitTurnRequest
  ): Promise<RemoteAgentWorkerSubmitTurnResponse>;
};

const CENTER_AGENT_PAUSED_ADMISSION_RESPONSE = {
  message:
    "Center Agent is paused. Ask the Organization creator to resume it before trying again.",
  reasonCode: "remote_agent.center_agent_paused",
} as const;
const REMOTE_AGENT_ADMISSION_FALLBACK_PUBLIC_COPY =
  "Center Agent could not start this request. Please try again.";

export function resolveRemoteAgentAdmissionPublicCopy(input: {
  conversationKind: "message_channel" | "slack" | "space";
  reasonCode: string;
}): string {
  if (input.reasonCode === CENTER_AGENT_PAUSED_ADMISSION_RESPONSE.reasonCode) {
    return CENTER_AGENT_PAUSED_ADMISSION_RESPONSE.message;
  }
  if (input.reasonCode === REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_REASON_CODE) {
    return REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_MESSAGE;
  }
  if (
    input.conversationKind !== "space" &&
    input.reasonCode ===
      REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE
  ) {
    return REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_PUBLIC_COPY;
  }
  return (
    resolveMappedPublicAgentFailureReason(input.reasonCode) ??
    REMOTE_AGENT_ADMISSION_FALLBACK_PUBLIC_COPY
  );
}

export async function submitRemoteAgentWorkerAdmission(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  organizationId: string;
  request: RemoteAgentWorkerSubmitTurnRequest;
  worker: NonNullable<CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]>;
}): Promise<RemoteAgentWorkerAdmission> {
  const centerAgentDb = identityDb(input.env);
  if (centerAgentDb) {
    const designation = await readCenterAgentDesignationRecord({
      db: centerAgentDb,
      organizationId: input.organizationId,
    });
    if (
      designation?.agentProfileId === input.request.agentProfileId &&
      !isCenterAgentDesignationActive(designation)
    ) {
      return {
        response: CENTER_AGENT_PAUSED_ADMISSION_RESPONSE,
        status: "rejected",
      };
    }
  }

  const dailyAdmission = await admitRemoteAgentDailyDelivery({
    db: input.db,
    idempotencyKey: input.request.idempotencyKey,
    limit: resolveRemoteAgentDailyAdmissionLimit(
      input.env.OPENMELD_REMOTE_AGENT_DAILY_ADMISSION_LIMIT
    ),
    nowMs: input.nowMs,
    organizationId: input.organizationId,
  });
  if (dailyAdmission.status === "rejected") {
    return {
      response: {
        message: REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_MESSAGE,
        reasonCode: REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_REASON_CODE,
      },
      status: "rejected",
    };
  }

  let generation: RemoteAgentConversationGeneration | null = null;
  let request = input.request;
  if (input.request.v !== 1) {
    try {
      generation = await readRemoteAgentConversationGeneration({
        db: input.db,
        logicalConversationId: resolveRemoteAgentLogicalConversationId(
          input.request
        ),
        organizationId: input.organizationId,
      });
      request = await prepareGenerationRequest({
        ...input,
        generation,
        request: input.request,
      });
    } catch (error) {
      return { error, status: "protocol_error" };
    }
  }

  let response: RemoteAgentWorkerSubmitTurnResponse;
  try {
    // Once admitted, downstream failures do not roll back the daily count.
    // Retries reuse the ledger marker above and therefore are never recounted.
    response = await submitRemoteAgentWorkerTurn(input.worker, request);
  } catch (error) {
    return {
      error,
      status: isRpcReceiverMethodNotImplementedError(error)
        ? "receiver_unavailable"
        : "outcome_unknown",
    };
  }

  const parsed = remoteAgentWorkerSubmitTurnResponseSchema.safeParse(response);
  if (!parsed.success) {
    return { error: parsed.error, status: "protocol_error" };
  }
  if ("outcome" in parsed.data) {
    if (
      parsed.data.reasonCode ===
        REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE &&
      request.v === 4 &&
      generation
    ) {
      const rolloverAdmission = await rolloverRemoteAgentConversation({
        ...input,
        currentGeneration: generation,
        request,
      });
      if (rolloverAdmission.status !== "acknowledged") {
        return rolloverAdmission;
      }
      return await finishAcknowledgedAdmission({
        ...input,
        ack: rolloverAdmission.ack,
        request: rolloverAdmission.request,
      });
    }
    return { response: parsed.data, status: "rejected" };
  }
  return await finishAcknowledgedAdmission({
    ...input,
    ack: parsed.data,
    request,
  });
}

async function prepareGenerationRequest(input: {
  db: D1Database;
  env: CoreBindings;
  generation: RemoteAgentConversationGeneration;
  nowMs: number;
  request: Exclude<RemoteAgentWorkerSubmitTurnRequest, { v: 1 }>;
}): Promise<RemoteAgentWorkerSubmitTurnRequest> {
  let continuityContext =
    input.request.v === 4 &&
    input.request.runtimeConversation.generation === input.generation.generation
      ? input.request.continuityContext
      : undefined;
  if (
    !continuityContext &&
    input.generation.generation > 0 &&
    input.generation.startedAtMs === null
  ) {
    continuityContext = await buildRemoteAgentConversationContinuityContext({
      db: input.db,
      env: input.env,
      generation: input.generation.generation,
      request: input.request,
    });
  }
  const request = buildRemoteAgentWorkerSubmitTurnRequestV4({
    ...(continuityContext ? { continuityContext } : {}),
    generation: input.generation.generation,
    request: input.request,
  });
  const persisted = await replaceRemoteAgentWorkerSubmitRequestForGeneration({
    db: input.db,
    idempotencyKey: request.idempotencyKey,
    nowMs: input.nowMs,
    workerSubmitRequest: request,
  });
  if (!persisted) {
    throw new Error(
      "Remote Agent runtime conversation generation was not persisted before admission."
    );
  }
  return request;
}

async function rolloverRemoteAgentConversation(input: {
  currentGeneration: RemoteAgentConversationGeneration;
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  organizationId: string;
  request: RemoteAgentWorkerSubmitTurnRequest & { v: 4 };
  worker: NonNullable<CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]>;
}): Promise<
  | {
      ack: RemoteAgentWorkerSubmitMessagesResult;
      request: RemoteAgentWorkerSubmitTurnRequest & { v: 4 };
      status: "acknowledged";
    }
  | Exclude<RemoteAgentWorkerAdmission, { status: "acknowledged" }>
> {
  let request: RemoteAgentWorkerSubmitTurnRequest;
  try {
    const generation = await advanceRemoteAgentConversationGeneration({
      db: input.db,
      deliveryId: input.request.dispatchId,
      expectedGeneration: input.currentGeneration.generation,
      logicalConversationId: resolveRemoteAgentLogicalConversationId(
        input.request
      ),
      nowMs: input.nowMs,
      organizationId: input.organizationId,
    });
    request = await prepareGenerationRequest({
      ...input,
      generation,
      request: input.request,
    });
  } catch (error) {
    return { error, status: "protocol_error" };
  }

  let response: RemoteAgentWorkerSubmitTurnResponse;
  try {
    response = await submitRemoteAgentWorkerTurn(input.worker, request);
  } catch (error) {
    return {
      error,
      status: isRpcReceiverMethodNotImplementedError(error)
        ? "receiver_unavailable"
        : "outcome_unknown",
    };
  }
  const parsed = remoteAgentWorkerSubmitTurnResponseSchema.safeParse(response);
  if (!parsed.success) {
    return { error: parsed.error, status: "protocol_error" };
  }
  if ("outcome" in parsed.data) {
    return { response: parsed.data, status: "rejected" };
  }
  return {
    ack: parsed.data,
    request: request as RemoteAgentWorkerSubmitTurnRequest & { v: 4 },
    status: "acknowledged",
  };
}

async function finishAcknowledgedAdmission(input: {
  ack: RemoteAgentWorkerSubmitMessagesResult;
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  organizationId: string;
  request: RemoteAgentWorkerSubmitTurnRequest;
  worker: NonNullable<CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]>;
}): Promise<RemoteAgentWorkerAdmission> {
  if (input.request.v === 4) {
    try {
      await markRemoteAgentConversationGenerationStarted({
        db: input.db,
        generation: input.request.runtimeConversation.generation,
        logicalConversationId: input.request.conversationId,
        nowMs: input.nowMs,
        organizationId: input.organizationId,
      });
    } catch (error) {
      console.error(
        "[core.remote_agent.conversation_generation_start_record_failed]",
        {
          dispatchId: input.request.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          generation: input.request.runtimeConversation.generation,
          organizationId: input.organizationId,
        }
      );
    }
  }
  const pauseFenceFailure = await requestCancellationWhenPausedAfterAdmission({
    ...input,
    centerAgentDb: identityDb(input.env),
  });
  return pauseFenceFailure ?? { ack: input.ack, status: "acknowledged" };
}

async function requestCancellationWhenPausedAfterAdmission(input: {
  ack: RemoteAgentWorkerSubmitMessagesResult;
  centerAgentDb: D1Database | undefined;
  organizationId: string;
  request: RemoteAgentWorkerSubmitTurnRequest;
  worker: NonNullable<CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]>;
}): Promise<RemoteAgentWorkerAdmission | null> {
  if (!input.centerAgentDb) {
    return null;
  }
  const designation = await readCenterAgentDesignationRecord({
    db: input.centerAgentDb,
    organizationId: input.organizationId,
  });
  if (
    designation?.agentProfileId !== input.request.agentProfileId ||
    isCenterAgentDesignationActive(designation)
  ) {
    return null;
  }
  const cancelExecution = input.worker.cancelExecution?.bind(input.worker);
  if (!cancelExecution) {
    return {
      error: new Error(
        "remote_agent.center_agent_pause_cancellation_receiver_unavailable"
      ),
      status: "outcome_unknown",
    };
  }
  try {
    const cancellation = remoteAgentWorkerCancellationResponseSchema.parse(
      await cancelExecution({
        ...(resolveRemoteAgentRuntimeConversationId(input.request)
          ? {
              conversationId: resolveRemoteAgentRuntimeConversationId(
                input.request
              ),
            }
          : {}),
        idempotencyKey: input.request.idempotencyKey,
        organizationId: input.organizationId,
        reason: "Center Agent was paused by the Organization creator.",
        spaceId: input.request.spaceId,
        submissionId: input.ack.submissionId,
        v: 1,
      })
    );
    if (cancellation.status === "identity_mismatch") {
      return {
        error: new Error(cancellation.reasonCode),
        status: "outcome_unknown",
      };
    }
    if (cancellation.status === "not_found") {
      return {
        response: CENTER_AGENT_PAUSED_ADMISSION_RESPONSE,
        status: "rejected",
      };
    }
    return null;
  } catch (error) {
    return { error, status: "outcome_unknown" };
  }
}

function submitRemoteAgentWorkerTurn(
  worker: NonNullable<CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]>,
  request: RemoteAgentWorkerSubmitTurnRequest
): Promise<RemoteAgentWorkerSubmitTurnResponse> {
  // RPC proxies expose arbitrary method properties; direct invocation is the
  // only reliable capability check after the binding itself is present.
  return (worker as RequiredRemoteAgentWorkerSubmitter).submitConversationTurn(
    request
  );
}
