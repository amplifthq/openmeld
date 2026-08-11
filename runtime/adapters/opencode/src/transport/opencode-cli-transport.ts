import type {
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterRuntimeEventCallback,
  AdapterRuntimeProcessCallback,
  ConversationPolicy,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import {
  buildCliLaunchInvocation,
  buildProviderExitError,
  classifyCliDriverTimeoutFailure,
  looksLikeRuntimePermissionDenialMessage,
} from "@openmeld/adapter-core";
import {
  CliDriverError,
  runCliDriver,
} from "@openmeld/adapter-core/drivers/cli-driver";
import { isLikelyOpenCodeContextLostError } from "../context/opencode-context-heal.js";
import {
  parseOpenCodeOutputDocument,
  parseOpenCodeOutputLine,
} from "../output/opencode-output-parser.js";
import { classifyOpenCodeFailureMessage } from "./opencode-failure.js";

export type OpenCodeCliTransportResult = {
  output: string;
  sessionId: string | null;
  telemetry: AdapterDispatchTelemetry;
};

export class OpenCodeCliTransportError extends Error {
  readonly code: string;
  readonly errorType: AdapterErrorType;

  constructor(input: {
    code: string;
    errorType: AdapterErrorType;
    message: string;
  }) {
    super(input.message);
    this.name = "OpenCodeCliTransportError";
    this.code = input.code;
    this.errorType = input.errorType;
  }
}

const STREAMING_PROVIDER_FAILURE_THRESHOLD = 3;

export async function invokeOpenCodeCliTransport(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  openCodeTimeoutMs: number | null;
  openCodeWorkdir: string;
  conversationPolicy?: ConversationPolicy;
  env?: Record<string, string | undefined>;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  sessionId: string | null;
}): Promise<OpenCodeCliTransportResult> {
  const prompt = normalizeOptionalText(input.prompt);
  if (!prompt) {
    throw new OpenCodeCliTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: prompt is required",
    });
  }

  const args = buildOpenCodeArgs({
    conversationPolicy: input.conversationPolicy,
    prompt,
    sessionId: normalizeOptionalText(input.sessionId),
    workdir: input.openCodeWorkdir,
  });
  const invocation = buildCliLaunchInvocation({
    args,
    launchContract: input.launchContract,
  });

  let latestOutput = "";
  let latestResultIsError = false;
  let resolvedSessionId = normalizeOptionalText(input.sessionId);
  const providerErrorMessages: string[] = [];
  const invokedAtMs = Date.now();
  let firstStdoutAtMs: number | null = null;
  let firstStderrAtMs: number | null = null;
  let streamingProviderFailureCount = 0;
  let stoppedForStreamingProviderFailure = false;

  let driverResult: Awaited<ReturnType<typeof runCliDriver>>;
  try {
    driverResult = await runCliDriver({
      allowNonZeroExit: true,
      args: invocation.args,
      bin: invocation.bin,
      cwd: input.openCodeWorkdir,
      env: input.env,
      onLifecycleEvent: input.onRuntimeEvent,
      onProcessControlEvent: input.onProcessControlEvent,
      onStderrLine: (event) => {
        if (firstStderrAtMs === null) {
          firstStderrAtMs = Date.now();
        }
        const providerErrorMessage = collectProviderErrorMessage(
          event.line,
          providerErrorMessages
        );
        if (!providerErrorMessage) {
          return;
        }
        if (looksLikeStreamingProviderFailure(providerErrorMessage)) {
          streamingProviderFailureCount += 1;
          if (
            streamingProviderFailureCount >=
            STREAMING_PROVIDER_FAILURE_THRESHOLD
          ) {
            stoppedForStreamingProviderFailure = true;
            return {
              complete: true,
              terminateProcess: true,
            };
          }
        }
      },
      onStdoutLine: (event) => {
        if (firstStdoutAtMs === null) {
          firstStdoutAtMs = Date.now();
        }
        const parsedLine = parseOpenCodeOutputLine(event.line);
        if (!parsedLine) {
          collectRuntimePermissionDenialMessage(
            event.line,
            providerErrorMessages
          );
          return;
        }

        if (parsedLine.resultText) {
          latestOutput += parsedLine.resultText;
        }

        if (parsedLine.errorMessage) {
          providerErrorMessages.push(parsedLine.errorMessage);
        }

        if (parsedLine.isErrorResult === true) {
          latestResultIsError = true;
          return;
        }

        if (parsedLine.isErrorResult === false) {
          latestResultIsError = false;
        }

        if (parsedLine.sessionId) {
          resolvedSessionId = parsedLine.sessionId;
        }

        if (parsedLine.terminal) {
          return {
            complete: true,
            terminateProcess: true,
          };
        }
      },
      timeoutMs: input.openCodeTimeoutMs,
    });
  } catch (error) {
    throw toOpenCodeCliTransportError(error, input.openCodeTimeoutMs);
  }

  if (stoppedForStreamingProviderFailure) {
    const classifiedFailure = classifyOpenCodeFailure({
      providerErrorMessages,
      stderrText: driverResult.stderrText,
      stdoutText: driverResult.stdoutText,
    });
    throw new OpenCodeCliTransportError({
      code: classifiedFailure.code,
      errorType: classifiedFailure.errorType,
      message: classifiedFailure.message,
    });
  }

  if (driverResult.exitCode !== 0 || latestResultIsError) {
    const classifiedFailure = classifyOpenCodeFailure({
      providerErrorMessages,
      stderrText: driverResult.stderrText,
      stdoutText: driverResult.stdoutText,
    });
    throw new OpenCodeCliTransportError({
      code: classifiedFailure.code,
      errorType: classifiedFailure.errorType,
      message: classifiedFailure.message,
    });
  }

  const documentParsed = parseOpenCodeOutputDocument(driverResult.stdoutText);
  if (documentParsed) {
    if (documentParsed.outputText) {
      latestOutput = documentParsed.outputText;
    }
    if (documentParsed.sessionId) {
      resolvedSessionId = documentParsed.sessionId;
    }
    if (documentParsed.errorMessage) {
      providerErrorMessages.push(documentParsed.errorMessage);
    }
    if (documentParsed.isErrorResult === true) {
      const classifiedFailure = classifyOpenCodeFailure({
        providerErrorMessages,
        stderrText: driverResult.stderrText,
        stdoutText: driverResult.stdoutText,
      });
      throw new OpenCodeCliTransportError({
        code: classifiedFailure.code,
        errorType: classifiedFailure.errorType,
        message: classifiedFailure.message,
      });
    }
  }

  const output = normalizeOptionalText(latestOutput);
  if (!output) {
    if (providerErrorMessages.length > 0) {
      const classifiedFailure = classifyOpenCodeFailure({
        providerErrorMessages,
        stderrText: driverResult.stderrText,
        stdoutText: driverResult.stdoutText,
      });
      throw new OpenCodeCliTransportError({
        code: classifiedFailure.code,
        errorType: classifiedFailure.errorType,
        message: classifiedFailure.message,
      });
    }
    throw new OpenCodeCliTransportError({
      code: "runtime.output.empty",
      errorType: "adapter",
      message: "runtime.output.empty: opencode finished without agent output",
    });
  }

  return {
    output,
    sessionId: normalizeOptionalText(resolvedSessionId),
    telemetry: buildTransportTelemetry({
      driverResult,
      firstStderrAtMs,
      firstStdoutAtMs,
      invokedAtMs,
      resumedContext: normalizeOptionalText(input.sessionId) !== null,
    }),
  };
}

const buildOpenCodeArgs = (input: {
  conversationPolicy?: ConversationPolicy;
  prompt: string;
  sessionId: string | null;
  workdir: string;
}): string[] => {
  const args = [
    "run",
    "--format",
    "json",
    "--print-logs",
    "--dir",
    input.workdir,
  ];
  if (input.sessionId) {
    args.push("--session", input.sessionId);
  }
  const model = normalizeOptionalText(input.conversationPolicy?.model);
  if (model) {
    args.push("--model", model);
  }
  const reasoningLevel = normalizeOptionalText(
    input.conversationPolicy?.reasoningLevel
  );
  if (reasoningLevel) {
    args.push("--variant", reasoningLevel);
  }
  args.push(input.prompt);
  return args;
};

const buildTransportTelemetry = (input: {
  driverResult: Awaited<ReturnType<typeof runCliDriver>>;
  firstStderrAtMs: number | null;
  firstStdoutAtMs: number | null;
  invokedAtMs: number;
  resumedContext: boolean;
}): AdapterDispatchTelemetry => ({
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
  ...(input.firstStderrAtMs === null
    ? {}
    : { firstStderrAtMs: input.firstStderrAtMs }),
  ...(input.firstStdoutAtMs === null
    ? {}
    : { firstStdoutAtMs: input.firstStdoutAtMs }),
  invokedAtMs: input.invokedAtMs,
  ...(input.driverResult.lifecycle.processId === null
    ? {}
    : { processId: input.driverResult.lifecycle.processId }),
  ...(input.driverResult.lifecycle.processSpawnedAtMs === null
    ? {}
    : { processSpawnedAtMs: input.driverResult.lifecycle.processSpawnedAtMs }),
  resumedContext: input.resumedContext,
  ...(input.driverResult.lifecycle.stdinClosedAtMs === null
    ? {}
    : { stdinClosedAtMs: input.driverResult.lifecycle.stdinClosedAtMs }),
  ...(input.driverResult.lifecycle.timeoutTriggeredAtMs === null
    ? {}
    : {
        timeoutTriggeredAtMs: input.driverResult.lifecycle.timeoutTriggeredAtMs,
      }),
});

const toOpenCodeCliTransportError = (
  error: unknown,
  timeoutMs: number | null
): OpenCodeCliTransportError => {
  if (error instanceof OpenCodeCliTransportError) {
    return error;
  }

  if (error instanceof CliDriverError) {
    if (error.code === "process.timeout") {
      const classifiedFailure = classifyCliDriverTimeoutFailure({
        error,
        providerLabel: "opencode",
        timeoutMs,
      });
      return new OpenCodeCliTransportError(classifiedFailure);
    }

    if (error.code === "process.spawn_failed") {
      return new OpenCodeCliTransportError({
        code: "upstream_unreachable",
        errorType: "adapter",
        message: `upstream_unreachable: failed to spawn opencode (${error.message})`,
      });
    }

    if (error.code === "process.non_zero_exit") {
      const classifiedFailure = classifyOpenCodeFailure({
        providerErrorMessages: [],
        stderrText: error.stderrText,
        stdoutText: error.stdoutText,
      });
      return new OpenCodeCliTransportError({
        code: classifiedFailure.code,
        errorType: classifiedFailure.errorType,
        message: classifiedFailure.message,
      });
    }
  }

  const fallbackMessage =
    error instanceof Error ? error.message : String(error);
  return new OpenCodeCliTransportError({
    code: "upstream_unreachable",
    errorType: "adapter",
    message: `upstream_unreachable: failed to execute opencode (${fallbackMessage})`,
  });
};

const classifyOpenCodeFailure = (input: {
  providerErrorMessages: string[];
  stderrText?: string;
  stdoutText?: string;
}): {
  code: string;
  errorType: AdapterErrorType;
  message: string;
} => {
  const providerMessage = resolveProviderFailureMessage(input);
  if (providerMessage) {
    return classifyOpenCodeFailureMessage({
      isContextLost: isLikelyOpenCodeContextLostError,
      message: providerMessage,
    });
  }

  return {
    ...buildProviderExitError({
      providerLabel: "opencode",
    }),
  };
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
    if (
      looksLikeRuntimePermissionDenialMessage(candidate) ||
      looksLikeProviderFailure(candidate)
    ) {
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
    const parsedLine = parseOpenCodeOutputLine(line);
    if (parsedLine?.errorMessage) {
      messages.push(parsedLine.errorMessage);
    }
  }
  return messages;
};

const collectProviderErrorMessage = (
  line: string,
  output: string[]
): string | null => {
  const normalized = normalizeOptionalText(line);
  if (!normalized) {
    return null;
  }
  output.push(normalized);
  return normalized;
};

const collectRuntimePermissionDenialMessage = (
  line: string,
  output: string[]
): void => {
  const normalized = normalizeOptionalText(line);
  if (!(normalized && looksLikeRuntimePermissionDenialMessage(normalized))) {
    return;
  }
  output.push(normalized);
};

const looksLikeProviderFailure = (value: string): boolean => {
  const lowered = value.toLowerCase();
  return (
    lowered.includes("error") ||
    lowered.includes("failed") ||
    lowered.includes("permission") ||
    lowered.includes("reject") ||
    lowered.includes("denied") ||
    lowered.includes("unauthorized") ||
    lowered.includes("not logged in") ||
    lowered.includes("invalid") ||
    lowered.includes("quota") ||
    lowered.includes("rate") ||
    lowered.includes("balance") ||
    lowered.includes("credit") ||
    lowered.includes("billing") ||
    lowered.includes("payment required") ||
    lowered.includes("session") ||
    lowered.includes("unsupported model") ||
    lowered.includes("model is not supported")
  );
};

const looksLikeStreamingProviderFailure = (value: string): boolean => {
  const lowered = value.toLowerCase();
  return (
    lowered.includes("ai_apicallerror") ||
    lowered.includes("bad gateway") ||
    lowered.includes("gateway timeout") ||
    lowered.includes("econnreset") ||
    lowered.includes("etimedout") ||
    lowered.includes("socket hang up")
  );
};

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
