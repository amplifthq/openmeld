import type {
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterPreviewCallback,
  AdapterRuntimeEventCallback,
  AdapterRuntimeProcessCallback,
  ConversationPolicy,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import {
  buildCliLaunchInvocation,
  resolveAdapterToolActivityName,
  resolveAdapterToolWorkActivity,
} from "@openmeld/adapter-core";
import { runCliDriver } from "@openmeld/adapter-core/drivers/cli-driver";
import {
  type AntigravityStreamEvent,
  parseAntigravityOutputLine,
} from "../output/antigravity-output-parser.js";

const AUTH_FAILURE_PATTERN =
  /auth(?:entication)? required|not signed in|sign in/iu;
const CONTEXT_FAILURE_PATTERN =
  /conversation[^\n]*(?:not found|missing|unknown|does not exist)/iu;

export type AntigravityCliTransportResult = {
  output: string;
  sessionId: string;
  telemetry: AdapterDispatchTelemetry;
};

export class AntigravityCliTransportError extends Error {
  readonly code: string;
  readonly errorType: AdapterErrorType;
  readonly originalError?: string;
  readonly telemetry?: AdapterDispatchTelemetry;

  constructor(input: {
    code: string;
    errorType: AdapterErrorType;
    message: string;
    originalError?: string;
    telemetry?: AdapterDispatchTelemetry;
  }) {
    super(input.message);
    this.name = "AntigravityCliTransportError";
    this.code = input.code;
    this.errorType = input.errorType;
    this.originalError = input.originalError;
    this.telemetry = input.telemetry;
  }
}

export async function invokeAntigravityCliTransport(input: {
  conversationPolicy?: ConversationPolicy;
  env?: Record<string, string | undefined>;
  launchContract: RuntimeAgentControllerLaunchContract;
  onPreview?: AdapterPreviewCallback;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  sessionId: string | null;
  timeoutMs: number | null;
  workdir: string;
}): Promise<AntigravityCliTransportResult> {
  const prompt = normalizeOptionalText(input.prompt);
  if (!prompt) {
    throw new AntigravityCliTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: prompt is required",
    });
  }
  const invocation = buildCliLaunchInvocation({
    args: buildAntigravityArgs({
      conversationPolicy: input.conversationPolicy,
      prompt,
      sessionId: normalizeOptionalText(input.sessionId),
    }),
    launchContract: input.launchContract,
  });
  const invokedAtMs = Date.now();
  let firstOutputAtMs: number | null = null;
  let conversationId = normalizeOptionalText(input.sessionId);
  const terminal = {
    result: null as Extract<AntigravityStreamEvent, { event: "result" }> | null,
  };
  let malformedOutput = false;
  let previewText = "";
  let previewChain = Promise.resolve();

  const driverResult = await runCliDriver({
    allowNonZeroExit: true,
    args: invocation.args,
    bin: invocation.bin,
    cwd: input.workdir,
    env: input.env,
    onLifecycleEvent: input.onRuntimeEvent,
    onProcessControlEvent: input.onProcessControlEvent,
    onStderrLine: () => undefined,
    onStdoutLine: (lineEvent) => {
      const event = parseAntigravityOutputLine(lineEvent.line);
      if (!event) {
        malformedOutput = true;
        return undefined;
      }
      conversationId = event.conversationId || conversationId;
      if (event.event === "step_update") {
        if (event.stepType === "agent_response" && event.textDelta) {
          firstOutputAtMs ??= Date.now();
          previewText += event.textDelta;
          if (input.onPreview) {
            previewChain = previewChain.then(() =>
              Promise.resolve(input.onPreview?.({ text: previewText })).then(
                () => undefined
              )
            );
          }
        }
        emitToolActivity(event, input.onRuntimeEvent);
      }
      if (event.event === "result") {
        terminal.result = event;
      }
      return undefined;
    },
    timeoutMs: input.timeoutMs,
  });
  await previewChain;

  const telemetry = buildTelemetry({
    driverResult,
    firstOutputAtMs,
    invokedAtMs,
    resumedContext: input.sessionId !== null,
  });
  if (malformedOutput) {
    throw new AntigravityCliTransportError({
      code: "runtime.output.invalid",
      errorType: "adapter",
      message:
        "runtime.output.invalid: Antigravity CLI returned an invalid event stream",
      telemetry,
    });
  }
  const terminalResult = terminal.result;
  if (!terminalResult) {
    throw classifyAntigravityFailure({
      exitCode: driverResult.exitCode,
      signal: driverResult.signal,
      stderr: driverResult.stderrText,
      telemetry,
    });
  }
  if (
    terminalResult.status !== "SUCCESS" ||
    driverResult.exitCode !== 0 ||
    driverResult.signal !== null
  ) {
    throw classifyAntigravityFailure({
      exitCode: driverResult.exitCode,
      providerError: terminalResult.error,
      signal: driverResult.signal,
      stderr: driverResult.stderrText,
      telemetry,
    });
  }
  const output = normalizeOptionalText(terminalResult.response);
  const resolvedSessionId =
    normalizeOptionalText(terminalResult.conversationId) ?? conversationId;
  if (!(output && resolvedSessionId)) {
    throw new AntigravityCliTransportError({
      code: output ? "context.missing" : "runtime.output.empty",
      errorType: "adapter",
      message: output
        ? "context.missing: Antigravity CLI completed without a conversation ID"
        : "runtime.output.empty: Antigravity CLI completed without agent output",
      telemetry,
    });
  }
  return { output, sessionId: resolvedSessionId, telemetry };
}

export function buildAntigravityArgs(input: {
  conversationPolicy?: ConversationPolicy;
  prompt: string;
  sessionId: string | null;
}): string[] {
  const args = [
    "--print",
    input.prompt,
    "--output-format",
    "stream-json",
    "--print-timeout",
    "0",
  ];
  if (input.sessionId) {
    args.push("--conversation", input.sessionId);
  }
  const model = normalizeOptionalText(input.conversationPolicy?.model);
  if (model) {
    args.push("--model", model);
  }
  const effort = normalizeOptionalText(
    input.conversationPolicy?.reasoningLevel
  );
  if (effort) {
    if (!ANTIGRAVITY_EFFORTS.has(effort)) {
      throw new AntigravityCliTransportError({
        code: "model.reasoning_level.unsupported",
        errorType: "config",
        message: `model.reasoning_level.unsupported: Antigravity CLI does not support reasoning level '${effort}'`,
      });
    }
    args.push("--effort", effort);
  }
  if (input.conversationPolicy?.collaborationMode === "plan") {
    args.push("--mode", "plan");
  }
  return args;
}

const ANTIGRAVITY_EFFORTS = new Set(["low", "medium", "high"]);

function emitToolActivity(
  event: Extract<AntigravityStreamEvent, { event: "step_update" }>,
  callback: AdapterRuntimeEventCallback | undefined
): void {
  if (!(callback && event.stepType === "tool" && event.toolName)) {
    return;
  }
  const work = resolveAdapterToolWorkActivity(event.toolName, event.toolInput);
  let state: "input-available" | "output-available" | "output-error";
  if (event.state === "ACTIVE") {
    state = "input-available";
  } else if (event.toolError) {
    state = "output-error";
  } else {
    state = "output-available";
  }
  callback({
    phase: "tool_activity",
    state,
    toolCallId: `antigravity-step-${String(event.stepIndex)}`,
    toolName: resolveAdapterToolActivityName(event.toolName),
    tsMs: Date.now(),
    ...(work ? { work } : {}),
  });
}

function buildTelemetry(input: {
  driverResult: Awaited<ReturnType<typeof runCliDriver>>;
  firstOutputAtMs: number | null;
  invokedAtMs: number;
  resumedContext: boolean;
}): AdapterDispatchTelemetry {
  const lifecycle = input.driverResult.lifecycle;
  return {
    completedAtMs: Date.now(),
    ...(lifecycle.exitCode === null ? {} : { exitCode: lifecycle.exitCode }),
    ...(lifecycle.exitObservedAtMs === null
      ? {}
      : { exitObservedAtMs: lifecycle.exitObservedAtMs }),
    ...(lifecycle.exitSignal === null
      ? {}
      : { exitSignal: lifecycle.exitSignal }),
    ...(input.firstOutputAtMs === null
      ? {}
      : { firstOutputAtMs: input.firstOutputAtMs }),
    ...(lifecycle.firstStderrAtMs === null
      ? {}
      : { firstStderrAtMs: lifecycle.firstStderrAtMs }),
    ...(lifecycle.firstStdoutAtMs === null
      ? {}
      : { firstStdoutAtMs: lifecycle.firstStdoutAtMs }),
    invokedAtMs: input.invokedAtMs,
    ...(lifecycle.processId === null ? {} : { processId: lifecycle.processId }),
    ...(lifecycle.processSpawnedAtMs === null
      ? {}
      : { processSpawnedAtMs: lifecycle.processSpawnedAtMs }),
    resumedContext: input.resumedContext,
    ...(lifecycle.stdinClosedAtMs === null
      ? {}
      : { stdinClosedAtMs: lifecycle.stdinClosedAtMs }),
    streamingMode: "stream",
  };
}

function classifyAntigravityFailure(input: {
  exitCode: number;
  providerError?: string | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  telemetry: AdapterDispatchTelemetry;
}): AntigravityCliTransportError {
  const providerMessage =
    normalizeOptionalText(input.providerError) ??
    normalizeOptionalText(input.stderr) ??
    (input.signal
      ? `Antigravity CLI was interrupted by ${input.signal}.`
      : `Antigravity CLI exited with code ${String(input.exitCode)}.`);
  const authFailure = AUTH_FAILURE_PATTERN.test(providerMessage);
  const contextFailure = CONTEXT_FAILURE_PATTERN.test(providerMessage);
  let code = "provider_exit_error";
  if (authFailure) {
    code = "auth.required";
  } else if (contextFailure) {
    code = "context_not_found";
  } else if (input.signal) {
    code = "runtime.interrupted";
  }
  return new AntigravityCliTransportError({
    code,
    errorType: authFailure ? "auth" : "adapter",
    message: `${code}: ${providerMessage}`,
    telemetry: input.telemetry,
  });
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
