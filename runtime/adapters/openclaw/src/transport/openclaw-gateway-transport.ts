import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterInstructionPrompt,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import { buildCliLaunchInvocation } from "@openmeld/adapter-core";
import {
  classifyOpenClawFailureMessage,
  normalizeOpenClawFailureMessage,
} from "./openclaw-failure.js";
import { readRecentOpenClawSessionErrorMessage } from "./openclaw-session-store.js";

const execFileAsync = promisify(execFile);
const OPENCLAW_GATEWAY_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export type OpenClawGatewayTransportResult = {
  output: string;
  sessionId: string | null;
  sessionKey: string;
  telemetry: AdapterDispatchTelemetry;
};

export class OpenClawGatewayTransportError extends Error {
  readonly code: string;
  readonly errorType: AdapterErrorType;

  constructor(input: {
    code: string;
    errorType: AdapterErrorType;
    message: string;
  }) {
    super(input.message);
    this.code = input.code;
    this.errorType = input.errorType;
    this.name = "OpenClawGatewayTransportError";
  }
}

export async function invokeOpenClawGatewayTransport(input: {
  agentId: string;
  env?: Record<string, string | undefined>;
  idempotencyKey: string;
  instructionPrompt?: AdapterInstructionPrompt;
  launchContract: RuntimeAgentControllerLaunchContract;
  openClawTimeoutMs: number | null;
  openClawWorkdir: string;
  prompt: string;
  resumedContext: boolean;
  sessionKey: string;
}): Promise<OpenClawGatewayTransportResult> {
  const prompt = normalizeOptionalText(input.prompt);
  const sessionKey = normalizeOptionalText(input.sessionKey);
  if (!prompt) {
    throw new OpenClawGatewayTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: prompt is required",
    });
  }
  if (!sessionKey) {
    throw new OpenClawGatewayTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: sessionKey is required",
    });
  }

  const invokedAtMs = Date.now();
  let result: unknown;
  try {
    result = await runOpenClawGatewayJsonCommand({
      args: [
        "gateway",
        "call",
        "agent",
        "--expect-final",
        "--json",
        "--params",
        JSON.stringify({
          agentId: input.agentId,
          idempotencyKey: input.idempotencyKey,
          ...(input.instructionPrompt
            ? {
                extraSystemPrompt:
                  input.instructionPrompt.developerInstructions,
              }
            : {}),
          message: input.instructionPrompt?.userPrompt ?? prompt,
          sessionKey,
        }),
      ],
      env: input.env,
      launchContract: input.launchContract,
      timeoutMs: input.openClawTimeoutMs,
      workdir: input.openClawWorkdir,
    });
  } catch (error) {
    throw await promoteGatewayFailureFromSessionStore({
      agentId: input.agentId,
      env: input.env,
      error,
      minTimestampMs: invokedAtMs,
      sessionKey,
    });
  }

  let normalizedResult: {
    output: string;
    sessionId: string | null;
  };
  try {
    normalizedResult = normalizeOpenClawGatewayAgentResult(result, sessionKey);
  } catch (error) {
    throw await promoteGatewayFailureFromSessionStore({
      agentId: input.agentId,
      env: input.env,
      error,
      minTimestampMs: invokedAtMs,
      sessionKey,
    });
  }

  return {
    output: normalizedResult.output,
    sessionId: normalizedResult.sessionId,
    sessionKey,
    telemetry: {
      completedAtMs: Date.now(),
      invokedAtMs,
      resumedContext: input.resumedContext,
    },
  };
}

async function promoteGatewayFailureFromSessionStore(input: {
  agentId: string;
  env?: Record<string, string | undefined>;
  error: unknown;
  minTimestampMs: number;
  sessionKey: string;
}): Promise<OpenClawGatewayTransportError> {
  const fallbackError =
    input.error instanceof OpenClawGatewayTransportError
      ? input.error
      : toOpenClawGatewayTransportError(input.error);
  const sessionErrorMessage = await readRecentOpenClawSessionErrorMessage({
    agentId: input.agentId,
    env: input.env,
    minTimestampMs: input.minTimestampMs,
    sessionKey: input.sessionKey,
  });
  if (!sessionErrorMessage) {
    return fallbackError;
  }

  const classified = classifyOpenClawFailureMessage({
    message: sessionErrorMessage,
  });
  const normalizedFallbackMessage =
    normalizeOpenClawFailureMessage(fallbackError.message) ??
    fallbackError.message.trim();
  const normalizedClassifiedMessage =
    normalizeOpenClawFailureMessage(classified.message) ??
    classified.message.trim();
  if (
    classified.code === fallbackError.code &&
    normalizedClassifiedMessage === normalizedFallbackMessage
  ) {
    return fallbackError;
  }

  return new OpenClawGatewayTransportError(classified);
}

async function runOpenClawGatewayJsonCommand(input: {
  args: string[];
  env?: Record<string, string | undefined>;
  launchContract: RuntimeAgentControllerLaunchContract;
  timeoutMs: number | null;
  workdir: string;
}): Promise<unknown> {
  try {
    const invocation = buildCliLaunchInvocation({
      args: input.args,
      launchContract: input.launchContract,
    });
    const result = await execFileAsync(invocation.bin, invocation.args, {
      cwd: input.workdir,
      encoding: "utf8",
      env: {
        ...process.env,
        ...(input.env ?? {}),
      },
      maxBuffer: OPENCLAW_GATEWAY_MAX_BUFFER_BYTES,
      ...(input.timeoutMs === null ? {} : { timeout: input.timeoutMs }),
    });
    return JSON.parse(result.stdout);
  } catch (error) {
    throw toOpenClawGatewayTransportError(error);
  }
}

function normalizeOpenClawGatewayAgentResult(
  result: unknown,
  expectedSessionKey: string
): {
  output: string;
  sessionId: string | null;
} {
  if (!result || typeof result !== "object") {
    throw new OpenClawGatewayTransportError({
      code: "upstream_unreachable",
      errorType: "adapter",
      message:
        "upstream_unreachable: openclaw gateway returned a non-object payload for agent",
    });
  }
  const record = result as {
    error?: unknown;
    result?: unknown;
    status?: unknown;
    summary?: unknown;
  };
  const status = normalizeOptionalText(record.status);
  if (!status || status === "ok") {
    return extractSuccessfulAgentResult(record.result, expectedSessionKey);
  }
  const summary =
    normalizeOptionalText(record.summary) ??
    normalizeOptionalText(record.error) ??
    `openclaw gateway agent returned status '${status}'`;
  throw classifyGatewayFailure(summary);
}

function extractSuccessfulAgentResult(
  result: unknown,
  expectedSessionKey: string
): {
  output: string;
  sessionId: string | null;
} {
  if (!result || typeof result !== "object") {
    throw new OpenClawGatewayTransportError({
      code: "upstream_unreachable",
      errorType: "adapter",
      message:
        "upstream_unreachable: openclaw gateway agent payload is missing result details",
    });
  }
  const record = result as {
    meta?: unknown;
    payloads?: unknown;
  };
  const output = extractAgentPayloadText(record.payloads);
  if (!output) {
    throw new OpenClawGatewayTransportError({
      code: "runtime.output.empty",
      errorType: "adapter",
      message:
        "runtime.output.empty: openclaw gateway agent finished without payload text",
    });
  }
  const meta = normalizeAgentMeta(record.meta, expectedSessionKey);
  return {
    output,
    sessionId: meta.sessionId,
  };
}

function normalizeAgentMeta(
  meta: unknown,
  expectedSessionKey: string
): {
  sessionId: string | null;
} {
  if (!meta || typeof meta !== "object") {
    return { sessionId: null };
  }
  const record = meta as {
    agentMeta?: unknown;
    systemPromptReport?: unknown;
  };
  const systemPromptReport = record.systemPromptReport;
  if (systemPromptReport && typeof systemPromptReport === "object") {
    const actualSessionKey = normalizeOptionalText(
      (systemPromptReport as { sessionKey?: unknown }).sessionKey
    );
    if (actualSessionKey && actualSessionKey !== expectedSessionKey) {
      throw new OpenClawGatewayTransportError({
        code: "upstream_unreachable",
        errorType: "adapter",
        message: `upstream_unreachable: openclaw gateway agent returned sessionKey '${actualSessionKey}', expected '${expectedSessionKey}'`,
      });
    }
  }
  const agentMeta = record.agentMeta;
  const agentSessionId =
    agentMeta && typeof agentMeta === "object"
      ? normalizeOptionalText((agentMeta as { sessionId?: unknown }).sessionId)
      : null;
  const reportSessionId =
    systemPromptReport && typeof systemPromptReport === "object"
      ? normalizeOptionalText(
          (systemPromptReport as { sessionId?: unknown }).sessionId
        )
      : null;
  return {
    sessionId: agentSessionId ?? reportSessionId,
  };
}

function extractAgentPayloadText(payloads: unknown): string | null {
  if (!Array.isArray(payloads)) {
    return null;
  }
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") {
      continue;
    }
    const text = normalizeOptionalText((payload as { text?: unknown }).text);
    if (text) {
      return text;
    }
  }
  return null;
}

function toOpenClawGatewayTransportError(
  error: unknown
): OpenClawGatewayTransportError {
  if (error instanceof OpenClawGatewayTransportError) {
    return error;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  ) {
    return new OpenClawGatewayTransportError({
      code: "upstream_unreachable",
      errorType: "adapter",
      message: "upstream_unreachable: openclaw is not installed or not on PATH",
    });
  }
  const stderr = normalizeOptionalText((error as { stderr?: unknown })?.stderr);
  const stdout = normalizeOptionalText((error as { stdout?: unknown })?.stdout);
  const message = stderr ?? stdout ?? toErrorMessage(error);
  return classifyGatewayFailure(message);
}

function classifyGatewayFailure(
  message: string
): OpenClawGatewayTransportError {
  const classified = classifyOpenClawFailureMessage({ message });
  return new OpenClawGatewayTransportError(classified);
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
