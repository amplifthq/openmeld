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
  if (input.resolution.parseError) {
    return {
      failureReason: input.resolution.parseError,
      kind: "repair",
    };
  }
  if (!(input.requiresStructuredSpaceAction && !input.resolution.action)) {
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
  const previousOutput = normalizeOptionalText(input.previousOutput);
  const normalizedSpaceId = normalizeOptionalText(input.spaceId);
  const cliEntry = normalizeOptionalText(input.cliEntry) ?? "openmeld";
  const historyCommand = normalizedSpaceId
    ? `${cliEntry} space history ${normalizedSpaceId} --kind text --limit 20`
    : `${cliEntry} space history <space-id> --kind text --limit 20`;
  const promptCommand = `${cliEntry} prompt`;
  const spaceGuideCommand = normalizedSpaceId
    ? `${cliEntry} space guide ${normalizedSpaceId}`
    : `${cliEntry} space guide <space-id>`;
  const publicationRequirement = resolveSpacePublicationRequirement(
    input.spaceContractSnapshot
  );
  return [
    "Your previous OpenMeld Space structured action was invalid.",
    `Problem: ${input.parseError}`,
    ...(previousOutput
      ? ["Your previous final answer was:", "```text", previousOutput, "```"]
      : []),
    "This is a bounded repair of the public delivery action only. Do not redo the user's work.",
    "Do not change the user's intent.",
    ...SPACE_ACTION_CONTEXT_GUIDANCE_LINES,
    "Your answer text never selects an OpenMeld Space action.",
    "Call exactly one dispatch-scoped OpenMeld Space Action tool to repair the delivery action. Use the CLI only if the tool is unavailable.",
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
    `If you need recent public room context, use \`${historyCommand}\`.`,
    `If you need the OpenMeld action rules again, read the official guidance with \`${promptCommand}\` or \`${spaceGuideCommand}\`.`,
    ...(normalizedSpaceId
      ? [
          `For this room, you can inspect the current guide with \`${spaceGuideCommand}\`.`,
        ]
      : []),
    ...buildStructuredActionRepairCompletionLines({
      cliEntry,
      publicationRequirement,
    }),
  ].join("\n");
}

function buildStructuredActionRepairCompletionLines(input: {
  cliEntry: string;
  publicationRequirement: ReturnType<typeof resolveSpacePublicationRequirement>;
}): string[] {
  return [
    "Repair completion rule:",
    buildStructuredActionRepairPrimaryCommandLine(input),
    "If neither the tool nor the fallback command can record the action, stop. Do not print JSON or prose as a substitute.",
    "Do not finish with an explanation of what you will do.",
  ];
}

function buildStructuredActionRepairPrimaryCommandLine(input: {
  cliEntry: string;
  publicationRequirement: ReturnType<typeof resolveSpacePublicationRequirement>;
}): string {
  if (input.publicationRequirement.allowedActions.includes("post_message")) {
    return `For a normal reply, call the OpenMeld Space Action \`reply\` tool with the corrected public message. If that tool is unavailable, run the fallback CLI command \`${input.cliEntry} space action reply "corrected public message"\` and wait for it to finish.`;
  }
  if (input.publicationRequirement.allowedActions.includes("post_status")) {
    return `For a final status, call the OpenMeld Space Action \`status\` tool with a final-safe status and short update. If that tool is unavailable, run the fallback CLI command \`${input.cliEntry} space action status done "short completion update"\` and wait for it to finish.`;
  }
  if (input.publicationRequirement.allowedActions.includes("stay_silent")) {
    return `If no public reply is needed, call the OpenMeld Space Action \`stay_silent\` tool with your reason. If that tool is unavailable, run the fallback CLI command \`${input.cliEntry} space action silent --reason "reason"\` and wait for it to finish.`;
  }
  return "No permitted OpenMeld Space action is available. Do not invent one in answer text.";
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
