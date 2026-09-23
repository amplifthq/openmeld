import type { RuntimeTaskResult } from "@openmeld/local-execution";
import {
  SPACE_ACTION_CONTEXT_GUIDANCE_LINES,
  SPACE_ACTION_TARGET_GUIDANCE_LINES,
} from "@openmeld/local-service";
import { openMeldDaemonTaskResultPayloadSchema } from "@openmeld/schemas";
import type {
  AgentControllerConversationRef,
  OpenMeldDaemonTaskResultPayload,
} from "@openmeld/schemas/types";
import {
  resolvePublicAgentFailureReason,
  resolveSpacePublicationRequirement,
} from "@openmeld/space-mesh";
import { normalizeOptionalText } from "../core/logger";
import {
  normalizeOptionalContextId,
  resolveDispatchContextDeltaFromRuntimeResult,
} from "./execute-dispatch-conversation";
import type {
  ParsedDispatchTask,
  StructuredActionFailureDiagnostics,
} from "./execute-dispatch-types";

export function resolveStructuredActionRequirementFailure(input: {
  requiresStructuredSpaceAction: boolean;
  resolution: {
    action: OpenMeldDaemonTaskResultPayload["spaceAction"];
    parseError: string | null;
  };
  runtimeResult: RuntimeTaskResult;
}):
  | {
      failureReason: string;
      kind: "preserve_runtime_failure";
    }
  | {
      failureReason: string;
      kind: "repair";
    }
  | null {
  if (
    !(
      input.resolution.parseError ||
      (input.requiresStructuredSpaceAction && !input.resolution.action)
    )
  ) {
    return null;
  }

  const payload = input.runtimeResult.resultPayload;
  if (payload.status === "failed") {
    return {
      failureReason:
        resolvePublicAgentFailureReason({
          defaultReason: "The agent could not complete this reply right now.",
          errorCode: payload.errorCode,
          errorMessage: payload.errorMessage,
        }) ?? "The agent could not complete this reply right now.",
      kind: "preserve_runtime_failure",
    };
  }

  return {
    failureReason:
      input.resolution.parseError ??
      "A valid OpenMeld Space action is required in collaboration mode.",
    kind: "repair",
  };
}

export function resolveStructuredActionOutputFallback(input: {
  action: NonNullable<OpenMeldDaemonTaskResultPayload["spaceAction"]>;
  cleanedOutput: string;
}): string {
  const cleanedOutput = input.cleanedOutput.trim();
  if (cleanedOutput.length > 0) {
    return cleanedOutput;
  }

  switch (input.action.type) {
    case "post_message":
      return input.action.messageEnvelope.text;
    case "post_status":
      return input.action.text.trim() || `status:${input.action.status}`;
    case "stay_silent":
      return input.action.reason.trim() || "stay_silent";
    default:
      return "structured-action";
  }
}

export function buildStructuredActionRepairPrompt(input: {
  cliEntry?: string | null;
  currentReplyToSignalId?: string | null;
  parseError: string;
  sendTargetReferenceLines?: readonly string[] | null;
  spaceContractSnapshot?: ParsedDispatchTask["spaceContractSnapshot"];
  spaceId?: string | null;
  previousOutput?: string | null;
}): string {
  // An isolated correction cannot recover a complete result from a UI preview.
  const previousOutput = normalizeOptionalText(input.previousOutput);
  const publicationRequirement = resolveSpacePublicationRequirement(
    input.spaceContractSnapshot
  );
  return [
    `OpenMeld delivery repair: ${input.parseError}`,
    ...(previousOutput
      ? [
          "Previous private output, for context only (not authorization to publish it):",
          "```text",
          previousOutput,
          "```",
        ]
      : []),
    "Do not redo the user's work or change the intended public outcome.",
    "This invocation is delivery-only: do not inspect or edit code, run commands, call business tools, or repeat the user's task. No shell, CLI, Skill research, or knowledge of OpenMeld internals is needed.",
    "If an earlier call reported an unknown outcome, use read_receipt first. Recover an existing record; do not replace it. If the record is invalid or cannot be verified, stop rather than resend.",
    "Only a positively rejected input may be corrected and retried. Explicit denials, cancellation and expired authority remain in force; do not change transports to bypass them.",
    "Use the exact tool names and input schemas in this invocation's catalog. reply takes message (the explicit public text), with optional files and recipient IDs; stay_silent takes reason; read_receipt takes no arguments.",
    "Author a deliberate public reply when the task has an answer, a known limitation, or a request for help. Do not turn private analysis or delivery-infrastructure logs into a public answer.",
    ...SPACE_ACTION_CONTEXT_GUIDANCE_LINES,
    "Your answer text never selects an OpenMeld Space action.",
    "Call exactly one dispatch-scoped OpenMeld Space Action tool now.",
    publicationRequirement.repairRequirementLine,
    ...SPACE_ACTION_TARGET_GUIDANCE_LINES,
    ...(normalizeOptionalText(input.currentReplyToSignalId)
      ? [
          `post_message.messageEnvelope.replyToSignalId must match the current dispatch reply target: ${normalizeOptionalText(input.currentReplyToSignalId)}.`,
        ]
      : []),
    ...publicationRequirement.actionGuidanceLines,
    ...buildStructuredActionRepairSendTargetReferenceLines(
      input.sendTargetReferenceLines
    ),
    "If the permitted tool cannot record the action, stop. Do not run a fallback CLI or print JSON/prose as a substitute. A native structured-output carrier may request an explicit public action through its supplied schema instead.",
    "Do not finish with an explanation of what you will do.",
  ].join("\n");
}

function buildStructuredActionRepairSendTargetReferenceLines(
  sendTargetReferenceLines: readonly string[] | null | undefined
): string[] {
  if (!(sendTargetReferenceLines && sendTargetReferenceLines.length > 0)) {
    return [];
  }

  return [
    "Current send target reference:",
    ...sendTargetReferenceLines.map((line) => line),
  ];
}

export function resolveStructuredActionRepairPreviousOutput(
  runtimeResult: RuntimeTaskResult
): string | null {
  const payload = runtimeResult.resultPayload;
  if (payload.status !== "success" && payload.status !== "partial_success") {
    return null;
  }
  return normalizeOptionalText(payload.output);
}

export function resolveStructuredActionRepairContinuation(input: {
  runtimeResult: RuntimeTaskResult;
  agentControllerConversationOverride?: AgentControllerConversationRef | null;
}): {
  contextId: string | null;
  agentControllerConversationOverride: AgentControllerConversationRef | null;
} {
  const contextDelta = resolveDispatchContextDeltaFromRuntimeResult(
    input.runtimeResult.dispatchResult
  );
  return {
    contextId:
      normalizeOptionalContextId(
        input.runtimeResult.contextResolution?.agentControllerConversationId ??
          contextDelta?.agentControllerConversationId ??
          null
      ) ?? null,
    agentControllerConversationOverride:
      input.runtimeResult.contextResolution?.agentControllerConversation ??
      contextDelta?.agentControllerConversation ??
      input.agentControllerConversationOverride ??
      null,
  };
}

export function buildInvalidStructuredActionOutputPreview(
  runtimeResult: RuntimeTaskResult
): string | null {
  const payload = runtimeResult.resultPayload;
  if (payload.status !== "success" && payload.status !== "partial_success") {
    return null;
  }
  const normalizedOutput = normalizeOptionalText(payload.output);
  if (!normalizedOutput) {
    return null;
  }
  if (normalizedOutput.length <= 180) {
    return normalizedOutput;
  }
  return `${normalizedOutput.slice(0, 177).trimEnd()}...`;
}

export function coerceRuntimeResultToStructuredActionFailure(input: {
  diagnostics?: StructuredActionFailureDiagnostics | null;
  failureReason: string;
  runtimeResult: RuntimeTaskResult;
}): OpenMeldDaemonTaskResultPayload {
  const payload = input.runtimeResult.resultPayload;
  const normalizedDiagnostics = input.diagnostics
    ? {
        ...input.diagnostics,
        publicFailureReason:
          input.diagnostics.publicFailureReason ??
          normalizeOptionalText(input.failureReason),
      }
    : null;
  const normalizedPayload = openMeldDaemonTaskResultPayloadSchema.safeParse({
    status: "failed",
    attemptId: payload.attemptId,
    taskId: payload.taskId,
    sourceEventId: payload.sourceEventId,
    agentId: payload.agentId,
    deduped: payload.deduped,
    ...(payload.agentControllerRef
      ? { agentControllerRef: payload.agentControllerRef }
      : {}),
    ...(payload.agentControllerConversationId
      ? { agentControllerConversationId: payload.agentControllerConversationId }
      : {}),
    ...(payload.telemetry ? { telemetry: payload.telemetry } : {}),
    ...(payload.agentControllerConversation
      ? { agentControllerConversation: payload.agentControllerConversation }
      : {}),
    ...(payload.bootstrapTemplateFacts
      ? { bootstrapTemplateFacts: payload.bootstrapTemplateFacts }
      : {}),
    ...(payload.dispatchExecution
      ? { dispatchExecution: payload.dispatchExecution }
      : {}),
    ...(normalizedDiagnostics
      ? { spaceActionFailureDiagnostics: normalizedDiagnostics }
      : {}),
    errorCode: "openmeld.space_action.repair_failed",
    errorMessage: input.failureReason,
    errorType: "policy",
  });
  if (normalizedPayload.success) {
    return normalizedPayload.data;
  }

  return {
    status: "failed",
    attemptId: payload.attemptId,
    taskId: payload.taskId,
    sourceEventId: payload.sourceEventId,
    agentId: payload.agentId,
    deduped: payload.deduped,
    ...(payload.agentControllerRef
      ? { agentControllerRef: payload.agentControllerRef }
      : {}),
    ...(normalizedDiagnostics
      ? { spaceActionFailureDiagnostics: normalizedDiagnostics }
      : {}),
    errorCode: "openmeld.space_action.repair_failed",
    errorMessage: input.failureReason,
    errorType: "policy",
  };
}
