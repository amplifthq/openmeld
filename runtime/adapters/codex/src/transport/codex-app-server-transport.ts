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
  AdapterPreviewCallback,
  AdapterProviderAccessEvidence,
  AdapterRuntimeEvent,
  AdapterRuntimeEventCallback,
  AdapterRuntimeProcessCallback,
  AdapterStreamingMode,
  AgentControllerPermissionMode,
  ConversationPolicy,
  RuntimeAgentControllerLaunchContract,
  SpawnedAgentControllerProcess,
} from "@openmeld/adapter-core";
import {
  AGENT_CONTROLLER_CONVERSATION_OCCUPANCY_CONTRACT_VERSION,
  classifyRuntimePermissionDenialMessage,
  createProviderOriginalError,
  spawnAgentControllerProcess,
} from "@openmeld/adapter-core";
import { classifyCodexProviderAccountFailure } from "../output/codex-provider-failure.js";
import { extractCodexToolActivityEvent } from "../output/codex-tool-activity.js";
import {
  type CodexAppServerControlOperation,
  resolveCodexAppServerControlRequestTimeoutMs,
} from "./codex-app-server-admission.js";
import { buildCodexAppServerLaunch } from "./codex-app-server-launch.js";
import { buildCodexFileAccessBoundaryGlobalArgs } from "./codex-file-access-boundary.js";
import { buildCodexSpaceActionMcpGlobalArgs } from "./codex-space-action-mcp-config.js";

const CODEX_APP_SERVER_VERSION_PATTERN = /\/([^\s]+)/u;

export type CodexAppServerTransportResult = {
  output: string;
  telemetry: AdapterDispatchTelemetry;
  threadId: string;
};

export type CodexAppServerActiveTurnRegistration = {
  interrupt: () => Promise<void>;
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
  authStatus: "authenticated" | "unauthenticated" | "unknown";
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
  operation: CodexAppServerControlOperation;
  timeoutMs: number;
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

type CodexAppServerApprovalPolicy = "never" | "on-request" | "untrusted";
type CodexAppServerApprovalReviewer = "auto_review";
type CodexAppServerSandboxMode =
  | "danger-full-access"
  | "read-only"
  | "workspace-write";

type CodexAppServerThreadPermissionModeParams = {
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
      const response = toRecord(await session.request("account/read", {}));
      const account = toRecord(response?.account);
      return {
        authStatus: resolveCodexAppServerAuthStatus({ account, response }),
        version: parseCodexAppServerVersion(initialized),
      };
    }
  );
}

export async function invokeCodexAppServerTransport(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
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
  const permissionModeParams = resolveCodexAppServerPermissionModeParams(
    input.agentControllerPermissionMode,
    input.executionMode,
    input.computerFileAccessBoundary !== undefined
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
      onInteractionRequest: input.onInteractionRequest,
      onProcessControlEvent: input.onProcessControlEvent,
      onRuntimeEvent: input.onRuntimeEvent,
      startupTimeoutMs: input.startupTimeoutMs,
    },
    async (session) => {
      throwIfCodexDispatchCancelled(input.cancellationSignal);
      const threadContext = await resolveDispatchThreadContext({
        cancellationSignal: input.cancellationSignal,
        conversationPolicyParams,
        codexWorkdir: input.codexWorkdir,
        executionMode: input.executionMode,
        permissionModeParams: permissionModeParams.thread,
        session,
        threadId: input.threadId,
        instructionPrompt: input.instructionPrompt,
      });
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
      throwIfCodexDispatchCancelled(input.cancellationSignal);
      const turnResponse = await session.requestControl(
        "turn/start",
        {
          ...permissionModeParams.turn,
          ...(collaborationMode ? { collaborationMode } : {}),
          cwd: input.codexWorkdir,
          ...conversationPolicyParams,
          ...reasoningSummary,
          input: [
            {
              text: turnPrompt,
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
      session.emitProviderTurnAccepted({
        threadId: executionThreadId,
        turnId,
      });
      session.setNewSessionTitleInBackground({
        existingThreadId: input.threadId,
        executionMode: input.executionMode,
        threadId: executionThreadId,
        title: input.newSessionTitle,
      });
      const unregisterActiveTurn = session.registerActiveTurn({
        onActiveTurn: input.onActiveTurn,
        taskId: input.taskId,
        threadId: executionThreadId,
        turnId,
      });
      if (input.cancellationSignal?.aborted && turn.status !== "completed") {
        await session.request("turn/interrupt", {
          threadId: executionThreadId,
          turnId,
        });
      }
      let completedTurn: AppServerTurn;
      try {
        completedTurn =
          turn.status === "completed"
            ? turn
            : await session.waitForTurnCompleted({
                threadId: executionThreadId,
                turnId,
              });
      } finally {
        unregisterActiveTurn?.();
      }
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
        "thread/resume",
        {
          cwd: input.codexWorkdir,
          excludeTurns: true,
          threadId,
        },
        {
          code: "context.resume_timeout",
          operation: "thread/resume",
        }
      );
      return {
        threadId: readThreadIdFromResponse(response),
      };
    }
  );
}

export async function forkCodexAppServerThread(input: {
  codexTimeoutMs: number | null;
  codexWorkdir: string;
  env?: Record<string, string | undefined>;
  launchContract: RuntimeAgentControllerLaunchContract;
  sourceThreadId: string;
  title?: string;
}): Promise<{ threadId: string }> {
  const sourceThreadId = normalizeOptionalText(input.sourceThreadId);
  if (!sourceThreadId) {
    throw new CodexAppServerTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: sourceThreadId is required",
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
        "thread/fork",
        {
          excludeTurns: true,
          threadId: sourceThreadId,
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

async function resolveDispatchThreadContext(input: {
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
  if (existingThreadId) {
    if (input.executionMode === "repair") {
      return await forkEphemeralCodexRepairThread({
        conversationPolicyParams: input.conversationPolicyParams,
        codexWorkdir: input.codexWorkdir,
        permissionModeParams: input.permissionModeParams,
        session: input.session,
        sourceThreadId: existingThreadId,
      });
    }
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
          excludeTurns: true,
          threadId: existingThreadId,
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

  const response = await input.session.requestControl(
    "thread/start",
    {
      ...(input.conversationPolicyParams.model
        ? { model: input.conversationPolicyParams.model }
        : {}),
      ...input.permissionModeParams,
      cwd: input.codexWorkdir,
      ...(input.instructionPrompt
        ? {
            developerInstructions:
              input.instructionPrompt.developerInstructions,
            threadSource: buildOpenMeldCodexThreadSource(
              input.instructionPrompt.instructionEpoch
            ),
          }
        : { threadSource: "user" }),
    },
    {
      code: "runtime.thread_start_timeout",
      operation: "thread/start",
    }
  );
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
      ephemeral: true,
      excludeTurns: true,
      threadId: input.sourceThreadId,
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
  return input.threadSource === expectedThreadSource
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
  hasComputerFileAccessBoundary = false
): CodexAppServerPermissionModeParams {
  if (executionMode === "repair") {
    return {
      thread: {
        approvalPolicy: "untrusted",
        ...(hasComputerFileAccessBoundary ? {} : { sandbox: "read-only" }),
      },
      turn: {
        approvalPolicy: "untrusted",
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
          ...(hasComputerFileAccessBoundary
            ? {}
            : { sandbox: "workspace-write" }),
        },
        turn: {
          approvalPolicy: "on-request",
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
  readonly #codexTimeoutMs: number | null;
  readonly #codexWorkdir: string;
  readonly #controlRequestTimeoutMs?: number;
  readonly #computerFileAccessBoundary?: AdapterComputerFileAccessBoundary;
  readonly #env?: Record<string, string | undefined>;
  readonly #launchContract: RuntimeAgentControllerLaunchContract;
  readonly #executionMode?: AdapterDispatchExecutionMode;
  readonly #notifications: JsonRpcMessage[] = [];
  readonly #onInteractionRequest?: AdapterInteractionCallback;
  readonly #onProcessControlEvent?: AdapterRuntimeProcessCallback;
  readonly #onRuntimeEvent?: AdapterRuntimeEventCallback;
  readonly #permissionMode?: AgentControllerPermissionMode;
  readonly #pending = new Map<JsonRpcId, PendingJsonRpcRequest>();
  readonly #turnAgentMessageDeltas = new Map<string, string>();
  #child: ChildProcessWithoutNullStreams | null = null;
  #runtimeProcess: SpawnedAgentControllerProcess | null = null;
  #contextCompactionObserved = false;
  #forceKillTimeout: NodeJS.Timeout | null = null;
  #firstOutputAtMs: number | null = null;
  #interactionFailure: CodexAppServerInteractionFailure | null = null;
  #lineBuffer = "";
  #latestTokenUsage: AdapterDispatchTelemetry["tokenUsage"] | null = null;
  #nextRequestId = 1;
  #processTimeout: NodeJS.Timeout | null = null;
  readonly #startupTimeoutMs: number;
  #startupTimeout: NodeJS.Timeout | null = null;
  #settledFailure: unknown = null;
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
          executionMode: this.#executionMode,
          permissionMode: this.#permissionMode,
        })
      : [];
    const env = {
      ...process.env,
      ...(this.#env ?? {}),
    };
    const spaceActionMcpArgs = buildCodexSpaceActionMcpGlobalArgs(env);
    const launch = buildCodexAppServerLaunch({
      args: [
        ...computerFileAccessArgs,
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
    child.stderr.on("data", () => {
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
      runtimeProcess.terminateRemainingDescendants();
      this.#clearTimers();
      this.#lifecycle.exitCode = exitCode;
      this.#lifecycle.exitObservedAtMs = Date.now();
      this.#lifecycle.exitSignal = signal;
      this.#emitRuntimeEvent({
        exitCode,
        phase: "process_exit",
        processId,
        signal,
        signalTarget,
        tsMs: this.#lifecycle.exitObservedAtMs,
      });
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
            message: "upstream_unreachable: codex app-server exited early",
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
          message: `runtime.startup_timeout: codex app-server did not initialize within ${this.#startupTimeoutMs}ms`,
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
      return initialized;
    } finally {
      if (this.#startupTimeout !== null) {
        clearTimeout(this.#startupTimeout);
        this.#startupTimeout = null;
      }
    }
  }

  async close(): Promise<void> {
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
      return;
    }
    this.#requestProcessTermination();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, APP_SERVER_PROCESS_KILL_GRACE_MS);
      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
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
            message: `${timeout.code}: codex app-server did not acknowledge ${timeout.operation} within ${timeout.timeoutMs}ms`,
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
    timeout: Omit<JsonRpcRequestTimeout, "timeoutMs">
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
    onActiveTurn?: CodexAppServerActiveTurnRegistrar;
    taskId: string;
    threadId: string;
    turnId: string;
  }): (() => void) | null {
    if (!input.onActiveTurn) {
      return null;
    }
    return input.onActiveTurn({
      taskId: input.taskId,
      threadId: input.threadId,
      turnId: input.turnId,
      interrupt: async () => {
        await this.request("turn/interrupt", {
          threadId: input.threadId,
          turnId: input.turnId,
        });
      },
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
    if (message.method === "item/reasoning/summaryTextDelta") {
      const params = toRecord(message.params);
      if (typeof params?.delta === "string" && params.delta.length > 0) {
        this.#emitRuntimeEvent({
          phase: "reasoning",
          blockId: `${params.turnId}:${params.itemId}:${params.summaryIndex}`,
          text: params.delta,
          mode: "append",
          tsMs: Date.now(),
        });
      }
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

  #observeContextTelemetry(message: JsonRpcMessage): void {
    if (message.method === "thread/tokenUsage/updated") {
      const tokenUsage = readCodexTokenUsage(
        toRecord(message.params)?.tokenUsage
      );
      if (tokenUsage) {
        this.#latestTokenUsage = tokenUsage;
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

  async #handleServerRequest(message: JsonRpcMessage): Promise<void> {
    const id = message.id;
    if (!(typeof id === "number" || typeof id === "string")) {
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
          onInteractionRequest: this.#onInteractionRequest,
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
    model: normalizeOptionalText(response?.model),
    threadId: readRequiredText(
      response?.thread?.id,
      "thread response thread.id"
    ),
    threadSource: normalizeOptionalText(response?.thread?.threadSource),
  };
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

function toCodexAppServerTransportError(
  error: unknown,
  timeoutMs: number | null
): CodexAppServerTransportError {
  if (error instanceof CodexAppServerTransportError) {
    return error;
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
