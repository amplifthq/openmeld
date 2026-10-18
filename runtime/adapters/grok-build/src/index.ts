// biome-ignore-all lint/performance/noBarrelFile: Package entrypoint intentionally exposes the Grok Build adapter contract.
import {
  type AdapterCancelRequest,
  type AdapterCancelResult,
  type AdapterDispatchContextDelta,
  type AdapterDispatchDiagnostics,
  type AdapterDispatchRequest,
  type AdapterDispatchTelemetry,
  type AdapterInterruptRequest,
  type AdapterInterruptResult,
  type AdapterPermissionModeUpdateRequest,
  type AdapterPermissionModeUpdateResult,
  type AdapterPreviewCallback,
  type AdapterRuntimeProcessEvent,
  type AdapterTransportMode,
  bridgeAgentControllerConversationRef,
  buildExecutableLaunchContract,
  createSharedDispatchShell,
  invokeWithSingleContextHeal,
  type RuntimeAdapter,
  type RuntimeAgentControllerLaunchContract,
  resolveBuiltinAdapterConversationBridgeSpec,
} from "@openmeld/adapter-core";
import {
  resolveGrokBuildTimeoutMs,
  verifyGrokBuildLaunchContract as verifyGrokBuildLaunchContractLocal,
} from "./config/grok-build-runtime-config.js";
import { GrokBuildPermissionMemoryStore } from "./transport/grok-build-acp-interactions.js";
import {
  type GrokBuildAcpActiveTurnRegistrar,
  type GrokBuildAcpActiveTurnRegistration,
  GrokBuildAcpTransportError,
  invokeGrokBuildAcpTransport as invokeGrokBuildAcpTransportLocal,
} from "./transport/grok-build-acp-transport.js";

export type GrokBuildInvokeResult = {
  contextDelta?: AdapterDispatchContextDelta;
  diagnostics?: AdapterDispatchDiagnostics;
  output: string;
  telemetry?: AdapterDispatchTelemetry;
};

export type GrokBuildInvokeFn = (
  input: AdapterDispatchRequest & {
    onPreview?: AdapterPreviewCallback;
  }
) => Promise<GrokBuildInvokeResult>;

export type GrokBuildInvokeByTransportMode = Partial<
  Record<AdapterTransportMode, GrokBuildInvokeFn>
>;

export type GrokBuildAdapterOptions = {
  grokBuildBin?: string;
  grokBuildTimeoutMs?: number | null;
  invoke?: GrokBuildInvokeFn;
  invokeByMode?: GrokBuildInvokeByTransportMode;
  launchContract?: RuntimeAgentControllerLaunchContract;
  registerRuntimeProcess?: (
    input: AdapterRuntimeProcessEvent & { taskId: string }
  ) => void;
};

type ActiveGrokBuildAcpTurn = Pick<
  GrokBuildAcpActiveTurnRegistration,
  "cancel" | "launchPermissionMode" | "sessionId" | "setPermissionMode"
>;

const GROK_BUILD_CONVERSATION_BRIDGE_SPEC =
  resolveBuiltinAdapterConversationBridgeSpec("grok-build");

export {
  resolveGrokBuildTimeoutMs,
  resolveInstalledGrokBuildLaunchCandidates,
  resolveInstalledGrokBuildLaunchContract,
  verifyGrokBuildLaunchContract,
} from "./config/grok-build-runtime-config.js";
export {
  type GrokBuildAcpActiveTurnRegistrar,
  type GrokBuildAcpActiveTurnRegistration,
  type GrokBuildAcpInterfaceProbeResult,
  GrokBuildAcpTransportError,
  type GrokBuildAcpTransportResult,
  invokeGrokBuildAcpTransport,
  probeGrokBuildAcpInterface,
} from "./transport/grok-build-acp-transport.js";
export { projectGrokBuildUsageLimits } from "./usage/grok-build-usage-limits.js";

export function createGrokBuildAdapter(
  options: GrokBuildAdapterOptions
): RuntimeAdapter {
  const activeTurns = new Map<string, ActiveGrokBuildAcpTurn>();
  const permissionMemoryStore = new GrokBuildPermissionMemoryStore();
  const registerActiveTurn: GrokBuildAcpActiveTurnRegistrar = (
    registration
  ) => {
    const turn = {
      cancel: registration.cancel,
      launchPermissionMode: registration.launchPermissionMode,
      sessionId: registration.sessionId,
      setPermissionMode: registration.setPermissionMode,
    };
    activeTurns.set(registration.taskId, turn);
    return () => {
      if (activeTurns.get(registration.taskId) === turn) {
        activeTurns.delete(registration.taskId);
      }
    };
  };
  const dispatch = createSharedDispatchShell({
    adapterId: "grok-build",
    bridgeSpec: GROK_BUILD_CONVERSATION_BRIDGE_SPEC,
    invoke: options.invoke,
    invokeByMode: options.invoke
      ? options.invokeByMode
      : {
          acp: createDefaultGrokBuildInvoke({
            options,
            permissionMemoryStore,
            registerActiveTurn,
          }),
          ...(options.invokeByMode ?? {}),
        },
    repairConversationPolicy: "require_canonical",
    resolveDefaultInvoke: () => null,
    runtimeOptions: options,
  });

  return {
    adapterId: "grok-build",
    cancel: (request) => cancelActiveGrokBuildTurn({ activeTurns, request }),
    dispatch,
    interrupt: (request) =>
      interruptActiveGrokBuildTurn({ activeTurns, request }),
    updatePermissionMode: (request) =>
      Promise.resolve(
        updateGrokBuildActivePermissionMode({ activeTurns, request })
      ),
    verifyComputerFileAccessBoundary: () =>
      Promise.resolve({
        reasonCode: "computer.file_access.controller_unsupported",
        supported: false,
      }),
  };
}

/**
 * Grok Build reads `--permission-mode` only at launch and its ACP session has
 * no mode switch. OpenMeld can still honor two live transitions faithfully:
 * switching to Bypass permissions (OpenMeld answers later permission requests
 * with Grok's one-time allow) and switching back to the launch mode (OpenMeld
 * stops answering and Grok's native launch policy resumes). Any other change
 * would need a native policy OpenMeld cannot reproduce, so it waits for the
 * next Wake.
 */
function updateGrokBuildActivePermissionMode(input: {
  activeTurns: ReadonlyMap<string, ActiveGrokBuildAcpTurn>;
  request: AdapterPermissionModeUpdateRequest;
}): AdapterPermissionModeUpdateResult {
  const nextPermissionMode = input.request.agentControllerPermissionMode;
  if (!nextPermissionMode.startsWith("grok-build:")) {
    return {
      reasonCode: "adapter.permission_mode_incompatible",
      status: "not_applied",
      taskId: input.request.taskId,
    };
  }
  const activeTurn = input.activeTurns.get(input.request.taskId);
  if (!activeTurn) {
    return {
      reasonCode: "adapter.task_not_active",
      status: "not_applied",
      taskId: input.request.taskId,
    };
  }
  if (
    nextPermissionMode !== "grok-build:bypassPermissions" &&
    nextPermissionMode !==
      (activeTurn.launchPermissionMode ?? "grok-build:default")
  ) {
    return {
      reasonCode: "adapter.permission_mode_update_unsupported",
      status: "not_applied",
      taskId: input.request.taskId,
    };
  }
  activeTurn.setPermissionMode(nextPermissionMode);
  return {
    effectiveFrom: "subsequent_tool_requests",
    status: "applied",
    taskId: input.request.taskId,
  };
}

function createDefaultGrokBuildInvoke(input: {
  options: GrokBuildAdapterOptions;
  permissionMemoryStore: GrokBuildPermissionMemoryStore;
  registerActiveTurn: GrokBuildAcpActiveTurnRegistrar;
}): GrokBuildInvokeFn {
  const grokBuildTimeoutMs =
    input.options.grokBuildTimeoutMs ?? resolveGrokBuildTimeoutMs();
  return async (dispatchInput): Promise<GrokBuildInvokeResult> => {
    const launchContract = await resolveGrokBuildDispatchLaunchContract({
      grokBuildBin: input.options.grokBuildBin,
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
    const contextId = normalizeOptionalText(
      dispatchInput.agentControllerConversationId
    );
    const result = await invokeWithSingleContextHeal({
      contextId,
      contextLossPolicy:
        dispatchInput.executionMode === "repair" ? "fail" : "rebuild",
      createRebuildFailedError: (error) =>
        new GrokBuildAcpTransportError({
          cause: error,
          code: "context.rebuild_failed",
          ...(error instanceof GrokBuildAcpTransportError && error.diagnostics
            ? { diagnostics: error.diagnostics }
            : {}),
          ...(error instanceof GrokBuildAcpTransportError && error.originalError
            ? { originalError: error.originalError }
            : {}),
          errorType: "adapter",
          message: `context.rebuild_failed: ${toErrorMessage(error)}`,
        }),
      invokeOnce: async (sessionId) => {
        const transportResult = await invokeGrokBuildAcpTransportLocal({
          agentControllerPermissionMode:
            dispatchInput.agentControllerPermissionMode,
          conversationPolicy: dispatchInput.conversationPolicy,
          spaceActionTools: dispatchInput.spaceActionTools,
          env: dispatchInput.env,
          grokBuildTimeoutMs,
          grokBuildWorkdir:
            dispatchInput.runtimeContext.providerRuntimeWorkingDirectory,
          launchContract,
          onActiveTurn: input.registerActiveTurn,
          permissionMemoryStore: input.permissionMemoryStore,
          ...(dispatchInput.onInteractionRequest
            ? { onInteractionRequest: dispatchInput.onInteractionRequest }
            : {}),
          ...(dispatchInput.onPreview
            ? { onPreview: dispatchInput.onPreview }
            : {}),
          ...(onProcessControlEvent ? { onProcessControlEvent } : {}),
          ...(dispatchInput.onRuntimeEvent
            ? { onRuntimeEvent: dispatchInput.onRuntimeEvent }
            : {}),
          prompt: dispatchInput.prompt,
          sessionId,
          streamingMode: dispatchInput.streamingMode,
          taskId: dispatchInput.taskId,
        });
        return {
          contextId: transportResult.sessionId,
          diagnostics: transportResult.diagnostics,
          output: transportResult.output,
          telemetry: transportResult.telemetry,
        };
      },
      isContextLostError: (error) =>
        error instanceof GrokBuildAcpTransportError &&
        error.code === "context_not_found",
    });
    const agentControllerConversation =
      GROK_BUILD_CONVERSATION_BRIDGE_SPEC && result.contextId
        ? bridgeAgentControllerConversationRef({
            bridgeSpec: GROK_BUILD_CONVERSATION_BRIDGE_SPEC,
            agentControllerConversationId: result.contextId,
          })
        : null;
    return {
      contextDelta: {
        agentControllerConversationId: result.contextId,
        refreshed: result.contextHealed,
        ...(agentControllerConversation ? { agentControllerConversation } : {}),
      },
      ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
      output: result.output,
      ...(result.telemetry ? { telemetry: result.telemetry } : {}),
    };
  };
}

async function resolveGrokBuildDispatchLaunchContract(input: {
  grokBuildBin?: string;
  inputLaunchContract?: RuntimeAgentControllerLaunchContract | null;
  optionLaunchContract?: RuntimeAgentControllerLaunchContract;
}): Promise<RuntimeAgentControllerLaunchContract> {
  const commandPath = normalizeOptionalText(input.grokBuildBin);
  const launchContract =
    input.inputLaunchContract ??
    input.optionLaunchContract ??
    (commandPath ? buildExecutableLaunchContract({ commandPath }) : null);
  if (!launchContract) {
    throw Object.assign(
      new Error("Grok Build launch contract is required for runtime dispatch."),
      {
        code: "controller.launch.needs_repair",
        errorType: "config",
      }
    );
  }
  const verification = await verifyGrokBuildLaunchContractLocal({
    launchContract,
  });
  if (!verification.ok) {
    throw Object.assign(new Error(verification.errorMessage), {
      code: "controller.launch.needs_repair",
      errorType: "config",
    });
  }
  return launchContract;
}

async function cancelActiveGrokBuildTurn(input: {
  activeTurns: ReadonlyMap<string, ActiveGrokBuildAcpTurn>;
  request: AdapterCancelRequest;
}): Promise<AdapterCancelResult> {
  const activeTurn = input.activeTurns.get(input.request.taskId);
  if (!activeTurn) {
    return {
      accepted: false,
      reasonCode: "task.not_running",
      signalDelivery: "not_sent",
      taskId: input.request.taskId,
    };
  }
  try {
    await activeTurn.cancel();
    return {
      accepted: true,
      deliveryPath: "cancel",
      reasonCode: "accepted",
      signalDelivery: "sent",
      taskId: input.request.taskId,
    };
  } catch (error) {
    return {
      accepted: false,
      reasonCode: "signal.send_failed",
      reasonDetail: toErrorMessage(error),
      signalDelivery: "not_sent",
      taskId: input.request.taskId,
    };
  }
}

async function interruptActiveGrokBuildTurn(input: {
  activeTurns: ReadonlyMap<string, ActiveGrokBuildAcpTurn>;
  request: AdapterInterruptRequest;
}): Promise<AdapterInterruptResult> {
  const plan: AdapterInterruptResult["plan"] = {
    initial: {
      mode: input.request.mode ?? "graceful",
      reason: input.request.reason ?? "service.interrupt",
      taskId: input.request.taskId,
    },
  };
  const result = await cancelActiveGrokBuildTurn({
    activeTurns: input.activeTurns,
    request: input.request,
  });
  return {
    accepted: result.accepted,
    plan,
    reasonCode: result.reasonCode,
    ...(result.reasonDetail ? { reasonDetail: result.reasonDetail } : {}),
    signalDelivery: result.signalDelivery,
    taskId: result.taskId,
  };
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
