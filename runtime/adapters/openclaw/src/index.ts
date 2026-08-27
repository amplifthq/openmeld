// biome-ignore-all lint/performance/noBarrelFile: Package entrypoint intentionally re-exports OpenClaw runtime helpers.
import {
  type AdapterCancelRequest,
  type AdapterDispatchContextDelta,
  type AdapterDispatchRequest,
  type AdapterDispatchTelemetry,
  type AdapterInterruptRequest,
  type AdapterInterruptSignal,
  type AdapterRuntimeProcessEvent,
  type AdapterTransportMode,
  bridgeAgentControllerConversationRef,
  buildAdapterAgentControllerConversationRef,
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
  resolveOpenClawAgentId as resolveOpenClawAgentIdLocal,
  resolveOpenClawTimeoutMs as resolveOpenClawTimeoutMsLocal,
  verifyOpenClawLaunchContract as verifyOpenClawLaunchContractLocal,
} from "./config/openclaw-runtime-config.js";
import { invokeOpenClawWithSingleContextHeal as invokeOpenClawWithSingleContextHealLocal } from "./invoke/openclaw-invoke.js";
import { invokeOpenClawGatewayTransport } from "./transport/openclaw-gateway-transport.js";
import { withOpenClawDispatchSpaceActionPlugin } from "./transport/openclaw-space-action-plugin-config.js";

export type OpenClawInvokeResult = {
  contextDelta?: AdapterDispatchContextDelta;
  output: string;
  telemetry?: AdapterDispatchTelemetry;
};

export type OpenClawInvokeFn = (
  input: AdapterDispatchRequest
) => Promise<OpenClawInvokeResult>;

export type OpenClawInvokeByTransportMode = Partial<
  Record<AdapterTransportMode, OpenClawInvokeFn>
>;

export type OpenClawInterruptSignalFn = (
  signal: AdapterInterruptSignal
) => Promise<void>;

export type OpenClawCancelSignalFn = (
  input: AdapterCancelRequest
) => Promise<void>;

export type OpenClawAdapterOptions = {
  openClawAgentId?: string;
  openClawBin?: string;
  openClawTimeoutMs?: number | null;
  gracefulTimeoutMs?: number;
  invoke?: OpenClawInvokeFn;
  invokeByMode?: OpenClawInvokeByTransportMode;
  launchContract?: RuntimeAgentControllerLaunchContract;
  registerRuntimeProcess?: (
    input: AdapterRuntimeProcessEvent & { taskId: string }
  ) => void;
  sendCancel?: OpenClawCancelSignalFn;
  sendInterrupt?: OpenClawInterruptSignalFn;
  waitForMs?: WaitForMs;
};

export {
  resolveInstalledOpenClawLaunchCandidates,
  resolveInstalledOpenClawLaunchContract,
  resolveOpenClawAgentId,
  resolveOpenClawBin,
  resolveOpenClawBinCandidates,
  resolveOpenClawTimeoutMs,
  verifyOpenClawLaunchContract,
} from "./config/openclaw-runtime-config.js";
export { isLikelyOpenClawContextLostError } from "./context/openclaw-context-heal.js";
export {
  invokeOpenClawWithSingleContextHeal,
  type OpenClawInvokeResult as OpenClawRuntimeInvokeResult,
  OpenClawRuntimeError,
} from "./invoke/openclaw-invoke.js";
export { parseOpenClawOutputLine } from "./output/openclaw-output-parser.js";
export {
  invokeOpenClawCliTransport,
  OpenClawCliTransportError,
} from "./transport/openclaw-cli-transport.js";
export {
  invokeOpenClawGatewayTransport,
  OpenClawGatewayTransportError,
} from "./transport/openclaw-gateway-transport.js";

const OPENCLAW_CONVERSATION_BRIDGE_SPEC =
  resolveBuiltinAdapterConversationBridgeSpec("openclaw");

const resolveOpenClawSessionConversation = (
  agentControllerConversation: AdapterDispatchRequest["agentControllerConversation"]
): AdapterDispatchRequest["agentControllerConversation"] => {
  if (!agentControllerConversation) {
    return null;
  }

  const agentControllerConversationId = normalizeOptionalText(
    agentControllerConversation.agentControllerConversationId
  );
  if (!agentControllerConversationId) {
    throw new Error(
      "conversation.bridge.agent_controller_conversation_id_missing: expected builtin:openclaw session agentControllerConversationId"
    );
  }
  if (
    agentControllerConversation.agentControllerRef !== "builtin:openclaw" ||
    agentControllerConversation.agentControllerConversationKind !== "session"
  ) {
    throw new Error(
      `conversation.bridge.agent_controller_conversation_mismatch: expected builtin:openclaw session, received ${agentControllerConversation.agentControllerRef}/${agentControllerConversation.agentControllerConversationKind}`
    );
  }

  return buildAdapterAgentControllerConversationRef({
    agentControllerRef: "builtin:openclaw",
    agentControllerConversationId,
    agentControllerConversationKind: "session",
  });
};

const resolveOpenClawInvokeRequest = (input: {
  request: AdapterDispatchRequest;
}): AdapterDispatchRequest => {
  const agentControllerConversation = resolveOpenClawSessionConversation(
    input.request.agentControllerConversation
  );

  return {
    ...input.request,
    agentControllerConversationId: normalizeOptionalText(
      input.request.agentControllerConversationId
    ),
    ...(agentControllerConversation ? { agentControllerConversation } : {}),
  };
};

const resolveOpenClawContextDelta = (input: {
  invokeRequest: AdapterDispatchRequest;
  result: OpenClawInvokeResult;
}): AdapterDispatchContextDelta | undefined => {
  if (!input.result.contextDelta) {
    return input.result.contextDelta;
  }
  if (input.result.contextDelta.agentControllerConversation) {
    return input.result.contextDelta;
  }

  const continuationConversation = resolveOpenClawSessionConversation(
    input.invokeRequest.agentControllerConversation
  );
  const canonicalConversation =
    continuationConversation ??
    (OPENCLAW_CONVERSATION_BRIDGE_SPEC
      ? bridgeAgentControllerConversationRef({
          bridgeSpec: OPENCLAW_CONVERSATION_BRIDGE_SPEC,
          agentControllerConversationId:
            input.result.contextDelta.agentControllerConversationId,
          agentControllerConversation:
            input.result.contextDelta.agentControllerConversation,
        })
      : null);

  return {
    ...input.result.contextDelta,
    ...(canonicalConversation
      ? { agentControllerConversation: canonicalConversation }
      : {}),
  };
};

export const createOpenClawAdapter = (
  options: OpenClawAdapterOptions
): RuntimeAdapter => {
  const controlShell = createSharedControlShell({
    gracefulTimeoutMs: options.gracefulTimeoutMs,
    sendCancel: options.sendCancel,
    sendInterrupt: options.sendInterrupt,
    waitForMs: options.waitForMs,
  });
  const dispatch = createSharedDispatchShell({
    adapterId: "openclaw",
    bridgeSpec: OPENCLAW_CONVERSATION_BRIDGE_SPEC,
    invoke: options.invoke,
    invokeByMode: options.invokeByMode,
    resolveDefaultInvoke: () => resolveDefaultOpenClawInvoke(options),
    resolveInvokeRequest: ({ request }) =>
      resolveOpenClawInvokeRequest({ request }),
    resolveSuccessContextDelta: ({ invokeRequest, result }) =>
      resolveOpenClawContextDelta({
        invokeRequest,
        result,
      }),
    runtimeOptions: options,
  });

  return {
    adapterId: "openclaw",
    cancel: controlShell.cancel,
    dispatch,
    interrupt: controlShell.interrupt,
  };
};

export const buildOpenClawInterruptRequest = (input: {
  reason?: string;
  taskId: string;
}): AdapterInterruptRequest => ({
  mode: "graceful",
  reason: input.reason,
  taskId: input.taskId,
});

export const buildOpenClawCancelRequest = (input: {
  reason?: string;
  taskId: string;
}): AdapterCancelRequest =>
  buildAdapterCancelRequest({
    reason: input.reason,
    taskId: input.taskId,
  });

const resolveDefaultOpenClawInvoke = (
  options: OpenClawAdapterOptions
): OpenClawInvokeFn => {
  const openClawTimeoutMs =
    options.openClawTimeoutMs ?? resolveOpenClawTimeoutMsLocal();

  return async (input): Promise<OpenClawInvokeResult> => {
    const launchContract = await resolveOpenClawDispatchLaunchContract({
      inputLaunchContract: input.launchContract,
      openClawBin: options.openClawBin,
      optionLaunchContract: options.launchContract,
    });
    const openClawWorkdir =
      input.runtimeContext.providerRuntimeWorkingDirectory;
    const onProcessControlEvent = resolveRuntimeProcessRegistrar({
      registerRuntimeProcess: options.registerRuntimeProcess,
      taskId: input.taskId,
    });
    const openClawAgentId = resolveOpenClawAgentId({
      dispatchEnvAgentId: input.env?.OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID,
      optionAgentId: options.openClawAgentId,
    });
    return await withOpenClawDispatchSpaceActionPlugin({
      env: input.env,
      run: async ({ active, env }) => {
        const sessionKey = resolveOpenClawSessionKey(input);
        const invokeInput: AdapterDispatchRequest = {
          ...input,
          env,
          ...(active && sessionKey && !input.agentControllerConversationId
            ? { agentControllerConversationId: sessionKey }
            : {}),
        };
        if (sessionKey && !active) {
          return await invokeOpenClawGatewayPath({
            input: invokeInput,
            launchContract,
            openClawAgentId,
            openClawTimeoutMs,
            openClawWorkdir,
            sessionKey,
          });
        }
        return await invokeOpenClawLocalCliPath({
          input: invokeInput,
          launchContract,
          onProcessControlEvent,
          openClawAgentId,
          openClawTimeoutMs,
          openClawWorkdir,
        });
      },
    });
  };
};

async function resolveOpenClawDispatchLaunchContract(input: {
  inputLaunchContract?: RuntimeAgentControllerLaunchContract | null;
  openClawBin?: string;
  optionLaunchContract?: RuntimeAgentControllerLaunchContract;
}): Promise<RuntimeAgentControllerLaunchContract> {
  const explicitLaunchContract =
    input.inputLaunchContract ??
    input.optionLaunchContract ??
    (normalizeOptionalText(input.openClawBin)
      ? buildExecutableLaunchContract({
          commandPath: normalizeOptionalText(input.openClawBin) as string,
        })
      : null);
  if (explicitLaunchContract) {
    const verification = await verifyOpenClawLaunchContractLocal({
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
    new Error("OpenClaw launch contract is required for runtime dispatch."),
    {
      code: "controller.launch.needs_repair",
      errorType: "config",
    }
  );
}

const resolveRuntimeProcessRegistrar = (input: {
  registerRuntimeProcess:
    | ((event: AdapterRuntimeProcessEvent & { taskId: string }) => void)
    | undefined;
  taskId: string;
}): ((event: AdapterRuntimeProcessEvent) => void) | undefined =>
  input.registerRuntimeProcess
    ? (event) => {
        input.registerRuntimeProcess?.({
          ...event,
          taskId: input.taskId,
        });
      }
    : undefined;

const resolveOpenClawAgentId = (input: {
  dispatchEnvAgentId: unknown;
  optionAgentId: unknown;
}): string =>
  normalizeOptionalText(input.dispatchEnvAgentId) ??
  normalizeOptionalText(input.optionAgentId) ??
  resolveOpenClawAgentIdLocal();

const resolveOpenClawSessionKey = (
  input: AdapterDispatchRequest
): string | null =>
  normalizeOptionalText(
    input.agentControllerConversation?.agentControllerRef ===
      "builtin:openclaw" &&
      input.agentControllerConversation.agentControllerConversationKind ===
        "session"
      ? input.agentControllerConversation.agentControllerConversationId
      : null
  );

const invokeOpenClawGatewayPath = async (input: {
  input: AdapterDispatchRequest;
  launchContract: RuntimeAgentControllerLaunchContract;
  openClawAgentId: string;
  openClawTimeoutMs: number | null;
  openClawWorkdir: string;
  sessionKey: string;
}): Promise<OpenClawInvokeResult> => {
  const gatewayResult = await invokeOpenClawGatewayTransport({
    agentId: input.openClawAgentId,
    env: input.input.env,
    idempotencyKey: input.input.dispatchId ?? input.input.taskId,
    instructionPrompt: input.input.instructionPrompt,
    launchContract: input.launchContract,
    openClawTimeoutMs: input.openClawTimeoutMs,
    openClawWorkdir: input.openClawWorkdir,
    prompt: input.input.prompt,
    resumedContext:
      normalizeOptionalText(input.input.agentControllerConversationId) !== null,
    sessionKey: input.sessionKey,
  });

  return {
    contextDelta: {
      agentControllerConversationId: gatewayResult.sessionId,
      agentControllerConversation: buildAdapterAgentControllerConversationRef({
        agentControllerRef: "builtin:openclaw",
        agentControllerConversationId: gatewayResult.sessionKey,
        agentControllerConversationKind: "session",
      }),
    },
    output: gatewayResult.output,
    ...(gatewayResult.telemetry ? { telemetry: gatewayResult.telemetry } : {}),
  };
};

const invokeOpenClawLocalCliPath = async (input: {
  input: AdapterDispatchRequest;
  launchContract: RuntimeAgentControllerLaunchContract;
  onProcessControlEvent:
    | ((event: AdapterRuntimeProcessEvent) => void)
    | undefined;
  openClawAgentId: string;
  openClawTimeoutMs: number | null;
  openClawWorkdir: string;
}): Promise<OpenClawInvokeResult> => {
  const result = await invokeOpenClawWithSingleContextHealLocal({
    launchContract: input.launchContract,
    openClawAgentId: input.openClawAgentId,
    openClawTimeoutMs: input.openClawTimeoutMs,
    openClawWorkdir: input.openClawWorkdir,
    env: input.input.env,
    executionMode: input.input.executionMode,
    ...(input.onProcessControlEvent
      ? { onProcessControlEvent: input.onProcessControlEvent }
      : {}),
    ...(input.input.onRuntimeEvent
      ? { onRuntimeEvent: input.input.onRuntimeEvent }
      : {}),
    prompt: input.input.prompt,
    sessionId: normalizeOptionalText(input.input.agentControllerConversationId),
  });

  const agentControllerConversation = OPENCLAW_CONVERSATION_BRIDGE_SPEC
    ? bridgeAgentControllerConversationRef({
        bridgeSpec: OPENCLAW_CONVERSATION_BRIDGE_SPEC,
        agentControllerConversationId: result.sessionId,
      })
    : null;

  return {
    contextDelta: {
      agentControllerConversationId: result.sessionId,
      ...(result.contextHealed ? { refreshed: true } : {}),
      ...(agentControllerConversation ? { agentControllerConversation } : {}),
    },
    output: result.output,
    ...(result.telemetry ? { telemetry: result.telemetry } : {}),
  };
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}
