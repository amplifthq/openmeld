import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  type Options as ClaudeAgentOptions,
  type Query as ClaudeAgentQuery,
  query as claudeQuery,
  type PermissionMode,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AdapterDispatchExecutionMode,
  AdapterDispatchFailure,
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterInstructionPrompt,
  AdapterInteractionCallback,
  AdapterPreviewCallback,
  AdapterRuntimeEventCallback,
  AdapterStreamingMode,
  AgentControllerPermissionMode,
  ConversationPolicy,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import {
  buildDispatchSpaceActionMcpToolIds,
  materializeCliLaunchCommand,
  resolveDispatchSpaceActionMcpServer,
} from "@openmeld/adapter-core";
import { createClaudeAgentSdkToolActivityTracker } from "../output/claude-tool-activity.js";
import { projectClaudeCodeUsageLimits } from "../usage/claude-code-usage-limits.js";
import {
  createClaudeCanUseTool,
  createClaudeOnElicitation,
} from "./claude-agent-interactions.js";
import { classifyClaudeFailure } from "./claude-cli-transport.js";
import { resolveClaudeConversationPolicyOptions } from "./claude-conversation-policy.js";
import {
  OPENMELD_CLAUDE_ALLOWED_TOOLS,
  resolveClaudePermissionMode,
} from "./claude-permission-policy.js";
import { createClaudePreviewEmitter } from "./claude-preview-emitter.js";

export type ClaudeAgentSdkTransportResult = {
  output: string;
  sessionId: string | null;
  telemetry: AdapterDispatchTelemetry;
};

export type ClaudeCodeTransportKind = "agent-sdk" | "cli";

export type ClaudeAgentSdkQueryFactory = (input: {
  options: ClaudeAgentOptions;
  prompt: AsyncIterable<SDKUserMessage>;
}) => ClaudeAgentQuery;

export type ClaudeAgentSdkActiveQuery = Pick<
  ClaudeAgentQuery,
  "close" | "interrupt" | "setPermissionMode"
>;

export type ClaudeAgentSdkQueryRegistration = (input: {
  permissionModeUpdatesAllowed: boolean;
  query: ClaudeAgentSdkActiveQuery;
  taskId: string;
}) => () => void;

type ClaudeAgentSdkProviderAccessEvidence = NonNullable<
  AdapterDispatchFailure["providerAccessEvidence"]
>;

export class ClaudeAgentSdkTransportError extends Error {
  readonly code: string;
  readonly errorType: AdapterErrorType;
  readonly originalError?: string;
  readonly providerAccessEvidence?: ClaudeAgentSdkProviderAccessEvidence;
  readonly telemetry?: AdapterDispatchTelemetry;

  constructor(input: {
    code: string;
    errorType: AdapterErrorType;
    message: string;
    originalError?: string;
    providerAccessEvidence?: ClaudeAgentSdkProviderAccessEvidence;
    telemetry?: AdapterDispatchTelemetry;
  }) {
    super(input.message);
    this.name = "ClaudeAgentSdkTransportError";
    this.code = input.code;
    this.errorType = input.errorType;
    if (input.originalError) {
      this.originalError = input.originalError;
    }
    if (input.providerAccessEvidence) {
      this.providerAccessEvidence = input.providerAccessEvidence;
    }
    if (input.telemetry) {
      this.telemetry = input.telemetry;
    }
  }
}

// resultMessage.is_error can be true even when subtype is "success": the SDK
// type (SDKResultSuccess) carries is_error precisely because some failures
// never reach a dedicated error subtype (e.g. an OAuth session that expired
// before the first turn).
function isFailedResultMessage(resultMessage: SDKResultMessage): boolean {
  return resultMessage.subtype !== "success" || resultMessage.is_error === true;
}

function resolveCanonicalRepairSessionId(input: {
  executionMode?: AdapterDispatchExecutionMode;
  sessionId: string | null;
}): string | null {
  if (input.executionMode !== "repair") {
    return null;
  }
  return normalizeOptionalText(input.sessionId);
}

async function observeClaudeReasoning(
  message: SDKMessage,
  messageId: string,
  onRuntimeEvent?: AdapterRuntimeEventCallback
): Promise<string> {
  if (message.type !== "stream_event") {
    return messageId;
  }
  const event = message.event;
  if (event.type === "message_start") {
    return event.message.id;
  }
  if (
    event.type === "content_block_delta" &&
    event.delta.type === "thinking_delta"
  ) {
    await onRuntimeEvent?.({
      phase: "reasoning",
      blockId: `${messageId}:${event.index}`,
      text: event.delta.thinking,
      mode: "append",
      tsMs: Date.now(),
    });
  }
  return messageId;
}

export async function invokeClaudeAgentSdkTransport(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  claudeTimeoutMs: number | null;
  claudeWorkdir: string;
  conversationPolicy?: ConversationPolicy;
  createQuery?: ClaudeAgentSdkQueryFactory;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  instructionPrompt?: AdapterInstructionPrompt;
  onInteractionRequest?: AdapterInteractionCallback;
  onPreview?: AdapterPreviewCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  registerQuery?: ClaudeAgentSdkQueryRegistration;
  sessionId: string | null;
  streamingMode?: AdapterStreamingMode;
  taskId?: string;
}): Promise<ClaudeAgentSdkTransportResult> {
  const prompt = normalizeOptionalText(input.prompt);
  if (!prompt) {
    throw new ClaudeAgentSdkTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: prompt is required",
    });
  }
  const resumedContext = normalizeOptionalText(input.sessionId) !== null;
  const canonicalRepairSessionId = resolveCanonicalRepairSessionId(input);
  const streamingMode = input.streamingMode ?? "final";

  const resources = await createClaudeAgentSdkInvocationResources({
    launchContract: input.launchContract,
    needsPlanCapture: input.onInteractionRequest !== undefined,
  });
  const abortController = new AbortController();
  const invokedAtMs = Date.now();
  const previewEmitter = createClaudePreviewEmitter({
    onPreview: input.onPreview,
    streamingMode: input.streamingMode,
  });
  const providerErrorMessages: string[] = [];
  const stderrChunks: string[] = [];
  let firstOutputAtMs: number | null = null;
  let firstStderrAtMs: number | null = null;
  let latestInteractionOutput = "";
  let latestOutput = "";
  let latestPlanDocument = "";
  let resultMessage: SDKResultMessage | null = null;
  let resolvedSessionId = normalizeOptionalText(input.sessionId);
  let timeoutTriggeredAtMs: number | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let queryRuntime: ClaudeAgentQuery | null = null;
  let unregisterQuery: (() => void) | undefined;
  const toolActivityTracker = createClaudeAgentSdkToolActivityTracker();

  if (input.claudeTimeoutMs !== null) {
    timeoutHandle = setTimeout(() => {
      timeoutTriggeredAtMs = Date.now();
      abortController.abort();
    }, input.claudeTimeoutMs);
  }

  try {
    const createQuery = input.createQuery ?? createDefaultClaudeAgentSdkQuery;
    queryRuntime = createQuery({
      options: buildClaudeAgentSdkOptions({
        onRuntimeEvent: input.onRuntimeEvent,
        abortController,
        agentControllerPermissionMode: input.agentControllerPermissionMode,
        claudeWorkdir: input.claudeWorkdir,
        conversationPolicy: input.conversationPolicy,
        env: input.env,
        executionMode: input.executionMode,
        instructionPrompt: input.instructionPrompt,
        getPlanReviewText: async () =>
          latestPlanDocument ||
          (await resources.planCapture.readLatestDocument()) ||
          latestInteractionOutput ||
          latestOutput,
        onInteractionRequest: input.onInteractionRequest,
        onStderr: (chunk) => {
          firstStderrAtMs = resolveFirstObservedAtMs(firstStderrAtMs);
          stderrChunks.push(chunk);
        },
        pathToClaudeCodeExecutable:
          resources.executable.pathToClaudeCodeExecutable,
        planDirectory: resources.planCapture.directory,
        sessionId: normalizeOptionalText(input.sessionId),
        streamingMode: input.streamingMode,
      }),
      prompt: createSinglePrompt(input.instructionPrompt?.userPrompt ?? prompt),
    });

    if (input.taskId) {
      unregisterQuery = input.registerQuery?.({
        permissionModeUpdatesAllowed: input.executionMode !== "repair",
        query: queryRuntime,
        taskId: input.taskId,
      });
    }

    let reasoningMessageId = "";
    for await (const message of queryRuntime) {
      reasoningMessageId = await observeClaudeReasoning(
        message,
        reasoningMessageId,
        input.onRuntimeEvent
      );
      await emitClaudeCodeUsageLimits({
        message,
        onRuntimeEvent: input.onRuntimeEvent,
      });
      await emitClaudeAgentSdkToolActivity({
        message,
        onRuntimeEvent: input.onRuntimeEvent,
        toolActivityTracker,
      });
      const nextState = handleClaudeAgentSdkMessage({
        firstOutputAtMs,
        latestInteractionOutput,
        latestOutput,
        latestPlanDocument,
        message,
        previewEmitter,
        providerErrorMessages,
        resolvedSessionId,
        resultMessage,
      });
      firstOutputAtMs = nextState.firstOutputAtMs;
      latestInteractionOutput = nextState.latestInteractionOutput;
      latestOutput = nextState.latestOutput;
      latestPlanDocument = nextState.latestPlanDocument;
      resultMessage = nextState.resultMessage;
      resolvedSessionId = nextState.resolvedSessionId;
      await emitClaudeProviderConversationObservation({
        canonicalRepairSessionId,
        observedConversationId: nextState.observedConversationId,
        onRuntimeEvent: input.onRuntimeEvent,
      });
    }
  } catch (error) {
    throw toClaudeAgentSdkTransportError({
      error,
      firstOutputAtMs,
      firstStderrAtMs,
      invokedAtMs,
      previewEmitted: previewEmitter.emitted,
      providerErrorMessages,
      resumedContext,
      stderrText: stderrChunks.join(""),
      streamingMode,
      timeoutMs: input.claudeTimeoutMs,
      timeoutTriggeredAtMs,
    });
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    unregisterQuery?.();
    queryRuntime?.close();
    await resources.cleanup();
  }

  await previewEmitter.flush();

  if (!resultMessage) {
    const telemetry = buildClaudeAgentSdkTelemetry({
      firstOutputAtMs,
      firstStderrAtMs,
      invokedAtMs,
      previewEmitted: previewEmitter.emitted,
      resumedContext,
      streamingMode,
      timeoutTriggeredAtMs,
    });
    const classifiedFailure = classifyClaudeFailure({
      providerErrorMessages,
      providerOriginalErrorMessages: providerErrorMessages,
      stderrText: stderrChunks.join(""),
    });
    throw new ClaudeAgentSdkTransportError({
      code: classifiedFailure.code,
      errorType: classifiedFailure.errorType,
      message: classifiedFailure.message,
      ...projectClaudeOriginalError(classifiedFailure),
      ...(classifiedFailure.providerAccessEvidence
        ? { providerAccessEvidence: classifiedFailure.providerAccessEvidence }
        : {}),
      telemetry,
    });
  }

  // providerErrorMessages already has every candidate message
  // handleClaudeAgentSdkMessage collected (assistant.error,
  // result.result-when-is_error, result.errors), so classification only
  // needs that shared array here.
  if (isFailedResultMessage(resultMessage)) {
    const telemetry = buildClaudeAgentSdkTelemetry({
      firstOutputAtMs,
      firstStderrAtMs,
      invokedAtMs,
      previewEmitted: previewEmitter.emitted,
      resumedContext,
      streamingMode,
      timeoutTriggeredAtMs,
    });
    const classifiedFailure = classifyClaudeFailure({
      providerErrorMessages,
      providerOriginalErrorMessages: providerErrorMessages,
      stderrText: stderrChunks.join(""),
    });
    throw new ClaudeAgentSdkTransportError({
      code: classifiedFailure.code,
      errorType: classifiedFailure.errorType,
      message: classifiedFailure.message,
      ...projectClaudeOriginalError(classifiedFailure),
      ...(classifiedFailure.providerAccessEvidence
        ? { providerAccessEvidence: classifiedFailure.providerAccessEvidence }
        : {}),
      telemetry,
    });
  }

  const output = normalizeOptionalText(latestOutput);
  if (!output) {
    throw new ClaudeAgentSdkTransportError({
      code: "runtime.output.empty",
      errorType: "adapter",
      message: "runtime.output.empty: claude finished without agent output",
      telemetry: buildClaudeAgentSdkTelemetry({
        firstOutputAtMs,
        firstStderrAtMs,
        invokedAtMs,
        previewEmitted: previewEmitter.emitted,
        resumedContext,
        streamingMode,
        timeoutTriggeredAtMs,
      }),
    });
  }

  return {
    output,
    sessionId:
      canonicalRepairSessionId ?? normalizeOptionalText(resolvedSessionId),
    telemetry: buildClaudeAgentSdkTelemetry({
      firstOutputAtMs,
      firstStderrAtMs,
      invokedAtMs,
      previewEmitted: previewEmitter.emitted,
      resumedContext,
      streamingMode,
      timeoutTriggeredAtMs,
    }),
  };
}

async function emitClaudeProviderConversationObservation(input: {
  canonicalRepairSessionId: string | null;
  observedConversationId: string | null;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
}): Promise<void> {
  if (!input.observedConversationId || input.canonicalRepairSessionId) {
    return;
  }
  await input.onRuntimeEvent?.({
    agentControllerConversationId: input.observedConversationId,
    phase: "provider_conversation_observed",
    tsMs: Date.now(),
  });
}

async function emitClaudeCodeUsageLimits(input: {
  message: SDKMessage;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
}): Promise<void> {
  const observedAtMs = Date.now();
  const usageLimits = projectClaudeCodeUsageLimits({
    event: input.message,
    observedAt: new Date(observedAtMs).toISOString(),
  });
  if (usageLimits.length === 0) {
    return;
  }
  await input.onRuntimeEvent?.({
    phase: "provider_usage_limits_observed",
    tsMs: observedAtMs,
    usageLimits,
  });
}

function buildClaudeAgentSdkTelemetry(input: {
  firstOutputAtMs: number | null;
  firstStderrAtMs: number | null;
  invokedAtMs: number;
  previewEmitted: boolean;
  resumedContext: boolean;
  streamingMode: AdapterStreamingMode;
  timeoutTriggeredAtMs: number | null;
}): AdapterDispatchTelemetry {
  return {
    completedAtMs: Date.now(),
    ...(input.firstOutputAtMs === null
      ? {}
      : { firstOutputAtMs: input.firstOutputAtMs }),
    ...(input.firstStderrAtMs === null
      ? {}
      : { firstStderrAtMs: input.firstStderrAtMs }),
    invokedAtMs: input.invokedAtMs,
    previewEmitted: input.previewEmitted,
    resumedContext: input.resumedContext,
    streamingMode: input.streamingMode,
    ...(input.timeoutTriggeredAtMs === null
      ? {}
      : { timeoutTriggeredAtMs: input.timeoutTriggeredAtMs }),
  };
}

function resolveFirstObservedAtMs(current: number | null): number {
  return current ?? Date.now();
}

type ClaudePlanCapture = {
  cleanup: () => Promise<void>;
  directory: string | null;
  readLatestDocument: () => Promise<string | null>;
};

async function createClaudeAgentSdkInvocationResources(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  needsPlanCapture: boolean;
}): Promise<{
  cleanup: () => Promise<void>;
  executable: Awaited<ReturnType<typeof resolveClaudeAgentSdkExecutable>>;
  planCapture: ClaudePlanCapture;
}> {
  const executable = await resolveClaudeAgentSdkExecutable({
    launchContract: input.launchContract,
  });
  let planCapture: ClaudePlanCapture;
  try {
    planCapture = await createClaudePlanCapture(input.needsPlanCapture);
  } catch (error) {
    await executable.cleanup();
    throw error;
  }
  return {
    cleanup: async () => {
      try {
        await executable.cleanup();
      } finally {
        await planCapture.cleanup();
      }
    },
    executable,
    planCapture,
  };
}

async function createClaudePlanCapture(
  enabled: boolean
): Promise<ClaudePlanCapture> {
  if (!enabled) {
    return {
      cleanup: async () => undefined,
      directory: null,
      readLatestDocument: async () => null,
    };
  }
  const directory = await mkdtemp(join(tmpdir(), "openmeld-claude-plan-"));
  return {
    cleanup: async () => {
      await rm(directory, { force: true, recursive: true });
    },
    directory,
    readLatestDocument: () => readLatestClaudePlanDocument(directory),
  };
}

export async function resolveClaudeAgentSdkExecutable(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
}): Promise<{
  cleanup: () => Promise<void>;
  pathToClaudeCodeExecutable: string;
}> {
  const launchCommand = materializeCliLaunchCommand({
    launchContract: input.launchContract,
  });
  if (launchCommand.argsPrefix.length === 0 && launchCommand.shell !== true) {
    return {
      cleanup: async () => undefined,
      pathToClaudeCodeExecutable: launchCommand.bin,
    };
  }

  const wrapperDir = await mkdtemp(join(tmpdir(), "openmeld-claude-sdk-"));
  const wrapperPath =
    process.platform === "win32"
      ? join(wrapperDir, "claude-code-wrapper.cmd")
      : join(wrapperDir, "claude-code-wrapper");
  await writeFile(
    wrapperPath,
    process.platform === "win32"
      ? buildWindowsWrapperScript({
          argsPrefix: launchCommand.argsPrefix,
          bin: launchCommand.bin,
        })
      : buildPosixWrapperScript({
          argsPrefix: launchCommand.argsPrefix,
          bin: launchCommand.bin,
        }),
    "utf8"
  );
  if (process.platform !== "win32") {
    await chmod(wrapperPath, 0o755);
  }

  return {
    cleanup: async () => {
      await rm(wrapperDir, { force: true, recursive: true });
    },
    pathToClaudeCodeExecutable: wrapperPath,
  };
}

function buildClaudeAgentSdkOptions(input: {
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  abortController: AbortController;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  claudeWorkdir: string;
  conversationPolicy?: ConversationPolicy;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  instructionPrompt?: AdapterInstructionPrompt;
  getPlanReviewText: () => Promise<string> | string;
  onInteractionRequest?: AdapterInteractionCallback;
  onStderr: (chunk: string) => void;
  pathToClaudeCodeExecutable: string;
  planDirectory: string | null;
  sessionId: string | null;
  streamingMode?: AdapterStreamingMode;
}): ClaudeAgentOptions {
  const spaceActionMcpServer = resolveDispatchSpaceActionMcpServer(input.env);
  const permissionMode = resolveClaudePermissionMode({
    agentControllerPermissionMode: input.agentControllerPermissionMode,
    executionMode: input.executionMode,
  }) as PermissionMode;
  const options: ClaudeAgentOptions = {
    abortController: input.abortController,
    additionalDirectories: [input.claudeWorkdir],
    allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
    allowedTools: [
      ...OPENMELD_CLAUDE_ALLOWED_TOOLS,
      ...(spaceActionMcpServer
        ? buildDispatchSpaceActionMcpToolIds("__").map(
            (toolId) => `mcp__${toolId}`
          )
        : []),
    ],
    cwd: input.claudeWorkdir,
    env: {
      ...process.env,
      ...(input.env ?? {}),
    },
    includePartialMessages:
      input.onRuntimeEvent !== undefined ||
      input.streamingMode === "stream" ||
      input.onInteractionRequest !== undefined,
    pathToClaudeCodeExecutable: input.pathToClaudeCodeExecutable,
    ...(spaceActionMcpServer
      ? {
          mcpServers: {
            [spaceActionMcpServer.id]: {
              args: [...spaceActionMcpServer.args],
              command: spaceActionMcpServer.commandPath,
              env: spaceActionMcpServer.env,
            },
          },
        }
      : {}),
    permissionMode,
    ...(input.planDirectory
      ? {
          settings: {
            plansDirectory: relative(input.claudeWorkdir, input.planDirectory),
          },
        }
      : {}),
    settingSources: ["user", "project", "local"],
    stderr: input.onStderr,
    systemPrompt: input.instructionPrompt
      ? {
          append: input.instructionPrompt.developerInstructions,
          excludeDynamicSections: true,
          preset: "claude_code",
          type: "preset",
        }
      : {
          preset: "claude_code",
          type: "preset",
        },
    ...(input.onInteractionRequest
      ? {
          canUseTool: createClaudeCanUseTool({
            getPlanReviewText: input.getPlanReviewText,
            onInteractionRequest: input.onInteractionRequest,
          }),
          onElicitation: createClaudeOnElicitation({
            onInteractionRequest: input.onInteractionRequest,
          }),
        }
      : {}),
  };

  const sessionId = normalizeOptionalText(input.sessionId);
  if (sessionId) {
    options.resume = sessionId;
    if (input.executionMode === "repair") {
      options.forkSession = true;
    }
  }

  const conversationPolicyOptions = resolveClaudeConversationPolicyOptions(
    input.conversationPolicy
  );
  const model = conversationPolicyOptions.model;
  if (model) {
    options.model = model;
  }

  const fallbackModel = conversationPolicyOptions.fallbackModel;
  if (fallbackModel) {
    options.fallbackModel = fallbackModel;
  }

  const effort = conversationPolicyOptions.reasoningLevel;
  if (effort) {
    options.effort = effort as ClaudeAgentOptions["effort"];
  }

  return options;
}

async function readLatestClaudePlanDocument(
  planDirectory: string
): Promise<string | null> {
  const entries = await readdir(planDirectory, { withFileTypes: true });
  const planFiles = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map(async (entry) => {
        const path = join(planDirectory, entry.name);
        return {
          mtimeMs: (await stat(path)).mtimeMs,
          path,
        };
      })
  );
  planFiles.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const latestPlanFile = planFiles[0];
  if (!latestPlanFile) {
    return null;
  }
  const content = await readFile(latestPlanFile.path, "utf8");
  return normalizeOptionalText(content.slice(0, 64_000));
}

function createDefaultClaudeAgentSdkQuery(input: {
  options: ClaudeAgentOptions;
  prompt: AsyncIterable<SDKUserMessage>;
}): ClaudeAgentQuery {
  return claudeQuery(input);
}

async function* createSinglePrompt(
  prompt: string
): AsyncGenerator<SDKUserMessage> {
  await Promise.resolve();
  yield {
    message: {
      content: prompt,
      role: "user",
    },
    parent_tool_use_id: null,
    type: "user",
  };
}

function handleClaudeAgentSdkMessage(input: {
  firstOutputAtMs: number | null;
  latestInteractionOutput: string;
  latestOutput: string;
  latestPlanDocument: string;
  message: SDKMessage;
  previewEmitter: ReturnType<typeof createClaudePreviewEmitter>;
  providerErrorMessages: string[];
  resolvedSessionId: string | null;
  resultMessage: SDKResultMessage | null;
}): {
  firstOutputAtMs: number | null;
  latestInteractionOutput: string;
  latestOutput: string;
  latestPlanDocument: string;
  observedConversationId: string | null;
  resolvedSessionId: string | null;
  resultMessage: SDKResultMessage | null;
} {
  let firstOutputAtMs = input.firstOutputAtMs;
  let latestInteractionOutput = input.latestInteractionOutput;
  let latestOutput = input.latestOutput;
  let latestPlanDocument = input.latestPlanDocument;
  let observedConversationId: string | null = null;
  let resolvedSessionId = input.resolvedSessionId;
  let resultMessage = input.resultMessage;

  const sessionId = normalizeOptionalText(
    (input.message as { session_id?: unknown }).session_id
  );
  if (sessionId) {
    observedConversationId = sessionId;
  }

  const previewDeltaText = extractPreviewDeltaText(input.message);
  if (previewDeltaText) {
    latestInteractionOutput += previewDeltaText;
    const nextPreviewText = input.previewEmitter.append(previewDeltaText);
    if (nextPreviewText && firstOutputAtMs === null) {
      firstOutputAtMs = Date.now();
    }
  }

  const assistantInteractionState = resolveAssistantInteractionState({
    firstOutputAtMs,
    latestInteractionOutput,
    latestPlanDocument,
    message: input.message,
  });
  firstOutputAtMs = assistantInteractionState.firstOutputAtMs;
  latestInteractionOutput = assistantInteractionState.latestInteractionOutput;
  latestPlanDocument = assistantInteractionState.latestPlanDocument;

  if (input.message.type === "assistant" && input.message.error) {
    input.providerErrorMessages.push(input.message.error);
  }

  if (input.message.type === "result") {
    resultMessage = input.message;
    if (sessionId) {
      resolvedSessionId = sessionId;
    }
    if (input.message.subtype === "success" && !input.message.is_error) {
      latestOutput = input.message.result;
      if (firstOutputAtMs === null) {
        firstOutputAtMs = Date.now();
      }
    } else if (input.message.subtype === "success") {
      // SDKResultSuccess still carries is_error: some failures (e.g. an
      // OAuth session that expired before the first turn) are reported as
      // a "success" envelope whose `result` text is the actual error, not
      // agent output. Route that text into classification instead of
      // returning it to the user as a normal reply.
      input.providerErrorMessages.push(input.message.result);
    } else {
      input.providerErrorMessages.push(...input.message.errors);
    }
  }

  return {
    firstOutputAtMs,
    latestInteractionOutput,
    latestOutput,
    latestPlanDocument,
    observedConversationId,
    resolvedSessionId,
    resultMessage,
  };
}

function resolveAssistantInteractionState(input: {
  firstOutputAtMs: number | null;
  latestInteractionOutput: string;
  latestPlanDocument: string;
  message: SDKMessage;
}): {
  firstOutputAtMs: number | null;
  latestInteractionOutput: string;
  latestPlanDocument: string;
} {
  const assistantText = extractAssistantMessageText(input.message);
  const writtenPlan = extractAssistantMessageWrittenPlan(input.message);
  if (!(assistantText || writtenPlan)) {
    return input;
  }
  return {
    firstOutputAtMs: input.firstOutputAtMs ?? Date.now(),
    latestInteractionOutput: assistantText ?? input.latestInteractionOutput,
    latestPlanDocument: writtenPlan ?? input.latestPlanDocument,
  };
}

function extractAssistantMessageWrittenPlan(
  message: SDKMessage
): string | null {
  if (message.type !== "assistant") {
    return null;
  }
  let writtenPlan: string | null = null;
  for (const block of message.message.content) {
    if (block.type !== "tool_use" || block.name !== "Write") {
      continue;
    }
    const toolInput = block.input;
    if (
      !toolInput ||
      typeof toolInput !== "object" ||
      Array.isArray(toolInput)
    ) {
      continue;
    }
    const content = normalizeOptionalText(
      (toolInput as Record<string, unknown>).content
    );
    if (content) {
      writtenPlan = content.slice(0, 64_000);
    }
  }
  return writtenPlan;
}

function extractAssistantMessageText(message: SDKMessage): string | null {
  if (message.type !== "assistant") {
    return null;
  }
  const text = message.message.content
    .filter(
      (
        block
      ): block is Extract<
        (typeof message.message.content)[number],
        { type: "text" }
      > => block.type === "text"
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text || null;
}

async function emitClaudeAgentSdkToolActivity(input: {
  message: SDKMessage;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  toolActivityTracker: ReturnType<
    typeof createClaudeAgentSdkToolActivityTracker
  >;
}): Promise<void> {
  for (const event of input.toolActivityTracker.observe(input.message)) {
    await input.onRuntimeEvent?.(event);
  }
}

function extractPreviewDeltaText(message: SDKMessage): string | null {
  if (message.type !== "stream_event") {
    return null;
  }

  const event = message.event as {
    delta?: {
      text?: unknown;
      type?: unknown;
    };
    type?: unknown;
  };
  if (
    event.type === "content_block_delta" &&
    event.delta?.type === "text_delta" &&
    typeof event.delta.text === "string"
  ) {
    return event.delta.text;
  }
  return null;
}

function toClaudeAgentSdkTransportError(input: {
  error: unknown;
  firstOutputAtMs: number | null;
  firstStderrAtMs: number | null;
  invokedAtMs: number;
  previewEmitted: boolean;
  providerErrorMessages: string[];
  resumedContext: boolean;
  stderrText: string;
  streamingMode: AdapterStreamingMode;
  timeoutMs: number | null;
  timeoutTriggeredAtMs: number | null;
}): ClaudeAgentSdkTransportError {
  if (input.error instanceof ClaudeAgentSdkTransportError) {
    return input.error;
  }

  if (input.timeoutTriggeredAtMs !== null) {
    const code =
      input.firstOutputAtMs === null
        ? "timed_out_before_output"
        : "timed_out_after_output";
    return new ClaudeAgentSdkTransportError({
      code,
      errorType: "timeout",
      message: `${code}: claude timed out after ${input.timeoutMs ?? 0}ms`,
      telemetry: buildClaudeAgentSdkTelemetry({
        firstOutputAtMs: input.firstOutputAtMs,
        firstStderrAtMs: input.firstStderrAtMs,
        invokedAtMs: input.invokedAtMs,
        previewEmitted: input.previewEmitted,
        resumedContext: input.resumedContext,
        streamingMode: input.streamingMode,
        timeoutTriggeredAtMs: input.timeoutTriggeredAtMs,
      }),
    });
  }

  const fallbackMessage =
    input.error instanceof Error ? input.error.message : String(input.error);
  const classifiedFailure = classifyClaudeFailure({
    providerErrorMessages: input.providerErrorMessages,
    providerOriginalErrorMessages: input.providerErrorMessages,
    stderrText: [fallbackMessage, input.stderrText]
      .map(normalizeOptionalText)
      .filter((value): value is string => value !== null)
      .join("\n"),
  });
  return new ClaudeAgentSdkTransportError({
    code: classifiedFailure.code,
    errorType: classifiedFailure.errorType,
    message: classifiedFailure.message,
    ...projectClaudeOriginalError(classifiedFailure),
    ...(classifiedFailure.providerAccessEvidence
      ? { providerAccessEvidence: classifiedFailure.providerAccessEvidence }
      : {}),
    telemetry: buildClaudeAgentSdkTelemetry({
      firstOutputAtMs: input.firstOutputAtMs,
      firstStderrAtMs: input.firstStderrAtMs,
      invokedAtMs: input.invokedAtMs,
      previewEmitted: input.previewEmitted,
      resumedContext: input.resumedContext,
      streamingMode: input.streamingMode,
      timeoutTriggeredAtMs: input.timeoutTriggeredAtMs,
    }),
  });
}

function projectClaudeOriginalError(input: { originalError?: string }): {
  originalError?: string;
} {
  return input.originalError ? { originalError: input.originalError } : {};
}

function buildPosixWrapperScript(input: {
  argsPrefix: readonly string[];
  bin: string;
}): string {
  const command = [
    shellQuote(input.bin),
    ...input.argsPrefix.map(shellQuote),
    '"$@"',
  ].join(" ");
  return ["#!/bin/sh", `exec ${command}`, ""].join("\n");
}

function buildWindowsWrapperScript(input: {
  argsPrefix: readonly string[];
  bin: string;
}): string {
  const command = [
    quoteWindowsArg(input.bin),
    ...input.argsPrefix.map(quoteWindowsArg),
    "%*",
  ].join(" ");
  return ["@echo off", command, ""].join("\r\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quoteWindowsArg(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
