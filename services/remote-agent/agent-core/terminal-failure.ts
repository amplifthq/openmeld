import {
  type CloudComputerCleanupReport,
  cloudComputerCleanupReportSchema,
  ORGANIZATION_SKILL_RELEASE_UNAVAILABLE_REASON_CODE,
  REMOTE_AGENT_COMPUTER_CLEANUP_FAILED_CODE,
  REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES,
  REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE,
  remoteAgentRuntimeEvidenceOutcomeReasonCodeSchema,
} from "@openmeld/schemas";
import type { RemoteAgentRuntimeEvidenceOutcomeReasonCode } from "@openmeld/schemas/types";
import { normalizeRemoteAgentCompletedAnswer } from "./completed-answer";
import {
  isOrganizationSkillReleaseUnavailable,
  isRemoteAgentContextWindowExceeded,
  isRemoteAgentToolResultTooLarge,
  normalizeRemoteAgentErrorMessage,
} from "./error-message";

export type RemoteAgentTerminalFailureFact = {
  code: string;
  detail?: string;
  reasonCode: RemoteAgentRuntimeEvidenceOutcomeReasonCode;
  explanationText?: string;
  computerCleanup?: CloudComputerCleanupReport;
};

export function retainRemoteAgentCleanupFacts(
  primary: RemoteAgentTerminalFailureFact | null,
  cleanup: RemoteAgentTerminalFailureFact | null
): RemoteAgentTerminalFailureFact | null {
  if (!primary) {
    return cleanup;
  }
  return cleanup?.computerCleanup
    ? { ...primary, computerCleanup: cleanup.computerCleanup }
    : primary;
}

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
    code: resolveTerminalFailureCode(input.error, reasonCode),
    ...(input.error === undefined
      ? {}
      : { detail: normalizeRemoteAgentErrorMessage(input.error) }),
    reasonCode,
  };
}

function resolveTerminalFailureCode(
  error: unknown,
  reasonCode: RemoteAgentRuntimeEvidenceOutcomeReasonCode
): string {
  if (isOrganizationSkillReleaseUnavailable(error)) {
    return ORGANIZATION_SKILL_RELEASE_UNAVAILABLE_REASON_CODE;
  }
  if (isRemoteAgentToolResultTooLarge(error)) {
    return REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE;
  }
  return resolveFailureCode(reasonCode);
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
  if (
    record.explanationText !== undefined &&
    code !== REMOTE_AGENT_COMPUTER_CLEANUP_FAILED_CODE
  ) {
    throw new Error(
      "Remote Agent failure explanation requires a Computer recovery outcome."
    );
  }
  const detail =
    record.detail === undefined
      ? undefined
      : parseNormalizedRequiredText(record.detail, "detail");
  return {
    code,
    ...(record.explanationText === undefined
      ? {}
      : {
          explanationText: normalizeRemoteAgentCompletedAnswer(
            parseNormalizedRequiredText(
              record.explanationText,
              "explanationText"
            )
          ),
        }),
    ...(record.computerCleanup === undefined
      ? {}
      : {
          computerCleanup: cloudComputerCleanupReportSchema.parse(
            record.computerCleanup
          ),
        }),
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
