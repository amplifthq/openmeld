import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_PUBLIC_COPY,
  REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE,
  remoteAgentWorkerCancellationResponseSchema,
  remoteAgentWorkerReadAdmissionResponseSchema,
  remoteAgentWorkerReadAdmissionStopResponseSchema,
  remoteAgentWorkerSubmitCapabilitiesSchema,
  remoteAgentWorkerSubmitTurnResponseSchema,
  resolveMappedPublicAgentFailureReason,
} from "@openmeld/schemas";
import type {
  RemoteAgentWorkerReadAdmissionStopResponse,
  RemoteAgentWorkerSubmitMessagesResult,
  RemoteAgentWorkerSubmitTurnRequest,
  RemoteAgentWorkerSubmitTurnResponse,
} from "@openmeld/schemas/types";
import {
  isCenterAgentDesignationActive,
  readCenterAgentDesignationRecord,
} from "../../center-agent/center-agent-repository";
import type { CoreBindings } from "../../lib/bindings";

import {
  isRpcReceiverMethodNotImplementedError,
  isRpcReceiverMethodNotImplementedErrorForMethod,
} from "../../rpc/errors";
import {
  BYOK_UNAVAILABLE_MESSAGE,
  MONTHLY_AI_LIMIT_MESSAGE,
  readAiBilling,
} from "../../usage/ai-billing-service";
import {
  REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_MESSAGE,
  REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_REASON_CODE,
} from "../../usage/ai-usage-policy";
import {
  advanceRemoteAgentConversationGeneration,
  markRemoteAgentConversationGenerationStarted,
  type RemoteAgentConversationGeneration,
  readRemoteAgentConversationGeneration,
} from "../infrastructure/postgresql/conversation-generation-repo";
import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/postgresql/native-delivery-ledger-repo";
import { replaceRemoteAgentWorkerSubmitRequestForGeneration } from "../infrastructure/postgresql/native-delivery-ledger-repo";
import { reportNativeDeliveryAdmissionEvidence } from "./native-delivery-admission-evidence";
import { requirePersonalRemoteAgentBinding } from "./personal-remote-agent-binding";
import {
  buildRemoteAgentConversationContinuityContext,
  buildRemoteAgentWorkerSubmitTurnRequestV4,
  isRemoteAgentRoutineRunConversation,
  resolveRemoteAgentLogicalConversationId,
  resolveRemoteAgentRuntimeConversationId,
} from "./remote-agent-conversation-continuity";
import {
  forwardSpaceStopAfterRemoteAgentAdmission,
  isRemoteAgentRequestStopRequested,
  RemoteAgentWakeStoppedBeforeAdmissionError,
} from "./space-wake-stop-intent";
import { requireTaskContinuationSummaryPolicy } from "./task-continuation-summary-policy";
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
    "Center Agent is paused. Ask the Organization owner or admin to resume it before trying again.",
  reasonCode: "remote_agent.center_agent_paused",
} as const;
const REMOTE_AGENT_ADMISSION_FALLBACK_PUBLIC_COPY =
  "Center Agent could not start this request. Please try again.";
const ROUTINE_RUN_HISTORY_LIMIT_RESPONSE = {
  message:
    "This Routine Run could not continue after its execution history reached the safety limit.",
  reasonCode: REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE,
} as const;
/** Select optional fields only before the owning ledger freezes a new request. */
export async function resolveRemoteAgentWorkerTaskAttribution(
  worker: NonNullable<CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]>,
  taskId: string | undefined
): Promise<{
  taskId?: string;
}> {
  if (!(taskId && worker.readSubmitTurnCapabilities)) {
    return {};
  }
  let value: unknown;
  try {
    value = await worker.readSubmitTurnCapabilities({ v: 1 });
  } catch (error) {
    if (
      isRpcReceiverMethodNotImplementedErrorForMethod(
        error,
        "readSubmitTurnCapabilities"
      )
    ) {
      return {};
    }
    throw error;
  }
  remoteAgentWorkerSubmitCapabilitiesSchema.parse(value);
  return { taskId };
}
/** null means an older receiver; not_found means a current owner has no fence. */
export async function readRemoteAgentWorkerAdmissionStop(input: {
  request: RemoteAgentWorkerSubmitTurnRequest;
  worker: Pick<
    NonNullable<CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]>,
    "readAdmissionStop"
  >;
}): Promise<RemoteAgentWorkerReadAdmissionStopResponse | null> {
  if (!input.worker.readAdmissionStop) {
    return null;
  }
  let value: unknown;
  try {
    value = await input.worker.readAdmissionStop(input.request);
  } catch (error) {
    if (
      isRpcReceiverMethodNotImplementedErrorForMethod(
        error,
        "readAdmissionStop"
      )
    ) {
      return null;
    }
    throw error;
  }
  const response =
    remoteAgentWorkerReadAdmissionStopResponseSchema.parse(value);
  if (response.status === "not_found") {
    return response;
  }
  const { stopIntent } = response;
  if (
    stopIntent.organizationId !== input.request.organizationId ||
    stopIntent.spaceId !== input.request.spaceId ||
    stopIntent.idempotencyKey !== input.request.idempotencyKey
  ) {
    throw new Error("remote_agent.admission_stop_receipt_identity_mismatch");
  }
  return response;
}
/** Recover the original ACK without replaying an admission request. */
export async function readRemoteAgentWorkerAdmission(input: {
  admissionDelivery?: RemoteAgentNativeDeliveryRecord;
  request: RemoteAgentWorkerSubmitTurnRequest;
  worker: Pick<
    NonNullable<CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]>,
    "readAdmission"
  >;
}): Promise<RemoteAgentWorkerSubmitMessagesResult | null> {
  if (!input.worker.readAdmission) {
    // Mixed-version receiver: preserve the existing exact-idempotency policy.
    return null;
  }
  const response = remoteAgentWorkerReadAdmissionResponseSchema.parse(
    await input.worker.readAdmission(input.request)
  );
  if (response.status !== "found") {
    return null;
  }
  if (response.ack.idempotencyKey !== input.request.idempotencyKey) {
    throw new Error("remote_agent.admission_receipt_identity_mismatch");
  }
  reportNativeDeliveryAdmissionEvidence({
    delivery: input.admissionDelivery,
    observedAtMs: Date.now(),
    phase: "acknowledged",
    submissionId: response.ack.submissionId,
  });
  return response.ack;
}
function cannotResumeRoutineRunGeneration(input: {
  generation: RemoteAgentConversationGeneration;
  request: RemoteAgentWorkerSubmitTurnRequest;
}): boolean {
  return (
    input.generation.generation > 0 &&
    input.generation.startedAtMs === null &&
    isRemoteAgentRoutineRunConversation(input.request)
  );
}
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
  if (input.reasonCode === "ai_usage.monthly_limit_reached") {
    return MONTHLY_AI_LIMIT_MESSAGE;
  }
  if (input.reasonCode === "ai_billing.key_unavailable") {
    return BYOK_UNAVAILABLE_MESSAGE;
  }
  if (input.reasonCode === "ai_billing.unavailable") {
    return "AI billing is temporarily unavailable. Try again later or add your own OpenRouter key in AI usage settings.";
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
async function validatePersonalRemoteAgentAdmission(input: {
  env: CoreBindings;
  request: RemoteAgentWorkerSubmitTurnRequest;
}): Promise<Extract<
  RemoteAgentWorkerAdmission,
  {
    status: "rejected";
  }
> | null> {
  const request = input.request;
  if (
    request.v !== 4 ||
    request.conversationIdentity?.kind !== "personal_agent"
  ) {
    return null;
  }
  try {
    const db = getPostgresDatabase(input.env);
    if (!(db && request.agentProfileOwnerUserId)) {
      throw new Error("remote_agent.personal_profile_unavailable");
    }
    await requirePersonalRemoteAgentBinding({
      db,
      agentProfileId: request.agentProfileId,
      bindingId: request.bindingId,
      organizationId: request.organizationId,
      ownerUserId: request.agentProfileOwnerUserId,
    });
    return null;
  } catch (error) {
    console.warn("[core.remote_agent.personal_admission_rejected]", {
      agentProfileId: request.agentProfileId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      status: "rejected",
      response: {
        reasonCode: "remote_agent.personal_profile_unavailable",
        message: "This Remote Agent is unavailable.",
      },
    };
  }
}
export async function submitRemoteAgentWorkerAdmission(input: {
  admissionDelivery?: RemoteAgentNativeDeliveryRecord;
  continuitySourceDispatchId?: string;
  db: PostgresDatabase;
  env: CoreBindings;
  nowMs: number;
  organizationId: string;
  request: RemoteAgentWorkerSubmitTurnRequest;
  worker: NonNullable<CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]>;
}): Promise<RemoteAgentWorkerAdmission> {
  const started = performance.now();
  const startedAtMs = Date.now();
  reportNativeDeliveryAdmissionEvidence({
    delivery: input.admissionDelivery,
    observedAtMs: startedAtMs,
    phase: "preparing",
  });
  try {
    const result = await performRemoteAgentWorkerAdmission(input);
    const observedAtMs = Date.now();
    reportNativeDeliveryAdmissionEvidence({
      delivery: input.admissionDelivery,
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      observedAtMs,
      phase: "admission_finished",
      outcome: result.status,
    });
    return result;
  } catch (error) {
    const observedAtMs = Date.now();
    reportNativeDeliveryAdmissionEvidence({
      delivery: input.admissionDelivery,
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      observedAtMs,
      phase: "unexpected_error",
    });
    throw error;
  }
}
async function performRemoteAgentWorkerAdmission(
  input: Parameters<typeof submitRemoteAgentWorkerAdmission>[0]
): Promise<RemoteAgentWorkerAdmission> {
  const centerAgentDb = getPostgresDatabase(input.env);
  const personalRejection = await validatePersonalRemoteAgentAdmission(input);
  if (personalRejection) {
    return personalRejection;
  }
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
  // A previously saved Stop must not spend an admission or be reported as a
  // quota failure. Keep the authorization fence immediately before submission
  // as well: this read-only preflight does not close the concurrent Stop race.
  try {
    if (await isRemoteAgentRequestStopRequested(input.env, input.request)) {
      return resolveWorkerSubmitFailure(
        new RemoteAgentWakeStoppedBeforeAdmissionError()
      );
    }
  } catch (error) {
    return resolveWorkerSubmitFailure(error);
  }
  await requireTaskContinuationSummaryPolicy({
    env: input.env,
    requests: [
      input.request,
      input.admissionDelivery?.workerSubmitRequest ?? null,
      input.admissionDelivery?.executionRecoverySubmitRequest ?? null,
    ],
  });
  const billingRejection = await validateAiBillingAdmission(
    input.env,
    input.organizationId
  );
  if (billingRejection) {
    return billingRejection;
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
      if (
        cannotResumeRoutineRunGeneration({ generation, request: input.request })
      ) {
        return {
          response: ROUTINE_RUN_HISTORY_LIMIT_RESPONSE,
          status: "rejected",
        };
      }
      request = await prepareGenerationRequest({
        ...input,
        generation,
        request: input.request,
      });
    } catch (error) {
      return { error, status: "protocol_error" };
    }
  }
  let parsed: ReturnType<
    typeof remoteAgentWorkerSubmitTurnResponseSchema.safeParse
  >;
  try {
    // Once admitted, downstream failures do not roll back the daily count.
    // Retries reuse the ledger marker above and therefore are never recounted.
    parsed = await submitRemoteAgentWorkerTurn(
      input.worker,
      request,
      input.env,
      input.admissionDelivery
    );
  } catch (error) {
    return resolveWorkerSubmitFailure(error);
  }
  if (!parsed.success) {
    return { error: parsed.error, status: "protocol_error" };
  }
  if ("outcome" in parsed.data) {
    return await handleRejectedWorkerOutcome({
      admissionInput: input,
      generation,
      request,
      response: parsed.data,
    });
  }
  return await finishAcknowledgedAdmission({
    ...input,
    ack: parsed.data,
    request,
  });
}
async function handleRejectedWorkerOutcome(input: {
  admissionInput: Parameters<typeof submitRemoteAgentWorkerAdmission>[0];
  generation: RemoteAgentConversationGeneration | null;
  request: RemoteAgentWorkerSubmitTurnRequest;
  response: Extract<
    RemoteAgentWorkerSubmitTurnResponse,
    {
      outcome: "rejected";
    }
  >;
}): Promise<RemoteAgentWorkerAdmission> {
  if (
    input.response.reasonCode !==
      REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE ||
    isRemoteAgentRoutineRunConversation(input.request) ||
    input.request.v !== 4 ||
    !input.generation
  ) {
    return { response: input.response, status: "rejected" };
  }
  const rolloverAdmission = await rolloverRemoteAgentConversation({
    ...input.admissionInput,
    currentGeneration: input.generation,
    request: input.request,
  });
  if (rolloverAdmission.status !== "acknowledged") {
    return rolloverAdmission;
  }
  return await finishAcknowledgedAdmission({
    ...input.admissionInput,
    ack: rolloverAdmission.ack,
    request: rolloverAdmission.request,
  });
}
async function prepareGenerationRequest(input: {
  continuitySourceDispatchId?: string;
  db: PostgresDatabase;
  env: CoreBindings;
  generation: RemoteAgentConversationGeneration;
  nowMs: number;
  request: Exclude<
    RemoteAgentWorkerSubmitTurnRequest,
    {
      v: 1;
    }
  >;
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
      ...(input.continuitySourceDispatchId
        ? { sourceDispatchId: input.continuitySourceDispatchId }
        : {}),
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
  admissionDelivery?: RemoteAgentNativeDeliveryRecord;
  currentGeneration: RemoteAgentConversationGeneration;
  db: PostgresDatabase;
  env: CoreBindings;
  nowMs: number;
  organizationId: string;
  request: RemoteAgentWorkerSubmitTurnRequest & {
    v: 4;
  };
  worker: NonNullable<CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]>;
}): Promise<
  | {
      ack: RemoteAgentWorkerSubmitMessagesResult;
      request: RemoteAgentWorkerSubmitTurnRequest & {
        v: 4;
      };
      status: "acknowledged";
    }
  | Exclude<
      RemoteAgentWorkerAdmission,
      {
        status: "acknowledged";
      }
    >
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
  let parsed: ReturnType<
    typeof remoteAgentWorkerSubmitTurnResponseSchema.safeParse
  >;
  try {
    parsed = await submitRemoteAgentWorkerTurn(
      input.worker,
      request,
      input.env,
      input.admissionDelivery
    );
  } catch (error) {
    return resolveWorkerSubmitFailure(error);
  }
  if (!parsed.success) {
    return { error: parsed.error, status: "protocol_error" };
  }
  if ("outcome" in parsed.data) {
    return { response: parsed.data, status: "rejected" };
  }
  return {
    ack: parsed.data,
    request: request as RemoteAgentWorkerSubmitTurnRequest & {
      v: 4;
    },
    status: "acknowledged",
  };
}
export async function finishAcknowledgedAdmission(input: {
  admissionDelivery?: RemoteAgentNativeDeliveryRecord;
  ack: RemoteAgentWorkerSubmitMessagesResult;
  db: PostgresDatabase;
  env: CoreBindings;
  nowMs: number;
  organizationId: string;
  request: RemoteAgentWorkerSubmitTurnRequest;
  worker: NonNullable<CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]>;
}): Promise<RemoteAgentWorkerAdmission> {
  const started = performance.now();
  reportNativeDeliveryAdmissionEvidence({
    delivery: input.admissionDelivery,
    observedAtMs: Date.now(),
    phase: "postprocessing_started",
    submissionId: input.ack.submissionId,
  });
  try {
    const result = await performAcknowledgedAdmissionPostprocessing(input);
    reportNativeDeliveryAdmissionEvidence({
      delivery: input.admissionDelivery,
      observedAtMs: Date.now(),
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      phase: "postprocessing_finished",
      outcome: result.status,
      submissionId: input.ack.submissionId,
    });
    return result;
  } catch (error) {
    reportNativeDeliveryAdmissionEvidence({
      delivery: input.admissionDelivery,
      observedAtMs: Date.now(),
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      phase: "postprocessing_finished",
      outcome: "unexpected_error",
      submissionId: input.ack.submissionId,
    });
    throw error;
  }
}
async function performAcknowledgedAdmissionPostprocessing(
  input: Parameters<typeof finishAcknowledgedAdmission>[0]
): Promise<RemoteAgentWorkerAdmission> {
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
  await forwardSpaceStopAfterRemoteAgentAdmission(input);
  const pauseFenceFailure = await requestCancellationWhenPausedAfterAdmission({
    ...input,
    centerAgentDb: getPostgresDatabase(input.env),
  });
  return pauseFenceFailure ?? { ack: input.ack, status: "acknowledged" };
}
async function requestCancellationWhenPausedAfterAdmission(input: {
  ack: RemoteAgentWorkerSubmitMessagesResult;
  centerAgentDb: PostgresDatabase | undefined;
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
  if (!input.worker.cancelExecution) {
    return {
      error: new Error(
        "remote_agent.center_agent_pause_cancellation_receiver_unavailable"
      ),
      status: "outcome_unknown",
    };
  }
  try {
    const cancellation = remoteAgentWorkerCancellationResponseSchema.parse(
      await input.worker.cancelExecution({
        ...(resolveRemoteAgentRuntimeConversationId(input.request)
          ? {
              conversationId: resolveRemoteAgentRuntimeConversationId(
                input.request
              ),
            }
          : {}),
        idempotencyKey: input.request.idempotencyKey,
        organizationId: input.organizationId,
        reason: "Center Agent was paused by the Organization owner or admin.",
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
function resolveWorkerSubmitFailure(error: unknown): Exclude<
  RemoteAgentWorkerAdmission,
  {
    status: "acknowledged";
  }
> {
  if (error instanceof RemoteAgentWakeStoppedBeforeAdmissionError) {
    return {
      status: "rejected",
      response: {
        message: error.message,
        reasonCode: "remote_agent.execution_cancelled",
      },
    };
  }
  return {
    error,
    status: isRpcReceiverMethodNotImplementedError(error)
      ? "receiver_unavailable"
      : "outcome_unknown",
  };
}
async function submitRemoteAgentWorkerTurn(
  worker: NonNullable<CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]>,
  request: RemoteAgentWorkerSubmitTurnRequest,
  env: CoreBindings,
  admissionDelivery?: RemoteAgentNativeDeliveryRecord
): Promise<
  ReturnType<typeof remoteAgentWorkerSubmitTurnResponseSchema.safeParse>
> {
  if (await isRemoteAgentRequestStopRequested(env, request, true)) {
    throw new RemoteAgentWakeStoppedBeforeAdmissionError();
  }
  reportNativeDeliveryAdmissionEvidence({
    delivery: admissionDelivery,
    observedAtMs: Date.now(),
    phase: "sending",
  });
  // RPC proxies expose arbitrary method properties; direct invocation is the
  // only reliable capability check after the binding itself is present.
  const started = performance.now();
  const response = await (
    worker as RequiredRemoteAgentWorkerSubmitter
  ).submitConversationTurn(request);
  const parsed = remoteAgentWorkerSubmitTurnResponseSchema.safeParse(response);
  if (parsed.success && !("outcome" in parsed.data)) {
    // Record the validated receipt before generation writes, Stop forwarding
    // or pause cancellation can wait or fail. This is evidence, not authority.
    reportNativeDeliveryAdmissionEvidence({
      delivery: admissionDelivery,
      observedAtMs: Date.now(),
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      phase: "acknowledged",
      accepted: parsed.data.accepted,
      submissionId: parsed.data.submissionId,
    });
  }
  return parsed;
}

async function validateAiBillingAdmission(
  env: CoreBindings,
  organizationId: string
): Promise<Extract<RemoteAgentWorkerAdmission, { status: "rejected" }> | null> {
  const billing = await readAiBilling(env, organizationId, false);
  if (billing.source === "byok" && billing.status !== "available") {
    return {
      response: {
        message: BYOK_UNAVAILABLE_MESSAGE,
        reasonCode: "ai_billing.key_unavailable",
      },
      status: "rejected",
    };
  }
  if (billing.status !== "available") {
    return {
      response: {
        message:
          billing.status === "exhausted"
            ? MONTHLY_AI_LIMIT_MESSAGE
            : "AI billing is unavailable. Check AI usage settings and try again.",
        reasonCode:
          billing.status === "exhausted"
            ? "ai_usage.monthly_limit_reached"
            : "ai_billing.unavailable",
      },
      status: "rejected",
    };
  }
  return null;
}
