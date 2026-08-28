// biome-ignore-all lint/performance/noBarrelFile: Package entrypoint intentionally exposes the Cursor adapter contract.
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
  resolveCursorTimeoutMs,
  verifyCursorLaunchContract as verifyCursorLaunchContractLocal,
} from "./config/cursor-runtime-config.js";
import {
  type CursorAcpActiveTurnRegistrar,
  type CursorAcpActiveTurnRegistration,
  CursorAcpTransportError,
  invokeCursorAcpTransport as invokeCursorAcpTransportLocal,
} from "./transport/cursor-acp-transport.js";

export type CursorInvokeResult = {
  contextDelta?: AdapterDispatchContextDelta;
  diagnostics?: AdapterDispatchDiagnostics;
  output: string;
  telemetry?: AdapterDispatchTelemetry;
};

export type CursorInvokeFn = (
  input: AdapterDispatchRequest & {
    onPreview?: AdapterPreviewCallback;
  }
) => Promise<CursorInvokeResult>;

export type CursorInvokeByTransportMode = Partial<
  Record<AdapterTransportMode, CursorInvokeFn>
>;

export type CursorAdapterOptions = {
  cursorBin?: string;
  cursorTimeoutMs?: number | null;
  invoke?: CursorInvokeFn;
  invokeByMode?: CursorInvokeByTransportMode;
  launchContract?: RuntimeAgentControllerLaunchContract;
  registerRuntimeProcess?: (
    input: AdapterRuntimeProcessEvent & { taskId: string }
  ) => void;
};

type ActiveCursorAcpTurn = Pick<
  CursorAcpActiveTurnRegistration,
  "agentControllerPermissionMode" | "cancel" | "sessionId" | "setPermissionMode"
>;

const CURSOR_CONVERSATION_BRIDGE_SPEC =
  resolveBuiltinAdapterConversationBridgeSpec("cursor");

export {
  refreshCursorPersistedLaunchContract,
  resolveCursorTimeoutMs,
  resolveInstalledCursorLaunchCandidates,
  resolveInstalledCursorLaunchContract,
  verifyCursorLaunchContract,
} from "./config/cursor-runtime-config.js";
export {
  type CursorAcpToolActivityTracker,
  createCursorAcpToolActivityTracker,
} from "./output/cursor-tool-activity.js";
export {
  type CursorAcpActiveTurnRegistrar,
  type CursorAcpActiveTurnRegistration,
  CursorAcpTransportError,
  type CursorAcpTransportResult,
  invokeCursorAcpTransport,
} from "./transport/cursor-acp-transport.js";

export function createCursorAdapter(
  options: CursorAdapterOptions
): RuntimeAdapter {
  const activeTurns = new Map<string, ActiveCursorAcpTurn>();
  const registerActiveTurn: CursorAcpActiveTurnRegistrar = (registration) => {
    const turn = {
      agentControllerPermissionMode: registration.agentControllerPermissionMode,
      cancel: registration.cancel,
      setPermissionMode: registration.setPermissionMode,
      sessionId: registration.sessionId,
    };
    activeTurns.set(registration.taskId, turn);
    return () => {
      if (activeTurns.get(registration.taskId) === turn) {
        activeTurns.delete(registration.taskId);
      }
    };
  };
  const dispatch = createSharedDispatchShell({
    adapterId: "cursor",
    bridgeSpec: CURSOR_CONVERSATION_BRIDGE_SPEC,
    invoke: options.invoke,
    invokeByMode: options.invoke
      ? options.invokeByMode
      : {
          acp: createDefaultCursorInvoke({
            options,
            registerActiveTurn,
          }),
          ...(options.invokeByMode ?? {}),
        },
    repairConversationPolicy: "require_canonical",
    resolveDefaultInvoke: () => null,
    runtimeOptions: options,
  });

  return {
    adapterId: "cursor",
    cancel: (request) => cancelActiveCursorTurn({ activeTurns, request }),
    dispatch,
    interrupt: (request) => interruptActiveCursorTurn({ activeTurns, request }),
    updatePermissionMode: (request) =>
      updateCursorActivePermissionMode({ activeTurns, request }),
  };
}

async function updateCursorActivePermissionMode(input: {
  activeTurns: ReadonlyMap<string, ActiveCursorAcpTurn>;
  request: AdapterPermissionModeUpdateRequest;
}): Promise<AdapterPermissionModeUpdateResult> {
  if (!input.request.agentControllerPermissionMode.startsWith("cursor:")) {
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
    !(
      isCursorAcpSessionPermissionMode(
        activeTurn.agentControllerPermissionMode
      ) &&
      isCursorAcpSessionPermissionMode(
        input.request.agentControllerPermissionMode
      )
    )
  ) {
    return {
      reasonCode: "adapter.permission_mode_update_unsupported",
      status: "not_applied",
      taskId: input.request.taskId,
    };
  }

  await activeTurn.setPermissionMode(
    input.request.agentControllerPermissionMode
  );
  activeTurn.agentControllerPermissionMode =
    input.request.agentControllerPermissionMode;
  return {
    effectiveFrom: "subsequent_tool_requests",
    status: "applied",
    taskId: input.request.taskId,
  };
}

function isCursorAcpSessionPermissionMode(
  permissionMode: AdapterPermissionModeUpdateRequest["agentControllerPermissionMode"]
): permissionMode is "cursor:ask" | "cursor:default" | "cursor:plan" {
  return (
    permissionMode === "cursor:ask" ||
    permissionMode === "cursor:default" ||
    permissionMode === "cursor:plan"
  );
}

function createDefaultCursorInvoke(input: {
  options: CursorAdapterOptions;
  registerActiveTurn: CursorAcpActiveTurnRegistrar;
}): CursorInvokeFn {
  const cursorTimeoutMs =
    input.options.cursorTimeoutMs ?? resolveCursorTimeoutMs();
  return async (dispatchInput): Promise<CursorInvokeResult> => {
    const launchContract = await resolveCursorDispatchLaunchContract({
      cursorBin: input.options.cursorBin,
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
        error instanceof CursorAcpTransportError &&
        error.code === "cursor.plan_upgrade_required"
          ? error
          : new CursorAcpTransportError({
              cause: error,
              code: "context.rebuild_failed",
              ...(error instanceof CursorAcpTransportError && error.diagnostics
                ? { diagnostics: error.diagnostics }
                : {}),
              errorType: "adapter",
              message: `context.rebuild_failed: ${toErrorMessage(error)}`,
            }),
      invokeOnce: async (sessionId) => {
        const transportResult = await invokeCursorAcpTransportLocal({
          agentControllerPermissionMode:
            dispatchInput.agentControllerPermissionMode,
          conversationPolicy: dispatchInput.conversationPolicy,
          cursorTimeoutMs,
          cursorWorkdir:
            dispatchInput.runtimeContext.providerRuntimeWorkingDirectory,
          env: dispatchInput.env,
          launchContract,
          onActiveTurn: input.registerActiveTurn,
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
        error instanceof CursorAcpTransportError &&
        error.code === "context_not_found",
    });
    const agentControllerConversation =
      CURSOR_CONVERSATION_BRIDGE_SPEC && result.contextId
        ? bridgeAgentControllerConversationRef({
            bridgeSpec: CURSOR_CONVERSATION_BRIDGE_SPEC,
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

async function resolveCursorDispatchLaunchContract(input: {
  cursorBin?: string;
  inputLaunchContract?: RuntimeAgentControllerLaunchContract | null;
  optionLaunchContract?: RuntimeAgentControllerLaunchContract;
}): Promise<RuntimeAgentControllerLaunchContract> {
  const launchContract =
    input.inputLaunchContract ??
    input.optionLaunchContract ??
    (normalizeOptionalText(input.cursorBin)
      ? buildExecutableLaunchContract({
          commandPath: normalizeOptionalText(input.cursorBin) as string,
        })
      : null);
  if (!launchContract) {
    throw Object.assign(
      new Error("Cursor CLI launch contract is required for runtime dispatch."),
      {
        code: "controller.launch.needs_repair",
        errorType: "config",
      }
    );
  }
  const verification = await verifyCursorLaunchContractLocal({
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

async function cancelActiveCursorTurn(input: {
  activeTurns: ReadonlyMap<string, ActiveCursorAcpTurn>;
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

async function interruptActiveCursorTurn(input: {
  activeTurns: ReadonlyMap<string, ActiveCursorAcpTurn>;
  request: AdapterInterruptRequest;
}): Promise<AdapterInterruptResult> {
  const plan: AdapterInterruptResult["plan"] = {
    initial: {
      mode: input.request.mode ?? "graceful",
      reason: input.request.reason ?? "service.interrupt",
      taskId: input.request.taskId,
    },
  };
  const activeTurn = input.activeTurns.get(input.request.taskId);
  if (!activeTurn) {
    return {
      accepted: false,
      plan,
      reasonCode: "task.not_running",
      signalDelivery: "not_sent",
      taskId: input.request.taskId,
    };
  }
  try {
    await activeTurn.cancel();
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

function normalizeOptionalText(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
