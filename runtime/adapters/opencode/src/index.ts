// biome-ignore-all lint/performance/noBarrelFile: Package entrypoint intentionally re-exports OpenCode runtime helpers.
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
  buildAdapterCancelRequest,
  buildDispatchSpaceActionMcpToolIds,
  buildExecutableLaunchContract,
  createSharedControlShell,
  createSharedDispatchShell,
  type RuntimeAdapter,
  type RuntimeAgentControllerLaunchContract,
  resolveBuiltinAdapterConversationBridgeSpec,
  resolveDispatchSpaceActionMcpServer,
  type WaitForMs,
} from "@openmeld/adapter-core";
import {
  resolveOpenCodeTimeoutMs as resolveOpenCodeTimeoutMsLocal,
  verifyOpenCodeLaunchContract as verifyOpenCodeLaunchContractLocal,
} from "./config/opencode-runtime-config.js";
import { invokeOpenCodeWithSingleContextHeal as invokeOpenCodeWithSingleContextHealLocal } from "./invoke/opencode-invoke.js";

export type OpenCodeInvokeResult = {
  contextDelta?: AdapterDispatchContextDelta;
  output: string;
  telemetry?: AdapterDispatchTelemetry;
};

export type OpenCodeInvokeFn = (
  input: AdapterDispatchRequest
) => Promise<OpenCodeInvokeResult>;

export type OpenCodeInvokeByTransportMode = Partial<
  Record<AdapterTransportMode, OpenCodeInvokeFn>
>;

export type OpenCodeInterruptSignalFn = (
  signal: AdapterInterruptSignal
) => Promise<void>;

export type OpenCodeCancelSignalFn = (
  input: AdapterCancelRequest
) => Promise<void>;

export type OpenCodeAdapterOptions = {
  openCodeBin?: string;
  openCodeTimeoutMs?: number | null;
  gracefulTimeoutMs?: number;
  invoke?: OpenCodeInvokeFn;
  invokeByMode?: OpenCodeInvokeByTransportMode;
  launchContract?: RuntimeAgentControllerLaunchContract;
  registerRuntimeProcess?: (
    input: AdapterRuntimeProcessEvent & { taskId: string }
  ) => void;
  sendCancel?: OpenCodeCancelSignalFn;
  sendInterrupt?: OpenCodeInterruptSignalFn;
  waitForMs?: WaitForMs;
};

export {
  resolveInstalledOpenCodeLaunchCandidates,
  resolveInstalledOpenCodeLaunchContract,
  resolveOpenCodeTimeoutMs,
  verifyOpenCodeLaunchContract,
} from "./config/opencode-runtime-config.js";
export { isLikelyOpenCodeContextLostError } from "./context/opencode-context-heal.js";
export {
  invokeOpenCodeWithSingleContextHeal,
  type OpenCodeInvokeResult as OpenCodeRuntimeInvokeResult,
  OpenCodeRuntimeError,
} from "./invoke/opencode-invoke.js";
export {
  parseOpenCodeOutputDocument,
  parseOpenCodeOutputLine,
} from "./output/opencode-output-parser.js";
export {
  invokeOpenCodeCliTransport,
  OpenCodeCliTransportError,
} from "./transport/opencode-cli-transport.js";
export {
  forkOpenCodeServerSession,
  invokeOpenCodeServerTransport,
  OpenCodeServerTransportError,
} from "./transport/opencode-server-transport.js";

const OPENCODE_CONVERSATION_BRIDGE_SPEC =
  resolveBuiltinAdapterConversationBridgeSpec("opencode");
const OPENCODE_PERMISSION_ENV = "OPENCODE_PERMISSION";
const OPENCODE_CONFIG_CONTENT_ENV = "OPENCODE_CONFIG_CONTENT";

export const createOpenCodeAdapter = (
  options: OpenCodeAdapterOptions
): RuntimeAdapter => {
  const controlShell = createSharedControlShell({
    gracefulTimeoutMs: options.gracefulTimeoutMs,
    sendCancel: options.sendCancel,
    sendInterrupt: options.sendInterrupt,
    waitForMs: options.waitForMs,
  });
  const dispatch = createSharedDispatchShell({
    adapterId: "opencode",
    bridgeSpec: OPENCODE_CONVERSATION_BRIDGE_SPEC,
    invoke: options.invoke,
    invokeByMode: options.invokeByMode,
    repairConversationPolicy: "require_canonical",
    resolveDefaultInvoke: () => resolveDefaultOpenCodeInvoke(options),
    runtimeOptions: options,
  });

  return {
    adapterId: "opencode",
    cancel: controlShell.cancel,
    dispatch,
    interrupt: controlShell.interrupt,
  };
};

export const buildOpenCodeInterruptRequest = (input: {
  reason?: string;
  taskId: string;
}): AdapterInterruptRequest => ({
  mode: "graceful",
  reason: input.reason,
  taskId: input.taskId,
});

export const buildOpenCodeCancelRequest = (input: {
  reason?: string;
  taskId: string;
}): AdapterCancelRequest =>
  buildAdapterCancelRequest({
    reason: input.reason,
    taskId: input.taskId,
  });

const resolveDefaultOpenCodeInvoke = (
  options: OpenCodeAdapterOptions
): OpenCodeInvokeFn => {
  const openCodeTimeoutMs =
    options.openCodeTimeoutMs ?? resolveOpenCodeTimeoutMsLocal();

  return async (input): Promise<OpenCodeInvokeResult> => {
    const launchContract = await resolveOpenCodeDispatchLaunchContract({
      inputLaunchContract: input.launchContract,
      openCodeBin: options.openCodeBin,
      optionLaunchContract: options.launchContract,
    });
    const openCodeWorkdir =
      input.runtimeContext.providerRuntimeWorkingDirectory;
    const onProcessControlEvent = resolveRuntimeProcessRegistrar({
      registerRuntimeProcess: options.registerRuntimeProcess,
      taskId: input.taskId,
    });
    const result = await invokeOpenCodeWithSingleContextHealLocal({
      launchContract,
      openCodeTimeoutMs,
      openCodeWorkdir,
      env: buildOpenCodeEnv(input),
      executionMode: input.executionMode,
      instructionPrompt: input.instructionPrompt,
      conversationPolicy: input.conversationPolicy,
      ...(input.onInteractionRequest
        ? { onInteractionRequest: input.onInteractionRequest }
        : {}),
      ...(input.onPreview ? { onPreview: input.onPreview } : {}),
      ...(onProcessControlEvent ? { onProcessControlEvent } : {}),
      ...(input.onRuntimeEvent ? { onRuntimeEvent: input.onRuntimeEvent } : {}),
      prompt: input.prompt,
      sessionId: normalizeOptionalText(input.agentControllerConversationId),
      streamingMode: input.streamingMode,
    });

    const agentControllerConversation = OPENCODE_CONVERSATION_BRIDGE_SPEC
      ? bridgeAgentControllerConversationRef({
          bridgeSpec: OPENCODE_CONVERSATION_BRIDGE_SPEC,
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

function buildOpenCodeEnv(
  input: Pick<AdapterDispatchRequest, "env" | "openCodePermission">
): Record<string, string | undefined> | undefined {
  const spaceActionMcpServer = resolveDispatchSpaceActionMcpServer(input.env);
  if (!spaceActionMcpServer) {
    if (!input.openCodePermission) {
      return input.env;
    }
    return {
      ...(input.env ?? {}),
      [OPENCODE_PERMISSION_ENV]: JSON.stringify(input.openCodePermission),
    };
  }

  const toolIds = buildDispatchSpaceActionMcpToolIds("_");
  const config = parseOpenCodeConfigContent(
    input.env?.[OPENCODE_CONFIG_CONTENT_ENV]
  );
  const mcp = readRecord(config.mcp);
  if (mcp[spaceActionMcpServer.id] !== undefined) {
    throw new Error(
      "OpenMeld cannot start its dispatch Space Action tool because the reserved OpenCode MCP server name is already configured."
    );
  }
  const tools = readRecord(config.tools);
  const permission = {
    ...(input.openCodePermission ?? {}),
    ...Object.fromEntries(toolIds.map((toolId) => [toolId, "allow"])),
  };

  return {
    ...(input.env ?? {}),
    [OPENCODE_CONFIG_CONTENT_ENV]: JSON.stringify({
      ...config,
      mcp: {
        ...mcp,
        [spaceActionMcpServer.id]: {
          command: [
            spaceActionMcpServer.commandPath,
            ...spaceActionMcpServer.args,
          ],
          enabled: true,
          environment: spaceActionMcpServer.env,
          type: "local",
        },
      },
      tools: {
        ...tools,
        ...Object.fromEntries(toolIds.map((toolId) => [toolId, true])),
      },
    }),
    [OPENCODE_PERMISSION_ENV]: JSON.stringify(permission),
  };
}

function parseOpenCodeConfigContent(value: unknown): Record<string, unknown> {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    throw new Error("OpenCode process config is not valid JSON.", {
      cause: error,
    });
  }
  if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
    throw new Error("OpenCode process config must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const resolveOpenCodeDispatchLaunchContract = async (input: {
  inputLaunchContract?: RuntimeAgentControllerLaunchContract | null;
  openCodeBin?: string;
  optionLaunchContract?: RuntimeAgentControllerLaunchContract;
}): Promise<RuntimeAgentControllerLaunchContract> => {
  const launchContract =
    input.inputLaunchContract ??
    input.optionLaunchContract ??
    (input.openCodeBin
      ? buildExecutableLaunchContract({
          commandPath: input.openCodeBin,
        })
      : null);
  if (!launchContract) {
    throw Object.assign(new Error("OpenCode launch contract is required."), {
      code: "adapter.missing_launch_contract",
      errorType: "config",
    });
  }

  const verification = await verifyOpenCodeLaunchContractLocal({
    launchContract,
  });
  if (!verification.ok) {
    throw Object.assign(
      new Error(
        `OpenCode launch contract is not executable: ${verification.errorMessage}`
      ),
      {
        code: "adapter.invalid_launch_contract",
        errorType: "config",
      }
    );
  }
  return launchContract;
};

const resolveRuntimeProcessRegistrar = (input: {
  registerRuntimeProcess?: (
    event: AdapterRuntimeProcessEvent & { taskId: string }
  ) => void;
  taskId: string;
}): ((event: AdapterRuntimeProcessEvent) => void) | undefined => {
  if (!input.registerRuntimeProcess) {
    return undefined;
  }
  return (event) => {
    input.registerRuntimeProcess?.({
      ...event,
      taskId: input.taskId,
    });
  };
};

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
