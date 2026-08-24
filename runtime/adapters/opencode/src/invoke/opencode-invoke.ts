import type {
  AdapterDispatchExecutionMode,
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterInstructionPrompt,
  AdapterInteractionCallback,
  AdapterPreviewCallback,
  AdapterRuntimeEventCallback,
  AdapterRuntimeProcessCallback,
  AdapterStreamingMode,
  ConversationPolicy,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import { invokeWithSingleContextHeal } from "@openmeld/adapter-core";
import { isLikelyOpenCodeContextLostError } from "../context/opencode-context-heal.js";
import { invokeOpenCodeCliTransport } from "../transport/opencode-cli-transport.js";
import { invokeOpenCodeServerTransport } from "../transport/opencode-server-transport.js";

export type OpenCodeInvokeResult = {
  output: string;
  sessionId: string | null;
  telemetry?: AdapterDispatchTelemetry;
};

export class OpenCodeRuntimeError extends Error {
  readonly code: string;
  readonly errorType: AdapterErrorType;

  constructor(input: {
    code: string;
    errorType: AdapterErrorType;
    message: string;
  }) {
    super(input.message);
    this.name = "OpenCodeRuntimeError";
    this.code = input.code;
    this.errorType = input.errorType;
  }
}

export async function invokeOpenCodeWithSingleContextHeal(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  openCodeTimeoutMs: number | null;
  openCodeWorkdir: string;
  conversationPolicy?: ConversationPolicy;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  instructionPrompt?: AdapterInstructionPrompt;
  onContextLost?: () => Promise<void>;
  onInteractionRequest?: AdapterInteractionCallback;
  onPreview?: AdapterPreviewCallback;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  sessionId: string | null;
  streamingMode?: AdapterStreamingMode;
}): Promise<{
  contextHealed: boolean;
  output: string;
  sessionId: string | null;
  telemetry?: AdapterDispatchTelemetry;
}> {
  const result = await invokeWithSingleContextHeal({
    contextId: input.sessionId,
    contextLossPolicy: input.executionMode === "repair" ? "fail" : "rebuild",
    createRebuildFailedError: (error) =>
      new OpenCodeRuntimeError({
        code: "context.rebuild_failed",
        errorType: "adapter",
        message: `context.rebuild_failed: ${toErrorMessage(error)}`,
      }),
    invokeOnce: (sessionId) =>
      invokeOpenCodeOnce({
        launchContract: input.launchContract,
        openCodeTimeoutMs: input.openCodeTimeoutMs,
        openCodeWorkdir: input.openCodeWorkdir,
        conversationPolicy: input.conversationPolicy,
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
        ...(input.onRuntimeEvent
          ? { onRuntimeEvent: input.onRuntimeEvent }
          : {}),
        prompt: input.prompt,
        sessionId,
        streamingMode: input.streamingMode,
      }).then((value) => ({
        contextId: value.sessionId,
        output: value.output,
        ...(value.telemetry ? { telemetry: value.telemetry } : {}),
      })),
    isContextLostError: (error) =>
      isLikelyOpenCodeContextLostError(
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

async function invokeOpenCodeOnce(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  openCodeTimeoutMs: number | null;
  openCodeWorkdir: string;
  conversationPolicy?: ConversationPolicy;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  instructionPrompt?: AdapterInstructionPrompt;
  onInteractionRequest?: AdapterInteractionCallback;
  onPreview?: AdapterPreviewCallback;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  sessionId: string | null;
  streamingMode?: AdapterStreamingMode;
}): Promise<OpenCodeInvokeResult> {
  try {
    if (
      input.onInteractionRequest ||
      (input.executionMode === "repair" && input.sessionId)
    ) {
      return await invokeOpenCodeServerTransport({
        launchContract: input.launchContract,
        openCodeTimeoutMs: input.openCodeTimeoutMs,
        openCodeWorkdir: input.openCodeWorkdir,
        conversationPolicy: input.conversationPolicy,
        env: input.env,
        executionMode: input.executionMode,
        instructionPrompt: input.instructionPrompt,
        onInteractionRequest: input.onInteractionRequest,
        ...(input.onPreview ? { onPreview: input.onPreview } : {}),
        ...(input.onProcessControlEvent
          ? { onProcessControlEvent: input.onProcessControlEvent }
          : {}),
        ...(input.onRuntimeEvent
          ? { onRuntimeEvent: input.onRuntimeEvent }
          : {}),
        prompt: input.prompt,
        sessionId: input.sessionId,
        streamingMode: input.streamingMode,
      });
    }
    return await invokeOpenCodeCliTransport({
      launchContract: input.launchContract,
      openCodeTimeoutMs: input.openCodeTimeoutMs,
      openCodeWorkdir: input.openCodeWorkdir,
      conversationPolicy: input.conversationPolicy,
      env: input.env,
      ...(input.onProcessControlEvent
        ? { onProcessControlEvent: input.onProcessControlEvent }
        : {}),
      ...(input.onRuntimeEvent ? { onRuntimeEvent: input.onRuntimeEvent } : {}),
      prompt: input.prompt,
      sessionId: input.sessionId,
    });
  } catch (error) {
    if (error instanceof OpenCodeRuntimeError) {
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
      throw new OpenCodeRuntimeError({
        code: (error as { code: string }).code,
        errorType: (error as { errorType: AdapterErrorType }).errorType,
        message: error.message,
      });
    }

    throw new OpenCodeRuntimeError({
      code: "upstream_unreachable",
      errorType: "adapter",
      message: `upstream_unreachable: ${toErrorMessage(error)}`,
    });
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
