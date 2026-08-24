import type {
  AdapterDispatchExecutionMode,
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterRuntimeEventCallback,
  AdapterRuntimeProcessCallback,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import { invokeWithSingleContextHeal } from "@openmeld/adapter-core";
import { isLikelyOpenClawContextLostError } from "../context/openclaw-context-heal.js";
import { invokeOpenClawCliTransport } from "../transport/openclaw-cli-transport.js";

export type OpenClawInvokeResult = {
  output: string;
  sessionId: string | null;
  telemetry?: AdapterDispatchTelemetry;
};

export class OpenClawRuntimeError extends Error {
  readonly code: string;
  readonly errorType: AdapterErrorType;

  constructor(input: {
    code: string;
    errorType: AdapterErrorType;
    message: string;
  }) {
    super(input.message);
    this.name = "OpenClawRuntimeError";
    this.code = input.code;
    this.errorType = input.errorType;
  }
}

export async function invokeOpenClawWithSingleContextHeal(input: {
  openClawAgentId: string;
  launchContract: RuntimeAgentControllerLaunchContract;
  openClawTimeoutMs: number | null;
  openClawWorkdir: string;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  onContextLost?: () => Promise<void>;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  sessionId: string | null;
}): Promise<{
  contextHealed: boolean;
  output: string;
  sessionId: string | null;
  telemetry?: AdapterDispatchTelemetry;
}> {
  const result = await invokeWithSingleContextHeal({
    contextId: input.sessionId,
    contextLossPolicy: "rebuild",
    createRebuildFailedError: (error) =>
      new OpenClawRuntimeError({
        code: "context.rebuild_failed",
        errorType: "adapter",
        message: `context.rebuild_failed: ${toErrorMessage(error)}`,
      }),
    invokeOnce: (sessionId) =>
      invokeOpenClawOnce({
        openClawAgentId: input.openClawAgentId,
        launchContract: input.launchContract,
        openClawTimeoutMs: input.openClawTimeoutMs,
        openClawWorkdir: input.openClawWorkdir,
        env: input.env,
        executionMode: input.executionMode,
        ...(input.onProcessControlEvent
          ? { onProcessControlEvent: input.onProcessControlEvent }
          : {}),
        ...(input.onRuntimeEvent
          ? { onRuntimeEvent: input.onRuntimeEvent }
          : {}),
        prompt: input.prompt,
        sessionId,
      }).then((value) => ({
        contextId: value.sessionId,
        output: value.output,
        ...(value.telemetry ? { telemetry: value.telemetry } : {}),
      })),
    isContextLostError: (error) =>
      isLikelyOpenClawContextLostError(
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

async function invokeOpenClawOnce(input: {
  openClawAgentId: string;
  launchContract: RuntimeAgentControllerLaunchContract;
  openClawTimeoutMs: number | null;
  openClawWorkdir: string;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  sessionId: string | null;
}): Promise<OpenClawInvokeResult> {
  try {
    return await invokeOpenClawCliTransport({
      openClawAgentId: input.openClawAgentId,
      launchContract: input.launchContract,
      openClawTimeoutMs: input.openClawTimeoutMs,
      openClawWorkdir: input.openClawWorkdir,
      env: input.env,
      ...(input.onProcessControlEvent
        ? { onProcessControlEvent: input.onProcessControlEvent }
        : {}),
      ...(input.onRuntimeEvent ? { onRuntimeEvent: input.onRuntimeEvent } : {}),
      prompt: input.prompt,
      sessionId: input.sessionId,
    });
  } catch (error) {
    if (error instanceof OpenClawRuntimeError) {
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
      throw new OpenClawRuntimeError({
        code: (error as { code: string }).code,
        errorType: (error as { errorType: AdapterErrorType }).errorType,
        message: error.message,
      });
    }

    throw new OpenClawRuntimeError({
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
