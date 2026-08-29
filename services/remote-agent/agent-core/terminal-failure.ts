import {
  REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES,
  REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE,
  remoteAgentRuntimeEvidenceOutcomeReasonCodeSchema,
} from "@openmeld/schemas";
import type { RemoteAgentRuntimeEvidenceOutcomeReasonCode } from "@openmeld/schemas/types";
import {
  isRemoteAgentContextWindowExceeded,
  isRemoteAgentToolResultTooLarge,
  normalizeRemoteAgentErrorMessage,
} from "./error-message";

export type RemoteAgentTerminalFailureFact = {
  code: string;
  detail?: string;
  reasonCode: RemoteAgentRuntimeEvidenceOutcomeReasonCode;
};

export function createRemoteAgentTerminalFailureFact(input: {
  error?: unknown;
  reasonCode?: RemoteAgentRuntimeEvidenceOutcomeReasonCode;
  status: "aborted" | "failed";
}): RemoteAgentTerminalFailureFact {
  if (input.status === "aborted") {
    return {
      code: "remote_agent.execution_cancelled",
      ...(input.error === undefined
        ? {}
        : { detail: normalizeRemoteAgentErrorMessage(input.error) }),
      reasonCode: REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_FAILED,
    };
  }

  const reasonCode = resolveFailureReasonCode(input);
  return {
    code: isRemoteAgentToolResultTooLarge(input.error)
      ? REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE
      : resolveFailureCode(reasonCode),
    ...(input.error === undefined
      ? {}
      : { detail: normalizeRemoteAgentErrorMessage(input.error) }),
    reasonCode,
  };
}

export function parseRemoteAgentTerminalFailureFact(
  value: unknown
): RemoteAgentTerminalFailureFact | null {
  if (value === undefined) {
    return null;
  }
  if (!(value && typeof value === "object") || Array.isArray(value)) {
    throw new Error("Remote Agent durable terminal failure fact is invalid.");
  }
  const record = value as Record<string, unknown>;
  const code = parseNormalizedRequiredText(record.code, "code");
  const detail =
    record.detail === undefined
      ? undefined
      : parseNormalizedRequiredText(record.detail, "detail");
  return {
    code,
    ...(detail ? { detail } : {}),
    reasonCode: remoteAgentRuntimeEvidenceOutcomeReasonCodeSchema.parse(
      record.reasonCode
    ),
  };
}

function resolveFailureReasonCode(input: {
  error?: unknown;
  reasonCode?: RemoteAgentRuntimeEvidenceOutcomeReasonCode;
}): RemoteAgentRuntimeEvidenceOutcomeReasonCode {
  if (isRemoteAgentContextWindowExceeded(input.error)) {
    return REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_CONTEXT_WINDOW_EXCEEDED;
  }
  return (
    input.reasonCode ??
    REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_NOT_COMPLETED
  );
}

function resolveFailureCode(
  reasonCode: RemoteAgentRuntimeEvidenceOutcomeReasonCode
): string {
  if (
    reasonCode === REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_FAILED ||
    reasonCode === REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_NOT_COMPLETED
  ) {
    return "remote_agent.turn_not_completed";
  }
  if (
    reasonCode ===
    REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_EMPTY_ASSISTANT_RESPONSE
  ) {
    return "remote_agent.empty_assistant_response";
  }
  return reasonCode;
}

function parseNormalizedRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(
      `Remote Agent durable terminal failure ${field} is invalid.`
    );
  }
  return value;
}
