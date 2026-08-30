import { randomUUID } from "node:crypto";
import type {
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterRuntimeEventCallback,
  AdapterRuntimeProcessCallback,
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
import { isLikelyOpenClawContextLostError } from "../context/openclaw-context-heal.js";
import {
  parseOpenClawOutputDocument,
  parseOpenClawOutputLine,
} from "../output/openclaw-output-parser.js";
import { classifyOpenClawFailureMessage } from "./openclaw-failure.js";

export type OpenClawCliTransportResult = {
  output: string;
  sessionId: string | null;
  telemetry: AdapterDispatchTelemetry;
};

export class OpenClawCliTransportError extends Error {
  readonly code: string;
  readonly errorType: AdapterErrorType;
  readonly originalError?: string;

  constructor(input: {
    code: string;
    errorType: AdapterErrorType;
    message: string;
    originalError?: string;
  }) {
    super(input.message);
    this.name = "OpenClawCliTransportError";
    this.code = input.code;
    this.errorType = input.errorType;
    this.originalError = input.originalError;
  }
}

export async function invokeOpenClawCliTransport(input: {
  openClawAgentId: string;
  launchContract: RuntimeAgentControllerLaunchContract;
  openClawTimeoutMs: number | null;
  openClawWorkdir: string;
  env?: Record<string, string | undefined>;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  sessionId: string | null;
}): Promise<OpenClawCliTransportResult> {
  const prompt = normalizeOptionalText(input.prompt);
  if (!prompt) {
    throw new OpenClawCliTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: prompt is required",
    });
  }

  const { args, sessionId: initialSessionId } = buildOpenClawArgs({
    openClawAgentId: input.openClawAgentId,
    prompt,
    sessionId: normalizeOptionalText(input.sessionId),
  });
  const invocation = buildCliLaunchInvocation({
    args,
    launchContract: input.launchContract,
  });

  let latestOutput = "";
  let latestResultIsError = false;
  let resolvedSessionId = initialSessionId;
  const providerErrorMessages: string[] = [];
  const providerOriginalErrorMessages: string[] = [];
  const invokedAtMs = Date.now();
  let firstStdoutAtMs: number | null = null;
  let firstStderrAtMs: number | null = null;

  let driverResult: Awaited<ReturnType<typeof runCliDriver>>;
  try {
    driverResult = await runCliDriver({
      allowNonZeroExit: true,
      args: invocation.args,
      bin: invocation.bin,
      cwd: input.openClawWorkdir,
      env: input.env,
      onLifecycleEvent: input.onRuntimeEvent,
      onProcessControlEvent: input.onProcessControlEvent,
      onStderrLine: (event) => {
        if (firstStderrAtMs === null) {
          firstStderrAtMs = Date.now();
        }
        collectProviderErrorMessage(event.line, providerErrorMessages);
        return undefined;
      },
      onStdoutLine: (event) => {
        if (firstStdoutAtMs === null) {
          firstStdoutAtMs = Date.now();
        }
        const parsedLine = parseOpenClawOutputLine(event.line);
        if (!parsedLine) {
          collectRuntimePermissionDenialMessage(
            event.line,
            providerErrorMessages
          );
          return;
        }

        if (parsedLine.resultText) {
          latestOutput = parsedLine.resultText;
        }

        if (parsedLine.errorMessage) {
          providerErrorMessages.push(parsedLine.errorMessage);
          providerOriginalErrorMessages.push(parsedLine.errorMessage);
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
      timeoutMs: input.openClawTimeoutMs,
    });
  } catch (error) {
    throw toOpenClawCliTransportError(error, input.openClawTimeoutMs);
  }

  if (driverResult.exitCode !== 0 || latestResultIsError) {
    const classifiedFailure = classifyOpenClawFailure({
      providerErrorMessages,
      providerOriginalErrorMessages,
      stderrText: driverResult.stderrText,
      stdoutText: driverResult.stdoutText,
    });
    throw new OpenClawCliTransportError(classifiedFailure);
  }

  const documentParsed = parseOpenClawOutputDocument(driverResult.stdoutText);
  if (documentParsed) {
    if (documentParsed.outputText) {
      latestOutput = documentParsed.outputText;
    }
    if (documentParsed.sessionId) {
      resolvedSessionId = documentParsed.sessionId;
    }
    if (documentParsed.errorMessage) {
      providerErrorMessages.push(documentParsed.errorMessage);
      providerOriginalErrorMessages.push(documentParsed.errorMessage);
    }
    if (documentParsed.isErrorResult === true) {
      const classifiedFailure = classifyOpenClawFailure({
        providerErrorMessages,
        providerOriginalErrorMessages,
        stderrText: driverResult.stderrText,
        stdoutText: driverResult.stdoutText,
      });
      throw new OpenClawCliTransportError(classifiedFailure);
    }
  }

  const output = normalizeOptionalText(latestOutput);
  if (!output) {
    const fallbackOutput = resolveSuccessFallbackOutput(
      driverResult.stdoutText
    );
    if (!fallbackOutput) {
      if (providerErrorMessages.length > 0) {
        const classifiedFailure = classifyOpenClawFailure({
          providerErrorMessages,
          providerOriginalErrorMessages,
          stderrText: driverResult.stderrText,
          stdoutText: driverResult.stdoutText,
        });
        throw new OpenClawCliTransportError(classifiedFailure);
      }
      throw new OpenClawCliTransportError({
        code: "runtime.output.empty",
        errorType: "adapter",
        message: "runtime.output.empty: openclaw finished without agent output",
      });
    }

    return {
      output: fallbackOutput,
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

const buildOpenClawArgs = (input: {
  openClawAgentId: string;
  prompt: string;
  sessionId: string | null;
}): { args: string[]; sessionId: string } => {
  const args = ["agent", "--local", "--agent", input.openClawAgentId];
  const sessionId = input.sessionId ?? randomUUID();
  args.push("--session-id", sessionId);
  args.push("--message", input.prompt, "--json");
  return { args, sessionId };
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

const toOpenClawCliTransportError = (
  error: unknown,
  timeoutMs: number | null
): OpenClawCliTransportError => {
  if (error instanceof OpenClawCliTransportError) {
    return error;
  }

  if (error instanceof CliDriverError) {
    if (error.code === "process.timeout") {
      const classifiedFailure = classifyCliDriverTimeoutFailure({
        error,
        providerLabel: "openclaw",
        timeoutMs,
      });
      return new OpenClawCliTransportError(classifiedFailure);
    }

    if (error.code === "process.spawn_failed") {
      return new OpenClawCliTransportError({
        code: "upstream_unreachable",
        errorType: "adapter",
        message: `upstream_unreachable: failed to spawn openclaw (${error.message})`,
      });
    }

    if (error.code === "process.non_zero_exit") {
      const classifiedFailure = classifyOpenClawFailure({
        providerErrorMessages: [],
        providerOriginalErrorMessages: [],
        stderrText: error.stderrText,
        stdoutText: error.stdoutText,
      });
      return new OpenClawCliTransportError(classifiedFailure);
    }
  }

  const fallbackMessage =
    error instanceof Error ? error.message : String(error);
  return new OpenClawCliTransportError({
    code: "upstream_unreachable",
    errorType: "adapter",
    message: `upstream_unreachable: failed to execute openclaw (${fallbackMessage})`,
  });
};

const classifyOpenClawFailure = (input: {
  providerErrorMessages: string[];
  providerOriginalErrorMessages?: string[];
  stderrText?: string;
  stdoutText?: string;
}): {
  code: string;
  errorType: AdapterErrorType;
  message: string;
  originalError?: string;
} => {
  const trustedProviderMessages = new Set([
    ...(input.providerOriginalErrorMessages ?? []),
    ...extractErrorMessagesFromStdout(input.stdoutText),
  ]);
  const providerMessage = resolveProviderFailureMessage(input);
  if (providerMessage) {
    return classifyOpenClawFailureMessage({
      includeOriginalError: trustedProviderMessages.has(providerMessage),
      isContextLost: isLikelyOpenClawContextLostError,
      message: providerMessage,
    });
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
      providerLabel: "openclaw",
    }),
  };
};

const resolveProviderFailureMessage = (input: {
  providerErrorMessages: string[];
  providerOriginalErrorMessages?: string[];
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
    const parsedLine = parseOpenClawOutputLine(line);
    if (parsedLine?.errorMessage) {
      messages.push(parsedLine.errorMessage);
    }
  }
  return messages;
};

const resolveSuccessFallbackOutput = (value: unknown): string | null => {
  const stdoutText = normalizeOptionalText(value);
  if (!stdoutText) {
    return null;
  }

  const lines = stdoutText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length !== 1) {
    return null;
  }
  const singleLine = lines[0] ?? "";
  if (!singleLine) {
    return null;
  }
  if (singleLine.startsWith("{") || singleLine.startsWith("[")) {
    return null;
  }
  return singleLine;
};

const collectProviderErrorMessage = (line: string, output: string[]): void => {
  const normalized = normalizeOptionalText(line);
  if (!normalized) {
    return;
  }
  output.push(normalized);
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
    lowered.includes("approval") ||
    lowered.includes("unauthorized") ||
    lowered.includes("not logged in") ||
    lowered.includes("invalid") ||
    lowered.includes("quota") ||
    lowered.includes("rate") ||
    lowered.includes("session") ||
    lowered.includes("unsupported model") ||
    lowered.includes("model is not supported")
  );
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}
