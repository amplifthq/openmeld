import type {
  AdapterComputerFileAccessBoundary,
  AdapterDispatchExecutionMode,
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterPreviewCallback,
  AdapterProviderAccessEvidence,
  AdapterRuntimeEventCallback,
  AdapterRuntimeProcessCallback,
  AdapterStreamingMode,
  AgentControllerPermissionMode,
  ConversationPolicy,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import {
  buildCliLaunchInvocation,
  buildProviderExitError,
  classifyCliDriverTimeoutFailure,
  classifyRuntimePermissionDenialMessage,
  createProviderOriginalError,
  looksLikeRuntimePermissionDenialMessage,
} from "@openmeld/adapter-core";
import {
  CliDriverError,
  runCliDriver,
} from "@openmeld/adapter-core/drivers/cli-driver";
import { processCodexStdoutLine } from "../output/codex-output-parser.js";
import { classifyCodexProviderAccountFailure } from "../output/codex-provider-failure.js";
import { extractCodexToolActivityEvent } from "../output/codex-tool-activity.js";
import { buildCodexFileAccessBoundaryGlobalArgs } from "./codex-file-access-boundary.js";
import { buildCodexSpaceActionMcpGlobalArgs } from "./codex-space-action-mcp-config.js";

export type CodexCliTransportResult = {
  output: string;
  telemetry: AdapterDispatchTelemetry;
  threadId: string | null;
};

export class CodexCliTransportError extends Error {
  readonly code: string;
  readonly errorType: AdapterErrorType;
  readonly originalError?: string;
  readonly providerAccessEvidence?: AdapterProviderAccessEvidence;

  constructor(input: {
    code: string;
    errorType: AdapterErrorType;
    message: string;
    originalError?: string;
    providerAccessEvidence?: AdapterProviderAccessEvidence;
  }) {
    super(input.message);
    this.name = "CodexCliTransportError";
    this.code = input.code;
    this.errorType = input.errorType;
    this.originalError = input.originalError;
    this.providerAccessEvidence = input.providerAccessEvidence;
  }
}

export async function invokeCodexCliTransport(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  codexTimeoutMs: number | null;
  codexWorkdir: string;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onPreview?: AdapterPreviewCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  streamingMode?: AdapterStreamingMode;
  threadId: string | null;
  conversationPolicy?: ConversationPolicy;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary;
}): Promise<CodexCliTransportResult> {
  const prompt = normalizeOptionalText(input.prompt);
  if (!prompt) {
    throw new CodexCliTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: prompt is required",
    });
  }

  const args = buildCodexExecArgs({
    agentControllerPermissionMode: input.agentControllerPermissionMode,
    conversationPolicy: input.conversationPolicy,
    computerFileAccessBoundary: input.computerFileAccessBoundary,
    env: input.env,
    executionMode: input.executionMode,
    threadId: input.threadId,
  });
  const invocation = buildCliLaunchInvocation({
    args,
    launchContract: input.launchContract,
  });

  const invokedAtMs = Date.now();
  let latestOutput = "";
  let resolvedThreadId = input.threadId;
  const providerErrorMessages: string[] = [];
  let firstStdoutAtMs: number | null = null;
  let firstOutputAtMs: number | null = null;
  const previewEmitter = createPreviewEmitter({
    onPreview: input.onPreview,
    streamingMode: input.streamingMode,
  });
  let driverResult: Awaited<ReturnType<typeof runCliDriver>>;

  try {
    driverResult = await runCliDriver({
      allowNonZeroExit: true,
      args: invocation.args,
      bin: invocation.bin,
      cwd: input.codexWorkdir,
      env: input.env,
      inputText: `${prompt}\n`,
      onLifecycleEvent: input.onRuntimeEvent,
      onProcessControlEvent: input.onProcessControlEvent,
      onStdoutLine: (event) => {
        if (firstStdoutAtMs === null) {
          firstStdoutAtMs = Date.now();
        }
        const previousOutput = latestOutput;
        const toolActivity = extractCodexToolActivityEventFromLine(event.line);
        if (toolActivity) {
          input.onRuntimeEvent?.(toolActivity);
        }
        const nextLineResult = processCodexStdoutLine({
          latestOutputRef: {
            get value() {
              return latestOutput;
            },
            set value(value: string) {
              latestOutput = value;
            },
          },
          line: event.line,
          threadIdRef: {
            get value() {
              return resolvedThreadId;
            },
            set value(value: string | null) {
              resolvedThreadId = value;
            },
          },
        });
        if (
          firstOutputAtMs === null &&
          previousOutput.trim().length === 0 &&
          latestOutput.trim().length > 0
        ) {
          firstOutputAtMs = Date.now();
        }
        if (nextLineResult.previewable && latestOutput !== previousOutput) {
          previewEmitter.push(latestOutput);
        }
        collectCodexErrorMessage(event.line, providerErrorMessages);
        if (nextLineResult.terminal) {
          return {
            complete: true,
            terminateProcess: true,
          };
        }
      },
      onStderrLine: (event) => {
        collectCodexErrorMessage(event.line, providerErrorMessages);
        return undefined;
      },
      timeoutMs: input.codexTimeoutMs,
    });
  } catch (error) {
    throw toCodexCliTransportError(error, input.codexTimeoutMs);
  }

  await previewEmitter.flush();

  if (driverResult.exitCode !== 0) {
    const classifiedFailure = classifyCodexFailure({
      providerErrorMessages,
      stderrText: driverResult.stderrText,
      stdoutText: driverResult.stdoutText,
    });
    throw new CodexCliTransportError({
      code: classifiedFailure.code,
      errorType: classifiedFailure.errorType,
      message: classifiedFailure.message,
      originalError: classifiedFailure.originalError,
      providerAccessEvidence: classifiedFailure.providerAccessEvidence,
    });
  }

  const output = normalizeOptionalText(latestOutput);
  if (!output) {
    if (providerErrorMessages.length > 0) {
      const classifiedFailure = classifyCodexFailure({
        providerErrorMessages,
        stderrText: driverResult.stderrText,
        stdoutText: driverResult.stdoutText,
      });
      throw new CodexCliTransportError({
        code: classifiedFailure.code,
        errorType: classifiedFailure.errorType,
        message: classifiedFailure.message,
        originalError: classifiedFailure.originalError,
        providerAccessEvidence: classifiedFailure.providerAccessEvidence,
      });
    }
    throw new CodexCliTransportError({
      code: "runtime.output.empty",
      errorType: "adapter",
      message: "runtime.output.empty: codex finished without agent output",
    });
  }

  return {
    output,
    telemetry: {
      completedAtMs: Date.now(),
      ...(driverResult.lifecycle.exitCode === null
        ? {}
        : { exitCode: driverResult.lifecycle.exitCode }),
      ...(driverResult.lifecycle.exitObservedAtMs === null
        ? {}
        : { exitObservedAtMs: driverResult.lifecycle.exitObservedAtMs }),
      ...(driverResult.lifecycle.exitSignal === null
        ? {}
        : { exitSignal: driverResult.lifecycle.exitSignal }),
      ...(firstOutputAtMs === null ? {} : { firstOutputAtMs }),
      ...(driverResult.lifecycle.firstStderrAtMs === null
        ? {}
        : { firstStderrAtMs: driverResult.lifecycle.firstStderrAtMs }),
      ...(firstStdoutAtMs === null ? {} : { firstStdoutAtMs }),
      invokedAtMs,
      previewEmitted: previewEmitter.emitted,
      ...(driverResult.lifecycle.processId === null
        ? {}
        : { processId: driverResult.lifecycle.processId }),
      ...(driverResult.lifecycle.processSpawnedAtMs === null
        ? {}
        : { processSpawnedAtMs: driverResult.lifecycle.processSpawnedAtMs }),
      resumedContext: normalizeOptionalText(input.threadId) !== null,
      ...(driverResult.lifecycle.stdinClosedAtMs === null
        ? {}
        : { stdinClosedAtMs: driverResult.lifecycle.stdinClosedAtMs }),
      streamingMode: input.streamingMode ?? "final",
      ...(driverResult.lifecycle.timeoutTriggeredAtMs === null
        ? {}
        : {
            timeoutTriggeredAtMs: driverResult.lifecycle.timeoutTriggeredAtMs,
          }),
    },
    threadId: normalizeOptionalText(resolvedThreadId),
  };
}

function extractCodexToolActivityEventFromLine(
  line: string
): ReturnType<typeof extractCodexToolActivityEvent> {
  try {
    return extractCodexToolActivityEvent(JSON.parse(line));
  } catch {
    return null;
  }
}

export function buildCodexExecArgs(input: {
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary;
  conversationPolicy?: ConversationPolicy;
  executionMode?: AdapterDispatchExecutionMode;
  env?: Record<string, string | undefined>;
  threadId: string | null;
}): string[] {
  const conversationPolicyArgs = buildCodexConversationPolicyArgs(
    input.conversationPolicy
  );
  const permissionModeArgs = resolveCodexAgentControllerPermissionModeArgs({
    agentControllerPermissionMode: input.agentControllerPermissionMode,
    computerFileAccessBoundary: input.computerFileAccessBoundary,
    executionMode: input.executionMode,
  });
  const spaceActionMcpArgs = buildCodexSpaceActionMcpGlobalArgs(
    input.env ?? {}
  );

  if (input.threadId) {
    return [
      ...permissionModeArgs.globalArgs,
      ...spaceActionMcpArgs,
      "exec",
      "resume",
      ...permissionModeArgs.execArgs,
      "--json",
      "--skip-git-repo-check",
      ...conversationPolicyArgs,
      input.threadId,
      "-",
    ];
  }

  return [
    ...permissionModeArgs.globalArgs,
    ...spaceActionMcpArgs,
    "exec",
    ...permissionModeArgs.execArgs,
    "--json",
    "--skip-git-repo-check",
    ...conversationPolicyArgs,
    "-",
  ];
}

function resolveCodexAgentControllerPermissionModeArgs(input: {
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary;
  executionMode?: AdapterDispatchExecutionMode;
}): {
  execArgs: string[];
  globalArgs: string[];
} {
  if (input.computerFileAccessBoundary) {
    return {
      execArgs: [],
      globalArgs: buildCodexFileAccessBoundaryGlobalArgs({
        boundary: input.computerFileAccessBoundary,
        executionMode: input.executionMode,
        permissionMode: input.agentControllerPermissionMode,
      }),
    };
  }
  if (input.executionMode === "repair") {
    return {
      execArgs: [],
      globalArgs: ["-s", "read-only", "-a", "untrusted"],
    };
  }

  const policy = resolveCodexAgentControllerPermissionMode(
    input.agentControllerPermissionMode
  );
  if (policy === "codex:fullAccess") {
    return {
      execArgs: ["--dangerously-bypass-approvals-and-sandbox"],
      globalArgs: [],
    };
  }

  if (policy === "codex:customConfig") {
    return {
      execArgs: [],
      globalArgs: [],
    };
  }

  const mapping = CODEX_CLI_POLICY_ARGS_BY_POLICY[policy];
  return {
    execArgs: [],
    globalArgs: [
      "-s",
      mapping.sandbox,
      "-a",
      mapping.askForApproval,
      ...mapping.configArgs,
    ],
  };
}

const CODEX_CLI_POLICY_ARGS_BY_POLICY = {
  "codex:askForApproval": {
    askForApproval: "untrusted",
    configArgs: [],
    sandbox: "workspace-write",
  },
  "codex:approveForMe": {
    askForApproval: "on-request",
    configArgs: ["-c", 'approvals_reviewer="auto_review"'],
    sandbox: "workspace-write",
  },
} as const satisfies Record<
  Extract<
    AgentControllerPermissionMode,
    "codex:askForApproval" | "codex:approveForMe"
  >,
  { askForApproval: string; configArgs: readonly string[]; sandbox: string }
>;

type CodexAgentControllerPermissionMode = Extract<
  AgentControllerPermissionMode,
  `codex:${string}`
>;

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

function buildCodexConversationPolicyArgs(
  conversationPolicy?: ConversationPolicy
): string[] {
  const args: string[] = [];

  const model = normalizeOptionalText(conversationPolicy?.model);
  if (model) {
    args.push("-m", model);
  }

  const reasoningLevel = normalizeOptionalText(
    conversationPolicy?.reasoningLevel
  );
  if (reasoningLevel) {
    args.push("-c", `model_reasoning_effort=${reasoningLevel}`);
  }

  return args;
}

const PREVIEW_EMIT_MIN_VISIBLE_CHARS = 24;
const PREVIEW_EMIT_THROTTLE_MS = 500;

const createPreviewEmitter = (input: {
  onPreview?: AdapterPreviewCallback;
  streamingMode?: AdapterStreamingMode;
}): {
  push: (nextPreviewText: string) => void;
  emitted: boolean;
  flush: () => Promise<void>;
} => {
  if (!(input.onPreview && input.streamingMode === "stream")) {
    return {
      push: () => undefined,
      emitted: false,
      flush: async () => undefined,
    };
  }

  let emitted = false;
  let lastEmittedAtMs = 0;
  let lastEmittedText = "";
  let latestPreviewText = "";
  const pendingTasks = new Set<Promise<void>>();

  const queuePreview = (nextPreviewText: string): void => {
    emitted = true;
    lastEmittedAtMs = Date.now();
    lastEmittedText = nextPreviewText;
    const task = Promise.resolve(
      input.onPreview?.({
        text: nextPreviewText,
      })
    )
      .catch(() => undefined)
      .finally(() => {
        pendingTasks.delete(task);
      });
    pendingTasks.add(task);
  };

  return {
    push: (nextPreviewText: string): void => {
      const normalizedPreviewText = nextPreviewText.trim();
      if (
        !normalizedPreviewText ||
        normalizedPreviewText === latestPreviewText
      ) {
        return;
      }
      latestPreviewText = normalizedPreviewText;
      if (normalizedPreviewText === lastEmittedText) {
        return;
      }
      const nowMs = Date.now();
      const grewEnough =
        normalizedPreviewText.length - lastEmittedText.length >=
        PREVIEW_EMIT_MIN_VISIBLE_CHARS;
      const addedNewLineBoundary =
        countVisibleLines(normalizedPreviewText) >
        countVisibleLines(lastEmittedText);
      if (
        lastEmittedText &&
        nowMs - lastEmittedAtMs < PREVIEW_EMIT_THROTTLE_MS
      ) {
        return;
      }
      if (!(lastEmittedText === "" || grewEnough || addedNewLineBoundary)) {
        return;
      }
      queuePreview(normalizedPreviewText);
    },
    get emitted() {
      return emitted;
    },
    flush: async (): Promise<void> => {
      if (latestPreviewText && latestPreviewText !== lastEmittedText) {
        queuePreview(latestPreviewText);
      }
      await Promise.allSettled([...pendingTasks]);
    },
  };
};

const countVisibleLines = (value: string): number => {
  if (value.length === 0) {
    return 0;
  }
  return value.split("\n").length;
};

const toCodexCliTransportError = (
  error: unknown,
  timeoutMs: number | null
): CodexCliTransportError => {
  if (error instanceof CodexCliTransportError) {
    return error;
  }

  if (error instanceof CliDriverError) {
    if (error.code === "process.timeout") {
      const classifiedFailure = classifyCliDriverTimeoutFailure({
        error,
        providerLabel: "codex",
        timeoutMs,
      });
      return new CodexCliTransportError(classifiedFailure);
    }

    if (error.code === "process.spawn_failed") {
      return new CodexCliTransportError({
        code: "upstream_unreachable",
        errorType: "adapter",
        message: `upstream_unreachable: failed to spawn codex (${error.message})`,
      });
    }

    if (error.code === "process.non_zero_exit") {
      const classifiedFailure = classifyCodexFailure({
        providerErrorMessages: [],
        stderrText: error.stderrText,
        stdoutText: error.stdoutText,
      });
      return new CodexCliTransportError({
        code: classifiedFailure.code,
        errorType: classifiedFailure.errorType,
        message: classifiedFailure.message,
        originalError: classifiedFailure.originalError,
        providerAccessEvidence: classifiedFailure.providerAccessEvidence,
      });
    }
  }

  const fallbackMessage =
    error instanceof Error ? error.message : String(error);
  return new CodexCliTransportError({
    code: "upstream_unreachable",
    errorType: "adapter",
    message: `upstream_unreachable: failed to execute codex (${fallbackMessage})`,
  });
};

const collectCodexErrorMessage = (line: string, messages: string[]): void => {
  const normalizedLine = normalizeOptionalText(line);
  if (!normalizedLine) {
    return;
  }

  const jsonMessage = readCodexJsonErrorMessage(normalizedLine);
  if (jsonMessage) {
    messages.push(jsonMessage);
  }
};

const readCodexJsonErrorMessage = (line: string): string | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!record) {
    return null;
  }

  const message = normalizeOptionalText(record.message);
  if (record.type === "error" && message) {
    return message;
  }

  const errorRecord =
    record.error &&
    typeof record.error === "object" &&
    !Array.isArray(record.error)
      ? (record.error as Record<string, unknown>)
      : null;
  const errorMessage = normalizeOptionalText(errorRecord?.message);
  if (record.type === "turn.failed" && errorMessage) {
    return errorMessage;
  }

  return null;
};

const classifyCodexFailure = (input: {
  providerErrorMessages: string[];
  stdoutText?: string;
  stderrText?: string;
}): {
  code: string;
  errorType: AdapterErrorType;
  message: string;
  originalError?: string;
  providerAccessEvidence?: AdapterProviderAccessEvidence;
} => {
  const providerMessage = resolveProviderFailureMessage(input);
  const originalError =
    providerMessage && input.providerErrorMessages.includes(providerMessage)
      ? (createProviderOriginalError(providerMessage) ?? undefined)
      : undefined;
  if (providerMessage) {
    const lowered = providerMessage.toLowerCase();
    const permissionDenial = classifyRuntimePermissionDenialMessage({
      message: providerMessage,
      source: "codex",
    });
    if (permissionDenial) {
      return {
        code: permissionDenial.code,
        errorType: permissionDenial.errorType,
        message: permissionDenial.message,
        originalError,
      };
    }
    if (isControllerClientUpgradeRequiredFailure(lowered)) {
      return {
        code: "controller.client.upgrade_required",
        errorType: "config",
        message: toControllerClientUpgradeRequiredMessage(providerMessage),
        originalError,
      };
    }
    const providerFailure = classifyCodexProviderAccountFailure({
      message: providerMessage,
    });
    if (providerFailure) {
      return {
        ...providerFailure,
        message: providerMessage,
      };
    }
    if (isConfigFailure(lowered)) {
      return {
        code: "config.invalid",
        errorType: "config",
        message: toConfigInvalidMessage(providerMessage),
        originalError,
      };
    }
  }

  const stderrText = normalizeOptionalText(input.stderrText);
  if (stderrText) {
    return {
      code: "upstream_unreachable",
      errorType: "adapter",
      message: `upstream_unreachable: ${stderrText}`,
      originalError,
    };
  }

  return {
    ...buildProviderExitError({
      providerLabel: "codex",
    }),
    originalError,
  };
};

const resolveProviderFailureMessage = (input: {
  providerErrorMessages: string[];
  stdoutText?: string;
  stderrText?: string;
}): string | null => {
  const candidateMessages = [
    ...input.providerErrorMessages,
    ...(normalizeOptionalText(input.stderrText)
      ? [normalizeOptionalText(input.stderrText)]
      : []),
    ...(normalizeOptionalText(input.stdoutText)
      ? [normalizeOptionalText(input.stdoutText)]
      : []),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidateMessages) {
    if (looksLikeProviderFailure(candidate)) {
      return candidate;
    }
  }

  return candidateMessages[0] ?? null;
};

const looksLikeProviderFailure = (value: string): boolean => {
  const normalized = value.toLowerCase();
  return (
    looksLikeRuntimePermissionDenialMessage(value) ||
    classifyCodexProviderAccountFailure({ message: normalized }) !== null
  );
};

const isConfigFailure = (value: string): boolean => {
  return (
    value.includes("model_not_found") ||
    value.includes("requested model") ||
    value.includes("unknown model") ||
    value.includes("invalid model") ||
    (value.includes("does not exist") && value.includes("model")) ||
    (value.includes("invalid_request_error") && value.includes("model")) ||
    value.includes('"param": "model"')
  );
};

const isControllerClientUpgradeRequiredFailure = (value: string): boolean => {
  return (
    value.includes("requires a newer version of codex") ||
    (value.includes("upgrade to the latest app or cli") &&
      value.includes("codex"))
  );
};

const toConfigInvalidMessage = (value: string): string => {
  return value.toLowerCase().startsWith("config.invalid:")
    ? value
    : `config.invalid: ${value}`;
};

const toControllerClientUpgradeRequiredMessage = (value: string): string => {
  return value.toLowerCase().startsWith("controller.client.upgrade_required:")
    ? value
    : `controller.client.upgrade_required: ${value}`;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}
