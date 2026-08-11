import {
  type ProjectObservabilityCloudflareRuntimeEventInput,
  projectObservabilityCloudflareAnalyticsDataPoint,
  projectObservabilityCloudflareRuntimeConsoleEvent,
  projectObservabilityCloudflareRuntimeEvent,
  REMOTE_AGENT_RUNTIME_EVIDENCE_EVENTS,
  REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES,
  remoteAgentRuntimeEvidenceOutcomeReasonCodeSchema,
  shouldLogObservabilityCloudflareRuntimeEvent,
} from "@openmeld/schemas";
import type {
  RemoteAgentAdmissionStageOperation,
  RemoteAgentRpcOperation,
  RemoteAgentRuntimeEvidenceOutcomeReasonCode,
  RemoteAgentWorkerSubmitTurnResponse,
} from "@openmeld/schemas/types";
import { isRemoteAgentContextWindowExceeded } from "../agent-core/error-message";

type RemoteAgentCloudflareRuntimeEvidenceEnv = {
  OPENMELD_OBSERVABILITY?: AnalyticsEngineDataset;
  OPENMELD_WORKER_ENVIRONMENT?: string;
};

type RemoteAgentCloudflareRuntimeEvidenceInput = Omit<
  ProjectObservabilityCloudflareRuntimeEventInput,
  "reasonCode" | "workerEnvironment" | "workerName"
> & {
  reasonCode?: RemoteAgentRuntimeEvidenceOutcomeReasonCode;
};

type RemoteAgentTerminalEvidenceStatus = "failed" | "succeeded";
type RemoteAgentRuntimeEvidenceStatus =
  | RemoteAgentTerminalEvidenceStatus
  | "started";

type RemoteAgentRpcOutcome = {
  reasonCode: RemoteAgentRuntimeEvidenceOutcomeReasonCode;
  requestId?: string | null;
  status: RemoteAgentTerminalEvidenceStatus;
};

type RemoteAgentAdmissionStageEvidenceInput = {
  bindingId?: string | null;
  clientMessageId?: string | null;
  dispatchId?: string | null;
  durationMs?: number;
  operation: RemoteAgentAdmissionStageOperation;
  requestId?: string | null;
  spaceId?: string | null;
  status: RemoteAgentRuntimeEvidenceStatus;
  targetProfileId?: string | null;
};

type RemoteAgentExecutionStageEvidenceInput = {
  bindingId?: string | null;
  category: "materialization" | "provider" | "stream";
  clientMessageId?: string | null;
  dispatchId?: string | null;
  durationMs?: number;
  errorName?: string | null;
  inputBytes?: number;
  messageCount?: number;
  operation: string;
  requestId?: string | null;
  spaceId?: string | null;
  status: RemoteAgentRuntimeEvidenceStatus;
  statusCode?: number;
  targetProfileId?: string | null;
  toolCount?: number;
};

type ObserveRemoteAgentRpcInput<Result> = {
  bindingId?: string | null;
  clientMessageId?: string | null;
  dispatchId?: string | null;
  env: RemoteAgentCloudflareRuntimeEvidenceEnv;
  execute: () => Promise<Result>;
  operation: RemoteAgentRpcOperation;
  requestId?: string | null;
  resolveOutcome?: (result: Result) => RemoteAgentRpcOutcome;
  spaceId?: string | null;
  targetProfileId?: string | null;
};

type RemoteAgentTurnFailureClassification = {
  errorName: string;
  reasonCode: RemoteAgentRuntimeEvidenceOutcomeReasonCode;
};

const OBSERVABILITY_STRUCTURED_ERROR_KEYS = [
  "name",
  "type",
  "code",
  "status",
  "statusCode",
] as const;

const OBSERVABILITY_NESTED_ERROR_KEYS = [
  "cause",
  "error",
  "errorInfo",
  "reason",
  "response",
] as const;
const REMOTE_AGENT_EXECUTION_STAGE_EVENT =
  "remote_agent.openmeld.execution_stage";

export function emitRemoteAgentCloudflareRuntimeEvidence(
  env: RemoteAgentCloudflareRuntimeEvidenceEnv,
  input: RemoteAgentCloudflareRuntimeEvidenceInput
): void {
  try {
    const reasonCode = input.reasonCode
      ? remoteAgentRuntimeEvidenceOutcomeReasonCodeSchema.parse(
          input.reasonCode
        )
      : undefined;
    const event = projectObservabilityCloudflareRuntimeEvent({
      ...input,
      reasonCode,
      workerEnvironment: env.OPENMELD_WORKER_ENVIRONMENT,
      workerName: "openmeld-remote-agent",
    });
    if (shouldLogObservabilityCloudflareRuntimeEvent(event)) {
      console.info(projectObservabilityCloudflareRuntimeConsoleEvent(event));
    }
    env.OPENMELD_OBSERVABILITY?.writeDataPoint(
      projectObservabilityCloudflareAnalyticsDataPoint(event)
    );
  } catch (error) {
    console.error({
      event:
        "remote_agent.openmeld.observability.runtime_evidence_projection_failed",
      errorName: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      requestId: normalizeOptionalText(input.requestId),
    });
  }
}

export function emitRemoteAgentAdmissionStageEvidence(
  env: RemoteAgentCloudflareRuntimeEvidenceEnv,
  input: RemoteAgentAdmissionStageEvidenceInput
): void {
  emitRemoteAgentCloudflareRuntimeEvidence(env, {
    ...input,
    // Analytics Engine is limited to 20 blob fields and the shared layout uses
    // all 20 for cross-runtime correlation. Keep the stage queryable after
    // persistence by encoding it in the event name as well as `operation`.
    event: `${REMOTE_AGENT_RUNTIME_EVIDENCE_EVENTS.ADMISSION_STAGE}.${input.operation}`,
    method: "RPC",
    runtimeKind: "durable_object",
  });
}

export function emitRemoteAgentExecutionStageEvidence(
  env: RemoteAgentCloudflareRuntimeEvidenceEnv,
  input: RemoteAgentExecutionStageEvidenceInput
): void {
  const isProviderStage = input.category === "provider";
  emitRemoteAgentCloudflareRuntimeEvidence(env, {
    ...input,
    event: `${REMOTE_AGENT_EXECUTION_STAGE_EVENT}.${input.category}.${input.operation}`,
    method: isProviderStage ? "POST" : "INTERNAL",
    runtimeKind: isProviderStage ? "http" : "durable_object",
  });
}

export async function observeRemoteAgentRpc<Result>(
  input: ObserveRemoteAgentRpcInput<Result>
): Promise<Result> {
  const startedAtMs = Date.now();
  emitRemoteAgentCloudflareRuntimeEvidence(input.env, {
    bindingId: input.bindingId,
    clientMessageId: input.clientMessageId,
    dispatchId: input.dispatchId,
    event: REMOTE_AGENT_RUNTIME_EVIDENCE_EVENTS.RPC,
    method: "RPC",
    operation: input.operation,
    requestId: input.requestId,
    runtimeKind: "rpc",
    spaceId: input.spaceId,
    status: "started",
    targetProfileId: input.targetProfileId,
  });
  try {
    const result = await input.execute();
    const outcome = input.resolveOutcome?.(result) ?? {
      reasonCode: REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.RPC_SUCCEEDED,
      status: "succeeded",
    };
    emitRemoteAgentCloudflareRuntimeEvidence(input.env, {
      bindingId: input.bindingId,
      clientMessageId: input.clientMessageId,
      dispatchId: input.dispatchId,
      durationMs: Date.now() - startedAtMs,
      event: REMOTE_AGENT_RUNTIME_EVIDENCE_EVENTS.RPC,
      method: "RPC",
      operation: input.operation,
      reasonCode: outcome.reasonCode,
      requestId: outcome.requestId ?? input.requestId,
      runtimeKind: "rpc",
      spaceId: input.spaceId,
      status: outcome.status,
      targetProfileId: input.targetProfileId,
    });
    return result;
  } catch (error) {
    const failure = classifyRemoteAgentRpcFailure(input.operation, error);
    emitRemoteAgentCloudflareRuntimeEvidence(input.env, {
      bindingId: input.bindingId,
      clientMessageId: input.clientMessageId,
      dispatchId: input.dispatchId,
      durationMs: Date.now() - startedAtMs,
      errorName: failure.errorName,
      event: REMOTE_AGENT_RUNTIME_EVIDENCE_EVENTS.RPC,
      method: "RPC",
      operation: input.operation,
      reasonCode: failure.reasonCode,
      requestId: input.requestId,
      runtimeKind: "rpc",
      spaceId: input.spaceId,
      status: "failed",
      targetProfileId: input.targetProfileId,
    });
    throw error;
  }
}

export function resolveSubmitConversationTurnOutcome(
  response: RemoteAgentWorkerSubmitTurnResponse
): RemoteAgentRpcOutcome {
  if ("outcome" in response) {
    return { reasonCode: response.reasonCode, status: "failed" };
  }
  if (!response.accepted) {
    return {
      reasonCode:
        response.status === "running"
          ? REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.ADMISSION_CONVERSATION_BUSY
          : REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.ADMISSION_NOT_ACCEPTED,
      requestId: response.requestId ?? response.submissionId,
      status: "failed",
    };
  }
  return {
    reasonCode: REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.ADMISSION_ACCEPTED,
    requestId: response.requestId ?? response.submissionId,
    status: "succeeded",
  };
}

export function classifyRemoteAgentTurnFailure(
  error: unknown
): RemoteAgentTurnFailureClassification {
  const signals = collectErrorSignals(error);
  const structured = signals.structured.join(" ").toLowerCase();
  const messages = signals.messages.join(" ").toLowerCase();
  const errorName = signals.errorName ?? "RemoteAgentTurnError";

  if (isRemoteAgentContextWindowExceeded(error)) {
    return {
      errorName,
      reasonCode:
        REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_CONTEXT_WINDOW_EXCEEDED,
    };
  }
  if (
    includesAny(structured, [
      "submissiontimeouterror",
      "submission_timeout",
      "time_limit",
      "timed_out",
      "timeout",
      "deadline_exceeded",
    ]) ||
    includesAny(messages, ["deadline exceeded", "timed out", "time limit"])
  ) {
    return {
      errorName,
      reasonCode: REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_TIMEOUT,
    };
  }
  if (
    includesAny(structured, [
      "429",
      "rate_limit",
      "ratelimit",
      "too_many_requests",
    ]) ||
    includesAny(messages, ["rate limit", "too many requests"])
  ) {
    return {
      errorName,
      reasonCode:
        REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.PROVIDER_RATE_LIMITED,
    };
  }
  if (
    includesAny(structured, [
      "401",
      "authentication",
      "invalid_api_key",
      "unauthorized",
    ]) ||
    includesAny(messages, ["invalid api key", "authentication failed"])
  ) {
    return {
      errorName,
      reasonCode:
        REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.PROVIDER_AUTHENTICATION_FAILED,
    };
  }
  if (
    includesAny(structured, [
      "502",
      "503",
      "504",
      "connection_error",
      "network_error",
      "overloaded",
      "service_unavailable",
      "unavailable",
    ]) ||
    includesAny(messages, ["service unavailable", "provider unavailable"])
  ) {
    return {
      errorName,
      reasonCode:
        REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.PROVIDER_UNAVAILABLE,
    };
  }
  if (includesAny(structured, ["apierror", "model_error", "provider_error"])) {
    return {
      errorName,
      reasonCode: REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.PROVIDER_FAILED,
    };
  }
  return {
    errorName,
    reasonCode: REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_FAILED,
  };
}

function classifyRemoteAgentRpcFailure(
  operation: RemoteAgentRpcOperation,
  error: unknown
): RemoteAgentTurnFailureClassification {
  const signals = collectErrorSignals(error);
  const structured = signals.structured.join(" ").toLowerCase();
  const messages = signals.messages.join(" ").toLowerCase();
  const errorName = signals.errorName ?? "RemoteAgentRpcError";
  if (
    operation === "submitConversationTurn" &&
    (includesAny(structured, ["session_busy", "sessionbusyerror"]) ||
      messages.includes("session busy"))
  ) {
    return {
      errorName,
      reasonCode:
        REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.ADMISSION_CONVERSATION_BUSY,
    };
  }
  if (
    includesAny(structured, ["zoderror", "invalid_request"]) ||
    messages.includes("invalid request")
  ) {
    return {
      errorName,
      reasonCode:
        REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.RPC_INVALID_REQUEST,
    };
  }
  return {
    errorName,
    reasonCode: REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.RPC_FAILED,
  };
}

function collectErrorSignals(
  error: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet()
): { errorName: string | null; messages: string[]; structured: string[] } {
  if (depth > 3) {
    return { errorName: null, messages: [], structured: [] };
  }
  if (
    typeof error === "string" ||
    typeof error === "number" ||
    typeof error === "boolean"
  ) {
    return {
      errorName: null,
      messages: [String(error).slice(0, 512)],
      structured: [],
    };
  }
  if (!error || typeof error !== "object" || seen.has(error)) {
    return { errorName: null, messages: [], structured: [] };
  }
  seen.add(error);
  const record = error as Record<string, unknown>;
  const structured: string[] = [];
  for (const key of OBSERVABILITY_STRUCTURED_ERROR_KEYS) {
    const value = record[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      structured.push(String(value).slice(0, 512));
    }
  }
  const message =
    typeof record.message === "string" ? [record.message.slice(0, 512)] : [];
  let errorName = readNamedErrorDescriptor(record, "name");
  for (const key of OBSERVABILITY_NESTED_ERROR_KEYS) {
    const nested = collectErrorSignals(record[key], depth + 1, seen);
    errorName ??= nested.errorName;
    structured.push(...nested.structured);
    message.push(...nested.messages);
  }
  return { errorName, messages: message, structured };
}

function readNamedErrorDescriptor(
  error: Record<string, unknown>,
  key: "name" | "type"
): string | null {
  const value = error[key];
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 160)
    : null;
}

function includesAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
