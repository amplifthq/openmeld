import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
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
  AdapterDispatchSpaceTools,
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterInstructionPrompt,
  AdapterInteractionCallback,
  AdapterPreviewCallback,
  AdapterRuntimeEventCallback,
  AdapterRuntimeProcessCallback,
  AdapterStreamingMode,
  AgentControllerPermissionMode,
  ConversationPolicy,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import {
  materializeCliLaunchCommand,
  readAdapterAiUsageObservation,
} from "@openmeld/adapter-core";
import { resolvePlatformCommand } from "@openmeld/adapter-core/process-launch";
import { createClaudeAgentSdkToolActivityTracker } from "../output/claude-tool-activity.js";
import { projectClaudeCodeUsageLimits } from "../usage/claude-code-usage-limits.js";
import {
  createClaudeCanUseTool,
  createClaudeOnElicitation,
} from "./claude-agent-interactions.js";
import { classifyClaudeFailure } from "./claude-cli-transport.js";
import { resolveClaudeConversationPolicyOptions } from "./claude-conversation-policy.js";
import { createClaudeLiveInput } from "./claude-live-input.js";
import { resolveClaudePermissionMode } from "./claude-permission-policy.js";
import { createClaudePreviewEmitter } from "./claude-preview-emitter.js";
import { createClaudeSdkProcessLauncher } from "./claude-sdk-process.js";
import {
  buildClaudeSpaceToolOptions,
  createClaudeDispatchConnectionObserver,
  isClaudeDeliveryOnly,
  verifyClaudeDeliveryReport,
} from "./claude-space-action-tools.js";

function claudeDeliveryPolicyError(
  code: "claude_delivery_policy.invalid" | "claude_delivery_policy.unavailable",
  cause?: unknown
): ClaudeAgentSdkTransportError {
  return new ClaudeAgentSdkTransportError({
    code,
    errorType: "config",
    message: code,
    ...(cause instanceof Error ? { originalError: cause.message } : {}),
  });
}

function claudeDeliverySettingPaths(input: {
  cwd: string;
  env?: Record<string, string | undefined>;
}): string[] {
  const environment = { ...process.env, ...input.env };
  const configRoot =
    environment.CLAUDE_CONFIG_DIR ||
    join(environment.HOME || environment.USERPROFILE || homedir(), ".claude");
  if (!(isAbsolute(input.cwd) && isAbsolute(configRoot))) {
    throw claudeDeliveryPolicyError("claude_delivery_policy.invalid");
  }
  // Claude's project/local sources are scoped to cwd, not every ancestor.
  return [
    join(configRoot, "settings.json"),
    join(input.cwd, ".claude", "settings.json"),
    join(input.cwd, ".claude", "settings.local.json"),
  ];
}

function restrictiveClaudeRuleList(
  permissions: Record<string, unknown>,
  key: "deny" | "ask"
): string[] {
  const values = permissions[key];
  if (values === undefined) {
    return [];
  }
  if (
    !(
      Array.isArray(values) &&
      values.every((value) => typeof value === "string")
    )
  ) {
    throw claudeDeliveryPolicyError("claude_delivery_policy.invalid");
  }
  return values;
}

async function readClaudeDeliverySettingRules(
  path: string
): Promise<{ deny: string[]; ask: string[] } | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw claudeDeliveryPolicyError(
      "claude_delivery_policy.unavailable",
      error
    );
  }
  let settings: unknown;
  try {
    settings = JSON.parse(raw);
  } catch (error) {
    throw claudeDeliveryPolicyError("claude_delivery_policy.invalid", error);
  }
  if (!settings || typeof settings !== "object") {
    throw claudeDeliveryPolicyError("claude_delivery_policy.invalid");
  }
  const permissions = (settings as { permissions?: unknown }).permissions;
  if (permissions === undefined) {
    return { deny: [], ask: [] };
  }
  if (!permissions || typeof permissions !== "object") {
    throw claudeDeliveryPolicyError("claude_delivery_policy.invalid");
  }
  return {
    deny: restrictiveClaudeRuleList(
      permissions as Record<string, unknown>,
      "deny"
    ),
    ask: restrictiveClaudeRuleList(
      permissions as Record<string, unknown>,
      "ask"
    ),
  };
}

async function resolveClaudeDeliveryPermissions(input: {
  cwd: string;
  env?: Record<string, string | undefined>;
}): Promise<{ deny: string[]; ask: string[] }> {
  const deny = new Set<string>();
  const ask = new Set<string>();
  // Only restrictive rules cross into correction. Unreadable or malformed
  // settings stop correction rather than silently dropping a native denial.
  for (const path of claudeDeliverySettingPaths(input)) {
    const rules = await readClaudeDeliverySettingRules(path);
    if (!rules) {
      continue;
    }
    for (const value of rules.deny) {
      deny.add(value);
    }
    for (const value of rules.ask) {
      ask.add(value);
    }
  }
  return {
    deny: [...deny],
    ask: [...ask],
  };
}

async function applyClaudeDeliveryPermissions(input: {
  cwd: string;
  env?: Record<string, string | undefined>;
  options: ClaudeAgentOptions;
  spaceActionTools?: AdapterDispatchSpaceTools;
}): Promise<void> {
  if (!isClaudeDeliveryOnly(input)) {
    return;
  }
  input.options.settings = {
    disableAllHooks: true,
    permissions: await resolveClaudeDeliveryPermissions({
      cwd: input.cwd,
      env: input.env,
    }),
  };
}

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
  liveInput?: ReturnType<typeof createClaudeLiveInput>;
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
  spaceActionTools?: AdapterDispatchSpaceTools;
  executionContext?: import("@openmeld/adapter-core").AdapterDispatchRequest["executionContext"];
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
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
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
    onProcessControlEvent: input.onProcessControlEvent,
    needsPlanCapture: input.onInteractionRequest !== undefined,
  });
  const abortController = new AbortController();
  const invokedAtMs = Date.now();
  const previewEmitter = createClaudePreviewEmitter({
    onPreview: input.onPreview,
    streamingMode: input.streamingMode,
  });
  const providerErrorMessages: string[] = [];
  const aiUsage = new Map<
    string,
    NonNullable<AdapterDispatchTelemetry["aiUsage"]>[number]
  >();
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
  let liveInput: ReturnType<typeof createClaudeLiveInput> | undefined;
  const toolActivityTracker = createClaudeAgentSdkToolActivityTracker();

  if (input.claudeTimeoutMs !== null) {
    timeoutHandle = setTimeout(() => {
      timeoutTriggeredAtMs = Date.now();
      abortController.abort();
    }, input.claudeTimeoutMs);
  }

  try {
    const createQuery = input.createQuery ?? createDefaultClaudeAgentSdkQuery;
    const options = buildClaudeAgentSdkOptions({
      spaceActionTools: input.spaceActionTools,
      executionContext: input.executionContext,
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
      spawnProcess: resources.executable.spawnProcess,
      planDirectory: resources.planCapture.directory,
      sessionId: normalizeOptionalText(input.sessionId),
      streamingMode: input.streamingMode,
    });
    await applyClaudeDeliveryPermissions({
      cwd: input.claudeWorkdir,
      env: input.env,
      options,
      spaceActionTools: input.spaceActionTools,
    });
    const userPrompt = [
      input.instructionPrompt?.userPrompt ?? prompt,
      ...(input.spaceActionTools?.deliveryOnly
        ? [
            "Use only the supplied delivery tools. Do not repeat the user's work or change permission mode. After the final tool call, return the required small delivery report: recorded is true only after verifying a proposal_saved_locally receipt. This report is not a public reply and never authorizes publication.",
          ]
        : []),
    ].join("\n\n");
    liveInput = createInvocationLiveInput(input, userPrompt, options);
    queryRuntime = createQuery({
      options,
      prompt: liveInput?.prompt() ?? createSinglePrompt(userPrompt),
    });

    if (input.taskId) {
      unregisterQuery = input.registerQuery?.({
        liveInput,
        permissionModeUpdatesAllowed: input.executionMode !== "repair",
        query: queryRuntime,
        taskId: input.taskId,
      });
    }

    let reasoningMessageId = "";
    const observeConnection = createClaudeDispatchConnectionObserver(
      input.spaceActionTools
    );
    for await (const message of queryRuntime) {
      liveInput?.observe(message);
      await observeConnection(message, queryRuntime);
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
      observeClaudeAiUsage(aiUsage, message);
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
      aiUsage: [...aiUsage.values()],
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
    liveInput?.close();
    queryRuntime?.close();
    await resources.cleanup();
  }

  await previewEmitter.flush();

  if (!resultMessage) {
    const telemetry = buildClaudeAgentSdkTelemetry({
      aiUsage: [...aiUsage.values()],
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
      aiUsage: [...aiUsage.values()],
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

  const output = await resolveClaudeFinalOutput({
    tools: input.spaceActionTools,
    result: resultMessage,
    privateOutput: latestOutput,
  });
  if (!output) {
    throw new ClaudeAgentSdkTransportError({
      code: "runtime.output.empty",
      errorType: "adapter",
      message: "runtime.output.empty: claude finished without agent output",
      telemetry: buildClaudeAgentSdkTelemetry({
        aiUsage: [...aiUsage.values()],
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
      aiUsage: [...aiUsage.values()],
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

async function resolveClaudeFinalOutput(input: {
  tools?: AdapterDispatchSpaceTools;
  result: SDKResultMessage;
  privateOutput: string;
}): Promise<string | null> {
  if (!input.tools?.deliveryOnly) {
    return normalizeOptionalText(input.privateOutput);
  }
  return await verifyClaudeDeliveryReport(
    input.tools,
    input.result.subtype === "success"
      ? input.result.structured_output
      : undefined
  );
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

function observeClaudeAiUsage(
  observations: Map<
    string,
    NonNullable<AdapterDispatchTelemetry["aiUsage"]>[number]
  >,
  message: SDKMessage
): void {
  if (message.type !== "assistant" || !message.message.usage) {
    return;
  }
  const native = message.message;
  const usage = native.usage;
  const eventId = `claude:${message.session_id}:${native.id}`;
  // Repeated message IDs are snapshots, including child-agent messages.
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const inputTokens = usage.input_tokens + cacheRead + cacheWrite;
  const observation = readAdapterAiUsageObservation({
    eventId,
    provider: "anthropic",
    model: native.model,
    source: "claude_message",
    occurredAtMs: observations.get(eventId)?.occurredAtMs ?? Date.now(),
    tokens: {
      input: inputTokens,
      output: usage.output_tokens,
      cacheRead,
      cacheWrite,
      reasoning: null,
      total: inputTokens + usage.output_tokens,
    },
    cost: null,
  });
  if (observation) {
    observations.set(eventId, observation);
  }
}

function buildClaudeAgentSdkTelemetry(input: {
  aiUsage?: AdapterDispatchTelemetry["aiUsage"];
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
    ...(input.aiUsage ? { aiUsage: input.aiUsage } : {}),
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
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  needsPlanCapture: boolean;
}): Promise<{
  cleanup: () => Promise<void>;
  executable: Awaited<ReturnType<typeof resolveClaudeAgentSdkExecutable>>;
  planCapture: ClaudePlanCapture;
}> {
  const executable = await resolveClaudeAgentSdkExecutable({
    launchContract: input.launchContract,
    onProcessControlEvent: input.onProcessControlEvent,
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
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
}): Promise<{
  cleanup: () => Promise<void>;
  pathToClaudeCodeExecutable: string;
  spawnProcess: ReturnType<typeof createClaudeSdkProcessLauncher>["spawn"];
}> {
  const launchCommand = materializeCliLaunchCommand({
    launchContract: input.launchContract,
  });
  if (process.platform === "win32") {
    const invocation = resolvePlatformCommand(
      launchCommand.bin,
      launchCommand.argsPrefix
    );
    // A Node script must be exposed as Node + a prefix, not handed to the SDK
    // as a script that it would independently reinterpret with another runtime.
    const selected = invocation.windowsVerbatimArguments
      ? launchCommand
      : { bin: invocation.bin, argsPrefix: invocation.args };
    const launcher = createClaudeSdkProcessLauncher(
      selected,
      input.onProcessControlEvent
    );
    return {
      cleanup: launcher.cleanup,
      pathToClaudeCodeExecutable: selected.bin,
      spawnProcess: launcher.spawn,
    };
  }
  if (launchCommand.argsPrefix.length === 0 && launchCommand.shell !== true) {
    const launcher = createClaudeSdkProcessLauncher(
      launchCommand,
      input.onProcessControlEvent
    );
    return {
      cleanup: launcher.cleanup,
      pathToClaudeCodeExecutable: launchCommand.bin,
      spawnProcess: launcher.spawn,
    };
  }

  const wrapperDir = await mkdtemp(join(tmpdir(), "openmeld-claude-sdk-"));
  const wrapperPath = join(wrapperDir, "claude-code-wrapper");
  await writeFile(
    wrapperPath,
    buildPosixWrapperScript({
      argsPrefix: launchCommand.argsPrefix,
      bin: launchCommand.bin,
    }),
    "utf8"
  );
  await chmod(wrapperPath, 0o755);

  const launcher = createClaudeSdkProcessLauncher(
    { bin: wrapperPath, argsPrefix: [] },
    input.onProcessControlEvent
  );

  return {
    cleanup: async () => {
      try {
        await launcher.cleanup();
      } finally {
        await rm(wrapperDir, { force: true, recursive: true });
      }
    },
    pathToClaudeCodeExecutable: wrapperPath,
    spawnProcess: launcher.spawn,
  };
}

function buildClaudeAgentSdkOptions(input: {
  spaceActionTools?: AdapterDispatchSpaceTools;
  executionContext?: import("@openmeld/adapter-core").AdapterDispatchRequest["executionContext"];
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
  spawnProcess: ReturnType<typeof createClaudeSdkProcessLauncher>["spawn"];
  sessionId: string | null;
  streamingMode?: AdapterStreamingMode;
}): ClaudeAgentOptions {
  const spawnProcess = input.spawnProcess;
  const deliveryOnly = isClaudeDeliveryOnly(input);
  if (!isSupportedClaudeExecutionContext(input.executionContext)) {
    throw new Error("execution_context.file_access_unsupported");
  }
  const permissionMode = resolveClaudePermissionMode({
    deliveryOnly,
    agentControllerPermissionMode: input.agentControllerPermissionMode,
    executionMode: input.executionMode,
  }) as PermissionMode;
  const options: ClaudeAgentOptions = {
    abortController: input.abortController,
    additionalDirectories: [input.claudeWorkdir],
    // Eligibility permits a later owner-selected bypass; permissionMode still
    // controls the starting policy. Repair turns cannot change permissions.
    allowDangerouslySkipPermissions: input.executionMode !== "repair",
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
    ...(spawnProcess
      ? {
          spawnClaudeCodeProcess: (options) =>
            spawnProcess(options, input.onStderr),
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

  Object.assign(options, buildClaudeSpaceToolOptions(input));
  if (
    input.executionContext?.access === "workspace" &&
    input.executionContext.permissionSource !== "agent_settings" &&
    input.executionMode !== "repair" &&
    !deliveryOnly
  ) {
    applyClaudeProjectToolBoundary(options, permissionMode);
  }

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

function isSupportedClaudeExecutionContext(
  context?: import("@openmeld/adapter-core").AdapterDispatchRequest["executionContext"]
): boolean {
  return (
    !context ||
    context.access === "space_context" ||
    (context.access === "workspace" &&
      (context.permissionSource === "agent_settings" ||
        context.workspace === "isolated"))
  );
}

function applyClaudeProjectToolBoundary(
  options: ClaudeAgentOptions,
  permissionMode: PermissionMode
): void {
  if (permissionMode === "bypassPermissions") {
    throw new Error("execution_context.permission_mode_unsupported");
  }
  // Claude's restricted file tools stay inside cwd. Host Bash is omitted;
  // project_shell runs commands inside the verified task-only container.
  options.extraArgs = { restricted: null };
  options.tools = ["Read", "Edit", "Write", "Glob", "Grep"];
  options.strictMcpConfig = true;
  options.settingSources = [];
  options.settings = { disableAllHooks: true };
  options.additionalDirectories = [];
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

function createInvocationLiveInput(
  input: Parameters<typeof invokeClaudeAgentSdkTransport>[0],
  prompt: string,
  options: ClaudeAgentOptions
) {
  if (
    !(input.taskId && input.registerQuery) ||
    input.executionMode === "repair" ||
    input.spaceActionTools?.deliveryOnly
  ) {
    return undefined;
  }
  options.extraArgs = { ...options.extraArgs, "replay-user-messages": null };
  return createClaudeLiveInput(input.taskId, prompt);
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
  aiUsage?: AdapterDispatchTelemetry["aiUsage"];
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
        aiUsage: input.aiUsage,
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
      aiUsage: input.aiUsage,
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
