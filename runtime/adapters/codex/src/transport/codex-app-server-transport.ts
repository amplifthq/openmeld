import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { tmpdir } from "node:os";
import type {
  AdapterAgentControllerConversationOccupancy,
  AdapterComputerFileAccessBoundary,
  AdapterDispatchExecutionMode,
  AdapterDispatchRequest,
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterInstructionPrompt,
  AdapterInteractionCallback,
  AdapterInteractionRequest,
  AdapterPermissionModeUpdateRequest,
  AdapterPermissionModeUpdateResult,
  AdapterPreviewCallback,
  AdapterProviderAccessEvidence,
  AdapterRuntimeEvent,
  AdapterRuntimeEventCallback,
  AdapterRuntimeProcessCallback,
  AdapterStreamingMode,
  AgentControllerPermissionMode,
  AgentExecutionSteerRequest,
  AgentExecutionSteerResponse,
  ConversationPolicy,
  RuntimeAgentControllerLaunchContract,
  SpawnedAgentControllerProcess,
} from "@openmeld/adapter-core";
import {
  AGENT_CONTROLLER_CONVERSATION_OCCUPANCY_CONTRACT_VERSION,
  classifyRuntimePermissionDenialMessage,
  createProviderOriginalError,
  listAgentControllerSupervisedProcessIds,
  OPENMELD_SPACE_ACTION_MCP_SERVER_ID,
  resolveDispatchSpaceActionMcpServer,
  spawnAgentControllerProcess,
} from "@openmeld/adapter-core";
import { supportsAgentControllerVersion } from "@openmeld/agent-runtime";
import { classifyCodexProviderAccountFailure } from "../output/codex-provider-failure.js";
import { extractCodexToolActivityEvent } from "../output/codex-tool-activity.js";
import { readCodexAccountUsageObservation } from "../usage/codex-usage-limits.js";
import {
  type CodexAppServerControlOperation,
  resolveCodexAppServerControlRequestTimeoutMs,
} from "./codex-app-server-admission.js";
import { buildCodexAppServerLaunch } from "./codex-app-server-launch.js";
import {
  buildCodexDeliveryOnlyConfig,
  isCodexDeliveryOnly,
} from "./codex-delivery-only.js";
import {
  buildCodexFileAccessBoundaryGlobalArgs,
  CODEX_FILE_ACCESS_PERMISSION_PROFILE,
  isCodexExecutionContextFileAccessConfirmed,
} from "./codex-file-access-boundary.js";
import {
  assertCodexScopedMcpInventory,
  buildCodexScopedMcpDisableArgs,
} from "./codex-scoped-mcp.js";
import {
  buildCodexSpaceDynamicTools,
  CodexSpaceDynamicToolInvocation,
  canUseCodexSpaceDynamicTools,
  codexSpaceDynamicThreadSource,
  codexSpaceInstructionThreadSource,
  readCodexSpaceDynamicToolCarrier,
  supportsCodexSpaceDynamicTools,
} from "./codex-space-action-dynamic-tools.js";
import { buildCodexSpaceActionMcpGlobalArgs } from "./codex-space-action-mcp-config.js";
import { CodexStartupDiagnostics } from "./codex-startup-diagnostics.js";
import { verifyCodexWorkspaceAccess } from "./codex-workspace-access-probe.js";

const CODEX_APP_SERVER_VERSION_PATTERN = /\/([^\s]+)/u;
const EXECUTION_CONTEXT_ERROR_PATTERN =
  /^(execution_context\.[a-z_]+|context\.mcp_isolation_unverified)(?::|$)/u;
const REQUIRED_MCP_INITIALIZATION_FAILURE_PATTERN =
  /required MCP servers? failed to initialize/iu;

export type CodexAppServerTransportResult = {
  output: string;
  telemetry: AdapterDispatchTelemetry;
  threadId: string;
};

export type CodexAppServerActiveTurnRegistration = {
  updatePermissionMode: (
    input: AdapterPermissionModeUpdateRequest
  ) => Promise<AdapterPermissionModeUpdateResult>;
  interrupt: () => Promise<void>;
  steer: (
    input: Omit<AgentExecutionSteerRequest, "taskId">
  ) => Promise<AgentExecutionSteerResponse>;
  taskId: string;
  threadId: string;
  turnId: string;
};

export type CodexAppServerActiveTurnRegistrar = (
  registration: CodexAppServerActiveTurnRegistration
) => () => void;

export type CodexAppServerThreadProofResult = {
  threadId: string;
};

export type CodexAppServerAccountProbeResult = {
  accountKey?: string;
  authStatus: "authenticated" | "unauthenticated" | "unknown";
  email?: string;
  version: string | null;
};

type JsonRpcId = number | string;

type JsonRpcError = {
  code?: number;
  data?: unknown;
  message?: string;
};

type JsonRpcMessage = {
  error?: JsonRpcError;
  id?: JsonRpcId | null;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
  result?: unknown;
};

type PendingJsonRpcRequest = {
  reject: (error: unknown) => void;
  resolve: (value: unknown) => void;
  timeout: NodeJS.Timeout | null;
};

type JsonRpcRequestTimeout = {
  code: string;
  operation: string;
  timeoutMs: number;
  terminateSession?: boolean;
};

type CodexAppServerInteractionFailure = {
  code: string;
  message: string;
};

type NotificationHandler = (message: JsonRpcMessage) => void;

type RuntimeLifecycle = {
  exitCode: number | null;
  exitObservedAtMs: number | null;
  exitSignal: NodeJS.Signals | null;
  firstStderrAtMs: number | null;
  firstStdoutAtMs: number | null;
  processId: number | null;
  processSpawnedAtMs: number | null;
  stdinClosedAtMs: number | null;
  timeoutTriggeredAtMs: number | null;
};

type AppServerThread = {
  id?: unknown;
  threadSource?: unknown;
};

type AppServerThreadResponse = {
  model?: unknown;
  thread?: AppServerThread;
};

type AppServerThreadReadResponse = {
  thread?: AppServerThread & { turns?: AppServerTurn[] };
};

type AppServerTurn = {
  error?: { codexErrorInfo?: unknown; message?: unknown } | null;
  id?: unknown;
  items?: AppServerTurnItem[];
  status?: unknown;
};

type AppServerTurnItem = {
  text?: unknown;
  type?: unknown;
};

type AppServerTurnStartResponse = {
  turn?: AppServerTurn;
};

type CodexAppServerApprovalPolicy = "never" | "on-request";
type CodexAppServerApprovalReviewer = "user" | "auto_review";
type CodexAppServerSandboxMode =
  | "danger-full-access"
  | "read-only"
  | "workspace-write";

type CodexAppServerThreadPermissionModeParams = {
  permissions?: string;
  approvalPolicy?: CodexAppServerApprovalPolicy;
  approvalsReviewer?: CodexAppServerApprovalReviewer;
  sandbox?: CodexAppServerSandboxMode;
};

type CodexAppServerTurnPermissionModeParams = {
  approvalPolicy?: CodexAppServerApprovalPolicy;
  approvalsReviewer?: CodexAppServerApprovalReviewer;
};

type CodexAppServerConversationPolicyParams = {
  effort?: string;
  model?: string;
};

type CodexAppServerCollaborationMode = {
  mode: "default" | "plan";
  settings: {
    developer_instructions: string | null;
    model: string;
    reasoning_effort: string | null;
  };
};

type CodexAppServerCollaborationModePreset = {
  mode: "default" | "plan";
  model: string | null;
  reasoningEffort: string | null;
};

type CodexAppServerThreadContext = {
  permissionResponse: unknown;
  model: string | null;
  threadId: string;
  threadSource: string | null;
};

type CodexAppServerPermissionModeParams = {
  thread: CodexAppServerThreadPermissionModeParams;
  turn: CodexAppServerTurnPermissionModeParams;
};

type CodexAgentControllerPermissionMode = Extract<
  AgentControllerPermissionMode,
  `codex:${string}`
>;

const APP_SERVER_PROCESS_KILL_GRACE_MS = 1000;
const DEFAULT_APP_SERVER_STARTUP_TIMEOUT_MS = 15_000;
const CODEX_USAGE_REQUEST_TIMEOUT_MS = 2500;

export class CodexAppServerTransportError extends Error {
  readonly agentControllerConversationOccupancy?: AdapterAgentControllerConversationOccupancy;
  readonly code: string;
  readonly errorType: AdapterErrorType;
  readonly originalError?: string;
  readonly providerAccessEvidence?: AdapterProviderAccessEvidence;
  readonly rpcErrorCode?: number;

  constructor(input: {
    agentControllerConversationOccupancy?: AdapterAgentControllerConversationOccupancy;
    code: string;
    errorType: AdapterErrorType;
    message: string;
    originalError?: string;
    providerAccessEvidence?: AdapterProviderAccessEvidence;
    rpcErrorCode?: number;
  }) {
    super(input.message);
    this.name = "CodexAppServerTransportError";
    this.agentControllerConversationOccupancy =
      input.agentControllerConversationOccupancy;
    this.code = input.code;
    this.errorType = input.errorType;
    this.originalError = input.originalError;
    this.providerAccessEvidence = input.providerAccessEvidence;
    this.rpcErrorCode = input.rpcErrorCode;
  }
}

function throwIfCodexDispatchCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw new CodexAppServerTransportError({
    code: "runtime.turn.cancelled",
    errorType: "adapter",
    message: "runtime.turn.cancelled: Codex was stopped before starting a turn",
  });
}

export function classifyCodexThreadWriterConflict(input: {
  agentControllerConversationId: string;
  operation: CodexAppServerControlOperation;
  rpcErrorCode: number | undefined;
  rpcErrorMessage: string;
}): AdapterAgentControllerConversationOccupancy | null {
  const agentControllerConversationId =
    input.agentControllerConversationId.trim();
  if (
    !agentControllerConversationId ||
    input.operation !== "thread/resume" ||
    input.rpcErrorCode !== -32_600 ||
    input.rpcErrorMessage !==
      `thread ${agentControllerConversationId} already has an active writer`
  ) {
    return null;
  }
  return {
    agentControllerConversationId,
    contractVersion: AGENT_CONTROLLER_CONVERSATION_OCCUPANCY_CONTRACT_VERSION,
    state: "occupied",
  };
}

export async function probeCodexAppServerAccount(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  timeoutMs?: number;
}): Promise<CodexAppServerAccountProbeResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_APP_SERVER_STARTUP_TIMEOUT_MS;
  return await withCodexAppServerSession(
    {
      codexTimeoutMs: timeoutMs,
      codexWorkdir: tmpdir(),
      launchContract: input.launchContract,
      startupTimeoutMs: timeoutMs,
    },
    async (session, initialized) => {
      const currentAccount = await session.request("account/read", {});
      const usagePromise = readCodexAccountUsageObservation({
        readAccountEpoch: () => session.accountEpoch,
        request: (method, params) => session.request(method, params),
      }).catch(() => null);
      let graceTimer: NodeJS.Timeout | undefined;
      const accountUsage = await Promise.race([
        usagePromise,
        new Promise<null>((resolve) => {
          graceTimer = setTimeout(() => resolve(null), 2500);
        }),
      ]).finally(() => clearTimeout(graceTimer));
      const usageIsCurrent = Boolean(
        accountUsage?.accountKey &&
          accountUsage.accountEpoch === session.accountEpoch
      );
      const response = toRecord(
        usageIsCurrent && accountUsage
          ? accountUsage.accountResponse
          : currentAccount
      );
      const account = toRecord(response?.account);
      return {
        authStatus: resolveCodexAppServerAuthStatus({ account, response }),
        ...(usageIsCurrent && accountUsage?.accountKey
          ? { accountKey: accountUsage.accountKey }
          : {}),
        ...(typeof account?.email === "string" && account.email.trim()
          ? { email: account.email.trim() }
          : {}),
        version: parseCodexAppServerVersion(initialized),
      };
    }
  );
}

export async function invokeCodexAppServerTransport(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  spaceActionTools?: AdapterDispatchRequest["spaceActionTools"];
  cancellationSignal?: AbortSignal;
  codexTimeoutMs: number | null;
  codexWorkdir: string;
  controlRequestTimeoutMs?: number;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  onPreview?: AdapterPreviewCallback;
  onActiveTurn?: CodexAppServerActiveTurnRegistrar;
  onInteractionRequest?: AdapterInteractionCallback;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  instructionPrompt?: AdapterInstructionPrompt;
  newSessionTitle?: AdapterDispatchRequest["newSessionTitle"];
  prompt: string;
  streamingMode?: AdapterStreamingMode;
  startupTimeoutMs?: number;
  taskId: string;
  threadId: string | null;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  conversationPolicy?: ConversationPolicy;
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary;
}): Promise<CodexAppServerTransportResult> {
  throwIfCodexDispatchCancelled(input.cancellationSignal);
  const prompt = normalizeOptionalText(input.prompt);
  if (!prompt) {
    throw new CodexAppServerTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: prompt is required",
    });
  }

  const invokedAtMs = Date.now();
  const reasoningSummary = input.onRuntimeEvent
    ? { summary: "auto" as const }
    : {};
  const deliveryOnly = isCodexDeliveryOnly(input);
  const permissionExecutionMode = deliveryOnly ? "normal" : input.executionMode;
  const permissionModeParams = resolveCodexAppServerPermissionModeParams(
    input.agentControllerPermissionMode,
    permissionExecutionMode,
    input.computerFileAccessBoundary !== undefined,
    input.computerFileAccessBoundary?.executionContextAccess !== undefined
  );
  const conversationPolicyParams =
    resolveCodexAppServerConversationPolicyParams(input.conversationPolicy);
  return await withCodexAppServerSession(
    {
      codexTimeoutMs: input.codexTimeoutMs,
      codexWorkdir: input.codexWorkdir,
      controlRequestTimeoutMs: input.controlRequestTimeoutMs,
      computerFileAccessBoundary: input.computerFileAccessBoundary,
      env: input.env,
      executionMode: input.executionMode,
      launchContract: input.launchContract,
      permissionMode: input.agentControllerPermissionMode,
      spaceActionTools: input.spaceActionTools,
      cancellationSignal: input.cancellationSignal,
      onInteractionRequest: input.onInteractionRequest,
      onProcessControlEvent: input.onProcessControlEvent,
      onRuntimeEvent: input.onRuntimeEvent,
      startupTimeoutMs: input.startupTimeoutMs,
    },
    async (session, initialized) => {
      throwIfCodexDispatchCancelled(input.cancellationSignal);
      await session.selectSpaceToolCarrier({
        initialized,
        threadId: input.threadId,
      });
      await session.prepareDeliveryOnlyScope(initialized);
      const threadContext = await resolveDispatchThreadContext({
        executionContextScoped:
          input.computerFileAccessBoundary?.executionContextAccess !==
          undefined,
        cancellationSignal: input.cancellationSignal,
        conversationPolicyParams,
        codexWorkdir: input.codexWorkdir,
        executionMode: input.executionMode,
        permissionModeParams: permissionModeParams.thread,
        session,
        threadId: input.threadId,
        instructionPrompt: input.instructionPrompt,
      });
      assertFileAccessBeforeTurn(
        threadContext.permissionResponse,
        input.computerFileAccessBoundary,
        input.codexWorkdir,
        permissionExecutionMode
      );
      await session.verifyScopedMcp(
        threadContext.threadId,
        parseCodexAppServerVersion(initialized)
      );
      const collaborationMode =
        await resolveCodexAppServerTurnCollaborationMode({
          conversationPolicy: input.conversationPolicy,
          conversationPolicyParams,
          session,
          threadModel: threadContext.model,
        });
      const executionThreadId = threadContext.threadId;
      const continuityThreadId =
        input.executionMode === "repair"
          ? (normalizeOptionalText(input.threadId) ?? executionThreadId)
          : executionThreadId;
      const turnPrompt = resolveCodexTurnPrompt({
        fallbackPrompt: prompt,
        instructionPrompt: input.instructionPrompt,
        threadSource: threadContext.threadSource,
      });
      session.emitProviderConversationObserved(continuityThreadId);
      session.observeReasoningForThread(executionThreadId);
      session.observeUsageForThread(executionThreadId, threadContext.model);
      throwIfCodexDispatchCancelled(input.cancellationSignal);
      const completedTurn = await startAndAwaitAppServerTurn({
        supportsLiveReviewer: supportsAgentControllerVersion(
          parseCodexAppServerVersion(initialized),
          ">=0.153.0-alpha.4"
        ),
        permissionMode: resolveCodexAgentControllerPermissionMode(
          input.agentControllerPermissionMode
        ),
        cancellationSignal: input.cancellationSignal,
        collaborationMode,
        conversationPolicyParams,
        codexWorkdir: input.codexWorkdir,
        executionMode: input.executionMode,
        executionThreadId,
        existingThreadId: input.threadId,
        newSessionTitle: input.newSessionTitle,
        onActiveTurn: input.onActiveTurn,
        permissionModeParams: permissionModeParams.turn,
        reasoningSummary,
        session,
        taskId: input.taskId,
        turnPrompt,
      });
      const interactionFailure = session.readInteractionFailure();
      if (interactionFailure) {
        throw new CodexAppServerTransportError({
          code: interactionFailure.code,
          errorType: "adapter",
          message: interactionFailure.message,
        });
      }
      const output = normalizeOptionalText(
        readAgentMessageOutput(completedTurn) ??
          session.readCollectedAgentMessageDeltaText()
      );

      requireSuccessfulCodexTurn(completedTurn);

      if (output) {
        session.markAgentOutputObserved();
      }

      await emitPreviewIfRequested({
        onPreview: input.onPreview,
        output: output ?? "",
        streamingMode: input.streamingMode,
      });

      return {
        output: output ?? "",
        telemetry: session.buildTelemetry({
          invokedAtMs,
          previewEmitted:
            input.streamingMode === "stream" && input.onPreview !== undefined,
          resumedContext: normalizeOptionalText(input.threadId) !== null,
          streamingMode: input.streamingMode ?? "final",
        }),
        threadId: continuityThreadId,
      };
    }
  );
}

async function startAndAwaitAppServerTurn(input: {
  supportsLiveReviewer: boolean;
  permissionMode: AgentControllerPermissionMode;
  cancellationSignal?: AbortSignal;
  collaborationMode?: CodexAppServerCollaborationMode | null;
  conversationPolicyParams: CodexAppServerConversationPolicyParams;
  codexWorkdir: string;
  executionMode?: AdapterDispatchExecutionMode;
  executionThreadId: string;
  existingThreadId?: string | null;
  newSessionTitle?: string | null;
  onActiveTurn?: CodexAppServerActiveTurnRegistrar;
  permissionModeParams: CodexAppServerPermissionModeParams["turn"];
  reasoningSummary: Record<string, unknown>;
  session: CodexAppServerSession;
  taskId: string;
  turnPrompt: string;
}): Promise<AppServerTurn> {
  const { session, executionThreadId } = input;
  let activeTurnId: string | null = null;
  let turnSettled = false;
  let interruptRequested = false;
  let interruptSent = false;
  const sendInterruptIfActive = async (targetTurnId: string) => {
    if (interruptSent) {
      return;
    }
    interruptSent = true;
    try {
      await session.request("turn/interrupt", {
        threadId: executionThreadId,
        turnId: targetTurnId,
      });
    } catch {
      // Ignore interrupt errors if the turn is already terminating or completed
    }
  };

  // The reviewer Codex is currently using. A live Full access switch keeps it
  // underneath, so leaving Full access must restore the owner's chosen one.
  let appliedReviewerMode = input.permissionMode;
  const unregisterActiveTurn = session.registerActiveTurn({
    updatePermissionMode: async (update) => {
      const next = update.agentControllerPermissionMode;
      const taskId = input.taskId;
      if (!next.startsWith("codex:")) {
        return {
          status: "not_applied",
          taskId,
          reasonCode: "adapter.permission_mode_incompatible",
        };
      }
      if (
        !activeTurnId ||
        turnSettled ||
        interruptRequested ||
        input.cancellationSignal?.aborted
      ) {
        return {
          status: "not_applied",
          taskId,
          reasonCode: "adapter.task_not_active",
        };
      }
      const reviewerMode = (mode: AgentControllerPermissionMode) =>
        mode === "codex:askForApproval" || mode === "codex:approveForMe";
      const canEmulateFullAccess =
        input.executionMode !== "repair" && reviewerMode(input.permissionMode);
      if (canEmulateFullAccess && next === "codex:fullAccess") {
        session.setLiveFullAccess(true);
        return {
          status: "applied",
          effectiveFrom: "subsequent_tool_requests",
          taskId,
        };
      }
      if (
        canEmulateFullAccess &&
        session.liveFullAccess &&
        next === appliedReviewerMode
      ) {
        session.setLiveFullAccess(false);
        return {
          status: "applied",
          effectiveFrom: "subsequent_tool_requests",
          taskId,
        };
      }
      if (
        !input.supportsLiveReviewer ||
        input.executionMode === "repair" ||
        !reviewerMode(input.permissionMode) ||
        !reviewerMode(next)
      ) {
        return {
          status: "not_applied",
          taskId,
          reasonCode: "adapter.permission_mode_update_unsupported",
        };
      }
      const result = toRecord(
        await session.requestControl(
          "turn/settings/update",
          {
            threadId: executionThreadId,
            turnId: activeTurnId,
            approvalsReviewer:
              next === "codex:approveForMe" ? "auto_review" : "user",
          },
          {
            code: "runtime.permission_mode_update_timeout",
            operation: "turn/settings/update",
            terminateSession: false,
          }
        )
      );
      if (result?.status !== "applied" || turnSettled || interruptRequested) {
        return {
          status: "not_applied",
          taskId,
          reasonCode: "adapter.task_not_active",
        };
      }
      appliedReviewerMode = next;
      session.setLiveFullAccess(false);
      return {
        status: "applied",
        effectiveFrom: "subsequent_tool_requests",
        taskId,
      };
    },
    steer: async (steeringInput) => {
      const targetTurnId = activeTurnId;
      if (
        !targetTurnId ||
        turnSettled ||
        interruptRequested ||
        input.cancellationSignal?.aborted
      ) {
        return {
          status: "not_applied",
          taskId: input.taskId,
          reasonCode: "execution_input.target_unavailable",
        };
      }
      try {
        // clientUserMessageId correlates native history; it does not dedupe.
        // Send once: an absent or mismatched receipt cannot authorize a later
        // Queue execution.
        const result = toRecord(
          await session.requestControl(
            "turn/steer",
            {
              threadId: executionThreadId,
              clientUserMessageId: steeringInput.inputId,
              expectedTurnId: targetTurnId,
              input: [
                { type: "text", text: steeringInput.text, text_elements: [] },
              ],
            },
            {
              code: "runtime.turn_steer_timeout",
              operation: "turn/steer",
              terminateSession: false,
            }
          )
        );
        if (result?.turnId === targetTurnId) {
          return {
            status: "applied",
            taskId: input.taskId,
            threadId: executionThreadId,
            turnId: targetTurnId,
          };
        }
      } catch (error) {
        const transportError =
          error instanceof CodexAppServerTransportError ? error : null;
        if (transportError?.rpcErrorCode === -32_601) {
          return {
            status: "not_applied",
            taskId: input.taskId,
            reasonCode: "execution_input.unsupported",
          };
        }
        // Codex rejects turn/steer preconditions with Invalid Request/Params
        // before admitting input (including an ended or different active turn).
        // Internal errors and transport failures do not prove non-application.
        if (
          transportError?.rpcErrorCode === -32_600 ||
          transportError?.rpcErrorCode === -32_602
        ) {
          return {
            status: "not_applied",
            taskId: input.taskId,
            reasonCode: "execution_input.rejected",
          };
        }
        return {
          status: "unconfirmed",
          taskId: input.taskId,
          reasonCode: "execution_input.application_unconfirmed",
          diagnosticCode: transportError?.code ?? "runtime.turn_steer_failed",
          nativeErrorCode: transportError?.rpcErrorCode,
        };
      }
      return {
        status: "unconfirmed",
        taskId: input.taskId,
        reasonCode: "execution_input.application_unconfirmed",
        diagnosticCode: "runtime.turn_steer_receipt_mismatch",
      };
    },
    interrupt: async () => {
      session.spaceToolInvocation.fence();
      interruptRequested = true;
      if (activeTurnId) {
        await sendInterruptIfActive(activeTurnId);
      }
    },
    onActiveTurn: input.onActiveTurn,
    taskId: input.taskId,
    threadId: executionThreadId,
    turnId: null,
  });

  session.spaceToolInvocation.begin(executionThreadId);
  try {
    const turnResponse = await session.requestControl(
      "turn/start",
      {
        ...input.permissionModeParams,
        ...(input.collaborationMode
          ? { collaborationMode: input.collaborationMode }
          : {}),
        cwd: input.codexWorkdir,
        ...input.conversationPolicyParams,
        ...input.reasoningSummary,
        ...session.deliveryOnlyTurnParams(),
        input: [
          {
            text: input.turnPrompt,
            text_elements: [],
            type: "text",
          },
        ],
        threadId: executionThreadId,
      },
      {
        code: "runtime.turn_start_timeout",
        operation: "turn/start",
      }
    );
    const turn = readTurnStartResponse(turnResponse);
    const turnId = readRequiredText(turn.id, "turn/start response turn.id");
    session.spaceToolInvocation.accept(turnId);
    activeTurnId = turnId;
    session.emitProviderTurnAccepted({
      threadId: executionThreadId,
      turnId,
    });
    session.setNewSessionTitleInBackground({
      existingThreadId: input.existingThreadId ?? null,
      executionMode: input.executionMode,
      threadId: executionThreadId,
      title: input.newSessionTitle ?? undefined,
    });
    if (
      (interruptRequested || input.cancellationSignal?.aborted) &&
      turn.status !== "completed"
    ) {
      await sendInterruptIfActive(turnId);
    }
    return turn.status === "completed"
      ? turn
      : await session.waitForTurnCompleted({
          threadId: executionThreadId,
          turnId,
        });
  } finally {
    turnSettled = true;
    session.spaceToolInvocation.fence();
    unregisterActiveTurn?.();
  }
}

function requireSuccessfulCodexTurn(turn: AppServerTurn): void {
  if (turn.status !== "failed") {
    return;
  }
  const failureMessage = readTurnFailureMessage(turn);
  const originalError =
    createProviderOriginalError(failureMessage) ?? undefined;
  const permissionDenial = classifyRuntimePermissionDenialMessage({
    message: failureMessage,
    source: "codex",
  });
  if (permissionDenial) {
    throw new CodexAppServerTransportError({
      code: permissionDenial.code,
      errorType: permissionDenial.errorType,
      message: permissionDenial.message,
      originalError,
    });
  }
  const providerFailure = classifyCodexProviderAccountFailure({
    codexErrorInfo: readTurnFailureCodexErrorInfo(turn),
    message: failureMessage,
  });
  if (providerFailure) {
    throw new CodexAppServerTransportError({
      code: providerFailure.code,
      errorType: providerFailure.errorType,
      message: failureMessage,
      originalError: providerFailure.originalError,
      providerAccessEvidence: providerFailure.providerAccessEvidence,
    });
  }
  throw new CodexAppServerTransportError({
    code: "runtime.turn.failed",
    errorType: "adapter",
    message: `runtime.turn.failed: ${failureMessage}`,
    originalError,
  });
}

export async function verifyCodexAppServerThread(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  codexTimeoutMs: number | null;
  codexWorkdir: string;
  env?: Record<string, string | undefined>;
  threadId: string;
}): Promise<CodexAppServerThreadProofResult> {
  const threadId = normalizeOptionalText(input.threadId);
  if (!threadId) {
    throw new CodexAppServerTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: threadId is required",
    });
  }

  return await withCodexAppServerSession(
    {
      codexTimeoutMs: input.codexTimeoutMs,
      codexWorkdir: input.codexWorkdir,
      env: input.env,
      launchContract: input.launchContract,
    },
    async (session) => {
      const response = await session.requestControl(
        "thread/read",
        {
          includeTurns: false,
          threadId,
        },
        {
          code: "context.read_timeout",
          operation: "thread/read",
        }
      );
      if (readThreadIdFromResponse(response) !== threadId) {
        throw new CodexAppServerTransportError({
          code: "context.thread_mismatch",
          errorType: "config",
          message:
            "Codex returned a different thread for the conversation check.",
        });
      }
      return {
        threadId,
      };
    }
  );
}

export async function resolveCodexAppServerCompletedTurn(input: {
  codexTimeoutMs: number | null;
  codexWorkdir: string;
  env?: Record<string, string | undefined>;
  launchContract: RuntimeAgentControllerLaunchContract;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  threadId: string;
}): Promise<{ completedTurnId: string; threadId: string }> {
  const threadId = normalizeOptionalText(input.threadId);
  if (!threadId) {
    throw new CodexAppServerTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: threadId is required",
    });
  }

  return await withCodexAppServerSession(
    {
      codexTimeoutMs: input.codexTimeoutMs,
      codexWorkdir: input.codexWorkdir,
      env: input.env,
      launchContract: input.launchContract,
      onRuntimeEvent: input.onRuntimeEvent,
    },
    async (session) => {
      const response = await session.requestControl(
        "thread/read",
        {
          includeTurns: true,
          threadId,
        },
        {
          code: "execution_context.history_unavailable",
          operation: "thread/read",
        }
      );
      const completedTurnId = readLastCompletedTurnId(response);
      if (!completedTurnId) {
        // No settled turn means there is no honest boundary to inherit, and a
        // fork without one copies whatever is in flight. Refuse rather than
        // hand back a superset the caller cannot verify.
        throw new CodexAppServerTransportError({
          code: "execution_context.fork_checkpoint_unavailable",
          errorType: "config",
          message:
            "execution_context.fork_checkpoint_unavailable: thread/read found no completed turn on the source thread",
        });
      }
      return { completedTurnId, threadId };
    }
  );
}

export async function forkCodexAppServerThread(input: {
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary;
  codexTimeoutMs: number | null;
  codexWorkdir: string;
  env?: Record<string, string | undefined>;
  forkFullHistory?: boolean;
  launchContract: RuntimeAgentControllerLaunchContract;
  sourceThreadId: string;
  sourceCompletedTurnId?: string;
  targetWorkingDirectory?: string;
  title?: string;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
}): Promise<{ threadId: string }> {
  const sourceThreadId = normalizeOptionalText(input.sourceThreadId);
  if (!sourceThreadId) {
    throw new CodexAppServerTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: sourceThreadId is required",
    });
  }
  const sourceCompletedTurnId = normalizeOptionalText(
    input.sourceCompletedTurnId
  );
  const executionContextScoped =
    input.computerFileAccessBoundary?.executionContextAccess !== undefined;
  if (sourceCompletedTurnId && input.forkFullHistory) {
    throw new CodexAppServerTransportError({
      code: "schema.invalid",
      errorType: "config",
      message:
        "schema.invalid: a fork takes either sourceCompletedTurnId or forkFullHistory, not both",
    });
  }
  // A fork without a cutoff copies the source's whole stored history. When the
  // source is mid-turn that history contains the turn in progress, so the child
  // would inherit an interrupted or never-finished turn as if it were settled
  // context. Nothing here can detect whether the source is mid-turn, so the only
  // safe default is to require a proven cutoff and make the unbounded copy an
  // explicit, named decision by the caller.
  if (!(sourceCompletedTurnId || input.forkFullHistory)) {
    throw new CodexAppServerTransportError({
      code: "execution_context.fork_checkpoint_unavailable",
      errorType: "config",
      message: executionContextScoped
        ? "execution_context.fork_checkpoint_unavailable: a completed turn is required for a scoped fork"
        : "execution_context.fork_checkpoint_unavailable: a completed turn is required, or forkFullHistory must be set to fork the source's entire history",
    });
  }

  return await withCodexAppServerSession(
    {
      codexTimeoutMs: input.codexTimeoutMs,
      codexWorkdir: input.targetWorkingDirectory ?? input.codexWorkdir,
      env: input.env,
      launchContract: input.launchContract,
      computerFileAccessBoundary: input.computerFileAccessBoundary,
      onRuntimeEvent: input.onRuntimeEvent,
    },
    async (session, initialized) => {
      const nativeCarrier = await session.readSpaceToolCarrier({
        initialized,
        threadId: sourceThreadId,
      });
      let disableSpaceMcp = false;
      if (nativeCarrier) {
        const configuration = await session.requestControl(
          "config/read",
          {
            cwd: input.targetWorkingDirectory ?? input.codexWorkdir,
            includeLayers: false,
          },
          { code: "runtime.control_timeout", operation: "config/read" }
        );
        const servers = toRecord(
          toRecord(toRecord(configuration)?.config)?.mcp_servers
        );
        if (!servers) {
          throw new CodexAppServerTransportError({
            code: "context.space_tool_carrier_unverified",
            errorType: "config",
            message:
              "The effective Codex MCP configuration could not be verified.",
          });
        }
        // Preparation has no dispatch bridge. A disabled-only override would
        // create an invalid transport when that server is absent. If present,
        // disable it while retaining its native transport definition.
        disableSpaceMcp = Object.hasOwn(
          servers,
          OPENMELD_SPACE_ACTION_MCP_SERVER_ID
        );
      }
      const response = await session.requestControl(
        "thread/fork",
        {
          excludeTurns: true,
          threadId: sourceThreadId,
          ...(disableSpaceMcp
            ? {
                config: {
                  [`mcp_servers.${OPENMELD_SPACE_ACTION_MCP_SERVER_ID}.enabled`]: false,
                },
              }
            : {}),
          ...(input.computerFileAccessBoundary?.executionContextAccess
            ? {
                permissions: CODEX_FILE_ACCESS_PERMISSION_PROFILE,
                approvalPolicy: "never",
                runtimeWorkspaceRoots: [
                  input.targetWorkingDirectory ?? input.codexWorkdir,
                ],
              }
            : {}),
          ...(sourceCompletedTurnId
            ? { lastTurnId: sourceCompletedTurnId }
            : {}),
          ...(input.targetWorkingDirectory
            ? { cwd: input.targetWorkingDirectory }
            : {}),
        },
        {
          code: "context.fork_timeout",
          operation: "thread/fork",
        }
      );
      const threadId = readThreadIdFromResponse(response);
      const title = normalizeOptionalText(input.title);
      if (title) {
        try {
          await session.requestControl(
            "thread/name/set",
            { name: title, threadId },
            {
              code: "context.name_timeout",
              operation: "thread/name/set",
            }
          );
        } catch (error) {
          console.warn("[openmeld.codex.fork_title_sync_failed]", {
            error,
            threadId,
          });
        }
      }
      return { threadId };
    }
  );
}

function assertFileAccessBeforeTurn(
  response: unknown,
  boundary: AdapterComputerFileAccessBoundary | undefined,
  workingDirectory: string,
  executionMode?: AdapterDispatchExecutionMode
): void {
  if (
    boundary &&
    !isCodexExecutionContextFileAccessConfirmed(
      response,
      boundary,
      workingDirectory,
      executionMode
    )
  ) {
    throw new CodexAppServerTransportError({
      code: "computer.file_access.unverified",
      errorType: "config",
      message: "Codex did not confirm the task's isolated file access profile.",
    });
  }
}

function scopedRuntimeWorkspaceParams(
  permissions: CodexAppServerThreadPermissionModeParams,
  workingDirectory: string
): { runtimeWorkspaceRoots?: string[] } {
  return permissions.permissions
    ? { runtimeWorkspaceRoots: [workingDirectory] }
    : {};
}

async function resolveDispatchThreadContext(input: {
  executionContextScoped: boolean;
  cancellationSignal?: AbortSignal;
  conversationPolicyParams: CodexAppServerConversationPolicyParams;
  codexWorkdir: string;
  executionMode?: AdapterDispatchExecutionMode;
  permissionModeParams: CodexAppServerThreadPermissionModeParams;
  session: CodexAppServerSession;
  threadId: string | null;
  instructionPrompt?: AdapterInstructionPrompt;
}): Promise<CodexAppServerThreadContext> {
  const existingThreadId = normalizeOptionalText(input.threadId);
  if (
    existingThreadId &&
    input.executionMode === "repair" &&
    (!input.executionContextScoped || input.session.deliveryOnly)
  ) {
    return await forkEphemeralCodexRepairThread({
      conversationPolicyParams: input.conversationPolicyParams,
      codexWorkdir: input.codexWorkdir,
      permissionModeParams: input.permissionModeParams,
      session: input.session,
      sourceThreadId: existingThreadId,
    });
  }
  if (existingThreadId) {
    let response: unknown;
    try {
      throwIfCodexDispatchCancelled(input.cancellationSignal);
      response = await input.session.requestControl(
        "thread/resume",
        {
          ...(input.conversationPolicyParams.model
            ? { model: input.conversationPolicyParams.model }
            : {}),
          ...input.permissionModeParams,
          cwd: input.codexWorkdir,
          ...scopedRuntimeWorkspaceParams(
            input.permissionModeParams,
            input.codexWorkdir
          ),
          excludeTurns: true,
          threadId: existingThreadId,
          ...input.session.spaceToolThreadParams(),
        },
        {
          code: "context.resume_timeout",
          operation: "thread/resume",
        }
      );
    } catch (error) {
      const transportError =
        error instanceof CodexAppServerTransportError ? error : null;
      const occupancy = transportError
        ? classifyCodexThreadWriterConflict({
            agentControllerConversationId: existingThreadId,
            operation: "thread/resume",
            rpcErrorCode: transportError.rpcErrorCode,
            rpcErrorMessage: transportError.message,
          })
        : null;
      if (!occupancy) {
        throw error;
      }
      throw new CodexAppServerTransportError({
        agentControllerConversationOccupancy: occupancy,
        code: "agent_controller.conversation_occupied",
        errorType: "adapter",
        message: transportError?.message ?? "Codex thread writer is occupied",
        rpcErrorCode: transportError?.rpcErrorCode,
      });
    }
    return readThreadContextFromResponse(response);
  }

  const response = await input.session.startDispatchThread({
    ...(input.conversationPolicyParams.model
      ? { model: input.conversationPolicyParams.model }
      : {}),
    ...input.permissionModeParams,
    cwd: input.codexWorkdir,
    ...scopedRuntimeWorkspaceParams(
      input.permissionModeParams,
      input.codexWorkdir
    ),
    ...(input.instructionPrompt
      ? {
          developerInstructions: input.instructionPrompt.developerInstructions,
          threadSource: buildOpenMeldCodexThreadSource(
            input.instructionPrompt.instructionEpoch
          ),
        }
      : { threadSource: "user" }),
  });
  return readThreadContextFromResponse(response);
}

async function forkEphemeralCodexRepairThread(input: {
  conversationPolicyParams: CodexAppServerConversationPolicyParams;
  codexWorkdir: string;
  permissionModeParams: CodexAppServerThreadPermissionModeParams;
  session: CodexAppServerSession;
  sourceThreadId: string;
}): Promise<CodexAppServerThreadContext> {
  const response = await input.session.requestControl(
    "thread/fork",
    {
      ...(input.conversationPolicyParams.model
        ? { model: input.conversationPolicyParams.model }
        : {}),
      ...input.permissionModeParams,
      cwd: input.codexWorkdir,
      ...scopedRuntimeWorkspaceParams(
        input.permissionModeParams,
        input.codexWorkdir
      ),
      ephemeral: true,
      excludeTurns: true,
      threadId: input.sourceThreadId,
      ...input.session.spaceToolThreadParams(),
    },
    {
      code: "context.fork_timeout",
      operation: "thread/fork",
    }
  );
  // An ephemeral thread intentionally has no on-disk rollout. It is already
  // live in this app-server session, so resuming it would force an impossible
  // disk lookup ("no rollout found") before the repair turn can start.
  return readThreadContextFromResponse(response);
}

function resolveCodexTurnPrompt(input: {
  fallbackPrompt: string;
  instructionPrompt?: AdapterInstructionPrompt;
  threadSource: string | null;
}): string {
  if (!input.instructionPrompt) {
    return input.fallbackPrompt;
  }
  const expectedThreadSource = buildOpenMeldCodexThreadSource(
    input.instructionPrompt.instructionEpoch
  );
  return codexSpaceInstructionThreadSource(input.threadSource) ===
    expectedThreadSource
    ? input.instructionPrompt.userPrompt
    : input.fallbackPrompt;
}

function buildOpenMeldCodexThreadSource(instructionEpoch: string): string {
  return `openmeld/${instructionEpoch}`;
}

async function resolveCodexAppServerCollaborationMode(input: {
  collaborationMode: ConversationPolicy["collaborationMode"];
  model?: string | null;
  reasoningEffort?: string;
  session: CodexAppServerSession;
}): Promise<CodexAppServerCollaborationMode | null> {
  if (input.collaborationMode !== "plan") {
    return null;
  }
  const model = normalizeOptionalText(input.model);
  if (!model) {
    throw new CodexAppServerTransportError({
      code: "protocol.invalid",
      errorType: "adapter",
      message:
        "protocol.invalid: Codex Plan collaboration mode requires a resolved model",
    });
  }
  const response = toRecord(
    await input.session.requestControl(
      "collaborationMode/list",
      {},
      {
        code: "runtime.control_timeout",
        operation: "collaborationMode/list",
      }
    )
  );
  const presets = Array.isArray(response?.data) ? response.data : [];
  const preset = presets
    .map(readCodexAppServerCollaborationModePreset)
    .find((candidate) => candidate?.mode === "plan");
  if (!preset) {
    throw new CodexAppServerTransportError({
      code: "protocol.invalid",
      errorType: "adapter",
      message:
        "protocol.invalid: codex app-server did not advertise the Plan collaboration mode",
    });
  }
  return {
    mode: "plan",
    settings: {
      developer_instructions: null,
      model,
      reasoning_effort: input.reasoningEffort ?? preset.reasoningEffort ?? null,
    },
  };
}

async function resolveCodexAppServerTurnCollaborationMode(input: {
  conversationPolicy?: ConversationPolicy;
  conversationPolicyParams: CodexAppServerConversationPolicyParams;
  session: CodexAppServerSession;
  threadModel: string | null;
}): Promise<CodexAppServerCollaborationMode | null> {
  return await resolveCodexAppServerCollaborationMode({
    collaborationMode: input.conversationPolicy?.collaborationMode,
    model: input.conversationPolicyParams.model ?? input.threadModel,
    reasoningEffort: input.conversationPolicyParams.effort,
    session: input.session,
  });
}

function readCodexAppServerCollaborationModePreset(
  value: unknown
): CodexAppServerCollaborationModePreset | null {
  const preset = toRecord(value);
  const mode = normalizeOptionalText(preset?.mode);
  if (mode !== "default" && mode !== "plan") {
    return null;
  }
  return {
    mode,
    model: normalizeOptionalText(preset?.model),
    reasoningEffort: normalizeOptionalText(preset?.reasoning_effort),
  };
}

function resolveCodexAppServerPermissionModeParams(
  value: unknown,
  executionMode?: AdapterDispatchExecutionMode,
  hasComputerFileAccessBoundary = false,
  hasExecutionContextBoundary = false
): CodexAppServerPermissionModeParams {
  if (hasExecutionContextBoundary) {
    return {
      thread: {
        approvalPolicy: "never",
        permissions: CODEX_FILE_ACCESS_PERMISSION_PROFILE,
      },
      turn: { approvalPolicy: "never" },
    };
  }
  if (executionMode === "repair") {
    return {
      thread: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        ...(hasComputerFileAccessBoundary ? {} : { sandbox: "read-only" }),
      },
      turn: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
      },
    };
  }

  const permissionMode = resolveCodexAgentControllerPermissionMode(value);
  switch (permissionMode) {
    case "codex:approveForMe":
      return {
        thread: {
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          ...(hasComputerFileAccessBoundary
            ? {}
            : { sandbox: "workspace-write" }),
        },
        turn: {
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
        },
      };
    case "codex:fullAccess":
      return {
        thread: {
          approvalPolicy: "never",
          ...(hasComputerFileAccessBoundary
            ? {}
            : { sandbox: "danger-full-access" }),
        },
        turn: {
          approvalPolicy: "never",
        },
      };
    case "codex:customConfig":
      return {
        thread: {},
        turn: {},
      };
    case "codex:askForApproval":
      return {
        thread: {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          ...(hasComputerFileAccessBoundary
            ? {}
            : { sandbox: "workspace-write" }),
        },
        turn: {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
        },
      };
    default:
      throw new Error(`Unsupported Codex permission mode: ${permissionMode}`);
  }
}

function resolveCodexAgentControllerPermissionMode(
  value: unknown
): CodexAgentControllerPermissionMode {
  switch (value) {
    case "codex:approveForMe":
    case "codex:fullAccess":
    case "codex:customConfig":
      return value;
    default:
      return "codex:askForApproval";
  }
}

function resolveCodexAppServerConversationPolicyParams(
  conversationPolicy?: ConversationPolicy
): CodexAppServerConversationPolicyParams {
  const params: CodexAppServerConversationPolicyParams = {};

  const model = normalizeOptionalText(conversationPolicy?.model);
  if (model) {
    params.model = model;
  }

  const reasoningLevel = normalizeOptionalText(
    conversationPolicy?.reasoningLevel
  );
  if (reasoningLevel) {
    params.effort = reasoningLevel;
  }

  return params;
}

async function withCodexAppServerSession<T>(
  input: {
    spaceActionTools?: AdapterDispatchRequest["spaceActionTools"];
    cancellationSignal?: AbortSignal;
    codexTimeoutMs: number | null;
    codexWorkdir: string;
    controlRequestTimeoutMs?: number;
    computerFileAccessBoundary?: AdapterComputerFileAccessBoundary;
    env?: Record<string, string | undefined>;
    executionMode?: AdapterDispatchExecutionMode;
    launchContract: RuntimeAgentControllerLaunchContract;
    permissionMode?: AgentControllerPermissionMode;
    onInteractionRequest?: AdapterInteractionCallback;
    onProcessControlEvent?: AdapterRuntimeProcessCallback;
    onRuntimeEvent?: AdapterRuntimeEventCallback;
    startupTimeoutMs?: number;
  },
  callback: (session: CodexAppServerSession, initialized: unknown) => Promise<T>
): Promise<T> {
  const session = new CodexAppServerSession(input);
  try {
    const initialized = await session.start();
    return await callback(session, initialized);
  } catch (error) {
    throw toCodexAppServerTransportError(error, input.codexTimeoutMs);
  } finally {
    await session.close();
  }
}

class CodexAppServerSession {
  #accountEpoch = 0;
  #usageObservationPending: Promise<void> | null = null;

  get accountEpoch(): number {
    return this.#accountEpoch;
  }
  readonly spaceToolInvocation: CodexSpaceDynamicToolInvocation;
  readonly #spaceActionTools?: AdapterDispatchRequest["spaceActionTools"];
  readonly deliveryOnly: boolean;
  #deliveryConfig: Record<string, unknown> = {};
  #processCleanup: Promise<void> | null = null;
  readonly #codexTimeoutMs: number | null;
  readonly #codexWorkdir: string;
  readonly #controlRequestTimeoutMs?: number;
  readonly #computerFileAccessBoundary?: AdapterComputerFileAccessBoundary;
  readonly #env?: Record<string, string | undefined>;
  readonly #launchContract: RuntimeAgentControllerLaunchContract;
  readonly #executionMode?: AdapterDispatchExecutionMode;
  readonly #notifications: JsonRpcMessage[] = [];
  readonly #onInteractionRequest?: AdapterInteractionCallback;
  // Set when the owner switches this running task to Full access. The turn's
  // sandbox cannot change, so OpenMeld answers Codex's later permission
  // requests with its one-time allow; full sandbox access starts next task.
  #liveFullAccess = false;
  readonly #onProcessControlEvent?: AdapterRuntimeProcessCallback;
  readonly #onRuntimeEvent?: AdapterRuntimeEventCallback;
  readonly #permissionMode?: AgentControllerPermissionMode;
  readonly #pending = new Map<JsonRpcId, PendingJsonRpcRequest>();
  readonly #turnAgentMessageDeltas = new Map<string, string>();
  #reasoningThreadId: string | null = null;
  #child: ChildProcessWithoutNullStreams | null = null;
  #runtimeProcess: SpawnedAgentControllerProcess | null = null;
  #contextCompactionObserved = false;
  #forceKillTimeout: NodeJS.Timeout | null = null;
  #firstOutputAtMs: number | null = null;
  #interactionFailure: CodexAppServerInteractionFailure | null = null;
  #lineBuffer = "";
  #latestTokenUsage: AdapterDispatchTelemetry["tokenUsage"] | null = null;
  #usageThreadId: string | null = null;
  #usageModel: string | null = null;
  #usageTurnId: string | null = null;
  readonly #usageTotalByThread = new Map<string, number>();
  readonly #aiUsage = new Map<
    string,
    NonNullable<AdapterDispatchTelemetry["aiUsage"]>[number]
  >();
  #nextRequestId = 1;
  #processTimeout: NodeJS.Timeout | null = null;
  readonly #startupTimeoutMs: number;
  #startupTimeout: NodeJS.Timeout | null = null;
  #settledFailure: unknown = null;
  readonly #startupDiagnostics = new CodexStartupDiagnostics();
  readonly #waiters = new Set<{
    predicate: (message: JsonRpcMessage) => boolean;
    reject: (error: unknown) => void;
    resolve: (message: JsonRpcMessage) => void;
  }>();
  readonly #lifecycle: RuntimeLifecycle = {
    exitCode: null,
    exitObservedAtMs: null,
    exitSignal: null,
    firstStderrAtMs: null,
    firstStdoutAtMs: null,
    processId: null,
    processSpawnedAtMs: null,
    stdinClosedAtMs: null,
    timeoutTriggeredAtMs: null,
  };

  constructor(input: {
    spaceActionTools?: AdapterDispatchRequest["spaceActionTools"];
    cancellationSignal?: AbortSignal;
    codexTimeoutMs: number | null;
    codexWorkdir: string;
    controlRequestTimeoutMs?: number;
    computerFileAccessBoundary?: AdapterComputerFileAccessBoundary;
    env?: Record<string, string | undefined>;
    executionMode?: AdapterDispatchExecutionMode;
    launchContract: RuntimeAgentControllerLaunchContract;
    permissionMode?: AgentControllerPermissionMode;
    onInteractionRequest?: AdapterInteractionCallback;
    onProcessControlEvent?: AdapterRuntimeProcessCallback;
    onRuntimeEvent?: AdapterRuntimeEventCallback;
    startupTimeoutMs?: number;
  }) {
    this.#spaceActionTools = input.spaceActionTools;
    this.deliveryOnly = isCodexDeliveryOnly(input);
    this.spaceToolInvocation = new CodexSpaceDynamicToolInvocation(
      input.spaceActionTools,
      input.cancellationSignal
    );
    this.#codexTimeoutMs = input.codexTimeoutMs;
    this.#codexWorkdir = input.codexWorkdir;
    this.#controlRequestTimeoutMs = input.controlRequestTimeoutMs;
    this.#computerFileAccessBoundary = input.computerFileAccessBoundary;
    this.#env = input.env;
    this.#executionMode = input.executionMode;
    this.#launchContract = input.launchContract;
    this.#onInteractionRequest = input.onInteractionRequest;
    this.#onProcessControlEvent = input.onProcessControlEvent;
    this.#onRuntimeEvent = input.onRuntimeEvent;
    this.#permissionMode = input.permissionMode;
    this.#startupTimeoutMs =
      input.startupTimeoutMs ?? DEFAULT_APP_SERVER_STARTUP_TIMEOUT_MS;
  }

  async start(): Promise<unknown> {
    const computerFileAccessArgs = this.#computerFileAccessBoundary
      ? buildCodexFileAccessBoundaryGlobalArgs({
          boundary: this.#computerFileAccessBoundary,
          executionMode: this.deliveryOnly ? "normal" : this.#executionMode,
          permissionMode: this.#permissionMode,
        })
      : [];
    const env = {
      ...process.env,
      ...(this.#env ?? {}),
    };
    const spaceActionMcpArgs = buildCodexSpaceActionMcpGlobalArgs(env);
    const scopedMcpArgs = this.#computerFileAccessBoundary
      ?.executionContextAccess
      ? await buildCodexScopedMcpDisableArgs({
          env,
          launchContract: this.#launchContract,
          workingDirectory: this.#codexWorkdir,
        })
      : [];
    const launch = buildCodexAppServerLaunch({
      args: [
        ...computerFileAccessArgs,
        ...scopedMcpArgs,
        ...spaceActionMcpArgs,
        "app-server",
        "--listen",
        "stdio://",
      ],
      env,
      launchContract: this.#launchContract,
    });
    const runtimeProcess = spawnAgentControllerProcess({
      args: launch.args,
      bin: launch.bin,
      // App-server is a multi-thread controller, not the task process. Keep its
      // host cwd outside user workspaces so startup never depends on resolving a
      // macOS privacy-protected project path. Every thread/turn request below
      // still carries the exact dispatch workspace as the authoritative cwd.
      cwd: tmpdir(),
      env: launch.env,
      shell: launch.shell ?? false,
      ...(this.#env?.OPENMELD_PROCESS_SUPERVISION_ID
        ? { supervisionId: this.#env.OPENMELD_PROCESS_SUPERVISION_ID }
        : {}),
    });
    const { child, processId, signalTarget } = runtimeProcess;
    this.#child = child;
    this.#runtimeProcess = runtimeProcess;
    const processSpawnedAtMs = Date.now();
    this.#lifecycle.processId = processId;
    this.#lifecycle.processSpawnedAtMs = processSpawnedAtMs;
    this.#emitRuntimeEvent({
      phase: "process_spawned",
      processLaunchKind: launch.processLaunchKind,
      processId,
      processWorkingDirectoryKind: "runtime_host",
      signalTarget,
      tsMs: processSpawnedAtMs,
    });
    this.#onProcessControlEvent?.({
      phase: "process_spawned",
      processId,
      signalTarget,
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      if (this.#lifecycle.firstStdoutAtMs === null) {
        const firstStdoutAtMs = Date.now();
        this.#lifecycle.firstStdoutAtMs = firstStdoutAtMs;
        this.#emitRuntimeEvent({
          phase: "first_stdout",
          processId,
          tsMs: firstStdoutAtMs,
        });
      }
      this.#consumeStdoutText(text);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.#startupDiagnostics.observeStderr(String(chunk));
      if (this.#lifecycle.firstStderrAtMs !== null) {
        return;
      }
      const firstStderrAtMs = Date.now();
      this.#lifecycle.firstStderrAtMs = firstStderrAtMs;
      this.#emitRuntimeEvent({
        phase: "first_stderr",
        processId,
        tsMs: firstStderrAtMs,
      });
    });

    child.stdin.on("error", (error) => {
      this.#failAll(this.#buildStdinWriteError(error));
    });
    child.on("error", (error) => {
      this.#failAll(
        new CodexAppServerTransportError({
          code: "upstream_unreachable",
          errorType: "adapter",
          message: `upstream_unreachable: failed to spawn codex app-server (${error.message})`,
        })
      );
    });

    child.on("close", (exitCode, signal) => {
      this.#clearTimers();
      this.#lifecycle.exitCode = exitCode;
      this.#lifecycle.exitObservedAtMs = Date.now();
      this.#lifecycle.exitSignal = signal;
      const exitObservedAtMs = this.#lifecycle.exitObservedAtMs;
      this.#processCleanup = (async () => {
        let ownedProcessesQuiescent = false;
        try {
          const cleanup = await runtimeProcess.terminateRemainingDescendants();
          if (
            cleanup.ok &&
            signalTarget === "process_group" &&
            processId !== null &&
            isProcessGroupAbsent(processId)
          ) {
            ownedProcessesQuiescent =
              (
                await listAgentControllerSupervisedProcessIds({
                  fresh: true,
                  processId,
                  supervisionId: runtimeProcess.supervisionId,
                })
              ).length === 0 && isProcessGroupAbsent(processId);
          }
        } catch {
          // Missing cleanup/discovery evidence must never authorize file reclamation.
        }
        this.#emitRuntimeEvent({
          exitCode,
          phase: "process_exit",
          processId,
          signal,
          signalTarget,
          tsMs: exitObservedAtMs,
          ...(ownedProcessesQuiescent
            ? { ownedProcessesQuiescent: true as const }
            : {}),
        });
      })();
      this.#onProcessControlEvent?.({
        phase: "process_exit",
        processId,
        signalTarget,
      });
      if (this.#pending.size > 0 || this.#waiters.size > 0) {
        this.#failAll(
          new CodexAppServerTransportError({
            code: "upstream_unreachable",
            errorType: "adapter",
            message: `upstream_unreachable: codex app-server exited early.${this.#startupDiagnostics.summary()}`,
          })
        );
      }
    });

    this.#processTimeout =
      this.#codexTimeoutMs === null
        ? null
        : setTimeout(() => {
            const timeoutTriggeredAtMs = Date.now();
            this.#lifecycle.timeoutTriggeredAtMs = timeoutTriggeredAtMs;
            this.#emitRuntimeEvent({
              phase: "timeout_triggered",
              processId,
              tsMs: timeoutTriggeredAtMs,
            });
            this.#failAll(
              new CodexAppServerTransportError({
                code: "process.timeout",
                errorType: "timeout",
                message:
                  this.#codexTimeoutMs === null
                    ? "process.timeout: codex app-server timed out"
                    : `process.timeout: codex app-server did not complete within ${this.#codexTimeoutMs}ms`,
              })
            );
            this.#requestProcessTermination();
          }, this.#codexTimeoutMs);

    this.#startupTimeout = setTimeout(() => {
      const timeoutTriggeredAtMs = Date.now();
      this.#lifecycle.timeoutTriggeredAtMs = timeoutTriggeredAtMs;
      this.#emitRuntimeEvent({
        phase: "timeout_triggered",
        processId,
        tsMs: timeoutTriggeredAtMs,
      });
      this.#failAll(
        new CodexAppServerTransportError({
          code: "runtime.startup_timeout",
          errorType: "timeout",
          message: `runtime.startup_timeout: codex app-server did not initialize within ${this.#startupTimeoutMs}ms.${this.#startupDiagnostics.summary()}`,
        })
      );
      this.#requestProcessTermination();
    }, this.#startupTimeoutMs);

    try {
      const initialized = await this.request("initialize", {
        capabilities: {
          experimentalApi: true,
        },
        clientInfo: {
          name: "openmeld",
          version: "0.0.0",
        },
      });
      this.notify("initialized", {});
      if (this.#computerFileAccessBoundary?.executionContextAccess) {
        await verifyCodexWorkspaceAccess({
          boundary: this.#computerFileAccessBoundary,
          executionMode: this.deliveryOnly ? "normal" : this.#executionMode,
          workingDirectory: this.#codexWorkdir,
          execute: (params) =>
            this.requestControl("command/exec", params, {
              code: "execution_context.workspace_probe_timeout",
              operation: "command/exec",
            }),
        });
      }
      return initialized;
    } finally {
      if (this.#startupTimeout !== null) {
        clearTimeout(this.#startupTimeout);
        this.#startupTimeout = null;
      }
    }
  }

  async readSpaceToolCarrier(input: {
    initialized: unknown;
    threadId: string;
  }): Promise<boolean> {
    const response = await this.requestControl(
      "thread/read",
      {
        threadId: input.threadId,
        includeTurns: false,
      },
      { code: "context.read_timeout", operation: "thread/read" }
    );
    try {
      return await readCodexSpaceDynamicToolCarrier({
        thread: toRecord(response)?.thread,
        codexHome: toRecord(input.initialized)?.codexHome,
      });
    } catch {
      throw new CodexAppServerTransportError({
        code: "context.space_tool_carrier_unverified",
        errorType: "config",
        message:
          "The saved native tool interface could not be verified. No turn was started and no carrier was replayed.",
      });
    }
  }

  async selectSpaceToolCarrier(input: {
    initialized: unknown;
    threadId: string | null;
  }): Promise<void> {
    if (!this.#spaceActionTools) {
      return;
    }
    const existingThreadId = normalizeOptionalText(input.threadId);
    let nativeThread = false;
    if (existingThreadId) {
      nativeThread = await this.readSpaceToolCarrier({
        initialized: input.initialized,
        threadId: existingThreadId,
      });
      if (!nativeThread) {
        // Dynamic definitions cannot be added to a legacy thread by resume.
        return;
      }
    }
    const version = parseCodexAppServerVersion(input.initialized);
    let supported = supportsCodexSpaceDynamicTools(version);
    if (nativeThread && !supported) {
      throw new CodexAppServerTransportError({
        code: "context.space_tool_version_unsupported",
        errorType: "config",
        message: `Codex ${version ?? "(unknown version)"} does not meet the native Space tool version requirement (0.150.1 or newer). Select a supported Codex installation and retry. No turn was started.`,
      });
    }
    if (supported) {
      try {
        supported = await this.supportsSpaceToolPolicy();
      } catch (error) {
        if (
          !(error instanceof CodexAppServerTransportError) ||
          error.rpcErrorCode !== -32_601
        ) {
          throw error;
        }
        supported = false;
        if (nativeThread) {
          throw new CodexAppServerTransportError({
            code: "context.space_tool_capability_unavailable",
            errorType: "config",
            message:
              "Codex could not provide the policy checks required to continue this conversation. Select a supported Codex installation and retry. No turn was started.",
          });
        }
      }
    }
    if (nativeThread && !supported) {
      throw new CodexAppServerTransportError({
        code: "context.space_tool_policy_changed",
        errorType: "config",
        message:
          "The saved native tool interface cannot preserve the current Codex tool policy. No turn was started and no carrier was replayed.",
      });
    }
    this.spaceToolInvocation.enabled = supported;
  }

  async supportsSpaceToolPolicy(): Promise<boolean> {
    // TODO(PR #225): Investigate intermittent macOS config/read stalls promptly.
    // The same binary and workspace can reply when launched directly, yet time
    // out after a Service restart. Native samples show blocked file opens; the
    // exact file and cause remain unknown. Preserve the original workspace and
    // compare foreground/background launches. A longer timeout or another cwd
    // did not establish a repair. Keep this policy check fail-closed.
    const configuration = await this.requestControl(
      "config/read",
      { cwd: this.#codexWorkdir, includeLayers: false },
      { code: "runtime.control_timeout", operation: "config/read" }
    );
    if (
      !canUseCodexSpaceDynamicTools({
        configuration,
        permissionMode: this.#permissionMode,
      })
    ) {
      return false;
    }
    const requirements = await this.requestControl(
      "configRequirements/read",
      {},
      { code: "runtime.control_timeout", operation: "configRequirements/read" }
    );
    // Keep managed requirements on their native authorizer until this
    // carrier has equivalent policy evidence. Missing data is not allow.
    return toRecord(requirements)?.requirements === null;
  }

  async prepareDeliveryOnlyScope(initialized: unknown): Promise<void> {
    if (!this.deliveryOnly) {
      return;
    }
    if (
      this.#spaceActionTools?.tools.some(
        (tool) => !["reply", "stay_silent", "read_receipt"].includes(tool.name)
      )
    ) {
      throw new CodexAppServerTransportError({
        code: "space.action.delivery_only_unverified",
        errorType: "config",
        message:
          "The correction capability contains non-delivery actions. No correction turn was started.",
      });
    }
    if (
      !supportsCodexSpaceDynamicTools(parseCodexAppServerVersion(initialized))
    ) {
      throw new CodexAppServerTransportError({
        code: "space.action.delivery_only_unsupported",
        errorType: "config",
        message:
          "This Codex installation cannot verify delivery-only execution. No correction turn was started.",
      });
    }
    const configuration = await this.requestControl(
      "config/read",
      {
        cwd: this.#codexWorkdir,
        includeLayers: false,
      },
      { code: "runtime.control_timeout", operation: "config/read" }
    );
    const requirements = await this.requestControl(
      "configRequirements/read",
      {},
      {
        code: "runtime.control_timeout",
        operation: "configRequirements/read",
      }
    );
    if (toRecord(requirements)?.requirements !== null) {
      throw new CodexAppServerTransportError({
        code: "space.action.delivery_only_unverified",
        errorType: "config",
        message:
          "The managed Codex requirements cannot be proven compatible with delivery-only execution. No correction turn was started.",
      });
    }
    this.#deliveryConfig = buildCodexDeliveryOnlyConfig(configuration);
  }

  deliveryOnlyTurnParams(): Record<string, unknown> {
    return this.deliveryOnly ? { environments: [] } : {};
  }

  async startDispatchThread(params: Record<string, unknown>): Promise<unknown> {
    const source = normalizeOptionalText(params.threadSource) ?? "user";
    try {
      return await this.requestControl(
        "thread/start",
        {
          ...params,
          ...this.spaceToolThreadParams(source),
        },
        { code: "runtime.thread_start_timeout", operation: "thread/start" }
      );
    } catch (error) {
      const rejectedDefinition =
        error instanceof CodexAppServerTransportError &&
        ((error.rpcErrorCode === -32_600 &&
          error.message.startsWith("Invalid request:")) ||
          error.rpcErrorCode === -32_602) &&
        error.message.includes("dynamicTools");
      if (!(this.spaceToolInvocation.enabled && rejectedDefinition)) {
        throw error;
      }
      // Only a decoded pre-method argument rejection proves no thread/turn
      // or action executed. Timeouts and ordinary tool failures never replay.
      this.spaceToolInvocation.enabled = false;
      return await this.requestControl(
        "thread/start",
        { ...params, ...this.spaceToolThreadParams(source) },
        {
          code: "runtime.thread_start_timeout",
          operation: "thread/start",
        }
      );
    }
  }

  spaceToolThreadParams(newThreadSource?: string): Record<string, unknown> {
    const scope = this.deliveryOnly
      ? {
          config: this.#deliveryConfig,
          ...(newThreadSource === undefined
            ? {}
            : { environments: [], selectedCapabilityRoots: [] }),
        }
      : {};
    if (!(this.spaceToolInvocation.enabled && this.#spaceActionTools)) {
      return scope;
    }
    return {
      ...scope,
      config: {
        ...this.#deliveryConfig,
        ...(this.deliveryOnly
          ? {
              mcp_servers: {
                ...(toRecord(this.#deliveryConfig.mcp_servers) ?? {}),
                [OPENMELD_SPACE_ACTION_MCP_SERVER_ID]: {
                  ...(toRecord(
                    toRecord(this.#deliveryConfig.mcp_servers)?.[
                      OPENMELD_SPACE_ACTION_MCP_SERVER_ID
                    ]
                  ) ?? {}),
                  enabled: false,
                },
              },
            }
          : {
              [`mcp_servers.${OPENMELD_SPACE_ACTION_MCP_SERVER_ID}.enabled`]: false,
            }),
      },
      ...(newThreadSource === undefined
        ? {}
        : {
            threadSource: codexSpaceDynamicThreadSource(newThreadSource),
            dynamicTools: buildCodexSpaceDynamicTools(this.#spaceActionTools),
          }),
    };
  }

  async verifyScopedMcp(
    threadId: string,
    nativeVersion: string | null
  ): Promise<void> {
    const scoped =
      this.#computerFileAccessBoundary?.executionContextAccess !== undefined ||
      this.deliveryOnly;
    if (!(scoped || this.spaceToolInvocation.enabled)) {
      return;
    }
    const inventory = await this.requestControl(
      "mcpServerStatus/list",
      {
        threadId,
        // Isolation must still inspect all servers, tools and resources. An
        // ordinary native-tool turn only needs the alternate carrier disabled.
        detail: scoped ? "full" : "toolsAndAuthOnly",
        ...(!scoped &&
        supportsAgentControllerVersion(nativeVersion, ">=0.160.0")
          ? {
              // Reuse the thread's published connection state. An unfiltered
              // query starts discovery for unrelated MCP servers as well.
              serverName: OPENMELD_SPACE_ACTION_MCP_SERVER_ID,
            }
          : {}),
        limit: 100,
      },
      {
        code: "execution_context.mcp_inventory_timeout",
        operation: "mcpServerStatus/list",
      }
    );
    if (scoped) {
      assertCodexScopedMcpInventory(inventory, {
        expectedToolNames: this.deliveryOnly
          ? ["reply", "stay_silent", "read_receipt"]
          : undefined,
        expectDispatchServer:
          !this.spaceToolInvocation.enabled &&
          resolveDispatchSpaceActionMcpServer(this.#env) !== null,
      });
    } else {
      const result = toRecord(inventory);
      const rows = result?.data;
      if (
        !Array.isArray(rows) ||
        result?.nextCursor != null ||
        rows.some((row) => {
          const server = toRecord(row);
          return (
            server?.name === OPENMELD_SPACE_ACTION_MCP_SERVER_ID &&
            (server.runtimeStatus !== "disabled" ||
              Object.keys(toRecord(server.tools) ?? {}).length > 0)
          );
        })
      ) {
        throw new CodexAppServerTransportError({
          code: "context.space_tool_carrier_unverified",
          errorType: "config",
          message:
            "The current Codex tool inventory does not prove that the alternate Space carrier is disabled.",
        });
      }
    }
  }

  async close(): Promise<void> {
    this.spaceToolInvocation.fence();
    this.#clearTimers();
    const child = this.#child;
    if (!child) {
      return;
    }
    if (this.#lifecycle.stdinClosedAtMs === null) {
      this.#lifecycle.stdinClosedAtMs = Date.now();
      this.#emitRuntimeEvent({
        phase: "stdin_closed",
        processId: this.#lifecycle.processId,
        tsMs: this.#lifecycle.stdinClosedAtMs,
      });
    }
    if (!(child.stdin.destroyed || child.stdin.writableEnded)) {
      child.stdin.end();
    }
    if (this.#lifecycle.exitObservedAtMs !== null) {
      await this.#processCleanup;
      return;
    }
    this.#requestProcessTermination();
    await new Promise<void>((resolve, reject) => {
      const onClose = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        child.removeListener("close", onClose);
        reject(
          new CodexAppServerTransportError({
            code: "runtime.process_exit_unconfirmed",
            errorType: "adapter",
            message:
              "runtime.process_exit_unconfirmed: Codex process exit was not confirmed; automatic retry is unsafe",
            originalError:
              this.#settledFailure instanceof Error
                ? this.#settledFailure.message
                : undefined,
          })
        );
      }, APP_SERVER_PROCESS_KILL_GRACE_MS * 2);
      child.once("close", onClose);
    });
    await this.#processCleanup;
  }

  async request(
    method: string,
    params: unknown,
    timeout?: JsonRpcRequestTimeout
  ): Promise<unknown> {
    if (this.#settledFailure) {
      throw this.#settledFailure;
    }
    const id = this.#nextRequestId;
    this.#nextRequestId += 1;
    const requestPromise = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, {
        reject,
        resolve,
        timeout: null,
      });
    });
    if (timeout) {
      const pending = this.#pending.get(id);
      if (pending) {
        pending.timeout = setTimeout(() => {
          if (!this.#pending.has(id)) {
            return;
          }
          if (timeout.terminateSession === false) {
            this.#pending.delete(id);
            pending.reject(
              new CodexAppServerTransportError({
                code: timeout.code,
                errorType: "timeout",
                message: `${timeout.code}: codex app-server did not acknowledge ${timeout.operation}.`,
              })
            );
            return;
          }
          const timeoutTriggeredAtMs = Date.now();
          this.#lifecycle.timeoutTriggeredAtMs = timeoutTriggeredAtMs;
          this.#emitRuntimeEvent({
            phase: "timeout_triggered",
            processId: this.#lifecycle.processId,
            tsMs: timeoutTriggeredAtMs,
          });
          const error = new CodexAppServerTransportError({
            code: timeout.code,
            errorType: "timeout",
            message: `${timeout.code}: codex app-server did not acknowledge ${timeout.operation} within ${timeout.timeoutMs}ms.${this.#startupDiagnostics.summary()}`,
          });
          this.#failAll(error);
          this.#requestProcessTermination();
        }, timeout.timeoutMs);
        pending.timeout.unref?.();
      }
    }
    this.#write({
      id,
      jsonrpc: "2.0",
      method,
      params,
    });
    return await requestPromise;
  }

  async requestControl(
    method: string,
    params: unknown,
    timeout: Omit<JsonRpcRequestTimeout, "operation" | "timeoutMs"> & {
      operation: CodexAppServerControlOperation;
    }
  ): Promise<unknown> {
    return await this.request(method, params, {
      ...timeout,
      timeoutMs: resolveCodexAppServerControlRequestTimeoutMs({
        operation: timeout.operation,
        ...(this.#controlRequestTimeoutMs === undefined
          ? {}
          : { overrideMs: this.#controlRequestTimeoutMs }),
      }),
    });
  }

  setNewSessionTitleInBackground(input: {
    existingThreadId: string | null;
    executionMode?: AdapterDispatchExecutionMode;
    threadId: string;
    title?: AdapterDispatchRequest["newSessionTitle"];
  }): void {
    if (
      normalizeOptionalText(input.existingThreadId) ||
      input.executionMode === "repair" ||
      !input.title
    ) {
      return;
    }
    // Metadata is best effort on the already-running connection. Do not use
    // requestControl: its admission timeout kills the whole execution. One
    // unanswered request lives only until this ordinary session closes.
    this.request("thread/name/set", {
      name: input.title,
      threadId: input.threadId,
    }).catch((error: unknown) => {
      console.warn("[openmeld.codex.new_session_title_failed]", {
        code:
          error instanceof CodexAppServerTransportError
            ? error.code
            : "unknown",
        threadId: input.threadId,
      });
    });
  }

  notify(method: string, params?: unknown): void {
    this.#write({
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  async waitForTurnCompleted(input: {
    threadId: string;
    turnId: string;
  }): Promise<AppServerTurn> {
    const message = await this.#waitForNotification((candidate) => {
      if (candidate.method !== "turn/completed") {
        return false;
      }
      const params = toRecord(candidate.params);
      const turn = toRecord(params?.turn);
      return (
        params?.threadId === input.threadId &&
        normalizeOptionalText(turn?.id) === input.turnId
      );
    });
    const params = toRecord(message.params);
    const turn = toRecord(params?.turn);
    if (!turn) {
      throw new CodexAppServerTransportError({
        code: "protocol.invalid",
        errorType: "adapter",
        message: "protocol.invalid: turn/completed did not include turn",
      });
    }
    return turn as AppServerTurn;
  }

  registerActiveTurn(input: {
    updatePermissionMode: CodexAppServerActiveTurnRegistration["updatePermissionMode"];
    interrupt?: () => Promise<void>;
    steer: CodexAppServerActiveTurnRegistration["steer"];
    onActiveTurn?: CodexAppServerActiveTurnRegistrar;
    taskId: string;
    threadId: string;
    turnId: string | null;
  }): (() => void) | null {
    if (!input.onActiveTurn) {
      return null;
    }
    return input.onActiveTurn({
      updatePermissionMode: input.updatePermissionMode,
      steer: input.steer,
      taskId: input.taskId,
      threadId: input.threadId,
      turnId: input.turnId ?? "",
      interrupt:
        input.interrupt ??
        (async () => {
          if (input.turnId) {
            await this.request("turn/interrupt", {
              threadId: input.threadId,
              turnId: input.turnId,
            });
          }
        }),
    });
  }

  buildTelemetry(input: {
    invokedAtMs: number;
    previewEmitted: boolean;
    resumedContext: boolean;
    streamingMode: AdapterStreamingMode;
  }): AdapterDispatchTelemetry {
    return {
      completedAtMs: Date.now(),
      ...(this.#contextCompactionObserved
        ? { contextCompactionObserved: true }
        : {}),
      ...(this.#lifecycle.exitCode === null
        ? {}
        : { exitCode: this.#lifecycle.exitCode }),
      ...(this.#lifecycle.exitObservedAtMs === null
        ? {}
        : { exitObservedAtMs: this.#lifecycle.exitObservedAtMs }),
      ...(this.#lifecycle.exitSignal === null
        ? {}
        : { exitSignal: this.#lifecycle.exitSignal }),
      ...(this.#firstOutputAtMs === null
        ? {}
        : { firstOutputAtMs: this.#firstOutputAtMs }),
      ...(this.#lifecycle.firstStderrAtMs === null
        ? {}
        : { firstStderrAtMs: this.#lifecycle.firstStderrAtMs }),
      ...(this.#lifecycle.firstStdoutAtMs === null
        ? {}
        : { firstStdoutAtMs: this.#lifecycle.firstStdoutAtMs }),
      invokedAtMs: input.invokedAtMs,
      previewEmitted: input.previewEmitted,
      ...(this.#lifecycle.processId === null
        ? {}
        : { processId: this.#lifecycle.processId }),
      ...(this.#lifecycle.processSpawnedAtMs === null
        ? {}
        : { processSpawnedAtMs: this.#lifecycle.processSpawnedAtMs }),
      resumedContext: input.resumedContext,
      ...(this.#lifecycle.stdinClosedAtMs === null
        ? {}
        : { stdinClosedAtMs: this.#lifecycle.stdinClosedAtMs }),
      streamingMode: input.streamingMode,
      ...(this.#lifecycle.timeoutTriggeredAtMs === null
        ? {}
        : { timeoutTriggeredAtMs: this.#lifecycle.timeoutTriggeredAtMs }),
      ...(this.#latestTokenUsage ? { tokenUsage: this.#latestTokenUsage } : {}),
      aiUsage: [...this.#aiUsage.values()],
    };
  }

  readCollectedAgentMessageDeltaText(): string | null {
    const output = [...this.#turnAgentMessageDeltas.values()].join("").trim();
    return output.length > 0 ? output : null;
  }

  markAgentOutputObserved(): void {
    if (this.#firstOutputAtMs !== null) {
      return;
    }
    this.#firstOutputAtMs = Date.now();
  }

  #consumeStdoutText(text: string): void {
    this.#lineBuffer += text;
    while (true) {
      const newlineIndex = this.#lineBuffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      const line = this.#lineBuffer.slice(0, newlineIndex).trim();
      this.#lineBuffer = this.#lineBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      this.#handleStdoutLine(line);
    }
  }

  #handleStdoutLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch (error) {
      this.#failAll(
        new CodexAppServerTransportError({
          code: "protocol.invalid",
          errorType: "adapter",
          message: `protocol.invalid: codex app-server emitted non-JSON output (${toErrorMessage(
            error
          )})`,
        })
      );
      return;
    }

    if (message.id !== undefined && message.method) {
      this.#handleServerRequest(message).catch((error: unknown) => {
        this.#failAll(error);
      });
      return;
    }

    if (message.id !== undefined) {
      this.#handleResponse(message);
      return;
    }

    if (message.method) {
      this.#handleNotification(message);
    }
  }

  #handleResponse(message: JsonRpcMessage): void {
    const id = message.id;
    if (!(typeof id === "number" || typeof id === "string")) {
      return;
    }
    const pending = this.#pending.get(id);
    if (!pending) {
      return;
    }
    this.#pending.delete(id);
    if (pending.timeout !== null) {
      clearTimeout(pending.timeout);
    }
    if (message.error) {
      pending.reject(toJsonRpcTransportError(message.error));
      return;
    }
    pending.resolve(message.result);
  }

  #handleNotification(message: JsonRpcMessage): void {
    if (
      message.method === "account/updated" ||
      message.method === "account/login/completed"
    ) {
      this.#accountEpoch += 1;
    }
    if (message.method === "account/rateLimits/updated") {
      this.#observeCurrentAccountUsage();
    }
    this.#startupDiagnostics.observeNotification(
      message.method ?? "",
      message.params
    );
    if (message.method === "item/reasoning/summaryTextDelta") {
      this.#observeReasoningSummary(message.params);
      return;
    }
    if (
      message.method?.startsWith("item/reasoning/") ||
      toRecord(toRecord(message.params)?.item)?.type === "reasoning"
    ) {
      // Reasoning has no role in turn completion or reply extraction. Do not
      // retain raw deltas or full completed reasoning items in the event queue.
      return;
    }
    this.#notifications.push(message);
    this.#observeContextTelemetry(message);
    this.#collectAgentMessageDelta(message);
    const toolActivity = extractCodexToolActivityEvent(message);
    if (toolActivity) {
      this.#emitRuntimeEvent(toolActivity);
    }
    for (const waiter of [...this.#waiters]) {
      if (!waiter.predicate(message)) {
        continue;
      }
      this.#waiters.delete(waiter);
      waiter.resolve(message);
    }
  }

  #observeCurrentAccountUsage(): void {
    if (!this.#onRuntimeEvent || this.#usageObservationPending) {
      return;
    }
    // Sparse rolling events have no account id. Refetch a bounded snapshot on
    // this same native session rather than binding the event to another probe.
    // One pending read coalesces notifications and never delays the turn.
    this.#usageObservationPending = readCodexAccountUsageObservation({
      readAccountEpoch: () => this.#accountEpoch,
      request: (method, params) =>
        this.request(method, params, {
          code: "runtime.usage_observation_timeout",
          operation: method,
          terminateSession: false,
          timeoutMs: CODEX_USAGE_REQUEST_TIMEOUT_MS,
        }),
    })
      .then((observation) => {
        if (
          !observation.accountKey ||
          observation.accountEpoch !== this.#accountEpoch
        ) {
          return;
        }
        this.#emitRuntimeEvent({
          phase: "provider_usage_limits_observed",
          tsMs: Date.now(),
          usageAccountKey: observation.accountKey,
          ...observation.usageObservation,
        });
      })
      .catch(() => {
        // An unavailable auxiliary endpoint supplies no capacity evidence.
      })
      .finally(() => {
        this.#usageObservationPending = null;
      });
  }

  #observeContextTelemetry(message: JsonRpcMessage): void {
    const params = toRecord(message.params);
    if (
      message.method === "turn/started" &&
      params?.threadId === this.#usageThreadId
    ) {
      this.#usageTurnId = normalizeOptionalText(toRecord(params.turn)?.id);
    }
    if (
      message.method === "model/rerouted" &&
      params?.threadId === this.#usageThreadId
    ) {
      this.#usageModel = normalizeOptionalText(params.toModel);
    }
    if (message.method === "thread/tokenUsage/updated") {
      const tokenUsage = readCodexTokenUsage(
        toRecord(message.params)?.tokenUsage
      );
      if (tokenUsage) {
        this.#latestTokenUsage = tokenUsage;
        this.#observeAiUsage(params, tokenUsage);
      }
      return;
    }
    if (
      (message.method === "item/started" ||
        message.method === "item/completed") &&
      toRecord(toRecord(message.params)?.item)?.type === "contextCompaction"
    ) {
      this.#contextCompactionObserved = true;
    }
  }

  #observeAiUsage(
    params: Record<string, unknown> | null,
    tokenUsage: NonNullable<AdapterDispatchTelemetry["tokenUsage"]>
  ): void {
    const threadId = normalizeOptionalText(params?.threadId);
    if (!threadId) {
      return;
    }
    const previousTotal = this.#usageTotalByThread.get(threadId);
    this.#usageTotalByThread.set(threadId, tokenUsage.total.totalTokens);
    const turnId = normalizeOptionalText(params?.turnId);
    if (
      threadId !== this.#usageThreadId ||
      !turnId ||
      turnId !== this.#usageTurnId ||
      previousTotal === tokenUsage.total.totalTokens
    ) {
      return;
    }
    // Resume/fork replays and rate-limit-only events carry the previous last
    // usage. Observe their total cursor, but only count advances in our turn.
    const eventId = `codex:${threadId}:${turnId}:${tokenUsage.total.totalTokens}`;
    if (this.#aiUsage.has(eventId)) {
      return;
    }
    const usage = tokenUsage.last;
    this.#aiUsage.set(eventId, {
      eventId,
      provider: "openai",
      model: this.#usageModel,
      source: "codex_event",
      occurredAtMs: Date.now(),
      tokens: {
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cachedInputTokens,
        cacheWrite: usage.cacheWriteInputTokens ?? null,
        reasoning: usage.reasoningOutputTokens,
        total: usage.totalTokens,
      },
      cost: null,
    });
  }

  get liveFullAccess(): boolean {
    return this.#liveFullAccess;
  }

  setLiveFullAccess(enabled: boolean): void {
    this.#liveFullAccess = enabled;
  }

  async #handleServerRequest(message: JsonRpcMessage): Promise<void> {
    const id = message.id;
    if (!(typeof id === "number" || typeof id === "string")) {
      return;
    }
    if (message.method === "item/tool/call") {
      this.#write({
        id,
        jsonrpc: "2.0",
        result: await this.spaceToolInvocation.call(message.params),
      });
      return;
    }
    if (
      this.deliveryOnly &&
      message.method !== "mcpServer/elicitation/request" &&
      message.method !== "item/tool/requestUserInput"
    ) {
      this.#write({
        id,
        jsonrpc: "2.0",
        result: buildServerRequestDeclineResponse(message.method),
      });
      return;
    }
    const result = this.#onInteractionRequest
      ? await resolveCodexServerInteraction({
          method: message.method,
          onCancel: async () => {
            const params = toRecord(message.params) ?? {};
            const threadId = readRequiredText(
              params.threadId,
              "requestUserInput params.threadId"
            );
            const turnId = readRequiredText(
              params.turnId,
              "requestUserInput params.turnId"
            );
            this.#interactionFailure = {
              code: "interaction.cancelled",
              message:
                "interaction.cancelled: the local agent request was cancelled before Codex received an answer",
            };
            await this.request("turn/interrupt", {
              threadId,
              turnId,
            });
          },
          onInteractionRequest: this.#liveFullAccess
            ? allowPermissionRequestsOnce(this.#onInteractionRequest)
            : this.#onInteractionRequest,
          params: message.params,
        })
      : buildServerRequestDeclineResponse(message.method);
    if (result === null) {
      this.#write({
        error: {
          code: -32_601,
          message: `OpenMeld Codex App Server transport does not handle server request '${message.method}'.`,
        },
        id,
        jsonrpc: "2.0",
      });
      return;
    }
    this.#write({
      id,
      jsonrpc: "2.0",
      result,
    });
  }

  #waitForNotification(
    predicate: NotificationHandler extends (message: infer M) => void
      ? (message: M) => boolean
      : never
  ): Promise<JsonRpcMessage> {
    for (const notification of this.#notifications) {
      if (predicate(notification)) {
        return Promise.resolve(notification);
      }
    }
    if (this.#settledFailure) {
      return Promise.reject(this.#settledFailure);
    }
    return new Promise<JsonRpcMessage>((resolve, reject) => {
      this.#waiters.add({
        predicate,
        reject,
        resolve,
      });
    });
  }

  #collectAgentMessageDelta(message: JsonRpcMessage): void {
    if (message.method !== "item/agentMessage/delta") {
      return;
    }
    const params = toRecord(message.params);
    const itemId = normalizeOptionalText(params?.itemId);
    const delta = readAgentMessageDeltaText(params?.delta);
    if (!(itemId && delta)) {
      return;
    }
    this.markAgentOutputObserved();
    this.#turnAgentMessageDeltas.set(
      itemId,
      `${this.#turnAgentMessageDeltas.get(itemId) ?? ""}${delta}`
    );
  }

  #write(message: JsonRpcMessage): void {
    const child = this.#child;
    if (this.#settledFailure) {
      throw this.#settledFailure;
    }
    if (
      !child ||
      this.#lifecycle.exitObservedAtMs !== null ||
      child.stdin.destroyed ||
      child.stdin.writableEnded ||
      !child.stdin.writable
    ) {
      const error = this.#buildStdinWriteError();
      this.#failAll(error);
      throw error;
    }
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          this.#failAll(this.#buildStdinWriteError(error));
        }
      });
    } catch (error) {
      const writeError = this.#buildStdinWriteError(error);
      this.#failAll(writeError);
      throw writeError;
    }
  }

  #buildStdinWriteError(cause?: unknown): CodexAppServerTransportError {
    const detail =
      cause instanceof Error && cause.message.trim()
        ? ` (${cause.message.trim()})`
        : "";
    return new CodexAppServerTransportError({
      code: "upstream_unreachable",
      errorType: "adapter",
      message: `upstream_unreachable: codex app-server is not accepting responses${detail}`,
    });
  }

  #failAll(error: unknown): void {
    if (!this.#settledFailure) {
      this.#settledFailure = error;
    }
    for (const pending of this.#pending.values()) {
      if (pending.timeout !== null) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
    }
    this.#pending.clear();
    for (const waiter of this.#waiters) {
      waiter.reject(error);
    }
    this.#waiters.clear();
  }

  #requestProcessTermination(): void {
    const runtimeProcess = this.#runtimeProcess;
    if (!runtimeProcess || this.#lifecycle.exitObservedAtMs !== null) {
      return;
    }
    runtimeProcess.terminate("SIGTERM");
    this.#forceKillTimeout = setTimeout(() => {
      runtimeProcess.terminate("SIGKILL");
    }, APP_SERVER_PROCESS_KILL_GRACE_MS);
    this.#forceKillTimeout.unref?.();
  }

  #clearTimers(): void {
    if (this.#processTimeout !== null) {
      clearTimeout(this.#processTimeout);
      this.#processTimeout = null;
    }
    if (this.#forceKillTimeout !== null) {
      clearTimeout(this.#forceKillTimeout);
      this.#forceKillTimeout = null;
    }
    if (this.#startupTimeout !== null) {
      clearTimeout(this.#startupTimeout);
      this.#startupTimeout = null;
    }
  }

  readInteractionFailure(): CodexAppServerInteractionFailure | null {
    return this.#interactionFailure;
  }

  observeReasoningForThread(threadId: string): void {
    this.#reasoningThreadId = threadId;
  }

  observeUsageForThread(threadId: string, model: string | null): void {
    this.#usageThreadId = threadId;
    this.#usageModel = model;
  }

  #observeReasoningSummary(payload: unknown): void {
    const params = toRecord(payload);
    if (
      !this.#reasoningThreadId ||
      params?.threadId !== this.#reasoningThreadId ||
      typeof params.turnId !== "string" ||
      typeof params.itemId !== "string" ||
      typeof params.summaryIndex !== "number" ||
      typeof params.delta !== "string" ||
      params.delta.length === 0
    ) {
      return;
    }
    this.#emitRuntimeEvent({
      phase: "reasoning",
      blockId: `${params.turnId}:${params.itemId}:${params.summaryIndex}`,
      text: params.delta,
      mode: "append",
      tsMs: Date.now(),
    });
  }

  emitProviderConversationObserved(threadId: string): void {
    const agentControllerConversationId = normalizeOptionalText(threadId);
    if (!agentControllerConversationId) {
      return;
    }
    this.#emitRuntimeEvent({
      agentControllerConversationId,
      phase: "provider_conversation_observed",
      tsMs: Date.now(),
    });
  }

  emitProviderTurnAccepted(input: { threadId: string; turnId: string }): void {
    this.#emitRuntimeEvent({
      agentControllerConversationId: input.threadId,
      phase: "provider_turn_accepted",
      tsMs: Date.now(),
      turnId: input.turnId,
    });
  }

  #emitRuntimeEvent(event: AdapterRuntimeEvent): void {
    this.#onRuntimeEvent?.(event);
  }
}

function readThreadIdFromResponse(value: unknown): string {
  const response = toRecord(value) as AppServerThreadResponse | null;
  return readRequiredText(response?.thread?.id, "thread response thread.id");
}

function readThreadContextFromResponse(
  value: unknown
): CodexAppServerThreadContext {
  const response = toRecord(value) as AppServerThreadResponse | null;
  return {
    permissionResponse: value,
    model: normalizeOptionalText(response?.model),
    threadId: readRequiredText(
      response?.thread?.id,
      "thread response thread.id"
    ),
    threadSource: normalizeOptionalText(response?.thread?.threadSource),
  };
}

function readLastCompletedTurnId(value: unknown): string | null {
  const response = toRecord(value) as AppServerThreadReadResponse | null;
  const turns = Array.isArray(response?.thread?.turns)
    ? response.thread.turns
    : [];
  // The source may be mid-turn. Only a settled turn is a history boundary a
  // fork may inherit, so scan backwards for the last completed one.
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (normalizeOptionalText(turn?.status) !== "completed") {
      continue;
    }
    const turnId = normalizeOptionalText(turn?.id);
    if (turnId) {
      return turnId;
    }
  }
  return null;
}

function readTurnStartResponse(value: unknown): AppServerTurn {
  const response = toRecord(value) as AppServerTurnStartResponse | null;
  const turn = response?.turn;
  if (!turn || typeof turn !== "object") {
    throw new CodexAppServerTransportError({
      code: "protocol.invalid",
      errorType: "adapter",
      message: "protocol.invalid: turn/start response did not include turn",
    });
  }
  return turn;
}

function readAgentMessageOutput(turn: AppServerTurn): string | null {
  const items = Array.isArray(turn.items) ? turn.items : [];
  const text = items
    .filter((item) => item.type === "agentMessage")
    .map((item) => normalizeOptionalText(item.text))
    .filter((item): item is string => item !== null)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

function readTurnFailureMessage(turn: AppServerTurn): string {
  return (
    normalizeOptionalText(turn.error?.message) ?? "codex app-server turn failed"
  );
}

function readTurnFailureCodexErrorInfo(turn: AppServerTurn): string | null {
  return normalizeOptionalText(turn.error?.codexErrorInfo);
}

function readCodexTokenUsage(
  value: unknown
): NonNullable<AdapterDispatchTelemetry["tokenUsage"]> | null {
  const usage = toRecord(value);
  const last = readCodexTokenUsageBreakdown(usage?.last);
  const total = readCodexTokenUsageBreakdown(usage?.total);
  const rawModelContextWindow = usage?.modelContextWindow;
  const modelContextWindow =
    rawModelContextWindow === null
      ? null
      : readNonNegativeInteger(rawModelContextWindow);
  if (!(last && total && modelContextWindow !== undefined)) {
    return null;
  }
  return { last, modelContextWindow, total };
}

function readCodexTokenUsageBreakdown(
  value: unknown
): NonNullable<AdapterDispatchTelemetry["tokenUsage"]>["last"] | null {
  const usage = toRecord(value);
  const cachedInputTokens = readNonNegativeInteger(usage?.cachedInputTokens);
  const inputTokens = readNonNegativeInteger(usage?.inputTokens);
  const outputTokens = readNonNegativeInteger(usage?.outputTokens);
  const reasoningOutputTokens = readNonNegativeInteger(
    usage?.reasoningOutputTokens
  );
  const totalTokens = readNonNegativeInteger(usage?.totalTokens);
  const cacheWriteInputTokens = readNonNegativeInteger(
    usage?.cacheWriteInputTokens
  );
  if (
    cachedInputTokens === undefined ||
    inputTokens === undefined ||
    outputTokens === undefined ||
    reasoningOutputTokens === undefined ||
    totalTokens === undefined
  ) {
    return null;
  }
  return {
    ...(cacheWriteInputTokens === undefined ? {} : { cacheWriteInputTokens }),
    cachedInputTokens,
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function readAgentMessageDeltaText(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

async function emitPreviewIfRequested(input: {
  onPreview?: AdapterPreviewCallback;
  output: string;
  streamingMode?: AdapterStreamingMode;
}): Promise<void> {
  if (!(input.onPreview && input.streamingMode === "stream")) {
    return;
  }
  await input.onPreview({
    text: input.output,
  });
}

// Only Codex approval prompts are covered by Full access. An MCP URL step
// shares the permission shape, but its "allow" means the owner completed a
// step such as a sign-in, so it must still reach the owner.
const FULL_ACCESS_APPROVAL_SUBJECTS: ReadonlySet<string> = new Set([
  "additional_permissions",
  "command",
  "file_change",
]);

function allowPermissionRequestsOnce(
  onInteractionRequest: AdapterInteractionCallback
): AdapterInteractionCallback {
  return (request) => {
    if (
      request.kind !== "permission" ||
      !FULL_ACCESS_APPROVAL_SUBJECTS.has(request.subject.type)
    ) {
      return onInteractionRequest(request);
    }
    const allowOnce = request.options.find(
      (option) => option.intent === "allow_once"
    );
    return allowOnce
      ? Promise.resolve({ kind: "permission", optionId: allowOnce.optionId })
      : onInteractionRequest(request);
  };
}

async function resolveCodexServerInteraction(input: {
  method: string | undefined;
  onCancel: () => Promise<void>;
  onInteractionRequest: AdapterInteractionCallback;
  params: unknown;
}): Promise<Record<string, unknown> | string | null> {
  switch (input.method) {
    case "item/commandExecution/requestApproval":
      return await resolveCommandApprovalInteraction({
        legacy: false,
        onInteractionRequest: input.onInteractionRequest,
        params: input.params,
      });
    case "item/fileChange/requestApproval":
      return await resolveFileChangeApprovalInteraction({
        legacy: false,
        onInteractionRequest: input.onInteractionRequest,
        params: input.params,
      });
    case "execCommandApproval":
      return await resolveCommandApprovalInteraction({
        legacy: true,
        onInteractionRequest: input.onInteractionRequest,
        params: input.params,
      });
    case "applyPatchApproval":
      return await resolveFileChangeApprovalInteraction({
        legacy: true,
        onInteractionRequest: input.onInteractionRequest,
        params: input.params,
      });
    case "item/tool/requestUserInput":
      return await resolveUserInputInteraction({
        onCancel: input.onCancel,
        onInteractionRequest: input.onInteractionRequest,
        params: input.params,
      });
    case "item/permissions/requestApproval":
      return await resolveAdditionalPermissionsInteraction({
        onInteractionRequest: input.onInteractionRequest,
        params: input.params,
      });
    case "mcpServer/elicitation/request":
      return await resolveMcpServerElicitationInteraction({
        onInteractionRequest: input.onInteractionRequest,
        params: input.params,
      });
    default:
      return buildServerRequestDeclineResponse(input.method);
  }
}

async function resolveCommandApprovalInteraction(input: {
  legacy: boolean;
  onInteractionRequest: AdapterInteractionCallback;
  params: unknown;
}): Promise<Record<string, unknown>> {
  const params = toRecord(input.params) ?? {};
  const command =
    normalizeBoundedText(
      input.legacy && Array.isArray(params.command)
        ? params.command.map(String).join(" ")
        : params.command,
      16_000
    ) ?? "Command details were not provided.";
  const cwd = normalizeBoundedText(params.cwd, 4096);
  const decisions = input.legacy
    ? ["approved", "approved_for_session", "denied"]
    : resolveCommandApprovalDecisions(params.availableDecisions);
  const mappedOptions = decisions
    .map((decision, index) => {
      const presentation = presentCommandApprovalDecision(decision);
      return presentation
        ? {
            decision,
            option: {
              intent: presentation.intent,
              label: presentation.label,
              optionId: `codex-command-decision-${index}`,
            },
          }
        : null;
    })
    .filter(
      (
        value
      ): value is {
        decision: unknown;
        option: Extract<
          AdapterInteractionRequest,
          { kind: "permission" }
        >["options"][number];
      } => value !== null
    );
  const options =
    mappedOptions.length > 0
      ? mappedOptions
      : [
          {
            decision: input.legacy ? "denied" : "decline",
            option: {
              intent: "deny" as const,
              label: "Deny",
              optionId: "codex-command-decision-deny",
            },
          },
        ];
  const response = await input.onInteractionRequest({
    ...(normalizeBoundedText(params.reason, 4000)
      ? { description: normalizeBoundedText(params.reason, 4000) }
      : {}),
    kind: "permission",
    options: options.map(({ option }) => option),
    subject: {
      command,
      ...(cwd ? { cwd } : {}),
      type: "command",
    },
    title: "Allow Codex to run this command?",
  });

  if (response.kind === "cancel") {
    return {
      decision: input.legacy ? "abort" : "cancel",
    };
  }
  const selected =
    response.kind === "permission"
      ? options.find(({ option }) => option.optionId === response.optionId)
      : null;
  if (selected) {
    return {
      decision:
        input.legacy && selected.decision === "denied"
          ? { denied: { rejection: "Denied by the user." } }
          : selected.decision,
    };
  }
  return {
    decision: input.legacy
      ? { denied: { rejection: "Denied by the user." } }
      : "decline",
  };
}

function resolveCommandApprovalDecisions(value: unknown): unknown[] {
  if (Array.isArray(value) && value.length > 0) {
    return value;
  }
  return ["accept", "acceptForSession", "decline", "cancel"];
}

function presentCommandApprovalDecision(decision: unknown): {
  intent: "allow_always" | "allow_once" | "allow_session" | "deny";
  label: string;
} | null {
  if (decision === "accept" || decision === "approved") {
    return { intent: "allow_once", label: "Allow once" };
  }
  if (decision === "acceptForSession" || decision === "approved_for_session") {
    return { intent: "allow_session", label: "Allow for this session" };
  }
  if (decision === "decline" || decision === "denied") {
    return { intent: "deny", label: "Deny" };
  }
  if (decision === "cancel" || decision === "abort") {
    return null;
  }
  const record = toRecord(decision);
  if (record?.acceptWithExecpolicyAmendment) {
    return { intent: "allow_always", label: "Allow matching commands" };
  }
  if (record?.applyNetworkPolicyAmendment) {
    return { intent: "allow_always", label: "Allow this network access" };
  }
  return null;
}

async function resolveFileChangeApprovalInteraction(input: {
  legacy: boolean;
  onInteractionRequest: AdapterInteractionCallback;
  params: unknown;
}): Promise<Record<string, unknown>> {
  const params = toRecord(input.params) ?? {};
  const resource = input.legacy
    ? normalizeBoundedText(safeJsonStringify(params.fileChanges), 4096)
    : normalizeBoundedText(params.grantRoot, 4096);
  const options = [
    {
      decision: input.legacy ? "approved" : "accept",
      option: {
        intent: "allow_once" as const,
        label: "Allow once",
        optionId: "codex-file-decision-once",
      },
    },
    {
      decision: input.legacy ? "approved_for_session" : "acceptForSession",
      option: {
        intent: "allow_session" as const,
        label: "Allow for this session",
        optionId: "codex-file-decision-session",
      },
    },
    {
      decision: input.legacy ? "denied" : "decline",
      option: {
        intent: "deny" as const,
        label: "Deny",
        optionId: "codex-file-decision-deny",
      },
    },
  ];
  const response = await input.onInteractionRequest({
    ...(normalizeBoundedText(params.reason, 4000)
      ? { description: normalizeBoundedText(params.reason, 4000) }
      : {}),
    kind: "permission",
    options: options.map(({ option }) => option),
    subject: {
      ...(resource ? { resource } : {}),
      type: "file_change",
    },
    title: "Allow Codex to change these files?",
  });

  if (response.kind === "cancel") {
    return { decision: input.legacy ? "abort" : "cancel" };
  }
  const selected =
    response.kind === "permission"
      ? options.find(({ option }) => option.optionId === response.optionId)
      : null;
  if (selected) {
    return {
      decision:
        input.legacy && selected.decision === "denied"
          ? { denied: { rejection: "Denied by the user." } }
          : selected.decision,
    };
  }
  return {
    decision: input.legacy
      ? { denied: { rejection: "Denied by the user." } }
      : "decline",
  };
}

async function resolveUserInputInteraction(input: {
  onCancel: () => Promise<void>;
  onInteractionRequest: AdapterInteractionCallback;
  params: unknown;
}): Promise<Record<string, unknown>> {
  const params = toRecord(input.params) ?? {};
  const rawQuestions = Array.isArray(params.questions) ? params.questions : [];
  const answers: Record<string, { answers: string[] }> = {};

  for (let offset = 0; offset < rawQuestions.length; offset += 3) {
    const mappedQuestions = rawQuestions
      .slice(offset, offset + 3)
      .map((value, localIndex) => mapCodexQuestion(value, offset + localIndex));
    const response = await input.onInteractionRequest({
      kind: "question",
      questions: mappedQuestions.map(({ request }) => request),
      title: "Codex needs your input",
    });
    if (response.kind === "cancel") {
      await input.onCancel();
      return { answers: {} };
    }
    if (response.kind !== "question") {
      return { answers: {} };
    }
    for (const answer of response.answers) {
      const question = mappedQuestions.find(
        ({ request }) => request.questionId === answer.questionId
      );
      if (!question) {
        continue;
      }
      answers[answer.questionId] = {
        answers: answer.values.map(
          (value) => question.optionValueById.get(value) ?? value
        ),
      };
    }
  }

  return { answers };
}

function mapCodexQuestion(
  value: unknown,
  questionIndex: number
): {
  optionValueById: ReadonlyMap<string, string>;
  request: Extract<
    AdapterInteractionRequest,
    { kind: "question" }
  >["questions"][number];
} {
  const question = toRecord(value) ?? {};
  const questionId =
    normalizeBoundedText(question.id, 256) ?? `codex-question-${questionIndex}`;
  const rawOptions = Array.isArray(question.options)
    ? question.options.slice(0, 20)
    : [];
  const optionValueById = new Map<string, string>();
  const options = rawOptions.map((rawOption, optionIndex) => {
    const option = toRecord(rawOption) ?? {};
    const label =
      normalizeBoundedText(option.label, 240) ?? `Option ${optionIndex + 1}`;
    const optionId = `${questionId}-option-${optionIndex}`;
    optionValueById.set(optionId, label);
    const description = normalizeBoundedText(option.description, 1000);
    return {
      ...(description ? { description } : {}),
      label,
      optionId,
    };
  });
  return {
    optionValueById,
    request: {
      allowOther: question.isOther === true || options.length === 0,
      ...(normalizeBoundedText(question.header, 120)
        ? { header: normalizeBoundedText(question.header, 120) }
        : {}),
      multiple: false,
      options,
      prompt:
        normalizeBoundedText(question.question, 4000) ??
        "What should Codex do?",
      questionId,
      ...(question.isSecret === true ? { secret: true } : {}),
    },
  };
}

async function resolveAdditionalPermissionsInteraction(input: {
  onInteractionRequest: AdapterInteractionCallback;
  params: unknown;
}): Promise<Record<string, unknown>> {
  const allowTurnOptionId = "codex-additional-permissions-turn";
  const allowSessionOptionId = "codex-additional-permissions-session";
  const denyOptionId = "codex-additional-permissions-deny";
  const params = toRecord(input.params) ?? {};
  const requestedPermissions = toRecord(params.permissions) ?? {};
  const grantedPermissions = Object.fromEntries(
    Object.entries(requestedPermissions).filter(([, value]) => value !== null)
  );
  const options = [
    {
      intent: "allow_once" as const,
      label: "Allow for this turn",
      optionId: allowTurnOptionId,
    },
    {
      intent: "allow_session" as const,
      label: "Allow for this session",
      optionId: allowSessionOptionId,
    },
    {
      intent: "deny" as const,
      label: "Deny",
      optionId: denyOptionId,
    },
  ];
  const response = await input.onInteractionRequest({
    ...(normalizeBoundedText(params.reason, 4000)
      ? { description: normalizeBoundedText(params.reason, 4000) }
      : {}),
    kind: "permission",
    options,
    subject: {
      ...(normalizeBoundedText(params.cwd, 4096)
        ? { cwd: normalizeBoundedText(params.cwd, 4096) }
        : {}),
      resource: normalizeBoundedText(
        safeJsonStringify(requestedPermissions),
        4096
      ),
      type: "additional_permissions",
    },
    title: "Allow Codex additional access?",
  });
  const optionId =
    response.kind === "permission" ? response.optionId : denyOptionId;
  if (optionId === allowTurnOptionId) {
    return {
      permissions: grantedPermissions,
      scope: "turn",
      strictAutoReview: true,
    };
  }
  if (optionId === allowSessionOptionId) {
    return {
      permissions: grantedPermissions,
      scope: "session",
      strictAutoReview: true,
    };
  }
  return {
    permissions: {},
    scope: "turn",
    strictAutoReview: true,
  };
}

async function resolveMcpServerElicitationInteraction(input: {
  onInteractionRequest: AdapterInteractionCallback;
  params: unknown;
}): Promise<Record<string, unknown>> {
  const params = toRecord(input.params) ?? {};
  if (params.mode === "url") {
    return await resolveMcpServerUrlElicitation({
      onInteractionRequest: input.onInteractionRequest,
      params,
    });
  }
  if (params.mode !== "form" && params.mode !== "openai/form") {
    return { action: "decline" };
  }
  return await resolveMcpServerFormElicitation({
    onInteractionRequest: input.onInteractionRequest,
    params,
  });
}

async function resolveMcpServerFormElicitation(input: {
  onInteractionRequest: AdapterInteractionCallback;
  params: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const requestedSchema = toRecord(input.params.requestedSchema);
  const properties = toRecord(requestedSchema?.properties);
  if (!properties) {
    return { action: "decline" };
  }
  const requiredNames = new Set(
    Array.isArray(requestedSchema?.required)
      ? requestedSchema.required.map(String)
      : []
  );
  const fields = Object.entries(properties).map(([name, value], index) =>
    mapCodexMcpElicitationField({
      fieldIndex: index,
      name,
      required: requiredNames.has(name),
      schema: value,
    })
  );
  if (fields.length === 0) {
    return { action: "decline" };
  }

  const content: Record<string, unknown> = {};
  for (let offset = 0; offset < fields.length; offset += 3) {
    const chunk = fields.slice(offset, offset + 3);
    const description = normalizeBoundedText(input.params.message, 4000);
    const response = await input.onInteractionRequest({
      ...(description ? { description } : {}),
      kind: "question",
      questions: chunk.map(({ request }) => request),
      title: `${normalizeBoundedText(input.params.serverName, 180) ?? "An MCP server"} needs your input`,
    });
    if (response.kind === "cancel") {
      return { action: "cancel" };
    }
    if (response.kind !== "question") {
      return { action: "decline" };
    }
    for (const answer of response.answers) {
      const field = chunk.find(
        ({ request }) => request.questionId === answer.questionId
      );
      if (!field) {
        continue;
      }
      const values = answer.values
        .filter((value) => value !== field.skipOptionId)
        .map((value) => field.optionValueById.get(value) ?? value);
      if (values.length === 0 && field.skipOptionId) {
        continue;
      }
      content[field.name] = field.convert(values);
    }
  }

  return { action: "accept", content };
}

async function resolveMcpServerUrlElicitation(input: {
  onInteractionRequest: AdapterInteractionCallback;
  params: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const completedOptionId = "codex-mcp-elicitation-completed";
  const declineOptionId = "codex-mcp-elicitation-decline";
  const url = normalizeBoundedText(input.params.url, 4096);
  if (!url) {
    return { action: "decline" };
  }
  const response = await input.onInteractionRequest({
    description:
      normalizeBoundedText(input.params.message, 4000) ??
      "Complete the requested step, then continue.",
    kind: "permission",
    options: [
      {
        intent: "allow_once",
        label: "I've completed this step",
        optionId: completedOptionId,
      },
      {
        intent: "deny",
        label: "Decline",
        optionId: declineOptionId,
      },
    ],
    subject: {
      resource: url,
      type: "tool",
    },
    title: `${normalizeBoundedText(input.params.serverName, 180) ?? "An MCP server"} needs your attention`,
  });
  if (
    response.kind === "permission" &&
    response.optionId === completedOptionId
  ) {
    return { action: "accept" };
  }
  return { action: response.kind === "cancel" ? "cancel" : "decline" };
}

function mapCodexMcpElicitationField(input: {
  fieldIndex: number;
  name: string;
  required: boolean;
  schema: unknown;
}): {
  convert: (values: unknown[]) => unknown;
  name: string;
  optionValueById: ReadonlyMap<string, unknown>;
  request: Extract<
    AdapterInteractionRequest,
    { kind: "question" }
  >["questions"][number];
  skipOptionId: string | null;
} {
  const schema = toRecord(input.schema) ?? {};
  const questionId = `codex-mcp-field-${input.fieldIndex}`;
  const skipOptionId = input.required ? null : `${questionId}-skip`;
  const optionValueById = new Map<string, unknown>();
  const rawOptions = listCodexMcpElicitationOptions(schema).slice(
    0,
    skipOptionId ? 19 : 20
  );
  const options = rawOptions.map((option, optionIndex) => {
    const optionId = `${questionId}-option-${optionIndex}`;
    optionValueById.set(optionId, option.value);
    return {
      label: option.label.slice(0, 240),
      optionId,
    };
  });
  if (skipOptionId) {
    options.push({
      label: "Skip",
      optionId: skipOptionId,
    });
  }
  const multiple = schema.type === "array";
  return {
    convert: (values) => convertCodexMcpElicitationValues(values, schema),
    name: input.name,
    optionValueById,
    request: {
      allowOther: rawOptions.length === 0,
      header:
        normalizeBoundedText(schema.title, 120) ?? input.name.slice(0, 120),
      multiple,
      options,
      prompt:
        normalizeBoundedText(schema.description, 4000) ??
        `Enter ${input.name.replaceAll("_", " ")}.`,
      questionId,
    },
    skipOptionId,
  };
}

function listCodexMcpElicitationOptions(
  schema: Record<string, unknown>
): Array<{ label: string; value: unknown }> {
  if (schema.type === "boolean") {
    return [
      { label: "Yes", value: true },
      { label: "No", value: false },
    ];
  }
  const itemSchema = toRecord(schema.items);
  let titledOptions: unknown[] | null = null;
  if (Array.isArray(schema.oneOf)) {
    titledOptions = schema.oneOf;
  } else if (Array.isArray(itemSchema?.anyOf)) {
    titledOptions = itemSchema.anyOf;
  }
  if (titledOptions) {
    return titledOptions.map((value) => {
      const option = toRecord(value) ?? {};
      const rawValue = option.const ?? "";
      return {
        label:
          normalizeBoundedText(option.title, 240) ??
          String(rawValue).slice(0, 240),
        value: rawValue,
      };
    });
  }
  let rawValues: unknown[] = [];
  if (Array.isArray(schema.enum)) {
    rawValues = schema.enum;
  } else if (Array.isArray(itemSchema?.enum)) {
    rawValues = itemSchema.enum;
  }
  const enumNames = Array.isArray(schema.enumNames) ? schema.enumNames : [];
  return rawValues.map((value, index) => ({
    label:
      normalizeBoundedText(enumNames[index], 240) ??
      String(value).slice(0, 240),
    value,
  }));
}

function convertCodexMcpElicitationValues(
  values: unknown[],
  schema: Record<string, unknown>
): unknown {
  if (schema.type === "array") {
    return values.map(String);
  }
  const value = values[0] ?? "";
  if (schema.type === "boolean") {
    return typeof value === "boolean" ? value : value === "true";
  }
  if (schema.type === "number" || schema.type === "integer") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : value;
  }
  return String(value);
}

function normalizeBoundedText(
  value: unknown,
  maxLength: number
): string | null {
  const text = normalizeOptionalText(value);
  return text ? text.slice(0, maxLength) : null;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

function buildServerRequestDeclineResponse(method: string | undefined):
  | {
      [key: string]: unknown;
    }
  | string
  | null {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return { decision: "decline" };
    case "item/fileChange/requestApproval":
      return { decision: "decline" };
    case "execCommandApproval":
      return { decision: "denied" };
    case "applyPatchApproval":
      return { decision: "denied" };
    case "item/tool/requestUserInput":
      return { answers: {} };
    case "mcpServer/elicitation/request":
      return { _meta: null, action: "decline", content: null };
    case "item/tool/call":
      return { contentItems: [], success: false };
    case "item/permissions/requestApproval":
      return {
        permissions: {},
        scope: "turn",
        strictAutoReview: true,
      };
    default:
      return null;
  }
}

function toJsonRpcTransportError(
  error: JsonRpcError
): CodexAppServerTransportError {
  const message =
    normalizeOptionalText(error.message) ?? "codex app-server error";
  const originalError = createProviderOriginalError(message) ?? undefined;
  // JSON-RPC method absence is capability evidence, not a missing conversation.
  // Preserve the protocol code before human-message classification sees "not found".
  if (error.code === -32_601) {
    return new CodexAppServerTransportError({
      code: "runtime.method_unsupported",
      errorType: "adapter",
      message,
      originalError,
      rpcErrorCode: error.code,
    });
  }
  const mcpInitializationFailure =
    classifyCodexRequiredMcpInitializationFailure({
      message,
      ...(typeof error.code === "number" ? { rpcErrorCode: error.code } : {}),
    });
  if (mcpInitializationFailure) {
    return mcpInitializationFailure;
  }
  const permissionDenial = classifyRuntimePermissionDenialMessage({
    message,
    source: "codex",
  });
  if (permissionDenial) {
    return new CodexAppServerTransportError({
      code: permissionDenial.code,
      errorType: permissionDenial.errorType,
      message: permissionDenial.message,
      originalError,
    });
  }
  const providerFailure = classifyCodexProviderAccountFailure({ message });
  if (providerFailure) {
    return new CodexAppServerTransportError({
      code: providerFailure.code,
      errorType: providerFailure.errorType,
      message,
      originalError: providerFailure.originalError,
      providerAccessEvidence: providerFailure.providerAccessEvidence,
    });
  }
  const lowered = message.toLowerCase();
  if (
    lowered.includes("not logged in") ||
    lowered.includes("unauthorized") ||
    lowered.includes("authentication") ||
    lowered.includes("401")
  ) {
    return new CodexAppServerTransportError({
      code: "auth.required",
      errorType: "auth",
      message,
      originalError,
    });
  }
  if (
    lowered.includes("no rollout found") ||
    lowered.includes("rollout not found") ||
    lowered.includes("thread not found") ||
    lowered.includes("thread not loaded") ||
    lowered.includes("no thread") ||
    lowered.includes("not found")
  ) {
    return new CodexAppServerTransportError({
      code: "context_not_found",
      errorType: "config",
      message,
      originalError,
      ...(typeof error.code === "number" ? { rpcErrorCode: error.code } : {}),
    });
  }
  return new CodexAppServerTransportError({
    code: "upstream_unreachable",
    errorType: "adapter",
    message,
    originalError,
    ...(typeof error.code === "number" ? { rpcErrorCode: error.code } : {}),
  });
}

function classifyCodexRequiredMcpInitializationFailure(input: {
  message: string;
  rpcErrorCode?: number;
}): CodexAppServerTransportError | null {
  if (!REQUIRED_MCP_INITIALIZATION_FAILURE_PATTERN.test(input.message)) {
    return null;
  }
  return new CodexAppServerTransportError({
    code: "execution_context.mcp_server_initialization_failed",
    errorType: "config",
    message:
      "execution_context.mcp_server_initialization_failed: required tools could not start",
    originalError: createProviderOriginalError(input.message) ?? undefined,
    ...(typeof input.rpcErrorCode === "number"
      ? { rpcErrorCode: input.rpcErrorCode }
      : {}),
  });
}

function toCodexAppServerTransportError(
  error: unknown,
  timeoutMs: number | null
): CodexAppServerTransportError {
  if (error instanceof CodexAppServerTransportError) {
    return error;
  }
  const contextError =
    error instanceof Error
      ? EXECUTION_CONTEXT_ERROR_PATTERN.exec(error.message)?.[1]
      : undefined;
  if (contextError) {
    return new CodexAppServerTransportError({
      code: contextError,
      errorType: "config",
      message: `${contextError}: the local execution boundary could not be verified`,
    });
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
    return new CodexAppServerTransportError({
      code: (error as { code: string }).code,
      errorType: (error as { errorType: AdapterErrorType }).errorType,
      message: error.message,
    });
  }
  if (timeoutMs !== null && toErrorMessage(error).includes("timed out")) {
    return new CodexAppServerTransportError({
      code: "process.timeout",
      errorType: "timeout",
      message: toErrorMessage(error),
    });
  }
  return new CodexAppServerTransportError({
    code: "upstream_unreachable",
    errorType: "adapter",
    message: `upstream_unreachable: failed to execute codex app-server (${toErrorMessage(
      error
    )})`,
  });
}

function readRequiredText(value: unknown, label: string): string {
  const text = normalizeOptionalText(value);
  if (text) {
    return text;
  }
  throw new CodexAppServerTransportError({
    code: "protocol.invalid",
    errorType: "adapter",
    message: `protocol.invalid: missing ${label}`,
  });
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function isProcessGroupAbsent(processId: number): boolean {
  try {
    process.kill(-processId, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

function parseCodexAppServerVersion(response: unknown): string | null {
  const userAgent = normalizeOptionalText(toRecord(response)?.userAgent);
  return userAgent?.match(CODEX_APP_SERVER_VERSION_PATTERN)?.[1] ?? null;
}

function resolveCodexAppServerAuthStatus(input: {
  account: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
}): CodexAppServerAccountProbeResult["authStatus"] {
  if (input.account) {
    return "authenticated";
  }
  return input.response?.requiresOpenaiAuth === true
    ? "unauthenticated"
    : "unknown";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
