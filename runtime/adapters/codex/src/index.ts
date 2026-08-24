// biome-ignore-all lint/performance/noBarrelFile: Package entrypoint intentionally re-exports Codex runtime helpers.
import {
  type AdapterCancelRequest,
  type AdapterComputerFileAccessVerificationResult,
  type AdapterDispatchContextDelta,
  type AdapterDispatchRequest,
  type AdapterDispatchTelemetry,
  type AdapterInterruptRequest,
  type AdapterInterruptResult,
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
  verifyCliLaunchContract,
  type WaitForMs,
} from "@openmeld/adapter-core";
import {
  resolveCodexTimeoutMs as resolveCodexTimeoutMsLocal,
  verifyCodexLaunchContract as verifyCodexLaunchContractLocal,
} from "./config/codex-runtime-config.js";
import {
  invokeCodexAppServer as invokeCodexAppServerLocal,
  invokeCodexWithSingleContextHeal as invokeCodexWithSingleContextHealLocal,
} from "./invoke/codex-invoke.js";
import type {
  CodexAppServerActiveTurnRegistrar,
  CodexAppServerActiveTurnRegistration,
} from "./transport/codex-app-server-transport.js";
import {
  buildCodexFileAccessBoundaryGlobalArgs,
  redactCodexFileAccessBoundaryDispatchFailure,
} from "./transport/codex-file-access-boundary.js";

export type CodexInvokeResult = {
  contextDelta?: AdapterDispatchContextDelta;
  output: string;
  telemetry?: AdapterDispatchTelemetry;
};

export type CodexInvokeFn = (
  input: AdapterDispatchRequest & {
    onPreview?: AdapterPreviewCallback;
  }
) => Promise<CodexInvokeResult>;

export type CodexInvokeByTransportMode = Partial<
  Record<AdapterTransportMode, CodexInvokeFn>
>;

export type CodexInterruptSignalFn = (
  signal: AdapterInterruptSignal
) => Promise<void>;

export type CodexCancelSignalFn = (
  input: AdapterCancelRequest
) => Promise<void>;

type CodexAppServerActiveTurn = Pick<
  CodexAppServerActiveTurnRegistration,
  "interrupt" | "threadId" | "turnId"
>;

export type CodexAdapterOptions = {
  codexBin?: string;
  codexTimeoutMs?: number | null;
  enableLocalCliTransport?: boolean;
  gracefulTimeoutMs?: number;
  invoke?: CodexInvokeFn;
  invokeByMode?: CodexInvokeByTransportMode;
  launchContract?: RuntimeAgentControllerLaunchContract;
  registerRuntimeProcess?: (
    input: AdapterRuntimeProcessEvent & { taskId: string }
  ) => void;
  sendCancel?: CodexCancelSignalFn;
  sendInterrupt?: CodexInterruptSignalFn;
  waitForMs?: WaitForMs;
};

export {
  resolveCodexTimeoutMs,
  resolveInstalledCodexLaunchCandidates,
  resolveInstalledCodexLaunchContract,
  verifyCodexLaunchContract,
} from "./config/codex-runtime-config.js";
export { isLikelyContextLostError } from "./context/codex-context-heal.js";
export {
  type CodexInvokeResult as CodexRuntimeInvokeResult,
  CodexRuntimeError,
  invokeCodexAppServer,
  invokeCodexWithSingleContextHeal,
} from "./invoke/codex-invoke.js";
export { processCodexStdoutLine } from "./output/codex-output-parser.js";
export { extractCodexToolActivityEvent } from "./output/codex-tool-activity.js";
export {
  CodexAppServerTransportError,
  forkCodexAppServerThread,
  invokeCodexAppServerTransport,
  verifyCodexAppServerThread,
} from "./transport/codex-app-server-transport.js";
export {
  CodexCliTransportError,
  invokeCodexCliTransport,
} from "./transport/codex-cli-transport.js";
export { projectCodexUsageLimits } from "./usage/codex-usage-limits.js";

const CODEX_CONVERSATION_BRIDGE_SPEC =
  resolveBuiltinAdapterConversationBridgeSpec("codex");
const TEST_DISABLE_DEFAULT_INVOKE = Symbol.for(
  "openmeld.test.disableDefaultInvoke"
);
const COMPUTER_FILE_ACCESS_ATTESTATION_TTL_MS = 5 * 60 * 1000;
const MAX_COMPUTER_FILE_ACCESS_ATTESTATIONS = 32;

type ComputerFileAccessAttestation = {
  expiresAtMs: number;
  result: Promise<AdapterComputerFileAccessVerificationResult>;
};

export const createCodexAdapter = (
  options: CodexAdapterOptions
): RuntimeAdapter => {
  const activeAppServerTurns = new Map<string, CodexAppServerActiveTurn>();
  const computerFileAccessAttestations = new Map<
    string,
    ComputerFileAccessAttestation
  >();
  const registerAppServerTurn = (
    registration: CodexAppServerActiveTurnRegistration
  ) => {
    const activeTurn = {
      interrupt: registration.interrupt,
      threadId: registration.threadId,
      turnId: registration.turnId,
    };
    activeAppServerTurns.set(registration.taskId, activeTurn);
    return () => {
      if (activeAppServerTurns.get(registration.taskId) === activeTurn) {
        activeAppServerTurns.delete(registration.taskId);
      }
    };
  };
  const sendInterrupt: CodexInterruptSignalFn = async (signal) => {
    const activeTurn = activeAppServerTurns.get(signal.taskId);
    if (activeTurn) {
      await activeTurn.interrupt();
      return;
    }

    if (options.sendInterrupt) {
      await options.sendInterrupt(signal);
      return;
    }

    throw Object.assign(
      new Error("Codex App Server interrupt is not available for this task."),
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
  const sharedDispatch = createSharedDispatchShell({
    adapterId: "codex",
    bridgeSpec: CODEX_CONVERSATION_BRIDGE_SPEC,
    invoke: options.invoke,
    invokeByMode: resolveCodexInvokeByTransportMode({
      options,
      registerAppServerTurn,
    }),
    repairConversationPolicy: "preserve_canonical",
    resolveDefaultInvoke: () => resolveDefaultCodexInvoke(options),
    runtimeOptions: options,
  });
  const dispatch: RuntimeAdapter["dispatch"] = async (request) => {
    const result = await sharedDispatch(request);
    if (
      result.status === "failed" &&
      request.computerFileAccessBoundary !== undefined
    ) {
      return redactCodexFileAccessBoundaryDispatchFailure(result);
    }
    return result;
  };

  return {
    adapterId: "codex",
    cancel: controlShell.cancel,
    dispatch,
    interrupt: (request) =>
      interruptCodexActiveAppServerTurn({
        activeAppServerTurns,
        request,
        fallbackInterrupt: controlShell.interrupt,
      }),
    verifyComputerFileAccessBoundary: async (request) => {
      if (
        request.agentControllerPermissionMode === "codex:customConfig" ||
        (request.transportMode !== "codex-app-server" &&
          request.transportMode !== "local-cli")
      ) {
        return {
          reasonCode: "computer.file_access.controller_unsupported",
          supported: false,
        };
      }
      try {
        const configuredLaunchContract = resolveConfiguredCodexLaunchContract({
          codexBin: options.codexBin,
          inputLaunchContract: request.launchContract,
          optionLaunchContract: options.launchContract,
        });
        if (!configuredLaunchContract) {
          return {
            reasonCode: "computer.file_access.capability_unverified",
            supported: false,
          };
        }
        const probeArgs = [
          ...buildCodexFileAccessBoundaryGlobalArgs({
            boundary: request.boundary,
            executionMode: request.executionMode,
            permissionMode: request.agentControllerPermissionMode,
          }),
          "--version",
        ];
        const cacheKey = JSON.stringify({
          launchContract: configuredLaunchContract,
          probeArgs,
          workingDirectory: request.workingDirectory,
        });
        const nowMs = Date.now();
        const cached = computerFileAccessAttestations.get(cacheKey);
        if (cached && cached.expiresAtMs > nowMs) {
          return await cached.result;
        }
        if (cached) {
          computerFileAccessAttestations.delete(cacheKey);
        }
        const result = resolveCodexDispatchLaunchContract({
          codexBin: options.codexBin,
          inputLaunchContract: request.launchContract,
          optionLaunchContract: options.launchContract,
        })
          .then((launchContract) =>
            verifyCliLaunchContract({
              cwd: request.workingDirectory,
              displayName: "Codex file access boundary",
              launchContract,
              probeArgs,
              timeoutMs: 5000,
            })
          )
          .then<AdapterComputerFileAccessVerificationResult>((verification) =>
            verification.ok
              ? { supported: true }
              : {
                  reasonCode: "computer.file_access.capability_unverified",
                  supported: false,
                }
          )
          .catch<AdapterComputerFileAccessVerificationResult>(() => ({
            reasonCode: "computer.file_access.capability_unverified",
            supported: false,
          }));
        rememberComputerFileAccessAttestation({
          attestations: computerFileAccessAttestations,
          cacheKey,
          value: {
            expiresAtMs: nowMs + COMPUTER_FILE_ACCESS_ATTESTATION_TTL_MS,
            result,
          },
        });
        return await result;
      } catch {
        return {
          reasonCode: "computer.file_access.capability_unverified",
          supported: false,
        };
      }
    },
  };
};

function rememberComputerFileAccessAttestation(input: {
  attestations: Map<string, ComputerFileAccessAttestation>;
  cacheKey: string;
  value: ComputerFileAccessAttestation;
}): void {
  while (input.attestations.size >= MAX_COMPUTER_FILE_ACCESS_ATTESTATIONS) {
    const oldestKey = input.attestations.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    input.attestations.delete(oldestKey);
  }
  input.attestations.set(input.cacheKey, input.value);
}

export const buildCodexInterruptRequest = (input: {
  reason?: string;
  taskId: string;
}): AdapterInterruptRequest => ({
  mode: "graceful",
  reason: input.reason,
  taskId: input.taskId,
});

export const buildCodexCancelRequest = (input: {
  reason?: string;
  taskId: string;
}): AdapterCancelRequest =>
  buildAdapterCancelRequest({
    reason: input.reason,
    taskId: input.taskId,
  });

const resolveDefaultCodexInvoke = (
  options: CodexAdapterOptions
): CodexInvokeFn => {
  const codexTimeoutMs = options.codexTimeoutMs ?? resolveCodexTimeoutMsLocal();

  return async (input): Promise<CodexInvokeResult> => {
    const launchContract = await resolveCodexDispatchLaunchContract({
      codexBin: options.codexBin,
      inputLaunchContract: input.launchContract,
      optionLaunchContract: options.launchContract,
    });
    const onProcessControlEvent = options.registerRuntimeProcess
      ? (event: AdapterRuntimeProcessEvent) => {
          options.registerRuntimeProcess?.({
            ...event,
            taskId: input.taskId,
          });
        }
      : undefined;
    const result = await invokeCodexWithSingleContextHealLocal({
      agentControllerPermissionMode: input.agentControllerPermissionMode,
      computerFileAccessBoundary: input.computerFileAccessBoundary,
      launchContract,
      codexTimeoutMs,
      codexWorkdir: input.runtimeContext.providerRuntimeWorkingDirectory,
      conversationPolicy: input.conversationPolicy,
      env: input.env,
      executionMode: input.executionMode,
      ...(onProcessControlEvent ? { onProcessControlEvent } : {}),
      ...(input.onPreview ? { onPreview: input.onPreview } : {}),
      ...(input.onRuntimeEvent ? { onRuntimeEvent: input.onRuntimeEvent } : {}),
      prompt: input.prompt,
      streamingMode: input.streamingMode,
      threadId: normalizeOptionalText(input.agentControllerConversationId),
    });

    const agentControllerConversation = CODEX_CONVERSATION_BRIDGE_SPEC
      ? bridgeAgentControllerConversationRef({
          bridgeSpec: CODEX_CONVERSATION_BRIDGE_SPEC,
          agentControllerConversationId: result.threadId,
        })
      : null;
    return {
      contextDelta: {
        agentControllerConversationId: result.threadId,
        refreshed: result.contextHealed,
        ...(agentControllerConversation ? { agentControllerConversation } : {}),
      },
      output: result.output,
      ...(result.telemetry ? { telemetry: result.telemetry } : {}),
    };
  };
};

const resolveCodexInvokeByTransportMode = (input: {
  options: CodexAdapterOptions;
  registerAppServerTurn: CodexAppServerActiveTurnRegistrar;
}): CodexInvokeByTransportMode | undefined => {
  if (input.options.invoke || isDefaultInvokeDisabledForTests(input.options)) {
    return input.options.invokeByMode;
  }
  return {
    "codex-app-server": resolveDefaultCodexAppServerInvoke(input),
    ...(input.options.enableLocalCliTransport
      ? { "local-cli": resolveDefaultCodexInvoke(input.options) }
      : {}),
    ...(input.options.invokeByMode ?? {}),
  };
};

const resolveDefaultCodexAppServerInvoke = (input: {
  options: CodexAdapterOptions;
  registerAppServerTurn: CodexAppServerActiveTurnRegistrar;
}): CodexInvokeFn => {
  const codexTimeoutMs =
    input.options.codexTimeoutMs ?? resolveCodexTimeoutMsLocal();

  return async (dispatchInput): Promise<CodexInvokeResult> => {
    const launchContract = await resolveCodexDispatchLaunchContract({
      codexBin: input.options.codexBin,
      inputLaunchContract: dispatchInput.launchContract,
      optionLaunchContract: input.options.launchContract,
    });
    const onProcessControlEvent = input.options.registerRuntimeProcess
      ? (event: AdapterRuntimeProcessEvent) => {
          input.options.registerRuntimeProcess?.({
            ...event,
            taskId: dispatchInput.taskId,
          });
        }
      : undefined;
    const result = await invokeCodexAppServerLocal({
      agentControllerPermissionMode:
        dispatchInput.agentControllerPermissionMode,
      computerFileAccessBoundary: dispatchInput.computerFileAccessBoundary,
      launchContract,
      codexTimeoutMs,
      codexWorkdir:
        dispatchInput.runtimeContext.providerRuntimeWorkingDirectory,
      conversationPolicy: dispatchInput.conversationPolicy,
      env: dispatchInput.env,
      executionMode: dispatchInput.executionMode,
      instructionPrompt: dispatchInput.instructionPrompt,
      onActiveTurn: input.registerAppServerTurn,
      ...(dispatchInput.onInteractionRequest
        ? { onInteractionRequest: dispatchInput.onInteractionRequest }
        : {}),
      ...(onProcessControlEvent ? { onProcessControlEvent } : {}),
      ...(dispatchInput.onPreview
        ? { onPreview: dispatchInput.onPreview }
        : {}),
      ...(dispatchInput.onRuntimeEvent
        ? { onRuntimeEvent: dispatchInput.onRuntimeEvent }
        : {}),
      prompt: dispatchInput.prompt,
      streamingMode: dispatchInput.streamingMode,
      taskId: dispatchInput.taskId,
      threadId: normalizeOptionalText(
        dispatchInput.agentControllerConversationId
      ),
    });

    const agentControllerConversation = CODEX_CONVERSATION_BRIDGE_SPEC
      ? bridgeAgentControllerConversationRef({
          bridgeSpec: CODEX_CONVERSATION_BRIDGE_SPEC,
          agentControllerConversationId: result.threadId,
        })
      : null;
    return {
      contextDelta: {
        agentControllerConversationId: result.threadId,
        ...(result.contextHealed ? { refreshed: true } : {}),
        ...(agentControllerConversation ? { agentControllerConversation } : {}),
      },
      output: result.output,
      ...(result.telemetry ? { telemetry: result.telemetry } : {}),
    };
  };
};

async function interruptCodexActiveAppServerTurn(input: {
  activeAppServerTurns: ReadonlyMap<string, CodexAppServerActiveTurn>;
  fallbackInterrupt: RuntimeAdapter["interrupt"];
  request: AdapterInterruptRequest;
}): Promise<AdapterInterruptResult> {
  const activeTurn = input.activeAppServerTurns.get(input.request.taskId);
  if (!activeTurn) {
    return await input.fallbackInterrupt(input.request);
  }

  const plan: AdapterInterruptResult["plan"] = {
    initial: {
      mode: input.request.mode ?? "graceful",
      reason: input.request.reason ?? "service.interrupt",
      taskId: input.request.taskId,
    },
  };

  try {
    await activeTurn.interrupt();
    return {
      accepted: true,
      plan,
      reasonCode: "accepted",
      signalDelivery: "sent",
      taskId: input.request.taskId,
    };
  } catch (error) {
    return {
      accepted: false,
      plan,
      reasonCode: "signal.send_failed",
      reasonDetail: toErrorMessage(error),
      signalDelivery: "not_sent",
      taskId: input.request.taskId,
    };
  }
}

async function resolveCodexDispatchLaunchContract(input: {
  codexBin?: string;
  inputLaunchContract?: RuntimeAgentControllerLaunchContract | null;
  optionLaunchContract?: RuntimeAgentControllerLaunchContract;
}): Promise<RuntimeAgentControllerLaunchContract> {
  const explicitLaunchContract = resolveConfiguredCodexLaunchContract(input);
  if (explicitLaunchContract) {
    const verification = await verifyCodexLaunchContractLocal({
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
    new Error("Codex launch contract is required for runtime dispatch."),
    {
      code: "controller.launch.needs_repair",
      errorType: "config",
    }
  );
}

function resolveConfiguredCodexLaunchContract(input: {
  codexBin?: string;
  inputLaunchContract?: RuntimeAgentControllerLaunchContract | null;
  optionLaunchContract?: RuntimeAgentControllerLaunchContract;
}): RuntimeAgentControllerLaunchContract | null {
  return (
    input.inputLaunchContract ??
    input.optionLaunchContract ??
    (normalizeOptionalText(input.codexBin)
      ? buildExecutableLaunchContract({
          commandPath: normalizeOptionalText(input.codexBin) as string,
        })
      : null)
  );
}

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isDefaultInvokeDisabledForTests = (
  options: CodexAdapterOptions
): boolean =>
  (options as Record<PropertyKey, unknown>)[TEST_DISABLE_DEFAULT_INVOKE] ===
  true;
