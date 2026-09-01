// biome-ignore-all lint/performance/noBarrelFile: Package entrypoint intentionally exports stable adapter-core helpers.
//
// Provider runtime integrations must always go through adapter integration.
// There is no parallel "lightweight integration" path outside adapter-core.
//
// Use a thin adapter when the provider only needs straightforward transport
// wiring into the shared runtime shell. Escalate to a full adapter as soon as
// the provider has any of the following:
// - continuation-specific behavior
// - bootstrap or readiness preparation
// - gateway transport requirements
// - provider-native workspace semantics
// - non-trivial parser/codec logic
// - provider-specific failure/diagnostics mapping

import { openMeldDaemonProviderAccessEvidenceSchema } from "@openmeld/schemas";
import type {
  AgentControllerConversationRef,
  AgentControllerPermissionMode,
  AgentControllerUsageLimit,
  AgentInteractionRequest,
  AgentInteractionResponse,
  ComputerFileAccessPolicy,
  ConversationPolicy,
  OpenCodePermissionConfig,
  OpenMeldDaemonProviderAccessEvidence,
  ProviderDispatchRuntimeContext,
  RuntimeAgentControllerLaunchContract,
  RuntimeTransportMode,
} from "@openmeld/schemas/types";
import type { AgentControllerProcessSignalTarget } from "./agent-controller-process.js";
import type { AdapterConversationBridgeSpec } from "./conversation-bridge.js";
import { createProviderOriginalError } from "./provider-original-error.js";

export {
  type AcpClientRequestHandler,
  type AcpClientRequestResponse,
  type AcpJsonRpcError,
  type AcpJsonRpcId,
  type AcpJsonRpcMessage,
  type AcpNotificationHandler,
  type AcpProcessControlEvent,
  type AcpProcessErrorFactory,
  type AcpProcessErrorInput,
  type AcpProcessErrorType,
  type AcpProcessLifecycle,
  type AcpProcessLifecycleEvent,
  AcpProcessSession,
  type AcpProcessTelemetry,
} from "./acp-process-session.js";
export {
  type AcpToolActivityTracker,
  createAcpToolActivityTracker,
} from "./acp-tool-activity.js";

import {
  bridgeAgentControllerConversationRef,
  buildAdapterAgentControllerConversationRef,
  resolveBridgedAgentControllerConversationId,
} from "./conversation-bridge.js";
import type { CliDriverLifecycleEvent } from "./drivers/driver-types.js";
import type { AdapterToolActivityEvent } from "./tool-activity.js";

export type {
  AgentControllerPermissionMode,
  ConversationPolicy,
  OpenCodePermissionConfig,
  RuntimeAgentControllerLaunchCandidate,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/schemas/types";
export {
  type AgentControllerProcessCleanupResult,
  type AgentControllerProcessDiscoveryFailure,
  type AgentControllerProcessSignalTarget,
  type ListAgentControllerDescendantProcessIds,
  type ListAgentControllerSupervisedProcessIds,
  listAgentControllerDescendantProcessIds,
  listAgentControllerSupervisedProcessIds,
  type ReportAgentControllerProcessDiscoveryFailure,
  resolveAgentControllerDescendantProcessIds,
  resolveAgentControllerProcessSignalId,
  resolveAgentControllerProcessSignalTarget,
  resolveAgentControllerSupervisedProcessIds,
  type SpawnedAgentControllerProcess,
  signalAgentControllerProcessTree,
  spawnAgentControllerProcess,
  terminateRemainingAgentControllerProcesses,
  type WaitForAgentControllerProcessDiscoveryRetry,
} from "./agent-controller-process.js";
export {
  type AdapterConversationBridgeSpec,
  bridgeAgentControllerConversationRef,
  buildAdapterAgentControllerConversationRef,
  resolveBridgedAgentControllerConversationId,
  resolveBuiltinAdapterConversationBridgeSpec,
} from "./conversation-bridge.js";
export {
  type AcpDispatchSpaceActionMcpServer,
  buildAcpDispatchSpaceActionMcpServers,
  buildDispatchSpaceActionMcpToolIds,
  type DispatchSpaceActionMcpServer,
  OPENMELD_SPACE_ACTION_MCP_SERVER_ID,
  OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES,
  resolveDispatchSpaceActionMcpServer,
} from "./dispatch-space-action-mcp.js";
export {
  buildCliLaunchInvocation,
  buildExecutableLaunchContract,
  type CliLaunchCommand,
  type InstalledLaunchCandidatesFailureReason,
  type InstalledLaunchCandidatesOptions,
  type InstalledLaunchCandidatesResolution,
  type InstalledLaunchContractResolution,
  type LaunchContractVerificationFailureKind,
  type LaunchContractVerificationResult,
  materializeCliLaunchCommand,
  resolveExecutableOnPath,
  resolveExecutablePathsOnPath,
  resolveInstalledCommandPath,
  resolveInstalledCommandPaths,
  resolveInstalledNodeScriptLaunchCandidates,
  resolveInstalledNodeScriptLaunchContract,
  resolveLaunchCandidatesAfterVerification,
  resolveSiblingCommandPath,
  verifyCliLaunchContract,
  verifyLaunchContractFiles,
} from "./launch-contract.js";
export { createProviderOriginalError } from "./provider-original-error.js";
export {
  type AdapterProviderUsageLimit,
  createUnavailableProviderUsageLimits,
  createUnsupportedProviderUsageLimits,
} from "./provider-usage-limits.js";
export {
  type AdapterRuntimeFailure,
  buildProviderExitError,
  classifyCliDriverTimeoutFailure,
} from "./runtime-failure.js";
export {
  classifyRuntimePermissionDenialMessage,
  looksLikeRuntimePermissionDenialMessage,
  RUNTIME_PERMISSION_DENIED_REASON_CODE,
  type RuntimePermissionDenialClassification,
  type RuntimePermissionDenialDetails,
  type RuntimePermissionDenialSource,
  readRuntimePermissionDenialDetails,
} from "./runtime-permission-denial.js";
export {
  ADAPTER_TOOL_ACTIVITY_NAMES,
  type AdapterToolActivityEvent,
  type AdapterToolActivityName,
  type AdapterToolActivityState,
  resolveAdapterToolActivityName,
  resolveAdapterToolWorkActivity,
} from "./tool-activity.js";

export type AdapterErrorType =
  | "adapter"
  | "auth"
  | "config"
  | "timeout"
  | "network"
  | "unknown";
export type AdapterTransportMode = RuntimeTransportMode;
export type AdapterStreamingMode = "final" | "stream";
export type AdapterDispatchExecutionMode = "normal" | "repair";
export type AdapterComputerFileAccessBoundary = Extract<
  ComputerFileAccessPolicy,
  { mode: "block_selected_folders" | "only_selected_folders" }
>;
export type AdapterComputerFileAccessVerificationRequest = {
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  boundary: AdapterComputerFileAccessBoundary;
  executionMode?: AdapterDispatchExecutionMode;
  launchContract?: RuntimeAgentControllerLaunchContract | null;
  transportMode: AdapterTransportMode;
  workingDirectory: string;
};
export type AdapterComputerFileAccessVerificationResult =
  | { supported: true }
  | {
      reasonCode: string;
      supported: false;
    };
export type AdapterPreviewSnapshot = {
  text: string;
};
export type AdapterPreviewCallback = (
  preview: AdapterPreviewSnapshot
) => Promise<void> | void;
type AgentInteractionRuntimeFields =
  | "expiresAtMs"
  | "interactionId"
  | "requestedAtMs"
  | "v";
type WithoutAgentInteractionRuntimeFields<T> = T extends unknown
  ? Omit<T, AgentInteractionRuntimeFields>
  : never;
export type AdapterInteractionRequest =
  WithoutAgentInteractionRuntimeFields<AgentInteractionRequest>;
export type AdapterInteractionCallback = (
  request: AdapterInteractionRequest
) => Promise<AgentInteractionResponse>;
export type AdapterProviderConversationObservedEvent = {
  phase: "provider_conversation_observed";
  agentControllerConversationId: string;
  agentControllerConversation?: AgentControllerConversationRef | null;
  tsMs: number;
};
export type AdapterProviderTurnAcceptedEvent = {
  phase: "provider_turn_accepted";
  agentControllerConversationId: string;
  tsMs: number;
  turnId: string;
};
export type AdapterProviderUsageLimitsObservedEvent = {
  phase: "provider_usage_limits_observed";
  tsMs: number;
  usageLimits: AgentControllerUsageLimit[];
};
export const AGENT_CONTROLLER_CONVERSATION_OCCUPANCY_CONTRACT_VERSION = 1;

export type AdapterAgentControllerConversationOccupancy = {
  agentControllerConversationId: string;
  contractVersion: typeof AGENT_CONTROLLER_CONVERSATION_OCCUPANCY_CONTRACT_VERSION;
  state: "occupied";
};

export type AdapterAgentControllerConversationOccupancyEvent = {
  agentControllerConversationId: string;
  contractVersion: typeof AGENT_CONTROLLER_CONVERSATION_OCCUPANCY_CONTRACT_VERSION;
  phase:
    | "agent_controller_conversation_available"
    | "agent_controller_conversation_occupied";
  tsMs: number;
};
export type AdapterRuntimeEvent =
  | CliDriverLifecycleEvent
  | AdapterAgentControllerConversationOccupancyEvent
  | AdapterProviderConversationObservedEvent
  | AdapterProviderTurnAcceptedEvent
  | AdapterProviderUsageLimitsObservedEvent
  | AdapterToolActivityEvent;
export type AdapterRuntimeEventCallback = (
  event: AdapterRuntimeEvent
) => Promise<void> | void;
export type AdapterRuntimeProcessEvent = {
  phase: "process_exit" | "process_spawned";
  processId: number | null;
  signalTarget: AgentControllerProcessSignalTarget;
};
export type AdapterRuntimeProcessCallback = (
  event: AdapterRuntimeProcessEvent
) => Promise<void> | void;

export type AdapterInstructionPrompt = {
  developerInstructions: string;
  instructionEpoch: string;
  userPrompt: string;
};

export type AdapterTokenUsageBreakdown = {
  cacheWriteInputTokens?: number;
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type AdapterTokenUsage = {
  last: AdapterTokenUsageBreakdown;
  modelContextWindow: number | null;
  total: AdapterTokenUsageBreakdown;
};

declare const setTimeout: (callback: () => void, delay?: number) => unknown;

export type AdapterDispatchRequest = {
  agentId: string;
  agentControllerConversationId?: string | null;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  conversationPolicy?: ConversationPolicy;
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary;
  dispatchId?: string;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  launchContract?: RuntimeAgentControllerLaunchContract | null;
  openCodePermission?: OpenCodePermissionConfig;
  onInteractionRequest?: AdapterInteractionCallback;
  onPreview?: AdapterPreviewCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  instructionPrompt?: AdapterInstructionPrompt;
  prompt: string;
  runtimeContext: ProviderDispatchRuntimeContext;
  sourceEventId: string;
  spaceId: string;
  taskId: string;
  // Explicit watchdog only. A normal OpenMeld Agent execution has no fixed
  // wall-clock timeout; callers should omit this unless they intentionally want
  // a diagnostic/test backstop.
  timeoutMs?: number | null;
  transportMode?: AdapterTransportMode;
  streamingMode?: AdapterStreamingMode;
  agentControllerConversation?: AgentControllerConversationRef | null;
};

export type AdapterContextIdMappingSpec = {
  sourceField: string;
  mappingVersion: number;
};

export type AdapterAgentContextResolution = {
  agentControllerConversationId: string | null;
  sourceField: string;
  mappingVersion: number;
  agentControllerConversation?: AgentControllerConversationRef | null;
};

export type AdapterDispatchContextDelta = {
  agentControllerConversationId?: string | null;
  refreshed?: boolean;
  agentControllerConversation?: AgentControllerConversationRef | null;
};

export type AdapterDispatchTelemetry = {
  completedAtMs: number;
  contextCompactionObserved?: boolean;
  contextHealed?: boolean;
  exitCode?: number | null;
  exitObservedAtMs?: number;
  exitSignal?: NodeJS.Signals | null;
  firstOutputAtMs?: number;
  firstStderrAtMs?: number;
  firstStdoutAtMs?: number;
  invokedAtMs: number;
  previewEmitted?: boolean;
  processId?: number;
  processSpawnedAtMs?: number;
  resumedContext: boolean;
  stdinClosedAtMs?: number;
  streamingMode?: AdapterStreamingMode;
  timeoutTriggeredAtMs?: number;
  tokenUsage?: AdapterTokenUsage;
};

export type AdapterModelNegotiationDiagnostics = {
  checkAttempt: 1 | 2;
  configAvailableModelCount: number;
  configAvailableModelIds: string[];
  configAvailableModelIdsTruncated: boolean;
  configCurrentModelId: string | null;
  currentModelId: string | null;
  legacyAvailableModelCount: number;
  legacyAvailableModelIds: string[];
  legacyAvailableModelIdsTruncated: boolean;
  legacyCurrentModelId: string | null;
  protocol: "acp/v1";
  requestedModelId: string | null;
  requestedPresentInConfigOptions: boolean;
  requestedPresentInLegacyModels: boolean;
  sessionOperation: "load" | "new" | "resume";
  sourceState:
    | "config_options_only"
    | "conflicting"
    | "consistent"
    | "legacy_models_only"
    | "missing";
};

export type AdapterDispatchDiagnostics = {
  modelNegotiation?: AdapterModelNegotiationDiagnostics;
};

export type AdapterDispatchSuccess = {
  contextDelta?: AdapterDispatchContextDelta;
  diagnostics?: AdapterDispatchDiagnostics;
  output: string;
  status: "success";
  telemetry?: AdapterDispatchTelemetry;
};

export type AdapterDispatchFailure = {
  agentControllerConversationOccupancy?: AdapterAgentControllerConversationOccupancy;
  diagnostics?: AdapterDispatchDiagnostics;
  errorCode?: string;
  errorMessage: string;
  errorType: AdapterErrorType;
  originalError?: string;
  providerAccessEvidence?: OpenMeldDaemonProviderAccessEvidence;
  status: "failed";
  telemetry?: AdapterDispatchTelemetry;
};

export type AdapterProviderAccessEvidence =
  OpenMeldDaemonProviderAccessEvidence;

export type AdapterDispatchResult =
  | AdapterDispatchFailure
  | AdapterDispatchSuccess;

export type SharedDispatchInvokeResult = {
  contextDelta?: AdapterDispatchContextDelta;
  diagnostics?: AdapterDispatchDiagnostics;
  output: string;
  telemetry?: AdapterDispatchTelemetry;
};

export type SharedDispatchInvokeFn = (
  input: AdapterDispatchRequest
) => Promise<SharedDispatchInvokeResult>;

export type SharedDispatchInvokeRequestResolver = (input: {
  bridgeSpec: AdapterConversationBridgeSpec | null;
  request: AdapterDispatchRequest;
}) => AdapterDispatchRequest;

export type SharedDispatchSuccessContextDeltaResolver = (input: {
  bridgeSpec: AdapterConversationBridgeSpec | null;
  request: AdapterDispatchRequest;
  invokeRequest: AdapterDispatchRequest;
  result: SharedDispatchInvokeResult;
}) => AdapterDispatchContextDelta | undefined;

export type AdapterInterruptMode = "graceful" | "force";

export const DEFAULT_GRACEFUL_INTERRUPT_TIMEOUT_MS = 10_000;
const DEFAULT_INTERRUPT_REASON = "service.interrupt";
const DEFAULT_CANCEL_REASON = "service.cancel";
const TEST_DISABLE_DEFAULT_INVOKE = Symbol.for(
  "openmeld.test.disableDefaultInvoke"
);

export type AdapterControlReasonCode =
  | "accepted"
  | "adapter.unsupported"
  | "signal.not_sent"
  | "signal.send_failed"
  | "task.not_found"
  | "task.not_running";

export type AdapterControlResultBase = {
  accepted: boolean;
  reasonCode: AdapterControlReasonCode;
  reasonDetail?: string;
  taskId: string;
};

export type AdapterInterruptRequest = {
  gracefulTimeoutMs?: number;
  mode?: AdapterInterruptMode;
  reason?: string;
  taskId: string;
};

export type AdapterInterruptSignal = {
  mode: AdapterInterruptMode;
  reason: string;
  taskId: string;
};

export type AdapterInterruptPlan = {
  escalation?: AdapterInterruptSignal & { delayMs: number };
  initial: AdapterInterruptSignal;
};

export type AdapterInterruptResult = {
  plan: AdapterInterruptPlan;
  reasonCode: AdapterControlReasonCode;
  reasonDetail?: string;
  signalDelivery: "not_sent" | "sent";
  taskId: string;
  accepted: boolean;
};

export type AdapterCancelRequest = {
  reason?: string;
  taskId: string;
};

export type AdapterCancelResult = AdapterControlResultBase & {
  deliveryPath?: "cancel" | "force_interrupt_fallback";
  signalDelivery: "not_sent" | "sent";
};

export type AdapterPermissionModeUpdateRequest = {
  agentControllerPermissionMode: AgentControllerPermissionMode;
  taskId: string;
};

export type AdapterPermissionModeUpdateResult =
  | {
      effectiveFrom: "subsequent_tool_requests";
      status: "applied";
      taskId: string;
    }
  | {
      reasonCode:
        | "adapter.permission_mode_incompatible"
        | "adapter.permission_mode_update_unsupported"
        | "adapter.task_not_active";
      status: "not_applied";
      taskId: string;
    };

export type WaitForMs = (delayMs: number) => Promise<void>;

export type RuntimeAdapter = {
  readonly adapterId: string;
  // TODO(adapter-control-e2e): Wire user-triggered control commands (CLI/Space)
  // through RuntimeTransport -> daemon session router -> runtime adapter.
  cancel?(input: AdapterCancelRequest): Promise<AdapterCancelResult>;
  dispatch(input: AdapterDispatchRequest): Promise<AdapterDispatchResult>;
  interrupt(input: AdapterInterruptRequest): Promise<AdapterInterruptResult>;
  updatePermissionMode?(
    input: AdapterPermissionModeUpdateRequest
  ): Promise<AdapterPermissionModeUpdateResult>;
  verifyComputerFileAccessBoundary?(
    input: AdapterComputerFileAccessVerificationRequest
  ): Promise<AdapterComputerFileAccessVerificationResult>;
};

export const createSharedDispatchShell = (input: {
  adapterId: string;
  bridgeSpec?: AdapterConversationBridgeSpec | null;
  invoke?: SharedDispatchInvokeFn;
  invokeByMode?: Partial<Record<string, SharedDispatchInvokeFn>>;
  repairConversationPolicy?: "require_canonical";
  resolveInvokeRequest?: SharedDispatchInvokeRequestResolver;
  resolveSuccessContextDelta?: SharedDispatchSuccessContextDeltaResolver;
  resolveDefaultInvoke: () => SharedDispatchInvokeFn | null | undefined;
  runtimeOptions?: object;
}): RuntimeAdapter["dispatch"] => {
  const bridgeSpec = input.bridgeSpec ?? null;

  return async (
    dispatchInput: AdapterDispatchRequest
  ): Promise<AdapterDispatchResult> => {
    const transportMode = dispatchInput.transportMode ?? "local-cli";
    const transportInvoke = input.invokeByMode?.[transportMode];

    if (input.invokeByMode && !transportInvoke) {
      return {
        errorCode: "adapter.unreachable",
        errorMessage: `adapter.unreachable: ${input.adapterId} transport '${transportMode}' is not configured`,
        errorType: "adapter",
        status: "failed",
      };
    }

    const defaultInvoke = isDefaultInvokeDisabledForTests(input.runtimeOptions)
      ? null
      : (input.resolveDefaultInvoke() ?? null);
    const resolvedInvoke = transportInvoke ?? input.invoke ?? defaultInvoke;

    if (!resolvedInvoke) {
      return {
        errorCode: "controller.runtime.missing",
        errorMessage: `controller.runtime.missing: ${input.adapterId} invoke runtime is unavailable`,
        errorType: "adapter",
        status: "failed",
      };
    }

    try {
      const invokeRequest =
        input.resolveInvokeRequest?.({
          bridgeSpec,
          request: dispatchInput,
        }) ??
        buildDefaultInvokeRequest({
          bridgeSpec,
          request: dispatchInput,
        });
      const requiredRepairConversationId = resolveRequiredRepairConversationId({
        invokeRequest,
        policy: input.repairConversationPolicy,
        request: dispatchInput,
      });
      const result = await resolvedInvoke(invokeRequest);
      const contextDelta =
        input.resolveSuccessContextDelta?.({
          bridgeSpec,
          invokeRequest,
          request: dispatchInput,
          result,
        }) ??
        resolveCanonicalContextDelta({
          bridgeSpec,
          contextDelta: result.contextDelta,
        });
      const protectedContextDelta = requireCanonicalRepairConversation({
        canonicalConversationId: requiredRepairConversationId,
        contextDelta,
      });

      return {
        ...(protectedContextDelta
          ? { contextDelta: protectedContextDelta }
          : {}),
        ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
        output: result.output,
        status: "success",
        ...(result.telemetry ? { telemetry: result.telemetry } : {}),
      };
    } catch (error) {
      return toAdapterDispatchFailure(error, "adapter");
    }
  };
};

class AdapterRepairConversationMissingError extends Error {
  readonly code = "repair.conversation_missing";
  readonly errorType: AdapterErrorType = "adapter";

  constructor() {
    super(
      "repair.conversation_missing: repair requires an existing Agent Controller conversation"
    );
    this.name = "AdapterRepairConversationMissingError";
  }
}

class AdapterRepairConversationError extends Error {
  readonly code = "repair.conversation_changed";
  readonly errorType: AdapterErrorType = "adapter";

  constructor() {
    super(
      "repair.conversation_changed: repair could not preserve the existing Agent Controller conversation"
    );
    this.name = "AdapterRepairConversationError";
  }
}

const resolveRequiredRepairConversationId = (input: {
  invokeRequest: AdapterDispatchRequest;
  policy?: "require_canonical";
  request: AdapterDispatchRequest;
}): string | null => {
  if (
    input.policy !== "require_canonical" ||
    input.request.executionMode !== "repair"
  ) {
    return null;
  }

  const canonicalConversationId = normalizeOptionalText(
    input.invokeRequest.agentControllerConversationId
  );
  if (!canonicalConversationId) {
    throw new AdapterRepairConversationMissingError();
  }

  return canonicalConversationId;
};

const requireCanonicalRepairConversation = (input: {
  canonicalConversationId: string | null;
  contextDelta?: AdapterDispatchContextDelta;
}): AdapterDispatchContextDelta | undefined => {
  if (!input.canonicalConversationId) {
    return input.contextDelta;
  }

  const observedConversationId = normalizeOptionalText(
    input.contextDelta?.agentControllerConversationId
  );
  if (
    input.contextDelta?.refreshed === true ||
    observedConversationId !== input.canonicalConversationId
  ) {
    throw new AdapterRepairConversationError();
  }

  return input.contextDelta;
};

export const createSharedControlShell = (input: {
  gracefulTimeoutMs?: number;
  sendCancel?: (request: AdapterCancelRequest) => Promise<void>;
  sendInterrupt?: (signal: AdapterInterruptSignal) => Promise<void>;
  waitForMs?: WaitForMs;
}): Pick<RuntimeAdapter, "cancel" | "interrupt"> => ({
  cancel: async (requestInput): Promise<AdapterCancelResult> => {
    const request = buildAdapterCancelRequest(requestInput);
    const sendCancelSignal = resolveCancelSignalSender({
      sendCancel: input.sendCancel,
      sendInterrupt: input.sendInterrupt,
    });

    if (!sendCancelSignal) {
      return buildUnsupportedCancelResult({
        taskId: request.taskId,
      });
    }

    try {
      await sendCancelSignal.send(request);
      return {
        accepted: true,
        deliveryPath: sendCancelSignal.deliveryPath,
        reasonCode: "accepted",
        signalDelivery: "sent",
        taskId: request.taskId,
      };
    } catch (error) {
      const reasonCode =
        resolveControlReasonCode(error) ?? "signal.send_failed";
      return buildUnsupportedCancelResult({
        reasonCode,
        reasonDetail: resolveControlReasonDetail(error, reasonCode),
        taskId: request.taskId,
      });
    }
  },
  interrupt: async (requestInput): Promise<AdapterInterruptResult> => {
    const plan = buildInterruptPlan({
      gracefulTimeoutMs:
        requestInput.gracefulTimeoutMs ?? input.gracefulTimeoutMs,
      mode: requestInput.mode,
      reason: requestInput.reason,
      taskId: requestInput.taskId,
    });

    if (!input.sendInterrupt) {
      return buildUnsupportedInterruptResult({
        plan,
        reasonCode: "adapter.unsupported",
        taskId: requestInput.taskId,
      });
    }

    try {
      await executeInterruptPlan({
        plan,
        sendSignal: input.sendInterrupt,
        waitForMs: input.waitForMs,
      });

      return {
        accepted: true,
        plan,
        reasonCode: "accepted",
        signalDelivery: "sent",
        taskId: requestInput.taskId,
      };
    } catch (error) {
      const reasonCode =
        resolveControlReasonCode(error) ?? "signal.send_failed";
      return buildUnsupportedInterruptResult({
        plan,
        reasonCode,
        reasonDetail: resolveControlReasonDetail(error, reasonCode),
        taskId: requestInput.taskId,
      });
    }
  },
});

export const invokeWithSingleContextHeal = async (input: {
  contextId: string | null;
  contextLossPolicy: "fail" | "rebuild";
  createRebuildFailedError: (error: unknown) => Error;
  invokeOnce: (contextId: string | null) => Promise<{
    contextId: string | null;
    diagnostics?: AdapterDispatchDiagnostics;
    output: string;
    telemetry?: AdapterDispatchTelemetry;
  }>;
  isContextLostError: (error: unknown) => boolean;
  onContextLost?: () => Promise<void>;
}): Promise<{
  contextHealed: boolean;
  contextId: string | null;
  diagnostics?: AdapterDispatchDiagnostics;
  output: string;
  telemetry?: AdapterDispatchTelemetry;
}> => {
  try {
    const first = await input.invokeOnce(input.contextId);
    return {
      contextHealed: false,
      contextId: first.contextId,
      ...(first.diagnostics ? { diagnostics: first.diagnostics } : {}),
      output: first.output,
      telemetry: first.telemetry,
    };
  } catch (firstError) {
    if (!(input.contextId && input.isContextLostError(firstError))) {
      throw firstError;
    }

    if (input.contextLossPolicy === "fail") {
      throw firstError;
    }

    await input.onContextLost?.();

    try {
      const healed = await input.invokeOnce(null);
      return {
        contextHealed: true,
        contextId: healed.contextId,
        ...(healed.diagnostics ? { diagnostics: healed.diagnostics } : {}),
        output: healed.output,
        telemetry: healed.telemetry
          ? {
              ...healed.telemetry,
              contextHealed: true,
              resumedContext: input.contextId !== null,
            }
          : undefined,
      };
    } catch (healError) {
      throw input.createRebuildFailedError(healError);
    }
  }
};

export const buildInterruptPlan = (
  input: AdapterInterruptRequest
): AdapterInterruptPlan => {
  const mode = input.mode ?? "graceful";
  const reason = input.reason ?? DEFAULT_INTERRUPT_REASON;

  if (mode === "force") {
    return {
      initial: {
        mode: "force",
        reason,
        taskId: input.taskId,
      },
    };
  }

  const delayMs = normalizeGracefulTimeoutMs(input.gracefulTimeoutMs);
  return {
    initial: {
      mode: "graceful",
      reason,
      taskId: input.taskId,
    },
    escalation: {
      delayMs,
      mode: "force",
      reason,
      taskId: input.taskId,
    },
  };
};

export const executeInterruptPlan = async (input: {
  plan: AdapterInterruptPlan;
  sendSignal: (signal: AdapterInterruptSignal) => Promise<void>;
  waitForMs?: WaitForMs;
}): Promise<void> => {
  await input.sendSignal(input.plan.initial);

  if (!input.plan.escalation) {
    return;
  }

  const waitForMs = input.waitForMs ?? defaultWaitForMs;
  await waitForMs(input.plan.escalation.delayMs);
  await input.sendSignal({
    mode: input.plan.escalation.mode,
    reason: input.plan.escalation.reason,
    taskId: input.plan.escalation.taskId,
  });
};

export const buildUnsupportedInterruptResult = (input: {
  plan: AdapterInterruptPlan;
  reasonDetail?: string;
  reasonCode?: Exclude<AdapterControlReasonCode, "accepted">;
  taskId: string;
}): AdapterInterruptResult => ({
  accepted: false,
  plan: input.plan,
  reasonCode: input.reasonCode ?? "adapter.unsupported",
  ...(input.reasonDetail ? { reasonDetail: input.reasonDetail } : {}),
  signalDelivery: "not_sent",
  taskId: input.taskId,
});

export const buildUnsupportedCancelResult = (input: {
  reasonCode?: Exclude<AdapterControlReasonCode, "accepted">;
  reasonDetail?: string;
  taskId: string;
}): AdapterCancelResult => ({
  accepted: false,
  reasonCode: input.reasonCode ?? "adapter.unsupported",
  ...(input.reasonDetail ? { reasonDetail: input.reasonDetail } : {}),
  signalDelivery: "not_sent",
  taskId: input.taskId,
});

export const buildAdapterCancelRequest = (input: {
  reason?: string;
  taskId: string;
}): AdapterCancelRequest => ({
  reason: normalizeControlReason(input.reason, DEFAULT_CANCEL_REASON),
  taskId: input.taskId,
});

export const toAdapterDispatchFailure = (
  error: unknown,
  defaultErrorType: AdapterErrorType = "adapter"
): AdapterDispatchFailure => {
  const errorCode = extractErrorCode(error);
  const agentControllerConversationOccupancy =
    extractAgentControllerConversationOccupancy(error);
  const errorType = extractErrorType(error) ?? defaultErrorType;
  const diagnostics = extractDispatchDiagnostics(error);
  const providerAccessEvidence = extractProviderAccessEvidence(error);
  const originalError = extractProviderOriginalError(error);
  const telemetry = extractDispatchTelemetry(error);
  return {
    ...(agentControllerConversationOccupancy
      ? { agentControllerConversationOccupancy }
      : {}),
    ...(diagnostics ? { diagnostics } : {}),
    ...(errorCode ? { errorCode } : {}),
    errorMessage:
      error instanceof Error ? error.message : "adapter dispatch failed",
    errorType,
    ...(originalError ? { originalError } : {}),
    ...(providerAccessEvidence ? { providerAccessEvidence } : {}),
    status: "failed",
    ...(telemetry ? { telemetry } : {}),
  };
};

const extractAgentControllerConversationOccupancy = (
  error: unknown
): AdapterAgentControllerConversationOccupancy | null => {
  if (!(error && typeof error === "object")) {
    return null;
  }
  const value = (error as { agentControllerConversationOccupancy?: unknown })
    .agentControllerConversationOccupancy;
  if (!(value && typeof value === "object")) {
    return null;
  }
  const occupancy =
    value as Partial<AdapterAgentControllerConversationOccupancy>;
  const agentControllerConversationId =
    typeof occupancy.agentControllerConversationId === "string"
      ? occupancy.agentControllerConversationId.trim()
      : "";
  if (
    !agentControllerConversationId ||
    occupancy.contractVersion !==
      AGENT_CONTROLLER_CONVERSATION_OCCUPANCY_CONTRACT_VERSION ||
    occupancy.state !== "occupied"
  ) {
    return null;
  }
  return {
    agentControllerConversationId,
    contractVersion: AGENT_CONTROLLER_CONVERSATION_OCCUPANCY_CONTRACT_VERSION,
    state: "occupied",
  };
};

const extractProviderOriginalError = (error: unknown): string | null => {
  if (!(error && typeof error === "object")) {
    return null;
  }
  return createProviderOriginalError(
    (error as { originalError?: unknown }).originalError
  );
};

const extractDispatchTelemetry = (
  error: unknown
): AdapterDispatchTelemetry | null => {
  if (!error || typeof error !== "object") {
    return null;
  }
  const telemetry = toUnknownRecord(
    (error as { telemetry?: unknown }).telemetry
  );
  if (
    !(
      telemetry &&
      isFiniteNumber(telemetry.completedAtMs) &&
      isFiniteNumber(telemetry.invokedAtMs) &&
      typeof telemetry.resumedContext === "boolean"
    )
  ) {
    return null;
  }
  const tokenUsage = extractAdapterTokenUsage(telemetry.tokenUsage);

  return {
    completedAtMs: telemetry.completedAtMs,
    ...(typeof telemetry.contextCompactionObserved === "boolean"
      ? { contextCompactionObserved: telemetry.contextCompactionObserved }
      : {}),
    ...(typeof telemetry.contextHealed === "boolean"
      ? { contextHealed: telemetry.contextHealed }
      : {}),
    ...(isFiniteNumber(telemetry.exitCode)
      ? { exitCode: telemetry.exitCode }
      : {}),
    ...(isFiniteNumber(telemetry.exitObservedAtMs)
      ? { exitObservedAtMs: telemetry.exitObservedAtMs }
      : {}),
    ...(isNodeSignal(telemetry.exitSignal)
      ? { exitSignal: telemetry.exitSignal }
      : {}),
    ...(isFiniteNumber(telemetry.firstOutputAtMs)
      ? { firstOutputAtMs: telemetry.firstOutputAtMs }
      : {}),
    ...(isFiniteNumber(telemetry.firstStderrAtMs)
      ? { firstStderrAtMs: telemetry.firstStderrAtMs }
      : {}),
    ...(isFiniteNumber(telemetry.firstStdoutAtMs)
      ? { firstStdoutAtMs: telemetry.firstStdoutAtMs }
      : {}),
    invokedAtMs: telemetry.invokedAtMs,
    ...(typeof telemetry.previewEmitted === "boolean"
      ? { previewEmitted: telemetry.previewEmitted }
      : {}),
    ...(isFiniteNumber(telemetry.processId)
      ? { processId: telemetry.processId }
      : {}),
    ...(isFiniteNumber(telemetry.processSpawnedAtMs)
      ? { processSpawnedAtMs: telemetry.processSpawnedAtMs }
      : {}),
    resumedContext: telemetry.resumedContext,
    ...(isFiniteNumber(telemetry.stdinClosedAtMs)
      ? { stdinClosedAtMs: telemetry.stdinClosedAtMs }
      : {}),
    ...(telemetry.streamingMode === "final" ||
    telemetry.streamingMode === "stream"
      ? { streamingMode: telemetry.streamingMode }
      : {}),
    ...(isFiniteNumber(telemetry.timeoutTriggeredAtMs)
      ? { timeoutTriggeredAtMs: telemetry.timeoutTriggeredAtMs }
      : {}),
    ...(tokenUsage ? { tokenUsage } : {}),
  };
};

function extractAdapterTokenUsage(value: unknown): AdapterTokenUsage | null {
  const usage = toUnknownRecord(value);
  const last = extractAdapterTokenUsageBreakdown(usage?.last);
  const total = extractAdapterTokenUsageBreakdown(usage?.total);
  const modelContextWindow = usage?.modelContextWindow;
  if (
    !(
      usage &&
      last &&
      total &&
      (modelContextWindow === null || isNonNegativeInteger(modelContextWindow))
    )
  ) {
    return null;
  }
  return { last, modelContextWindow, total };
}

function extractAdapterTokenUsageBreakdown(
  value: unknown
): AdapterTokenUsageBreakdown | null {
  const usage = toUnknownRecord(value);
  if (
    !(
      usage &&
      isNonNegativeInteger(usage.cachedInputTokens) &&
      isNonNegativeInteger(usage.inputTokens) &&
      isNonNegativeInteger(usage.outputTokens) &&
      isNonNegativeInteger(usage.reasoningOutputTokens) &&
      isNonNegativeInteger(usage.totalTokens) &&
      (usage.cacheWriteInputTokens === undefined ||
        isNonNegativeInteger(usage.cacheWriteInputTokens))
    )
  ) {
    return null;
  }
  return {
    ...(usage.cacheWriteInputTokens === undefined
      ? {}
      : { cacheWriteInputTokens: usage.cacheWriteInputTokens }),
    cachedInputTokens: usage.cachedInputTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningOutputTokens: usage.reasoningOutputTokens,
    totalTokens: usage.totalTokens,
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNodeSignal(value: unknown): value is NodeJS.Signals {
  return typeof value === "string" && value.startsWith("SIG");
}

const extractDispatchDiagnostics = (
  error: unknown
): AdapterDispatchDiagnostics | null => {
  if (!error || typeof error !== "object") {
    return null;
  }
  const diagnostics = (error as { diagnostics?: unknown }).diagnostics;
  const record = toUnknownRecord(diagnostics);
  const modelNegotiation = parseModelNegotiationDiagnostics(
    record?.modelNegotiation
  );
  return modelNegotiation ? { modelNegotiation } : null;
};

const MODEL_DIAGNOSTIC_ID_LIMIT = 100;
const MODEL_DIAGNOSTIC_ID_MAX_LENGTH = 512;

function parseModelNegotiationDiagnostics(
  value: unknown
): AdapterModelNegotiationDiagnostics | null {
  const record = toUnknownRecord(value);
  if (!record) {
    return null;
  }
  const configAvailableModelIds = parseBoundedModelIds(
    record.configAvailableModelIds
  );
  const legacyAvailableModelIds = parseBoundedModelIds(
    record.legacyAvailableModelIds
  );
  const configAvailableModelCount = parseModelCount(
    record.configAvailableModelCount,
    configAvailableModelIds?.length
  );
  const legacyAvailableModelCount = parseModelCount(
    record.legacyAvailableModelCount,
    legacyAvailableModelIds?.length
  );
  const configCurrentModelId = parseNullableModelId(
    record.configCurrentModelId
  );
  const currentModelId = parseNullableModelId(record.currentModelId);
  const legacyCurrentModelId = parseNullableModelId(
    record.legacyCurrentModelId
  );
  const requestedModelId = parseNullableModelId(record.requestedModelId);
  if (
    (record.checkAttempt !== 1 && record.checkAttempt !== 2) ||
    configAvailableModelIds === null ||
    configAvailableModelCount === null ||
    typeof record.configAvailableModelIdsTruncated !== "boolean" ||
    configCurrentModelId === undefined ||
    currentModelId === undefined ||
    legacyAvailableModelIds === null ||
    legacyAvailableModelCount === null ||
    typeof record.legacyAvailableModelIdsTruncated !== "boolean" ||
    legacyCurrentModelId === undefined ||
    record.protocol !== "acp/v1" ||
    requestedModelId === undefined ||
    typeof record.requestedPresentInConfigOptions !== "boolean" ||
    typeof record.requestedPresentInLegacyModels !== "boolean" ||
    (record.sessionOperation !== "load" &&
      record.sessionOperation !== "new" &&
      record.sessionOperation !== "resume") ||
    !isModelSourceState(record.sourceState)
  ) {
    return null;
  }
  return {
    checkAttempt: record.checkAttempt,
    configAvailableModelCount,
    configAvailableModelIds,
    configAvailableModelIdsTruncated: record.configAvailableModelIdsTruncated,
    configCurrentModelId,
    currentModelId,
    legacyAvailableModelCount,
    legacyAvailableModelIds,
    legacyAvailableModelIdsTruncated: record.legacyAvailableModelIdsTruncated,
    legacyCurrentModelId,
    protocol: record.protocol,
    requestedModelId,
    requestedPresentInConfigOptions: record.requestedPresentInConfigOptions,
    requestedPresentInLegacyModels: record.requestedPresentInLegacyModels,
    sessionOperation: record.sessionOperation,
    sourceState: record.sourceState,
  };
}

function parseBoundedModelIds(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > MODEL_DIAGNOSTIC_ID_LIMIT ||
    !value.every(
      (modelId) =>
        typeof modelId === "string" &&
        modelId.length > 0 &&
        modelId.length <= MODEL_DIAGNOSTIC_ID_MAX_LENGTH
    )
  ) {
    return null;
  }
  return [...value];
}

function parseModelCount(
  value: unknown,
  visibleCount: number | undefined
): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= (visibleCount ?? Number.POSITIVE_INFINITY)
    ? value
    : null;
}

function parseNullableModelId(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MODEL_DIAGNOSTIC_ID_MAX_LENGTH
    ? value
    : undefined;
}

function isModelSourceState(
  value: unknown
): value is AdapterModelNegotiationDiagnostics["sourceState"] {
  return (
    value === "config_options_only" ||
    value === "conflicting" ||
    value === "consistent" ||
    value === "legacy_models_only" ||
    value === "missing"
  );
}

function toUnknownRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export const resolveAdapterAgentContext = (input: {
  bridgeSpec?: import("./conversation-bridge").AdapterConversationBridgeSpec;
  spec: AdapterContextIdMappingSpec;
  env?: Record<string, string | undefined>;
}): AdapterAgentContextResolution => {
  const env = input.env ?? {};
  const rawValue = env[input.spec.sourceField];
  const agentControllerConversationId =
    typeof rawValue === "string" && rawValue.trim().length > 0
      ? rawValue.trim()
      : null;

  const agentControllerConversation =
    input.bridgeSpec && agentControllerConversationId
      ? buildAdapterAgentControllerConversationRef({
          agentControllerRef: input.bridgeSpec.agentControllerRef,
          agentControllerConversationId,
          agentControllerConversationKind:
            input.bridgeSpec.agentControllerConversationKind,
        })
      : null;

  return {
    agentControllerConversationId,
    sourceField: input.spec.sourceField,
    mappingVersion: input.spec.mappingVersion,
    ...(agentControllerConversation ? { agentControllerConversation } : {}),
  };
};

const defaultWaitForMs: WaitForMs = async (delayMs) => {
  if (delayMs <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, delayMs);
  });
};

const normalizeGracefulTimeoutMs = (gracefulTimeoutMs?: number): number => {
  if (!Number.isInteger(gracefulTimeoutMs) || gracefulTimeoutMs === undefined) {
    return DEFAULT_GRACEFUL_INTERRUPT_TIMEOUT_MS;
  }
  return gracefulTimeoutMs > 0
    ? gracefulTimeoutMs
    : DEFAULT_GRACEFUL_INTERRUPT_TIMEOUT_MS;
};

const extractErrorCode = (error: unknown): string | null => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") {
    return null;
  }

  const normalized = code.trim();
  return normalized.length > 0 ? normalized : null;
};

const extractErrorType = (error: unknown): AdapterErrorType | null => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const errorType = (error as { errorType?: unknown }).errorType;
  if (typeof errorType !== "string") {
    return null;
  }

  const normalized = errorType.trim();
  switch (normalized) {
    case "adapter":
      return "adapter";
    case "auth":
      return "auth";
    case "config":
      return "config";
    case "timeout":
      return "timeout";
    case "network":
      return "network";
    case "unknown":
      return "unknown";
    default:
      return null;
  }
};

const extractProviderAccessEvidence = (
  error: unknown
): OpenMeldDaemonProviderAccessEvidence | null => {
  if (!error || typeof error !== "object") {
    return null;
  }
  const evidence = (error as { providerAccessEvidence?: unknown })
    .providerAccessEvidence;
  if (!evidence || typeof evidence !== "object") {
    return null;
  }
  const parsed = openMeldDaemonProviderAccessEvidenceSchema.safeParse(evidence);
  return parsed.success ? parsed.data : null;
};

const normalizeControlReason = (
  reason: string | undefined,
  fallback: string
) => {
  if (typeof reason !== "string") {
    return fallback;
  }
  const normalized = reason.trim();
  return normalized.length > 0 ? normalized : fallback;
};

const resolveCanonicalContextDelta = (input: {
  bridgeSpec: AdapterConversationBridgeSpec | null;
  contextDelta?: AdapterDispatchContextDelta;
}): AdapterDispatchContextDelta | undefined => {
  if (!input.contextDelta) {
    return undefined;
  }

  const canonicalContextDelta: AdapterDispatchContextDelta = {
    agentControllerConversationId:
      input.contextDelta.agentControllerConversationId,
    ...(input.contextDelta.refreshed === true ? { refreshed: true } : {}),
    ...(input.contextDelta.agentControllerConversation
      ? {
          agentControllerConversation:
            input.contextDelta.agentControllerConversation,
        }
      : {}),
  };

  if (!input.bridgeSpec) {
    return canonicalContextDelta;
  }

  const agentControllerConversation = bridgeAgentControllerConversationRef({
    agentControllerConversationId:
      canonicalContextDelta.agentControllerConversationId,
    bridgeSpec: input.bridgeSpec,
    agentControllerConversation:
      canonicalContextDelta.agentControllerConversation,
  });

  return {
    ...canonicalContextDelta,
    ...(agentControllerConversation ? { agentControllerConversation } : {}),
  };
};

const buildDefaultInvokeRequest = (input: {
  bridgeSpec: AdapterConversationBridgeSpec | null;
  request: AdapterDispatchRequest;
}): AdapterDispatchRequest => {
  const agentControllerConversationId = input.bridgeSpec
    ? resolveBridgedAgentControllerConversationId({
        agentControllerConversationId:
          input.request.agentControllerConversationId,
        bridgeSpec: input.bridgeSpec,
        agentControllerConversation: input.request.agentControllerConversation,
      })
    : normalizeOptionalText(input.request.agentControllerConversationId);

  return {
    ...input.request,
    agentControllerConversationId,
  };
};

const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const isDefaultInvokeDisabledForTests = (runtimeOptions?: object): boolean =>
  (runtimeOptions as Record<PropertyKey, unknown> | undefined)?.[
    TEST_DISABLE_DEFAULT_INVOKE
  ] === true;

const resolveCancelSignalSender = (input: {
  sendCancel?: (request: AdapterCancelRequest) => Promise<void>;
  sendInterrupt?: (signal: AdapterInterruptSignal) => Promise<void>;
}): {
  deliveryPath: "cancel" | "force_interrupt_fallback";
  send: (request: AdapterCancelRequest) => Promise<void>;
} | null => {
  if (input.sendCancel) {
    return {
      deliveryPath: "cancel",
      send: input.sendCancel,
    };
  }

  if (!input.sendInterrupt) {
    return null;
  }

  return {
    deliveryPath: "force_interrupt_fallback",
    send: async (request) => {
      await input.sendInterrupt?.({
        mode: "force",
        reason: request.reason ?? DEFAULT_CANCEL_REASON,
        taskId: request.taskId,
      });
    },
  };
};

const resolveControlReasonCode = (
  error: unknown
): Exclude<AdapterControlReasonCode, "accepted"> | null => {
  const code = extractErrorCode(error);
  switch (code) {
    case "adapter.unsupported":
    case "signal.not_sent":
    case "signal.send_failed":
    case "task.not_found":
    case "task.not_running":
      return code;
    default:
      return null;
  }
};

const toUnknownErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "unknown adapter control error";

const resolveControlReasonDetail = (
  error: unknown,
  reasonCode: Exclude<AdapterControlReasonCode, "accepted">
): string | undefined =>
  reasonCode === "adapter.unsupported"
    ? undefined
    : toUnknownErrorMessage(error);
