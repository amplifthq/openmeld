// biome-ignore-all lint/performance/noBarrelFile: Package entrypoint exposes the Antigravity adapter contract.
import {
  type AdapterDispatchContextDelta,
  type AdapterDispatchRequest,
  type AdapterDispatchTelemetry,
  type AdapterInterruptSignal,
  type AdapterRuntimeProcessEvent,
  type AdapterTransportMode,
  bridgeAgentControllerConversationRef,
  buildExecutableLaunchContract,
  createSharedControlShell,
  createSharedDispatchShell,
  invokeWithSingleContextHeal,
  type RuntimeAdapter,
  type RuntimeAgentControllerLaunchContract,
  resolveBuiltinAdapterConversationBridgeSpec,
  signalAgentControllerProcessTree,
  type WaitForMs,
} from "@openmeld/adapter-core";
import { verifyAntigravityLaunchContract as verifyAntigravityLaunchContractLocal } from "./config/antigravity-runtime-config.js";
import {
  AntigravityCliTransportError,
  invokeAntigravityCliTransport,
} from "./transport/antigravity-cli-transport.js";
import { withAntigravityDispatchSpaceAction } from "./transport/antigravity-space-action.js";

export type AntigravityAdapterOptions = {
  antigravityBin?: string;
  gracefulTimeoutMs?: number;
  invoke?: AntigravityInvokeFn;
  invokeByMode?: AntigravityInvokeByTransportMode;
  launchContract?: RuntimeAgentControllerLaunchContract;
  registerRuntimeProcess?: (
    input: AdapterRuntimeProcessEvent & { taskId: string }
  ) => void;
  sendCancel?: (input: { reason?: string; taskId: string }) => Promise<void>;
  sendInterrupt?: (signal: AdapterInterruptSignal) => Promise<void>;
  waitForMs?: WaitForMs;
};

export type AntigravityInvokeResult = {
  contextDelta?: AdapterDispatchContextDelta;
  output: string;
  telemetry?: AdapterDispatchTelemetry;
};

export type AntigravityInvokeFn = (
  input: AdapterDispatchRequest
) => Promise<AntigravityInvokeResult>;

export type AntigravityInvokeByTransportMode = Partial<
  Record<AdapterTransportMode, AntigravityInvokeFn>
>;

type ActiveTask = {
  cancellationRequested: boolean;
  process: AdapterRuntimeProcessEvent | null;
};

const ANTIGRAVITY_CONVERSATION_BRIDGE_SPEC =
  resolveBuiltinAdapterConversationBridgeSpec("antigravity");

export {
  resolveInstalledAntigravityLaunchCandidates,
  verifyAntigravityLaunchContract,
} from "./config/antigravity-runtime-config.js";
export { parseAntigravityOutputLine } from "./output/antigravity-output-parser.js";
export {
  AntigravityCliTransportError,
  buildAntigravityArgs,
  invokeAntigravityCliTransport,
} from "./transport/antigravity-cli-transport.js";

export function createAntigravityAdapter(
  options: AntigravityAdapterOptions = {}
): RuntimeAdapter {
  const activeTasks = new Map<string, ActiveTask>();
  const invoke = createDefaultAntigravityInvoke({
    activeTasks,
    options,
  });
  const processInterruptSender = options.registerRuntimeProcess
    ? createProcessInterruptSender(activeTasks)
    : undefined;
  const controlShell = createSharedControlShell({
    gracefulTimeoutMs: options.gracefulTimeoutMs,
    sendCancel: options.sendCancel,
    sendInterrupt: options.sendInterrupt ?? processInterruptSender,
    waitForMs: options.waitForMs,
  });
  const dispatch = createSharedDispatchShell({
    adapterId: "antigravity",
    bridgeSpec: ANTIGRAVITY_CONVERSATION_BRIDGE_SPEC,
    invoke: options.invoke,
    invokeByMode: options.invokeByMode,
    repairConversationPolicy: "require_canonical",
    resolveDefaultInvoke: () => invoke,
    runtimeOptions: options,
  });
  return {
    adapterId: "antigravity",
    cancel: controlShell.cancel,
    dispatch,
    interrupt: controlShell.interrupt,
    verifyComputerFileAccessBoundary: () =>
      Promise.resolve({
        reasonCode: "computer.file_access.controller_unsupported",
        supported: false,
      }),
  };
}

function createDefaultAntigravityInvoke(input: {
  activeTasks: Map<string, ActiveTask>;
  options: AntigravityAdapterOptions;
}) {
  return async (request: AdapterDispatchRequest) => {
    const task: ActiveTask = {
      cancellationRequested: false,
      process: null,
    };
    input.activeTasks.set(request.taskId, task);
    try {
      const launchContract = await resolveDispatchLaunchContract({
        antigravityBin: input.options.antigravityBin,
        inputLaunchContract: request.launchContract,
        optionLaunchContract: input.options.launchContract,
      });
      if (task.cancellationRequested) {
        throw new AntigravityCliTransportError({
          code: "runtime.cancelled_before_start",
          errorType: "adapter",
          message:
            "runtime.cancelled_before_start: Antigravity dispatch was canceled before launch",
        });
      }
      const contextId = normalizeOptionalText(
        request.agentControllerConversationId
      );
      const result = await invokeWithSingleContextHeal({
        contextId,
        contextLossPolicy:
          request.executionMode === "repair" ? "fail" : "rebuild",
        createRebuildFailedError: (error) =>
          new AntigravityCliTransportError({
            code: "context.rebuild_failed",
            errorType: "adapter",
            message: `context.rebuild_failed: ${toErrorMessage(error)}`,
          }),
        invokeOnce: async (sessionId) => {
          const transportResult = await withAntigravityDispatchSpaceAction({
            env: request.env,
            prompt: request.prompt,
            workdir: request.runtimeContext.providerRuntimeWorkingDirectory,
            run: async ({ prompt, jsonSchema }) =>
              await invokeAntigravityCliTransport({
                agentControllerPermissionMode:
                  request.agentControllerPermissionMode,
                conversationPolicy: request.conversationPolicy,
                env: request.env,
                jsonSchema,
                launchContract,
                onPreview: request.onPreview,
                onProcessControlEvent: (event) => {
                  task.process =
                    event.phase === "process_spawned" ? event : null;
                  if (
                    event.phase === "process_spawned" &&
                    task.cancellationRequested
                  ) {
                    signalProcess(event, "SIGINT");
                  }
                  input.options.registerRuntimeProcess?.({
                    ...event,
                    taskId: request.taskId,
                  });
                },
                onRuntimeEvent: request.onRuntimeEvent,
                prompt,
                sessionId,
                timeoutMs: request.timeoutMs ?? null,
                workdir: request.runtimeContext.providerRuntimeWorkingDirectory,
              }),
          });
          return {
            contextId: transportResult.sessionId,
            output: transportResult.output,
            telemetry: transportResult.telemetry,
          };
        },
        isContextLostError: (error) =>
          error instanceof AntigravityCliTransportError &&
          error.code === "context_not_found",
      });
      const agentControllerConversation =
        ANTIGRAVITY_CONVERSATION_BRIDGE_SPEC && result.contextId
          ? bridgeAgentControllerConversationRef({
              bridgeSpec: ANTIGRAVITY_CONVERSATION_BRIDGE_SPEC,
              agentControllerConversationId: result.contextId,
            })
          : null;
      return {
        contextDelta: {
          agentControllerConversationId: result.contextId,
          refreshed: result.contextHealed,
          ...(agentControllerConversation
            ? { agentControllerConversation }
            : {}),
        },
        output: result.output,
        telemetry: result.telemetry,
      };
    } finally {
      if (input.activeTasks.get(request.taskId) === task) {
        input.activeTasks.delete(request.taskId);
      }
    }
  };
}

async function resolveDispatchLaunchContract(input: {
  antigravityBin?: string;
  inputLaunchContract?: RuntimeAgentControllerLaunchContract | null;
  optionLaunchContract?: RuntimeAgentControllerLaunchContract;
}): Promise<RuntimeAgentControllerLaunchContract> {
  const commandPath = normalizeOptionalText(input.antigravityBin);
  const launchContract =
    input.inputLaunchContract ??
    input.optionLaunchContract ??
    (commandPath ? buildExecutableLaunchContract({ commandPath }) : null);
  if (!launchContract) {
    throw Object.assign(
      new Error("Antigravity CLI launch contract is required for dispatch."),
      { code: "controller.launch.needs_repair", errorType: "config" }
    );
  }
  const verification = await verifyAntigravityLaunchContractLocal({
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

function createProcessInterruptSender(
  activeTasks: Map<string, ActiveTask>
): (signal: AdapterInterruptSignal) => Promise<void> {
  return (signal) => {
    const task = activeTasks.get(signal.taskId);
    if (!task) {
      return Promise.reject(
        Object.assign(new Error("Antigravity task is not running."), {
          code: "task.not_running",
        })
      );
    }
    task.cancellationRequested = true;
    if (!task.process) {
      return Promise.resolve();
    }
    const sent = signalProcess(
      task.process,
      signal.mode === "force" ? "SIGKILL" : "SIGINT"
    );
    return sent
      ? Promise.resolve()
      : Promise.reject(new Error("Antigravity process signal was not sent."));
  };
}

function signalProcess(
  processEvent: AdapterRuntimeProcessEvent,
  signal: NodeJS.Signals
): boolean {
  return signalAgentControllerProcessTree({
    processId: processEvent.processId,
    signal,
    signalTarget: processEvent.signalTarget,
  });
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
