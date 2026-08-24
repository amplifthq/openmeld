// biome-ignore-all lint/performance/noBarrelFile: Package entrypoint intentionally re-exports Claude Code runtime helpers.
import {
  type AdapterCancelRequest,
  type AdapterDispatchContextDelta,
  type AdapterDispatchRequest,
  type AdapterDispatchTelemetry,
  type AdapterInterruptRequest,
  type AdapterInterruptSignal,
  type AdapterPreviewCallback,
  type AdapterRuntimeProcessEvent,
  type AdapterTransportMode,
  bridgeAgentControllerConversationRef,
  buildAdapterCancelRequest,
  buildExecutableLaunchContract,
  createSharedControlShell,
  createSharedDispatchShell,
  type RuntimeAdapter,
  type RuntimeAgentControllerLaunchContract,
  resolveBuiltinAdapterConversationBridgeSpec,
  type WaitForMs,
} from "@openmeld/adapter-core";
import {
  resolveClaudeCodeTimeoutMs as resolveClaudeCodeTimeoutMsLocal,
  verifyClaudeCodeLaunchContract as verifyClaudeCodeLaunchContractLocal,
} from "./config/claude-runtime-config.js";
import { invokeClaudeWithSingleContextHeal as invokeClaudeWithSingleContextHealLocal } from "./invoke/claude-invoke.js";
import type {
  ClaudeAgentSdkActiveQuery,
  ClaudeAgentSdkQueryFactory,
  ClaudeAgentSdkQueryRegistration,
  ClaudeCodeTransportKind,
} from "./transport/claude-agent-sdk-transport.js";

export type ClaudeCodeInvokeResult = {
  contextDelta?: AdapterDispatchContextDelta;
  output: string;
  telemetry?: AdapterDispatchTelemetry;
};

export type ClaudeCodeInvokeFn = (
  input: AdapterDispatchRequest & {
    onPreview?: AdapterPreviewCallback;
  }
) => Promise<ClaudeCodeInvokeResult>;

export type ClaudeCodeInvokeByTransportMode = Partial<
  Record<AdapterTransportMode, ClaudeCodeInvokeFn>
>;

export type ClaudeCodeInterruptSignalFn = (
  signal: AdapterInterruptSignal
) => Promise<void>;

export type ClaudeCodeCancelSignalFn = (
  input: AdapterCancelRequest
) => Promise<void>;

export type ClaudeCodeAdapterOptions = {
  claudeBin?: string;
  claudeTimeoutMs?: number | null;
  claudeTransport?: ClaudeCodeTransportKind;
  createAgentSdkQuery?: ClaudeAgentSdkQueryFactory;
  gracefulTimeoutMs?: number;
  invoke?: ClaudeCodeInvokeFn;
  invokeByMode?: ClaudeCodeInvokeByTransportMode;
  launchContract?: RuntimeAgentControllerLaunchContract;
  registerRuntimeProcess?: (
    input: AdapterRuntimeProcessEvent & { taskId: string }
  ) => void;
  sendCancel?: ClaudeCodeCancelSignalFn;
  sendInterrupt?: ClaudeCodeInterruptSignalFn;
  waitForMs?: WaitForMs;
};

export {
  resolveClaudeCodeTimeoutMs,
  resolveInstalledClaudeCodeLaunchCandidates,
  resolveInstalledClaudeCodeLaunchContract,
  verifyClaudeCodeLaunchContract,
} from "./config/claude-runtime-config.js";
export { isLikelyClaudeContextLostError } from "./context/claude-context-heal.js";
export {
  type ClaudeInvokeResult as ClaudeCodeRuntimeInvokeResult,
  ClaudeRuntimeError,
  invokeClaudeWithSingleContextHeal,
} from "./invoke/claude-invoke.js";
export { parseClaudeOutputLine } from "./output/claude-output-parser.js";
export {
  type ClaudeAgentSdkToolActivityTracker,
  createClaudeAgentSdkToolActivityTracker,
} from "./output/claude-tool-activity.js";
export {
  type ClaudeAgentSdkQueryFactory,
  type ClaudeAgentSdkQueryRegistration,
  ClaudeAgentSdkTransportError,
  type ClaudeCodeTransportKind,
  invokeClaudeAgentSdkTransport,
  resolveClaudeAgentSdkExecutable,
} from "./transport/claude-agent-sdk-transport.js";
export {
  ClaudeCliTransportError,
  invokeClaudeCliTransport,
} from "./transport/claude-cli-transport.js";
export { projectClaudeCodeUsageLimits } from "./usage/claude-code-usage-limits.js";

const CLAUDE_CODE_CONVERSATION_BRIDGE_SPEC =
  resolveBuiltinAdapterConversationBridgeSpec("claude-code");
const EXPECTED_FORCE_CLOSE_INTERRUPT_ERROR_RE =
  /query closed before response received/i;

export const createClaudeCodeAdapter = (
  options: ClaudeCodeAdapterOptions
): RuntimeAdapter => {
  const activeAgentSdkQueries = new Map<string, ClaudeAgentSdkActiveQuery>();
  const registerAgentSdkQuery: ClaudeAgentSdkQueryRegistration = ({
    query,
    taskId,
  }) => {
    activeAgentSdkQueries.set(taskId, query);
    return () => {
      if (activeAgentSdkQueries.get(taskId) === query) {
        activeAgentSdkQueries.delete(taskId);
      }
    };
  };
  const sendInterrupt: ClaudeCodeInterruptSignalFn = async (signal) => {
    const activeQuery = activeAgentSdkQueries.get(signal.taskId);
    if (activeQuery) {
      if (signal.mode === "force") {
        Promise.resolve()
          .then(() => activeQuery.interrupt())
          .catch((error) => {
            if (isExpectedForceCloseInterruptError(error)) {
              return;
            }
            console.warn(
              "[openmeld.claude_code.force_interrupt_failed_after_close]",
              {
                error: error instanceof Error ? error.message : String(error),
                taskId: signal.taskId,
              }
            );
          });
        activeQuery.close();
        return;
      }

      await activeQuery.interrupt();
      return;
    }

    if (options.sendInterrupt) {
      await options.sendInterrupt(signal);
      return;
    }

    throw Object.assign(
      new Error("Claude Code interrupt is not available for this task."),
      {
        code: "adapter.unsupported",
      }
    );
  };
  const controlShell = createSharedControlShell({
    gracefulTimeoutMs: options.gracefulTimeoutMs,
    sendCancel: options.sendCancel,
    sendInterrupt,
    waitForMs: options.waitForMs,
  });
  const dispatch = createSharedDispatchShell({
    adapterId: "claude-code",
    bridgeSpec: CLAUDE_CODE_CONVERSATION_BRIDGE_SPEC,
    invoke: options.invoke,
    invokeByMode: options.invokeByMode,
    repairConversationPolicy: "require_canonical",
    resolveDefaultInvoke: () =>
      resolveDefaultClaudeCodeInvoke({
        options,
        registerAgentSdkQuery,
      }),
    runtimeOptions: options,
  });

  return {
    adapterId: "claude-code",
    cancel: controlShell.cancel,
    dispatch,
    interrupt: controlShell.interrupt,
  };
};

const isExpectedForceCloseInterruptError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return EXPECTED_FORCE_CLOSE_INTERRUPT_ERROR_RE.test(error.message);
};

export const buildClaudeCodeInterruptRequest = (input: {
  reason?: string;
  taskId: string;
}): AdapterInterruptRequest => ({
  mode: "graceful",
  reason: input.reason,
  taskId: input.taskId,
});

export const buildClaudeCodeCancelRequest = (input: {
  reason?: string;
  taskId: string;
}): AdapterCancelRequest =>
  buildAdapterCancelRequest({
    reason: input.reason,
    taskId: input.taskId,
  });

const resolveDefaultClaudeCodeInvoke = (input: {
  options: ClaudeCodeAdapterOptions;
  registerAgentSdkQuery: ClaudeAgentSdkQueryRegistration;
}): ClaudeCodeInvokeFn => {
  const { options, registerAgentSdkQuery } = input;
  const claudeTimeoutMs =
    options.claudeTimeoutMs ?? resolveClaudeCodeTimeoutMsLocal();

  return async (dispatchInput): Promise<ClaudeCodeInvokeResult> => {
    const launchContract = await resolveClaudeDispatchLaunchContract({
      claudeBin: options.claudeBin,
      inputLaunchContract: dispatchInput.launchContract,
      optionLaunchContract: options.launchContract,
    });
    const registerRuntimeProcess = options.registerRuntimeProcess;
    const onProcessControlEvent = registerRuntimeProcess
      ? (event: AdapterRuntimeProcessEvent) => {
          registerRuntimeProcess({
            ...event,
            taskId: dispatchInput.taskId,
          });
        }
      : undefined;
    const result = await invokeClaudeWithSingleContextHealLocal({
      agentControllerPermissionMode:
        dispatchInput.agentControllerPermissionMode,
      launchContract,
      claudeTimeoutMs,
      claudeTransport: options.claudeTransport,
      claudeWorkdir:
        dispatchInput.runtimeContext.providerRuntimeWorkingDirectory,
      conversationPolicy: dispatchInput.conversationPolicy,
      ...(options.createAgentSdkQuery
        ? { createAgentSdkQuery: options.createAgentSdkQuery }
        : {}),
      env: dispatchInput.env,
      executionMode: dispatchInput.executionMode,
      instructionPrompt: dispatchInput.instructionPrompt,
      ...(dispatchInput.onInteractionRequest
        ? { onInteractionRequest: dispatchInput.onInteractionRequest }
        : {}),
      ...(onProcessControlEvent ? { onProcessControlEvent } : {}),
      ...(dispatchInput.onRuntimeEvent
        ? { onRuntimeEvent: dispatchInput.onRuntimeEvent }
        : {}),
      prompt: dispatchInput.prompt,
      registerAgentSdkQuery,
      sessionId: normalizeOptionalText(
        dispatchInput.agentControllerConversationId
      ),
      ...(dispatchInput.onPreview
        ? { onPreview: dispatchInput.onPreview }
        : {}),
      streamingMode: dispatchInput.streamingMode,
      taskId: dispatchInput.taskId,
    });

    const agentControllerConversation = CLAUDE_CODE_CONVERSATION_BRIDGE_SPEC
      ? bridgeAgentControllerConversationRef({
          bridgeSpec: CLAUDE_CODE_CONVERSATION_BRIDGE_SPEC,
          agentControllerConversationId: result.sessionId,
        })
      : null;
    return {
      contextDelta: {
        agentControllerConversationId: result.sessionId,
        refreshed: result.contextHealed,
        ...(agentControllerConversation ? { agentControllerConversation } : {}),
      },
      output: result.output,
      ...(result.telemetry ? { telemetry: result.telemetry } : {}),
    };
  };
};

async function resolveClaudeDispatchLaunchContract(input: {
  claudeBin?: string;
  inputLaunchContract?: RuntimeAgentControllerLaunchContract | null;
  optionLaunchContract?: RuntimeAgentControllerLaunchContract;
}): Promise<RuntimeAgentControllerLaunchContract> {
  const explicitLaunchContract =
    input.inputLaunchContract ??
    input.optionLaunchContract ??
    (normalizeOptionalText(input.claudeBin)
      ? buildExecutableLaunchContract({
          commandPath: normalizeOptionalText(input.claudeBin) as string,
        })
      : null);
  if (explicitLaunchContract) {
    const verification = await verifyClaudeCodeLaunchContractLocal({
      launchContract: explicitLaunchContract,
    });
    if (verification.ok) {
      return explicitLaunchContract;
    }
    throw Object.assign(new Error(verification.errorMessage), {
      code: "controller.launch.needs_repair",
      errorType: "config",
    });
  }

  throw Object.assign(
    new Error("Claude Code launch contract is required for runtime dispatch."),
    {
      code: "controller.launch.needs_repair",
      errorType: "config",
    }
  );
}

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};
