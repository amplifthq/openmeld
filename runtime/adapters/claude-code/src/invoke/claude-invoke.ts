import type {
  AdapterDispatchExecutionMode,
  AdapterDispatchFailure,
  AdapterDispatchRequest,
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterInstructionPrompt,
  AdapterInteractionCallback,
  AdapterPreviewCallback,
  AdapterRuntimeEventCallback,
  AdapterRuntimeProcessCallback,
  AdapterStreamingMode,
  AgentControllerPermissionMode,
  ConversationPolicy,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import { invokeWithSingleContextHeal } from "@openmeld/adapter-core";
import { isLikelyClaudeContextLostError } from "../context/claude-context-heal.js";
import {
  type ClaudeAgentSdkQueryFactory,
  type ClaudeAgentSdkQueryRegistration,
  type ClaudeCodeTransportKind,
  invokeClaudeAgentSdkTransport,
} from "../transport/claude-agent-sdk-transport.js";
import { invokeClaudeCliTransport } from "../transport/claude-cli-transport.js";

export type ClaudeInvokeResult = {
  output: string;
  sessionId: string | null;
  telemetry?: AdapterDispatchTelemetry;
};

type ClaudeProviderAccessEvidence = NonNullable<
  AdapterDispatchFailure["providerAccessEvidence"]
>;

type ClaudeInvokeOnceInput = {
  spaceActionTools?: AdapterDispatchRequest["spaceActionTools"];
  executionContext?: AdapterDispatchRequest["executionContext"];
  launchContract: RuntimeAgentControllerLaunchContract;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  claudeTimeoutMs: number | null;
  claudeTransport?: ClaudeCodeTransportKind;
  claudeWorkdir: string;
  conversationPolicy?: ConversationPolicy;
  createAgentSdkQuery?: ClaudeAgentSdkQueryFactory;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  instructionPrompt?: AdapterInstructionPrompt;
  onInteractionRequest?: AdapterInteractionCallback;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onPreview?: AdapterPreviewCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  registerAgentSdkQuery?: ClaudeAgentSdkQueryRegistration;
  sessionId: string | null;
  streamingMode?: AdapterStreamingMode;
  taskId?: string;
};

export class ClaudeRuntimeError extends Error {
  readonly code: string;
  readonly errorType: AdapterErrorType;
  readonly originalError?: string;
  readonly providerAccessEvidence?: ClaudeProviderAccessEvidence;
  readonly telemetry?: AdapterDispatchTelemetry;

  constructor(input: {
    code: string;
    errorType: AdapterErrorType;
    message: string;
    originalError?: string;
    providerAccessEvidence?: ClaudeProviderAccessEvidence;
    telemetry?: AdapterDispatchTelemetry;
  }) {
    super(input.message);
    this.name = "ClaudeRuntimeError";
    this.code = input.code;
    this.errorType = input.errorType;
    if (input.originalError) {
      this.originalError = input.originalError;
    }
    if (input.providerAccessEvidence) {
      this.providerAccessEvidence = input.providerAccessEvidence;
    }
    if (input.telemetry) {
      this.telemetry = input.telemetry;
    }
  }
}

export async function invokeClaudeWithSingleContextHeal(input: {
  spaceActionTools?: AdapterDispatchRequest["spaceActionTools"];
  executionContext?: AdapterDispatchRequest["executionContext"];
  launchContract: RuntimeAgentControllerLaunchContract;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  claudeTimeoutMs: number | null;
  claudeTransport?: ClaudeCodeTransportKind;
  claudeWorkdir: string;
  conversationPolicy?: ConversationPolicy;
  createAgentSdkQuery?: ClaudeAgentSdkQueryFactory;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  instructionPrompt?: AdapterInstructionPrompt;
  onInteractionRequest?: AdapterInteractionCallback;
  onContextLost?: () => Promise<void>;
  onPreview?: AdapterPreviewCallback;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  registerAgentSdkQuery?: ClaudeAgentSdkQueryRegistration;
  sessionId: string | null;
  streamingMode?: AdapterStreamingMode;
  taskId?: string;
}): Promise<{
  contextHealed: boolean;
  output: string;
  sessionId: string | null;
  telemetry?: AdapterDispatchTelemetry;
}> {
  const result = await invokeWithSingleContextHeal({
    contextId: input.sessionId,
    contextLossPolicy:
      input.executionContext || input.executionMode === "repair"
        ? "fail"
        : "rebuild",
    createRebuildFailedError: (error) => {
      const providerAccessEvidence = getClaudeProviderAccessEvidence(error);
      const originalError = getClaudeOriginalError(error);
      const telemetry = getClaudeTelemetry(error);
      return new ClaudeRuntimeError({
        code: "context.rebuild_failed",
        errorType: "adapter",
        message: `context.rebuild_failed: ${toErrorMessage(error)}`,
        ...(originalError ? { originalError } : {}),
        ...(providerAccessEvidence ? { providerAccessEvidence } : {}),
        ...(telemetry ? { telemetry } : {}),
      });
    },
    invokeOnce: (sessionId) =>
      invokeClaudeOnce({
        spaceActionTools: input.spaceActionTools,
        executionContext: input.executionContext,
        agentControllerPermissionMode: input.agentControllerPermissionMode,
        launchContract: input.launchContract,
        claudeTimeoutMs: input.claudeTimeoutMs,
        claudeTransport: input.claudeTransport,
        claudeWorkdir: input.claudeWorkdir,
        conversationPolicy: input.conversationPolicy,
        ...(input.createAgentSdkQuery
          ? { createAgentSdkQuery: input.createAgentSdkQuery }
          : {}),
        env: input.env,
        executionMode: input.executionMode,
        instructionPrompt: input.instructionPrompt,
        ...(input.onInteractionRequest
          ? { onInteractionRequest: input.onInteractionRequest }
          : {}),
        ...(input.onProcessControlEvent
          ? { onProcessControlEvent: input.onProcessControlEvent }
          : {}),
        ...(input.onPreview ? { onPreview: input.onPreview } : {}),
        ...(input.onRuntimeEvent
          ? { onRuntimeEvent: input.onRuntimeEvent }
          : {}),
        prompt: input.prompt,
        ...(input.registerAgentSdkQuery
          ? { registerAgentSdkQuery: input.registerAgentSdkQuery }
          : {}),
        sessionId,
        streamingMode: input.streamingMode,
        taskId: input.taskId,
      }).then((value) => ({
        contextId: value.sessionId,
        output: value.output,
        ...(value.telemetry ? { telemetry: value.telemetry } : {}),
      })),
    isContextLostError: (error) =>
      isLikelyClaudeContextLostError(
        error instanceof Error ? error.message : String(error)
      ),
    onContextLost: input.onContextLost,
  });

  return {
    contextHealed: result.contextHealed,
    output: result.output,
    sessionId: result.contextId,
    ...(result.telemetry ? { telemetry: result.telemetry } : {}),
  };
}

async function invokeClaudeOnce(
  input: ClaudeInvokeOnceInput
): Promise<ClaudeInvokeResult> {
  try {
    if ((input.claudeTransport ?? "agent-sdk") === "cli") {
      if (input.executionContext) {
        throw new Error("execution_context.transport_unsupported");
      }
      return await invokeClaudeOnceWithCli(input);
    }

    return await invokeClaudeOnceWithAgentSdk(input);
  } catch (error) {
    if (error instanceof ClaudeRuntimeError) {
      throw error;
    }

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      "errorType" in error &&
      typeof (error as { errorType?: unknown }).errorType === "string" &&
      error instanceof Error
    ) {
      const providerAccessEvidence = getClaudeProviderAccessEvidence(error);
      const originalError = getClaudeOriginalError(error);
      const telemetry = getClaudeTelemetry(error);
      throw new ClaudeRuntimeError({
        code: (error as { code: string }).code,
        errorType: (error as { errorType: AdapterErrorType }).errorType,
        message: error.message,
        ...(originalError ? { originalError } : {}),
        ...(providerAccessEvidence ? { providerAccessEvidence } : {}),
        ...(telemetry ? { telemetry } : {}),
      });
    }

    throw new ClaudeRuntimeError({
      code: "upstream_unreachable",
      errorType: "adapter",
      message: `upstream_unreachable: ${toErrorMessage(error)}`,
    });
  }
}

function invokeClaudeOnceWithCli(
  input: ClaudeInvokeOnceInput
): Promise<ClaudeInvokeResult> {
  return invokeClaudeCliTransport({
    agentControllerPermissionMode: input.agentControllerPermissionMode,
    launchContract: input.launchContract,
    claudeTimeoutMs: input.claudeTimeoutMs,
    claudeWorkdir: input.claudeWorkdir,
    conversationPolicy: input.conversationPolicy,
    env: input.env,
    executionMode: input.executionMode,
    ...(input.onProcessControlEvent
      ? { onProcessControlEvent: input.onProcessControlEvent }
      : {}),
    ...(input.onPreview ? { onPreview: input.onPreview } : {}),
    ...(input.onRuntimeEvent ? { onRuntimeEvent: input.onRuntimeEvent } : {}),
    prompt: input.prompt,
    sessionId: input.sessionId,
    streamingMode: input.streamingMode,
  });
}

function invokeClaudeOnceWithAgentSdk(
  input: ClaudeInvokeOnceInput
): Promise<ClaudeInvokeResult> {
  return invokeClaudeAgentSdkTransport({
    spaceActionTools: input.spaceActionTools,
    executionContext: input.executionContext,
    agentControllerPermissionMode: input.agentControllerPermissionMode,
    launchContract: input.launchContract,
    claudeTimeoutMs: input.claudeTimeoutMs,
    claudeWorkdir: input.claudeWorkdir,
    conversationPolicy: input.conversationPolicy,
    ...(input.createAgentSdkQuery
      ? { createQuery: input.createAgentSdkQuery }
      : {}),
    env: input.env,
    executionMode: input.executionMode,
    instructionPrompt: input.instructionPrompt,
    ...(input.onInteractionRequest
      ? { onInteractionRequest: input.onInteractionRequest }
      : {}),
    ...(input.onPreview ? { onPreview: input.onPreview } : {}),
    ...(input.onProcessControlEvent
      ? { onProcessControlEvent: input.onProcessControlEvent }
      : {}),
    ...(input.onRuntimeEvent ? { onRuntimeEvent: input.onRuntimeEvent } : {}),
    prompt: input.prompt,
    ...(input.registerAgentSdkQuery
      ? { registerQuery: input.registerAgentSdkQuery }
      : {}),
    sessionId: input.sessionId,
    streamingMode: input.streamingMode,
    taskId: input.taskId,
  });
}

function getClaudeProviderAccessEvidence(
  error: unknown
): ClaudeProviderAccessEvidence | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const evidence = (error as { providerAccessEvidence?: unknown })
    .providerAccessEvidence;
  if (!evidence || typeof evidence !== "object") {
    return null;
  }
  return evidence as ClaudeProviderAccessEvidence;
}

function getClaudeOriginalError(error: unknown): string | null {
  if (!(error && typeof error === "object")) {
    return null;
  }
  const originalError = (error as { originalError?: unknown }).originalError;
  return typeof originalError === "string" ? originalError : null;
}

function getClaudeTelemetry(error: unknown): AdapterDispatchTelemetry | null {
  if (!(error && typeof error === "object" && "telemetry" in error)) {
    return null;
  }
  const telemetry = (error as { telemetry?: unknown }).telemetry;
  return telemetry && typeof telemetry === "object"
    ? (telemetry as AdapterDispatchTelemetry)
    : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
