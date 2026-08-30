import type {
  AdapterDispatchExecutionMode,
  AdapterDispatchFailure,
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterPreviewCallback,
  AdapterRuntimeEventCallback,
  AdapterRuntimeProcessCallback,
  AdapterStreamingMode,
  AgentControllerPermissionMode,
  ConversationPolicy,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import {
  buildCliLaunchInvocation,
  buildDispatchSpaceActionMcpToolIds,
  buildProviderExitError,
  classifyCliDriverTimeoutFailure,
  classifyRuntimePermissionDenialMessage,
  createProviderOriginalError,
  looksLikeRuntimePermissionDenialMessage,
  resolveDispatchSpaceActionMcpServer,
} from "@openmeld/adapter-core";
import {
  CliDriverError,
  runCliDriver,
} from "@openmeld/adapter-core/drivers/cli-driver";
import { isLikelyClaudeContextLostError } from "../context/claude-context-heal.js";
import { parseClaudeOutputLine } from "../output/claude-output-parser.js";
import { resolveClaudeConversationPolicyOptions } from "./claude-conversation-policy.js";
import {
  OPENMELD_CLAUDE_ALLOWED_TOOLS,
  resolveClaudePermissionMode,
} from "./claude-permission-policy.js";
import { createClaudePreviewEmitter } from "./claude-preview-emitter.js";

export type ClaudeCliTransportResult = {
  output: string;
  sessionId: string | null;
  telemetry: AdapterDispatchTelemetry;
};

type ClaudeCliProviderAccessEvidence = NonNullable<
  AdapterDispatchFailure["providerAccessEvidence"]
>;

type ClaudeFailureClassification = {
  code: string;
  errorType: AdapterErrorType;
  message: string;
  originalError?: string;
  providerAccessEvidence?: ClaudeCliProviderAccessEvidence;
};

export class ClaudeCliTransportError extends Error {
  readonly code: string;
  readonly errorType: AdapterErrorType;
  readonly originalError?: string;
  readonly providerAccessEvidence?: ClaudeCliProviderAccessEvidence;
  readonly telemetry?: AdapterDispatchTelemetry;

  constructor(input: {
    code: string;
    errorType: AdapterErrorType;
    message: string;
    originalError?: string;
    providerAccessEvidence?: ClaudeCliProviderAccessEvidence;
    telemetry?: AdapterDispatchTelemetry;
  }) {
    super(input.message);
    this.name = "ClaudeCliTransportError";
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

export async function invokeClaudeCliTransport(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  claudeTimeoutMs: number | null;
  claudeWorkdir: string;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onPreview?: AdapterPreviewCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  sessionId: string | null;
  streamingMode?: AdapterStreamingMode;
  conversationPolicy?: ConversationPolicy;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
}): Promise<ClaudeCliTransportResult> {
  const prompt = normalizeOptionalText(input.prompt);
  if (!prompt) {
    throw new ClaudeCliTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: prompt is required",
    });
  }

  const args = buildClaudeArgs({
    agentControllerPermissionMode: input.agentControllerPermissionMode,
    conversationPolicy: input.conversationPolicy,
    executionMode: input.executionMode,
    env: input.env,
    prompt,
    sessionId: normalizeOptionalText(input.sessionId),
    streamingMode: input.streamingMode,
  });
  const invocation = buildCliLaunchInvocation({
    args,
    launchContract: input.launchContract,
  });

  const invokedAtMs = Date.now();
  const canonicalRepairSessionId =
    input.executionMode === "repair"
      ? normalizeOptionalText(input.sessionId)
      : null;
  let latestOutput = "";
  let latestResultIsError = false;
  let resolvedSessionId = normalizeOptionalText(input.sessionId);
  const providerErrorMessages: string[] = [];
  const providerOriginalErrorMessages: string[] = [];
  let firstStdoutAtMs: number | null = null;
  let firstOutputAtMs: number | null = null;
  const previewEmitter = createClaudePreviewEmitter({
    onPreview: input.onPreview,
    streamingMode: input.streamingMode,
  });

  let driverResult: Awaited<ReturnType<typeof runCliDriver>>;
  try {
    driverResult = await runCliDriver({
      allowNonZeroExit: true,
      args: invocation.args,
      bin: invocation.bin,
      cwd: input.claudeWorkdir,
      env: input.env,
      onLifecycleEvent: input.onRuntimeEvent,
      onProcessControlEvent: input.onProcessControlEvent,
      onStderrLine: (event) => {
        collectProviderErrorMessage(event.line, providerErrorMessages);
        return undefined;
      },
      onStdoutLine: (event) => {
        const nextState = handleClaudeStdoutLine({
          eventLine: event.line,
          firstOutputAtMs,
          firstStdoutAtMs,
          latestOutput,
          latestResultIsError,
          previewEmitter,
          providerErrorMessages,
          providerOriginalErrorMessages,
          resolvedSessionId,
        });
        firstOutputAtMs = nextState.firstOutputAtMs;
        firstStdoutAtMs = nextState.firstStdoutAtMs;
        latestOutput = nextState.latestOutput;
        latestResultIsError = nextState.latestResultIsError;
        resolvedSessionId = nextState.resolvedSessionId;
        if (nextState.terminal) {
          return {
            complete: true,
            terminateProcess: true,
          };
        }
      },
      timeoutMs: input.claudeTimeoutMs,
    });
  } catch (error) {
    throw toClaudeCliTransportError(error, input.claudeTimeoutMs);
  }

  await previewEmitter.flush();

  if (
    driverResult.exitCode !== 0 ||
    driverResult.signal !== null ||
    latestResultIsError
  ) {
    const telemetry = buildClaudeCliTelemetry({
      driverResult,
      firstOutputAtMs,
      firstStdoutAtMs,
      invokedAtMs,
      previewEmitted: previewEmitter.emitted,
      resumedContext: normalizeOptionalText(input.sessionId) !== null,
      streamingMode: input.streamingMode ?? "final",
    });
    const classifiedFailure = classifyClaudeFailure({
      exitSignal: driverResult.signal,
      providerErrorMessages,
      providerOriginalErrorMessages,
      stderrText: driverResult.stderrText,
      stdoutText: driverResult.stdoutText,
    });
    throw new ClaudeCliTransportError({
      code: classifiedFailure.code,
      errorType: classifiedFailure.errorType,
      message: classifiedFailure.message,
      ...(classifiedFailure.originalError
        ? { originalError: classifiedFailure.originalError }
        : {}),
      ...(classifiedFailure.providerAccessEvidence
        ? { providerAccessEvidence: classifiedFailure.providerAccessEvidence }
        : {}),
      telemetry,
    });
  }

  const output = normalizeOptionalText(latestOutput);
  if (!output) {
    throw new ClaudeCliTransportError({
      code: "runtime.output.empty",
      errorType: "adapter",
      message: "runtime.output.empty: claude finished without agent output",
      telemetry: buildClaudeCliTelemetry({
        driverResult,
        firstOutputAtMs,
        firstStdoutAtMs,
        invokedAtMs,
        previewEmitted: previewEmitter.emitted,
        resumedContext: normalizeOptionalText(input.sessionId) !== null,
        streamingMode: input.streamingMode ?? "final",
      }),
    });
  }

  return {
    output,
    sessionId:
      canonicalRepairSessionId ?? normalizeOptionalText(resolvedSessionId),
    telemetry: buildClaudeCliTelemetry({
      driverResult,
      firstOutputAtMs,
      firstStdoutAtMs,
      invokedAtMs,
      previewEmitted: previewEmitter.emitted,
      resumedContext: normalizeOptionalText(input.sessionId) !== null,
      streamingMode: input.streamingMode ?? "final",
    }),
  };
}

function buildClaudeCliTelemetry(input: {
  driverResult: Awaited<ReturnType<typeof runCliDriver>>;
  firstOutputAtMs: number | null;
  firstStdoutAtMs: number | null;
  invokedAtMs: number;
  previewEmitted: boolean;
  resumedContext: boolean;
  streamingMode: AdapterStreamingMode;
}): AdapterDispatchTelemetry {
  return {
    completedAtMs: Date.now(),
    ...(input.driverResult.lifecycle.exitCode === null
      ? {}
      : { exitCode: input.driverResult.lifecycle.exitCode }),
    ...(input.driverResult.lifecycle.exitObservedAtMs === null
      ? {}
      : { exitObservedAtMs: input.driverResult.lifecycle.exitObservedAtMs }),
    ...(input.driverResult.lifecycle.exitSignal === null
      ? {}
      : { exitSignal: input.driverResult.lifecycle.exitSignal }),
    ...(input.firstOutputAtMs === null
      ? {}
      : { firstOutputAtMs: input.firstOutputAtMs }),
    ...(input.driverResult.lifecycle.firstStderrAtMs === null
      ? {}
      : { firstStderrAtMs: input.driverResult.lifecycle.firstStderrAtMs }),
    ...(input.firstStdoutAtMs === null
      ? {}
      : { firstStdoutAtMs: input.firstStdoutAtMs }),
    invokedAtMs: input.invokedAtMs,
    previewEmitted: input.previewEmitted,
    ...(input.driverResult.lifecycle.processId === null
      ? {}
      : { processId: input.driverResult.lifecycle.processId }),
    ...(input.driverResult.lifecycle.processSpawnedAtMs === null
      ? {}
      : {
          processSpawnedAtMs: input.driverResult.lifecycle.processSpawnedAtMs,
        }),
    resumedContext: input.resumedContext,
    ...(input.driverResult.lifecycle.stdinClosedAtMs === null
      ? {}
      : { stdinClosedAtMs: input.driverResult.lifecycle.stdinClosedAtMs }),
    streamingMode: input.streamingMode,
    ...(input.driverResult.lifecycle.timeoutTriggeredAtMs === null
      ? {}
      : {
          timeoutTriggeredAtMs:
            input.driverResult.lifecycle.timeoutTriggeredAtMs,
        }),
  };
}

export const buildClaudeArgs = (input: {
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  conversationPolicy?: ConversationPolicy;
  executionMode?: AdapterDispatchExecutionMode;
  env?: Record<string, string | undefined>;
  prompt: string;
  sessionId: string | null;
  streamingMode?: AdapterStreamingMode;
}): string[] => {
  const args: string[] = [];
  const spaceActionMcpServer = resolveDispatchSpaceActionMcpServer(input.env);
  if (input.sessionId) {
    args.push("--resume", input.sessionId);
    if (input.executionMode === "repair") {
      args.push("--fork-session");
    }
  }
  appendClaudeConversationPolicyArgs(args, input.conversationPolicy);
  if (spaceActionMcpServer) {
    args.push(
      "--mcp-config",
      JSON.stringify({
        mcpServers: {
          [spaceActionMcpServer.id]: {
            args: [...spaceActionMcpServer.args],
            command: spaceActionMcpServer.commandPath,
            env: spaceActionMcpServer.env,
          },
        },
      })
    );
  }
  args.push("-p", input.prompt);
  appendClaudeAgentControllerPermissionModeArgs(args, {
    agentControllerPermissionMode: input.agentControllerPermissionMode,
    executionMode: input.executionMode,
    spaceActionMcpEnabled: spaceActionMcpServer !== null,
  });
  if (input.streamingMode === "stream") {
    args.push(
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose"
    );
    return args;
  }
  args.push("--output-format", "json");
  return args;
};

const appendClaudeAgentControllerPermissionModeArgs = (
  args: string[],
  input: {
    agentControllerPermissionMode?: AgentControllerPermissionMode;
    executionMode?: AdapterDispatchExecutionMode;
    spaceActionMcpEnabled?: boolean;
  }
): void => {
  args.push(
    "--allowedTools",
    ...OPENMELD_CLAUDE_ALLOWED_TOOLS,
    ...(input.spaceActionMcpEnabled
      ? buildDispatchSpaceActionMcpToolIds("__").map(
          (toolId) => `mcp__${toolId}`
        )
      : [])
  );
  args.push("--permission-mode", resolveClaudePermissionMode(input));
};

const appendClaudeConversationPolicyArgs = (
  args: string[],
  conversationPolicy?: ConversationPolicy
): void => {
  const conversationPolicyOptions =
    resolveClaudeConversationPolicyOptions(conversationPolicy);
  const model = conversationPolicyOptions.model;
  if (model) {
    args.push("--model", model);
  }

  const fallbackModel = conversationPolicyOptions.fallbackModel;
  if (fallbackModel) {
    args.push("--fallback-model", fallbackModel);
  }

  const reasoningLevel = conversationPolicyOptions.reasoningLevel;
  if (reasoningLevel) {
    args.push("--effort", reasoningLevel);
  }
};

const handleClaudeStdoutLine = (input: {
  eventLine: string;
  firstOutputAtMs: number | null;
  firstStdoutAtMs: number | null;
  latestOutput: string;
  latestResultIsError: boolean;
  previewEmitter: ReturnType<typeof createClaudePreviewEmitter>;
  providerErrorMessages: string[];
  providerOriginalErrorMessages: string[];
  resolvedSessionId: string | null;
}): {
  firstOutputAtMs: number | null;
  firstStdoutAtMs: number | null;
  latestOutput: string;
  latestResultIsError: boolean;
  resolvedSessionId: string | null;
  terminal: boolean;
} => {
  let firstStdoutAtMs = input.firstStdoutAtMs;
  let firstOutputAtMs = input.firstOutputAtMs;
  let latestOutput = input.latestOutput;
  let latestResultIsError = input.latestResultIsError;
  let resolvedSessionId = input.resolvedSessionId;

  if (firstStdoutAtMs === null) {
    firstStdoutAtMs = Date.now();
  }

  const parsedLine = parseClaudeOutputLine(input.eventLine);
  if (!parsedLine) {
    return {
      firstOutputAtMs,
      firstStdoutAtMs,
      latestOutput,
      latestResultIsError,
      resolvedSessionId,
      terminal: false,
    };
  }

  if (parsedLine.previewDeltaText) {
    const nextPreviewText = input.previewEmitter.append(
      parsedLine.previewDeltaText
    );
    if (nextPreviewText && firstOutputAtMs === null) {
      firstOutputAtMs = Date.now();
    }
  }

  if (parsedLine.resultText) {
    latestOutput = parsedLine.resultText;
    if (firstOutputAtMs === null) {
      firstOutputAtMs = Date.now();
    }
  }

  if (parsedLine.errorMessage) {
    input.providerErrorMessages.push(parsedLine.errorMessage);
    input.providerOriginalErrorMessages.push(parsedLine.errorMessage);
  }

  if (parsedLine.isErrorResult === true) {
    latestResultIsError = true;
  } else {
    latestResultIsError = false;
    if (parsedLine.sessionId) {
      resolvedSessionId = parsedLine.sessionId;
    }
  }

  return {
    firstOutputAtMs,
    firstStdoutAtMs,
    latestOutput,
    latestResultIsError,
    resolvedSessionId,
    terminal: parsedLine.terminal,
  };
};

const toClaudeCliTransportError = (
  error: unknown,
  timeoutMs: number | null
): ClaudeCliTransportError => {
  if (error instanceof ClaudeCliTransportError) {
    return error;
  }

  if (error instanceof CliDriverError) {
    if (error.code === "process.timeout") {
      const classifiedFailure = classifyCliDriverTimeoutFailure({
        error,
        providerLabel: "claude",
        timeoutMs,
      });
      return new ClaudeCliTransportError(classifiedFailure);
    }

    if (error.code === "process.spawn_failed") {
      return new ClaudeCliTransportError({
        code: "upstream_unreachable",
        errorType: "adapter",
        message: `upstream_unreachable: failed to spawn claude (${error.message})`,
      });
    }

    if (error.code === "process.non_zero_exit") {
      const classifiedFailure = classifyClaudeFailure({
        exitSignal: error.signal,
        providerErrorMessages: [],
        stderrText: error.stderrText,
        stdoutText: error.stdoutText,
      });
      return new ClaudeCliTransportError({
        code: classifiedFailure.code,
        errorType: classifiedFailure.errorType,
        message: classifiedFailure.message,
        ...(classifiedFailure.originalError
          ? { originalError: classifiedFailure.originalError }
          : {}),
        ...(classifiedFailure.providerAccessEvidence
          ? { providerAccessEvidence: classifiedFailure.providerAccessEvidence }
          : {}),
      });
    }
  }

  const fallbackMessage =
    error instanceof Error ? error.message : String(error);
  return new ClaudeCliTransportError({
    code: "upstream_unreachable",
    errorType: "adapter",
    message: `upstream_unreachable: failed to execute claude (${fallbackMessage})`,
  });
};

export const classifyClaudeFailure = (input: {
  exitSignal?: NodeJS.Signals | null;
  providerErrorMessages: string[];
  providerOriginalErrorMessages?: string[];
  stderrText?: string;
  stdoutText?: string;
}): ClaudeFailureClassification => {
  const trustedProviderMessages = new Set([
    ...(input.providerOriginalErrorMessages ?? []),
    ...extractErrorMessagesFromStdout(input.stdoutText),
  ]);
  const providerMessage = resolveProviderFailureMessage(input);
  if (providerMessage) {
    const classified = classifyProviderMessageFailure(
      providerMessage,
      trustedProviderMessages.has(providerMessage)
    );
    if (classified) {
      return classified;
    }
  }

  if (input.exitSignal) {
    return {
      code: "provider.process_terminated",
      errorType: "adapter",
      message: `provider.process_terminated: claude process was terminated by ${input.exitSignal} before returning a result`,
    };
  }

  const stderrText = normalizeOptionalText(input.stderrText);
  if (stderrText) {
    return {
      code: "upstream_unreachable",
      errorType: "adapter",
      message: `upstream_unreachable: ${stderrText}`,
    };
  }

  return {
    ...buildProviderExitError({
      providerLabel: "claude",
    }),
  };
};

const classifyProviderMessageFailure = (
  providerMessage: string,
  includeOriginalError: boolean
): ClaudeFailureClassification | null => {
  const lowered = providerMessage.toLowerCase();
  const originalError = includeOriginalError
    ? createProviderOriginalError(providerMessage)
    : null;
  const withOriginalError = (
    value: ClaudeFailureClassification
  ): ClaudeFailureClassification => ({
    ...value,
    ...(originalError ? { originalError } : {}),
  });
  const providerAccessEvidence = buildClaudeCodeProviderAccessEvidence(lowered);
  const permissionDenial = classifyRuntimePermissionDenialMessage({
    message: providerMessage,
    source: "claude-code",
  });
  if (permissionDenial) {
    return withOriginalError({
      code: permissionDenial.code,
      errorType: permissionDenial.errorType,
      message: permissionDenial.message,
    });
  }
  if (isAuthFailure(lowered)) {
    return withOriginalError({
      code: "auth.required",
      errorType: "auth",
      message: providerMessage,
      ...(providerAccessEvidence ? { providerAccessEvidence } : {}),
    });
  }
  if (isQuotaFailure(lowered)) {
    return withOriginalError({
      code: "quota.exceeded",
      errorType: "adapter",
      message: providerMessage,
      ...(providerAccessEvidence ? { providerAccessEvidence } : {}),
    });
  }
  if (isRateLimitFailure(lowered)) {
    return withOriginalError({
      code: "rate_limited",
      errorType: "adapter",
      message: providerMessage,
    });
  }
  if (isProviderOverloadedFailure(lowered)) {
    return withOriginalError({
      code: "provider.unavailable",
      errorType: "adapter",
      message: providerMessage,
    });
  }
  if (isModelConfigFailure(lowered)) {
    return withOriginalError({
      code: "config.invalid",
      errorType: "config",
      message: toConfigInvalidMessage(providerMessage),
    });
  }
  if (isLikelyClaudeContextLostError(providerMessage)) {
    return withOriginalError({
      code: "context.lost",
      errorType: "adapter",
      message: providerMessage,
    });
  }
  return null;
};

const resolveProviderFailureMessage = (input: {
  providerErrorMessages: string[];
  stderrText?: string;
  stdoutText?: string;
}): string | null => {
  const candidateMessages = [
    ...input.providerErrorMessages,
    ...extractErrorMessagesFromStdout(input.stdoutText),
    ...(normalizeOptionalText(input.stderrText)
      ? [normalizeOptionalText(input.stderrText)]
      : []),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidateMessages) {
    if (looksLikeProviderFailure(candidate)) {
      return candidate;
    }
  }

  return candidateMessages[0] ?? null;
};

const extractErrorMessagesFromStdout = (value: unknown): string[] => {
  const stdoutText = normalizeOptionalText(value);
  if (!stdoutText) {
    return [];
  }

  const messages: string[] = [];
  const lines = stdoutText.split("\n");
  for (const line of lines) {
    const parsedLine = parseClaudeOutputLine(line);
    if (parsedLine?.errorMessage) {
      messages.push(parsedLine.errorMessage);
    }
  }
  return messages;
};

const collectProviderErrorMessage = (
  line: string,
  messages: string[]
): void => {
  const normalizedLine = normalizeOptionalText(line);
  if (!normalizedLine) {
    return;
  }
  messages.push(normalizedLine);
};

const looksLikeProviderFailure = (value: string): boolean => {
  const normalized = value.toLowerCase();
  return (
    looksLikeRuntimePermissionDenialMessage(value) ||
    isAuthFailure(normalized) ||
    isQuotaFailure(normalized) ||
    isRateLimitFailure(normalized) ||
    isModelConfigFailure(normalized) ||
    isLikelyClaudeContextLostError(normalized)
  );
};

const isAuthFailure = (value: string): boolean => {
  return (
    value.includes("not logged in") ||
    value.includes("please run /login") ||
    value.includes("authentication_failed") ||
    value.includes("oauth_org_not_allowed") ||
    value.includes("failed to authenticate") ||
    value.includes("oauth session expired") ||
    value.includes("unauthorized") ||
    value.includes("401") ||
    isClaudeCodeAccountAccessFailure(value)
  );
};

const isQuotaFailure = (value: string): boolean => {
  return (
    value.includes("insufficient_quota") ||
    value.includes("insufficient balance") ||
    value.includes("insufficient_balance") ||
    value.includes("quota exceeded") ||
    value.includes("exceeded your current quota") ||
    value.includes("not enough credits") ||
    value.includes("out of credits") ||
    value.includes("credits exhausted") ||
    value.includes("balance is too low") ||
    value.includes("payment required") ||
    value.includes("billing") ||
    isClaudeCodeSubscriptionAccessFailure(value)
  );
};

const isModelConfigFailure = (value: string): boolean => {
  return (
    value.includes("model_not_found") ||
    value.includes("unknown model") ||
    value.includes("invalid model") ||
    value.includes("requested model") ||
    value.includes("unsupported model") ||
    (value.includes("model") &&
      (value.includes("does not exist") ||
        value.includes("no longer available") ||
        value.includes("retired") ||
        value.includes("deprecated"))) ||
    (value.includes("invalid_request_error") && value.includes("model")) ||
    value.includes('"param": "model"')
  );
};

const toConfigInvalidMessage = (value: string): string => {
  return value.toLowerCase().startsWith("config.invalid:")
    ? value
    : `config.invalid: ${value}`;
};

const isClaudeCodeAccountAccessFailure = (value: string): boolean => {
  return (
    (value.includes("organization") &&
      value.includes("disabled") &&
      value.includes("access")) ||
    (value.includes("claude code") &&
      (value.includes("access is disabled") ||
        value.includes("disabled claude code") ||
        value.includes("access unavailable") ||
        value.includes("not enabled")))
  );
};

const isClaudeCodeSubscriptionAccessFailure = (value: string): boolean => {
  return (
    value.includes("subscription") &&
    (value.includes("disabled") ||
      value.includes("inactive") ||
      value.includes("required") ||
      value.includes("unavailable"))
  );
};

const buildClaudeCodeProviderAccessEvidence = (
  normalizedProviderMessage: string
): ClaudeCliProviderAccessEvidence | null => {
  if (isClaudeCodeAccountAccessFailure(normalizedProviderMessage)) {
    return {
      observedAtMs: Date.now(),
      provider: "claude-code",
      reasonCode: "provider_account.organization_access_disabled",
      source: "wake_failure",
    };
  }
  if (isClaudeCodeSubscriptionAccessFailure(normalizedProviderMessage)) {
    return {
      observedAtMs: Date.now(),
      provider: "claude-code",
      reasonCode: "provider_account.subscription_access_unavailable",
      source: "wake_failure",
    };
  }
  return null;
};

const isRateLimitFailure = (value: string): boolean => {
  return (
    value.includes("429") ||
    value.includes("rate limit") ||
    value.includes("rate_limit") ||
    value.includes("too many requests")
  );
};

const isProviderOverloadedFailure = (value: string): boolean => {
  return (
    value.includes("overloaded") ||
    value.includes("server_error") ||
    value.includes("internal server error")
  );
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}
