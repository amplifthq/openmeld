import type {
  AdapterComputerFileAccessBoundary,
  AdapterDispatchExecutionMode,
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
import { isLikelyContextLostError } from "../context/codex-context-heal.js";
import type { CodexAppServerActiveTurnRegistrar } from "../transport/codex-app-server-transport.js";
import { invokeCodexAppServerTransport } from "../transport/codex-app-server-transport.js";
import { invokeCodexCliTransport } from "../transport/codex-cli-transport.js";

export type CodexInvokeResult = {
  output: string;
  telemetry?: AdapterDispatchTelemetry;
  threadId: string | null;
};

export class CodexRuntimeError extends Error {
  readonly code: string;
  readonly errorType: AdapterErrorType;

  constructor(input: {
    code: string;
    errorType: AdapterErrorType;
    message: string;
  }) {
    super(input.message);
    this.name = "CodexRuntimeError";
    this.code = input.code;
    this.errorType = input.errorType;
  }
}

export async function invokeCodexWithSingleContextHeal(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  codexTimeoutMs: number | null;
  codexWorkdir: string;
  conversationPolicy?: ConversationPolicy;
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  onContextLost?: () => Promise<void>;
  onPreview?: AdapterPreviewCallback;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  streamingMode?: AdapterStreamingMode;
  threadId: string | null;
}): Promise<{
  contextHealed: boolean;
  output: string;
  telemetry?: AdapterDispatchTelemetry;
  threadId: string | null;
}> {
  const result = await invokeWithSingleContextHeal({
    contextId: input.threadId,
    createRebuildFailedError: (error) =>
      new CodexRuntimeError({
        code: "context.rebuild_failed",
        errorType: "adapter",
        message: `context.rebuild_failed: ${toErrorMessage(error)}`,
      }),
    invokeOnce: (threadId) =>
      invokeCodexOnce({
        agentControllerPermissionMode: input.agentControllerPermissionMode,
        launchContract: input.launchContract,
        codexTimeoutMs: input.codexTimeoutMs,
        codexWorkdir: input.codexWorkdir,
        conversationPolicy: input.conversationPolicy,
        computerFileAccessBoundary: input.computerFileAccessBoundary,
        env: input.env,
        executionMode: input.executionMode,
        ...(input.onProcessControlEvent
          ? { onProcessControlEvent: input.onProcessControlEvent }
          : {}),
        ...(input.onPreview ? { onPreview: input.onPreview } : {}),
        ...(input.onRuntimeEvent
          ? { onRuntimeEvent: input.onRuntimeEvent }
          : {}),
        prompt: input.prompt,
        streamingMode: input.streamingMode,
        threadId,
      }).then((value) => ({
        contextId: value.threadId,
        output: value.output,
        ...(value.telemetry ? { telemetry: value.telemetry } : {}),
      })),
    isContextLostError: (error) =>
      isLikelyContextLostError(
        error instanceof Error ? error.message : String(error)
      ),
    onContextLost: input.onContextLost,
  });

  return {
    contextHealed: result.contextHealed,
    output: result.output,
    ...(result.telemetry ? { telemetry: result.telemetry } : {}),
    threadId: result.contextId,
  };
}

export async function invokeCodexAppServer(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  codexTimeoutMs: number | null;
  codexWorkdir: string;
  conversationPolicy?: ConversationPolicy;
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  instructionPrompt?: AdapterInstructionPrompt;
  onActiveTurn?: CodexAppServerActiveTurnRegistrar;
  onInteractionRequest?: AdapterInteractionCallback;
  onPreview?: AdapterPreviewCallback;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  streamingMode?: AdapterStreamingMode;
  taskId: string;
  threadId: string | null;
}): Promise<CodexInvokeResult> {
  try {
    return await invokeCodexAppServerTransport({
      agentControllerPermissionMode: input.agentControllerPermissionMode,
      launchContract: input.launchContract,
      codexTimeoutMs: input.codexTimeoutMs,
      codexWorkdir: input.codexWorkdir,
      conversationPolicy: input.conversationPolicy,
      computerFileAccessBoundary: input.computerFileAccessBoundary,
      env: input.env,
      executionMode: input.executionMode,
      instructionPrompt: input.instructionPrompt,
      ...(input.onProcessControlEvent
        ? { onProcessControlEvent: input.onProcessControlEvent }
        : {}),
      ...(input.onActiveTurn ? { onActiveTurn: input.onActiveTurn } : {}),
      ...(input.onInteractionRequest
        ? { onInteractionRequest: input.onInteractionRequest }
        : {}),
      ...(input.onPreview ? { onPreview: input.onPreview } : {}),
      ...(input.onRuntimeEvent ? { onRuntimeEvent: input.onRuntimeEvent } : {}),
      prompt: input.prompt,
      streamingMode: input.streamingMode,
      taskId: input.taskId,
      threadId: input.threadId,
    });
  } catch (error) {
    if (error instanceof CodexRuntimeError) {
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
      throw new CodexRuntimeError({
        code: (error as { code: string }).code,
        errorType: (error as { errorType: AdapterErrorType }).errorType,
        message: error.message,
      });
    }
    throw new CodexRuntimeError({
      code: "upstream_unreachable",
      errorType: "adapter",
      message: `upstream_unreachable: ${toErrorMessage(error)}`,
    });
  }
}

async function invokeCodexOnce(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  codexTimeoutMs: number | null;
  codexWorkdir: string;
  conversationPolicy?: ConversationPolicy;
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onPreview?: AdapterPreviewCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  streamingMode?: AdapterStreamingMode;
  threadId: string | null;
}): Promise<CodexInvokeResult> {
  try {
    return await invokeCodexCliTransport({
      agentControllerPermissionMode: input.agentControllerPermissionMode,
      launchContract: input.launchContract,
      codexTimeoutMs: input.codexTimeoutMs,
      codexWorkdir: input.codexWorkdir,
      conversationPolicy: input.conversationPolicy,
      computerFileAccessBoundary: input.computerFileAccessBoundary,
      env: input.env,
      executionMode: input.executionMode,
      ...(input.onProcessControlEvent
        ? { onProcessControlEvent: input.onProcessControlEvent }
        : {}),
      ...(input.onPreview ? { onPreview: input.onPreview } : {}),
      ...(input.onRuntimeEvent ? { onRuntimeEvent: input.onRuntimeEvent } : {}),
      prompt: input.prompt,
      streamingMode: input.streamingMode,
      threadId: input.threadId,
    });
  } catch (error) {
    if (error instanceof CodexRuntimeError) {
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
      throw new CodexRuntimeError({
        code: (error as { code: string }).code,
        errorType: (error as { errorType: AdapterErrorType }).errorType,
        message: error.message,
      });
    }
    throw new CodexRuntimeError({
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
