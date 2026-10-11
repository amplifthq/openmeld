import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { loadavg } from "node:os";
import {
  createOpencodeClient,
  type Event,
  type PermissionRequest,
  type QuestionRequest,
} from "@opencode-ai/sdk/v2";
import type {
  AdapterDispatchExecutionMode,
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterInstructionPrompt,
  AdapterInteractionCallback,
  AdapterPreviewCallback,
  AdapterProviderAccessEvidence,
  AdapterRuntimeEvent,
  AdapterRuntimeEventCallback,
  AdapterRuntimeProcessCallback,
  AdapterStreamingMode,
  ConversationPolicy,
  RuntimeAgentControllerLaunchContract,
  SpawnedAgentControllerProcess,
} from "@openmeld/adapter-core";
import {
  buildCliLaunchInvocation,
  createProviderOriginalError,
  isDispatchSpaceActionDeliveryOnly,
  readAdapterAiUsageObservation,
  spawnAgentControllerProcess,
} from "@openmeld/adapter-core";
import { runCliDriver } from "@openmeld/adapter-core/drivers/cli-driver";
import { isLikelyOpenCodeContextLostError } from "../context/opencode-context-heal.js";
import { prepareOpenCodeDeliveryOnlyTurn } from "./opencode-delivery-only.js";
import { classifyOpenCodeFailureMessage } from "./opencode-failure.js";
import {
  type OpenCodeInteractionFailure,
  OpenCodeInteractionHandler,
} from "./opencode-interactions.js";
import { createOpenCode2Client } from "./opencode2-server.js";
import {
  assertOpenCode2Directory,
  runOpenCode2Turn,
} from "./opencode2-transport.js";

const SERVER_HOSTNAME = "127.0.0.1";
const OPENCODE_V1_VERSION_RE = /^v?1\./u;
const SERVER_HEALTH_TIMEOUT_MS = 5000;
const SERVER_STARTUP_TIMEOUT_MS = 15_000;
const SERVER_MAX_START_ATTEMPTS = 2;
const SERVER_SLOW_START_MS = 5000;
const SERVER_DIAGNOSTIC_CONNECT_TIMEOUT_MS = 250;
const SERVER_PROCESS_KILL_GRACE_MS = 1000;
const SERVER_PROCESS_CLOSE_TIMEOUT_MS = 2000;
const MAX_STDERR_CHARS = 16_000;
const SERVER_READY_LINE_PATTERN =
  /^(?:opencode )?server listening on (https?:\/\/[^\s]+)$/;

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

export type OpenCodeServerTransportResult = {
  output: string;
  sessionId: string;
  telemetry: AdapterDispatchTelemetry;
};

type OpenCodeServerTransportInput = {
  conversationPolicy?: ConversationPolicy;
  env?: Record<string, string | undefined>;
  executionMode?: AdapterDispatchExecutionMode;
  launchContract: RuntimeAgentControllerLaunchContract;
  instructionPrompt?: AdapterInstructionPrompt;
  onInteractionRequest?: AdapterInteractionCallback;
  onPreview?: AdapterPreviewCallback;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  openCodeTimeoutMs: number | null;
  openCodeWorkdir: string;
  prompt: string;
  sessionId: string | null;
  streamingMode?: AdapterStreamingMode;
};

type OpenCodeServerLifecycleInput = { pure?: boolean } & Pick<
  OpenCodeServerTransportInput,
  | "env"
  | "launchContract"
  | "onProcessControlEvent"
  | "onRuntimeEvent"
  | "openCodeTimeoutMs"
  | "openCodeWorkdir"
>;

export class OpenCodeServerTransportError extends Error {
  telemetry?: AdapterDispatchTelemetry;
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
    this.name = "OpenCodeServerTransportError";
    this.code = input.code;
    this.errorType = input.errorType;
    this.originalError = input.originalError;
    this.providerAccessEvidence = input.providerAccessEvidence;
  }
}

export async function invokeOpenCodeServerTransport(
  input: OpenCodeServerTransportInput
): Promise<OpenCodeServerTransportResult> {
  const prompt = normalizeOptionalText(input.prompt);
  if (!prompt) {
    throw new OpenCodeServerTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: prompt is required",
    });
  }

  const invokedAtMs = Date.now();
  const deadlineMs =
    input.openCodeTimeoutMs === null
      ? null
      : invokedAtMs + input.openCodeTimeoutMs;
  const { server, serverUrl } = await startHealthyOpenCodeServer({
    ...input,
    deadlineMs,
  });
  const client = createOpencodeClient({
    baseUrl: serverUrl,
    directory: input.openCodeWorkdir,
    responseStyle: "data",
    throwOnError: true,
  });
  const canonicalRepairSessionId =
    input.executionMode === "repair" ||
    isDispatchSpaceActionDeliveryOnly(input.env)
      ? normalizeOptionalText(input.sessionId)
      : null;
  let result:
    | {
        aiUsage?: AdapterDispatchTelemetry["aiUsage"];
        output: string;
        previewEmitted: boolean;
        sessionId: string;
      }
    | undefined;
  try {
    if (server.apiMajor === 2) {
      if (canonicalRepairSessionId) {
        throw new OpenCodeServerTransportError({
          code: "delivery_scope.unsupported",
          errorType: "config",
          message:
            "OpenCode 2 reply repair requires an attested restricted tool scope.",
        });
      }
      const abort = new AbortController();
      try {
        result = await Promise.race([
          runOpenCode2Turn({
            ...input,
            client: createOpenCode2Client(serverUrl, server.apiPassword),
            directory: input.openCodeWorkdir,
            signal: abort.signal,
          }),
          server.waitForFailure(),
        ]);
      } finally {
        abort.abort();
      }
    } else {
      const executionSessionId = canonicalRepairSessionId
        ? await forkOpenCodeSessionWithClient({
            client,
            openCodeWorkdir: input.openCodeWorkdir,
            sourceSessionId: canonicalRepairSessionId,
          })
        : normalizeOptionalText(input.sessionId);
      result = await runOpenCodeServerTurn({
        env: input.env,
        onRuntimeEvent: input.onRuntimeEvent,
        client,
        conversationPolicy: input.conversationPolicy,
        instructionPrompt: input.instructionPrompt,
        observedSessionId: canonicalRepairSessionId,
        onInteractionRequest: input.onInteractionRequest,
        onPreview: input.onPreview,
        openCodeWorkdir: input.openCodeWorkdir,
        prompt,
        server,
        sessionId: executionSessionId,
        streamingMode: input.streamingMode ?? "final",
      });
    }
  } catch (error) {
    const failure = toOpenCodeServerTransportError(error, server.readStderr());
    failure.telemetry = server.buildTelemetry({
      invokedAtMs,
      previewEmitted: false,
      resumedContext: normalizeOptionalText(input.sessionId) !== null,
      streamingMode: input.streamingMode ?? "final",
    });
    throw failure;
  } finally {
    await server.close();
  }

  if (!result) {
    throw new OpenCodeServerTransportError({
      code: "runtime.output.empty",
      errorType: "adapter",
      message: "runtime.output.empty: OpenCode finished without a result",
    });
  }
  return {
    output: result.output,
    sessionId: canonicalRepairSessionId ?? result.sessionId,
    telemetry: {
      ...server.buildTelemetry({
        invokedAtMs,
        previewEmitted: result.previewEmitted,
        resumedContext: normalizeOptionalText(input.sessionId) !== null,
        streamingMode: input.streamingMode ?? "final",
      }),
      ...(result.aiUsage ? { aiUsage: result.aiUsage } : {}),
    },
  };
}

export async function forkOpenCodeServerSession(input: {
  env?: Record<string, string | undefined>;
  launchContract: RuntimeAgentControllerLaunchContract;
  openCodeTimeoutMs: number | null;
  openCodeWorkdir: string;
  sourceSessionId: string;
  title?: string;
}): Promise<{ sessionId: string }> {
  const sourceSessionId = normalizeOptionalText(input.sourceSessionId);
  if (!sourceSessionId) {
    throw new OpenCodeServerTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: sourceSessionId is required",
    });
  }
  const deadlineMs =
    input.openCodeTimeoutMs === null
      ? null
      : Date.now() + input.openCodeTimeoutMs;
  const { server, serverUrl } = await startHealthyOpenCodeServer({
    ...input,
    deadlineMs,
  });
  try {
    if (server.apiMajor === 2) {
      const client = createOpenCode2Client(serverUrl, server.apiPassword);
      const options = { signal: AbortSignal.timeout(15_000) };
      const source = await client.session.get(
        { sessionID: sourceSessionId },
        options
      );
      await assertOpenCode2Directory(source, input.openCodeWorkdir);
      const fork = await client.session.fork(
        { sessionID: sourceSessionId },
        options
      );
      if (input.title) {
        await client.session.update(
          { sessionID: fork.id, title: input.title },
          options
        );
      }
      return { sessionId: fork.id };
    }
    const client = createOpencodeClient({
      baseUrl: serverUrl,
      directory: input.openCodeWorkdir,
      responseStyle: "data",
      throwOnError: true,
    });
    const sessionId = await forkOpenCodeSessionWithClient({
      client,
      openCodeWorkdir: input.openCodeWorkdir,
      sourceSessionId,
    });
    const title = normalizeOptionalText(input.title);
    if (title) {
      try {
        await client.session.update(
          {
            directory: input.openCodeWorkdir,
            sessionID: sessionId,
            title,
          },
          {
            responseStyle: "data",
            throwOnError: true,
          }
        );
      } catch (error) {
        console.warn("[openmeld.opencode.fork_title_sync_failed]", {
          error,
          sessionId,
        });
      }
    }
    return { sessionId };
  } catch (error) {
    throw toOpenCodeServerTransportError(error, server.readStderr());
  } finally {
    await server.close();
  }
}

async function forkOpenCodeSessionWithClient(input: {
  client: ReturnType<typeof createOpencodeClient>;
  openCodeWorkdir: string;
  sourceSessionId: string;
}): Promise<string> {
  const sourceSession = await input.client.session.get(
    {
      directory: input.openCodeWorkdir,
      sessionID: input.sourceSessionId,
    },
    {
      responseStyle: "data",
      throwOnError: true,
    }
  );
  const { directory } = await readOpenCodeSessionForWorkingDirectory({
    session: sourceSession,
    workingDirectory: input.openCodeWorkdir,
  });
  const session = await input.client.session.fork(
    {
      directory,
      sessionID: input.sourceSessionId,
    },
    {
      responseStyle: "data",
      throwOnError: true,
    }
  );
  return (
    await readOpenCodeSessionForWorkingDirectory({
      session,
      workingDirectory: input.openCodeWorkdir,
    })
  ).sessionId;
}

async function startHealthyOpenCodeServer(
  input: OpenCodeServerLifecycleInput & { deadlineMs: number | null }
): Promise<{ server: OpenCodeServerProcess; serverUrl: string }> {
  const pure = isDispatchSpaceActionDeliveryOnly(input.env);
  if (pure) {
    const invocation = buildCliLaunchInvocation({
      launchContract: input.launchContract,
      args: ["--version"],
    });
    const version = await runCliDriver({
      ...invocation,
      cwd: input.openCodeWorkdir,
      env: input.env,
      timeoutMs: SERVER_STARTUP_TIMEOUT_MS,
    });
    if (!OPENCODE_V1_VERSION_RE.test(version.stdoutText.trim())) {
      throw new OpenCodeServerTransportError({
        code: "delivery_scope.unsupported",
        errorType: "config",
        message:
          "OpenCode reply repair requires the verified OpenCode 1 pure-server contract.",
      });
    }
  }
  let lastError: OpenCodeServerTransportError | null = null;
  const startupEvidence: string[] = [];

  for (
    let attemptIndex = 0;
    attemptIndex < SERVER_MAX_START_ATTEMPTS;
    attemptIndex += 1
  ) {
    const remainingTimeoutMs = readRemainingTimeoutMs(input.deadlineMs);
    if (remainingTimeoutMs !== null && remainingTimeoutMs <= 0) {
      break;
    }
    const startupTimeoutMs = Math.min(
      remainingTimeoutMs ?? Number.POSITIVE_INFINITY,
      SERVER_STARTUP_TIMEOUT_MS
    );
    const attempt = await runOpenCodeServerStartAttempt({
      ...input,
      pure,
      openCodeTimeoutMs: remainingTimeoutMs,
      startupTimeoutMs,
    });
    if (attempt.status === "success") {
      return { server: attempt.server, serverUrl: attempt.serverUrl };
    }
    startupEvidence.push(
      `Startup evidence, attempt ${attemptIndex + 1}: ${JSON.stringify(attempt.evidence)}`
    );
    lastError = new OpenCodeServerTransportError({
      ...attempt.error,
      message: `${attempt.error.message} OpenCode server ${attempt.phase === "startup" ? "startup" : "health check"} failed on attempt ${attemptIndex + 1} of ${SERVER_MAX_START_ATTEMPTS}. No Agent task was sent.`,
      originalError:
        createProviderOriginalError(
          [
            ...startupEvidence,
            `OpenCode server ${attempt.phase}, attempt ${attemptIndex + 1} of ${SERVER_MAX_START_ATTEMPTS}.`,
            attempt.error.originalError ?? attempt.error.message,
          ].join("\n")
        ) ?? undefined,
    });
    if (!attempt.serverExited) {
      throw createOpenCodeServerCleanupError();
    }
    const hasNextAttempt = attemptIndex < SERVER_MAX_START_ATTEMPTS - 1;
    if (
      !shouldRetryOpenCodeServerStart({
        attempt,
        deadlineMs: input.deadlineMs,
        hasNextAttempt,
      })
    ) {
      throw lastError;
    }
    logOpenCodeServerStartRetry({ attempt, attemptIndex });
  }

  throw (
    lastError ??
    new OpenCodeServerTransportError({
      code: "upstream_unreachable",
      errorType: "adapter",
      message: "upstream_unreachable: opencode serve did not become healthy",
    })
  );
}

type OpenCodeServerStartAttempt =
  | {
      server: OpenCodeServerProcess;
      serverUrl: string;
      status: "success";
    }
  | {
      error: OpenCodeServerTransportError;
      evidence: ReturnType<OpenCodeServerProcess["readStartupEvidence"]>;
      phase: "health" | "startup";
      serverExited: boolean;
      status: "failed";
    };

async function runOpenCodeServerStartAttempt(
  input: OpenCodeServerLifecycleInput & {
    deadlineMs: number | null;
    startupTimeoutMs: number;
  }
): Promise<OpenCodeServerStartAttempt> {
  const server = new OpenCodeServerProcess(input);
  let serverUrl: string;
  try {
    serverUrl = await server.start();
  } catch (error) {
    return await closeFailedOpenCodeServer({ error, phase: "startup", server });
  }
  try {
    if (server.apiMajor === 2) {
      const info = await createOpenCode2Client(
        serverUrl,
        server.apiPassword
      ).server.info({ signal: AbortSignal.timeout(SERVER_HEALTH_TIMEOUT_MS) });
      if (!info.version.startsWith("2.")) {
        throw new Error("OpenCode returned an unsupported server API version.");
      }
    } else {
      await assertOpenCodeServerHealthy({
        deadlineMs: input.deadlineMs,
        directory: input.openCodeWorkdir,
        serverUrl,
      });
    }
    return { server, serverUrl, status: "success" };
  } catch (error) {
    return await closeFailedOpenCodeServer({ error, phase: "health", server });
  }
}

async function assertOpenCodeServerHealthy(input: {
  deadlineMs: number | null;
  directory: string;
  serverUrl: string;
}): Promise<void> {
  const healthTimeoutMs = Math.min(
    readRemainingTimeoutMs(input.deadlineMs) ?? Number.POSITIVE_INFINITY,
    SERVER_HEALTH_TIMEOUT_MS
  );
  const health = await Promise.race([
    createOpencodeClient({
      baseUrl: input.serverUrl,
      directory: input.directory,
      responseStyle: "data",
      throwOnError: true,
    }).global.health(),
    timeoutAfter(
      healthTimeoutMs,
      "Timed out waiting for opencode serve health."
    ),
  ]);
  if (toRecord(unwrapSdkData(health))?.healthy !== true) {
    throw new OpenCodeServerTransportError({
      code: "upstream_unreachable",
      errorType: "adapter",
      message: "upstream_unreachable: opencode serve reported unhealthy",
    });
  }
}

async function closeFailedOpenCodeServer(input: {
  error: unknown;
  phase: "health" | "startup";
  server: OpenCodeServerProcess;
}): Promise<Extract<OpenCodeServerStartAttempt, { status: "failed" }>> {
  const error = toOpenCodeServerTransportError(
    input.error,
    input.server.readStderr()
  );
  const evidence = input.server.readStartupEvidence();
  console.warn("[openmeld.opencode.server_start.failed]", {
    ...evidence,
    errorCode: error.code,
    phase: input.phase,
  });
  const serverExited = await input.server.close();
  return {
    error,
    evidence,
    phase: input.phase,
    serverExited,
    status: "failed",
  };
}

function shouldRetryOpenCodeServerStart(input: {
  attempt: Extract<OpenCodeServerStartAttempt, { status: "failed" }>;
  deadlineMs: number | null;
  hasNextAttempt: boolean;
}): boolean {
  const remainingRetryBudgetMs = readRemainingTimeoutMs(input.deadlineMs);
  const hasRetryBudget =
    remainingRetryBudgetMs === null || remainingRetryBudgetMs > 0;
  const startupTimedOut =
    input.attempt.phase === "startup" &&
    input.attempt.error.code === "process.timeout";
  return (
    input.hasNextAttempt &&
    hasRetryBudget &&
    (startupTimedOut || input.attempt.phase === "health")
  );
}

function logOpenCodeServerStartRetry(input: {
  attempt: Extract<OpenCodeServerStartAttempt, { status: "failed" }>;
  attemptIndex: number;
}): void {
  const startupTimedOut = input.attempt.phase === "startup";
  console.warn("[openmeld.opencode.server_start.retry]", {
    attempt: input.attemptIndex + 1,
    errorCode: input.attempt.error.code,
    originalError: input.attempt.error.originalError ?? null,
    nextAttempt: input.attemptIndex + 2,
    phase: input.attempt.phase,
    reasonCode: startupTimedOut
      ? "opencode.server_start.timeout"
      : "opencode.server_health.unavailable",
  });
}

function createOpenCodeServerCleanupError(): OpenCodeServerTransportError {
  return new OpenCodeServerTransportError({
    code: "runtime.cleanup_failed",
    errorType: "adapter",
    message:
      "runtime.cleanup_failed: the failed opencode serve process did not exit, so OpenMeld did not start a replacement",
  });
}

function readRemainingTimeoutMs(deadlineMs: number | null): number | null {
  return deadlineMs === null ? null : Math.max(0, deadlineMs - Date.now());
}

async function runOpenCodeServerTurn(input: {
  env?: Record<string, string | undefined>;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  client: ReturnType<typeof createOpencodeClient>;
  conversationPolicy?: ConversationPolicy;
  instructionPrompt?: AdapterInstructionPrompt;
  onInteractionRequest?: AdapterInteractionCallback;
  observedSessionId?: string | null;
  onPreview?: AdapterPreviewCallback;
  openCodeWorkdir: string;
  prompt: string;
  server: OpenCodeServerProcess;
  sessionId: string | null;
  streamingMode: AdapterStreamingMode;
}): Promise<{
  output: string;
  previewEmitted: boolean;
  sessionId: string;
}> {
  const { directory, sessionId } = await resolveOpenCodeSession(input);
  if (isDispatchSpaceActionDeliveryOnly(input.env)) {
    await prepareOpenCodeDeliveryOnlyTurn({
      client: input.client,
      directory,
      sessionId,
      sourceSessionId: input.observedSessionId,
      env: input.env,
    });
  }
  input.server.emitProviderConversationObserved(
    normalizeOptionalText(input.observedSessionId) ?? sessionId
  );
  const interactionHandler = new OpenCodeInteractionHandler({
    client: input.client,
    directory,
    onInteractionRequest: input.onInteractionRequest,
  });
  const eventAbortController = new AbortController();
  const eventReady = createDeferred<void>();
  const eventFailure = createDeferred<never>();
  const turnCompletion = createDeferred<void>();
  // A caller-owned ID correlates this input before any native event can arrive.
  // OpenCode's HTTP 204 acknowledges the handler, not execution admission.
  const promptMessageId = createOpenCodeMessageId();
  const turnState: OpenCodeTurnState = {
    onAccepted: async () => {
      await input.onRuntimeEvent?.({
        phase: "provider_turn_accepted",
        agentControllerConversationId: sessionId,
        turnId: promptMessageId,
        tsMs: Date.now(),
      });
    },
    observeUsage: (message) => input.server.observeUsage(message),
    acceptedSessionIds: new Set([sessionId]),
    assistantMessageIds: new Set(),
    promptDispatchStarted: false,
    promptMessageId,
    promptMessageObserved: false,
    rootIdleObserved: false,
    rootSessionId: sessionId,
    turnCompletion,
  };
  const textByPartId = new Map<string, string>();
  let previewEmitted = false;
  let eventLoop: Promise<void> | null = null;
  try {
    const subscription = await Promise.race([
      input.client.event.subscribe(
        { directory },
        // Native v1 events are not a replayable log. Reconnecting cannot prove
        // which events were missed, so surface a broken stream instead of
        // keeping a stale running projection alive indefinitely.
        { signal: eventAbortController.signal, sseMaxRetryAttempts: 1 }
      ),
      input.server.waitForFailure(),
      timeoutAfter(
        input.server.readStartupTimeoutMs(),
        "Timed out opening the OpenCode event stream."
      ),
    ]);
    eventLoop = consumeOpenCodeEvents({
      onRuntimeEvent: input.onRuntimeEvent,
      reasoningPartIds: new Set<string>(),
      eventReady,
      eventFailure,
      interactionHandler,
      onPreview:
        input.streamingMode === "stream" && input.onPreview
          ? async (preview) => {
              previewEmitted = true;
              await input.onPreview?.(preview);
            }
          : undefined,
      sessionId,
      stream: subscription.stream,
      textByPartId,
      turnState,
    }).catch((error: unknown) => {
      if (!eventAbortController.signal.aborted) {
        eventFailure.reject(error);
      }
    });
    await Promise.race([
      eventReady.promise,
      eventFailure.promise,
      input.server.waitForFailure(),
      timeoutAfter(
        Math.min(
          input.server.readStartupTimeoutMs(),
          SERVER_STARTUP_TIMEOUT_MS
        ),
        "Timed out waiting for the OpenCode event stream."
      ),
    ]);
    const model = parseOpenCodeModel(input.conversationPolicy?.model);
    try {
      turnState.promptDispatchStarted = true;
      // Native events own completion. A delayed/lost HTTP acknowledgement must
      // not hold a turn that the native controller has already completed.
      input.client.session
        .promptAsync(
          {
            directory,
            messageID: promptMessageId,
            ...(model ? { model } : {}),
            parts: [
              {
                text: input.instructionPrompt?.userPrompt ?? input.prompt,
                type: "text",
              },
            ],
            sessionID: sessionId,
            ...(input.instructionPrompt
              ? { system: input.instructionPrompt.developerInstructions }
              : {}),
            ...(normalizeOptionalText(input.conversationPolicy?.reasoningLevel)
              ? {
                  variant: normalizeOptionalText(
                    input.conversationPolicy?.reasoningLevel
                  ) as string,
                }
              : {}),
          },
          {
            responseStyle: "data",
            signal: eventAbortController.signal,
            throwOnError: true,
          }
        )
        .catch((error: unknown) => {
          if (
            !eventAbortController.signal.aborted &&
            turnState.assistantMessageIds.size === 0
          ) {
            eventFailure.reject(error);
          }
        });
      await Promise.race([
        turnCompletion.promise,
        eventFailure.promise,
        input.server.waitForFailure(),
      ]);
    } catch (error) {
      if (
        turnState.assistantMessageIds.size > 0 &&
        !turnState.rootIdleObserved
      ) {
        await input.client.session
          .abort(
            {
              directory,
              sessionID: sessionId,
            },
            {
              responseStyle: "data",
              signal: AbortSignal.timeout(SERVER_HEALTH_TIMEOUT_MS),
              throwOnError: true,
            }
          )
          .catch(() => undefined);
      }
      throw error;
    }
    const interactionFailure = interactionHandler.readFailure();
    if (interactionFailure) {
      throwInteractionFailure(interactionFailure);
    }
    const output = await readOpenCodeTurnOutput({
      client: input.client,
      directory,
      promptMessageId,
      sessionId,
    });
    if (!output) {
      throw new OpenCodeServerTransportError({
        code: "runtime.output.empty",
        errorType: "adapter",
        message: "runtime.output.empty: OpenCode finished without agent output",
      });
    }
    input.server.markAgentOutputObserved();
    if (input.streamingMode !== "stream" && input.onPreview) {
      await input.onPreview({ text: output });
      previewEmitted = true;
    }
    return {
      output,
      previewEmitted,
      sessionId,
    };
  } finally {
    eventAbortController.abort();
    if (eventLoop) {
      await waitForOpenCodeEventLoopCleanup(eventLoop);
    }
  }
}

async function waitForOpenCodeEventLoopCleanup(
  eventLoop: Promise<void>
): Promise<void> {
  await Promise.race([
    eventLoop,
    new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 250);
      timeout.unref?.();
    }),
  ]);
}

async function resolveOpenCodeSession(input: {
  client: ReturnType<typeof createOpencodeClient>;
  conversationPolicy?: ConversationPolicy;
  openCodeWorkdir: string;
  sessionId: string | null;
}): Promise<{ directory: string; sessionId: string }> {
  if (input.sessionId) {
    const session = await input.client.session.get(
      {
        directory: input.openCodeWorkdir,
        sessionID: input.sessionId,
      },
      {
        responseStyle: "data",
        throwOnError: true,
      }
    );
    return readOpenCodeSessionForWorkingDirectory({
      session,
      workingDirectory: input.openCodeWorkdir,
    });
  }
  const parsedModel = parseOpenCodeSessionModel(input.conversationPolicy);
  const session = await input.client.session.create(
    {
      directory: input.openCodeWorkdir,
      ...(parsedModel ? { model: parsedModel } : {}),
      title: "OpenMeld",
    },
    {
      responseStyle: "data",
      throwOnError: true,
    }
  );
  return readOpenCodeSessionForWorkingDirectory({
    session,
    workingDirectory: input.openCodeWorkdir,
  });
}

async function readOpenCodeSessionForWorkingDirectory(input: {
  session: unknown;
  workingDirectory: string;
}): Promise<{ directory: string; sessionId: string }> {
  const session = toRecord(unwrapSdkData(input.session));
  const sessionId = readOpenCodeSessionId(input.session);
  const directory = normalizeOptionalText(session?.directory);
  if (!directory) {
    throw new OpenCodeServerTransportError({
      code: "protocol.invalid",
      errorType: "adapter",
      message: "OpenCode did not return the conversation's working folder.",
    });
  }
  let sameDirectory: boolean;
  try {
    const [sessionPath, workingPath] = await Promise.all([
      realpath(directory),
      realpath(input.workingDirectory),
    ]);
    sameDirectory = sessionPath === workingPath;
  } catch {
    throw new OpenCodeServerTransportError({
      code: "context.workspace_unavailable",
      errorType: "adapter",
      message:
        "This OpenCode session's working folder is unavailable. Restore that folder, or create a new Agent with a new session here.",
    });
  }
  if (!sameDirectory) {
    throw new OpenCodeServerTransportError({
      code: "context.workspace_mismatch",
      errorType: "adapter",
      message:
        "This OpenCode session uses another working folder. Restore that folder for this Agent, or create a new Agent with a new session here.",
    });
  }
  return { directory, sessionId };
}

type OpenCodeTurnState = {
  onAccepted: () => Promise<void>;
  observeUsage: (message: Record<string, unknown>) => void;
  acceptedSessionIds: Set<string>;
  assistantMessageIds: Set<string>;
  promptDispatchStarted: boolean;
  promptMessageId: string;
  promptMessageObserved: boolean;
  rootIdleObserved: boolean;
  rootSessionId: string;
  turnCompletion: Deferred<void>;
};

let lastMessageTimestamp = 0;
let messageCounter = 0;

function createOpenCodeMessageId(): string {
  // Match the 1.18.34 native ascending identifier format. Random UUID ordering
  // would put a new input before older messages in native history readers.
  const timestamp = Date.now();
  messageCounter = timestamp === lastMessageTimestamp ? messageCounter + 1 : 1;
  lastMessageTimestamp = timestamp;
  const time = BigInt.asUintN(
    48,
    BigInt(timestamp) * 0x1000n + BigInt(messageCounter)
  );
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const random = [...randomBytes(14)]
    .map((byte) => alphabet[byte % 62])
    .join("");
  return `msg_${time.toString(16).padStart(12, "0")}${random}`;
}

async function consumeOpenCodeEvents(input: {
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  reasoningPartIds: Set<string>;
  eventReady: Deferred<void>;
  eventFailure: Deferred<never>;
  interactionHandler: OpenCodeInteractionHandler;
  onPreview?: AdapterPreviewCallback;
  sessionId: string;
  stream: AsyncGenerator<Event>;
  textByPartId: Map<string, string>;
  turnState: OpenCodeTurnState;
}): Promise<void> {
  let ready = false;
  for await (const rawEvent of input.stream) {
    if (!ready) {
      ready = true;
      input.eventReady.resolve();
    }
    const event = unwrapOpenCodeEvent(rawEvent);
    if (event) {
      await dispatchOpenCodeEvent(input, event);
    }
  }
  if (!ready) {
    input.eventReady.reject(
      new Error("OpenCode event stream closed before becoming ready.")
    );
  }
  throw new OpenCodeServerTransportError({
    code: "protocol.stream_closed",
    errorType: "network",
    message:
      "OpenCode closed its event stream before this invocation finished.",
  });
}

function observeOpenCodeReasoning(
  input: {
    turnState: OpenCodeTurnState;
    reasoningPartIds: Set<string>;
    onRuntimeEvent?: AdapterRuntimeEventCallback;
  },
  event: { type: string },
  properties: Record<string, unknown>
): void {
  if (!input.turnState.promptDispatchStarted) {
    return;
  }
  const part = toRecord(properties.part);
  if (
    event.type === "message.part.updated" &&
    part?.type === "reasoning" &&
    typeof part.id === "string" &&
    typeof part.text === "string" &&
    typeof part.messageID === "string" &&
    input.turnState.assistantMessageIds.has(part.messageID)
  ) {
    input.reasoningPartIds.add(part.id);
    if (input.reasoningPartIds.size > 128) {
      const oldest = input.reasoningPartIds.values().next().value;
      if (oldest) {
        input.reasoningPartIds.delete(oldest);
      }
    }
    Promise.resolve(
      input.onRuntimeEvent?.({
        phase: "reasoning",
        blockId: part.id,
        text: part.text,
        mode: "snapshot",
        tsMs: Date.now(),
      })
    ).catch(() => undefined);
  } else if (
    event.type === "message.part.delta" &&
    properties.field === "text" &&
    typeof properties.partID === "string" &&
    input.reasoningPartIds.has(properties.partID) &&
    typeof properties.delta === "string"
  ) {
    Promise.resolve(
      input.onRuntimeEvent?.({
        phase: "reasoning",
        blockId: properties.partID,
        text: properties.delta,
        mode: "append",
        tsMs: Date.now(),
      })
    ).catch(() => undefined);
  }
}

async function dispatchOpenCodeEvent(
  input: {
    onRuntimeEvent?: AdapterRuntimeEventCallback;
    reasoningPartIds: Set<string>;
    eventFailure: Deferred<never>;
    interactionHandler: OpenCodeInteractionHandler;
    onPreview?: AdapterPreviewCallback;
    sessionId: string;
    textByPartId: Map<string, string>;
    turnState: OpenCodeTurnState;
  },
  event: { properties: unknown; type: string }
): Promise<void> {
  const properties = toRecord(event.properties);
  if (!properties) {
    return;
  }
  observeOpenCodeSessionTree(input.turnState, event.type, properties);
  if (!eventBelongsToTurn(properties, input.turnState)) {
    return;
  }
  await observeOpenCodeTurnLifecycle(input.turnState, event.type, properties);
  observeOpenCodeReasoning(input, event, properties);
  const eventFailure = readOpenCodeTurnEventFailure(
    input.turnState,
    event.type,
    properties
  );
  if (eventFailure) {
    input.eventFailure.reject(
      new OpenCodeServerTransportError(
        classifyOpenCodeFailureMessage({
          includeOriginalError: true,
          isContextLost: isLikelyOpenCodeContextLostError,
          message: eventFailure,
        })
      )
    );
    return;
  }
  if (
    event.type === "permission.asked" ||
    event.type === "permission.v2.asked"
  ) {
    const request = readPermissionRequest(properties);
    if (request) {
      detachOpenCodeEventTask(
        input.interactionHandler.handlePermission(request),
        input.eventFailure
      );
    }
    return;
  }
  if (event.type === "question.asked" || event.type === "question.v2.asked") {
    const request = readQuestionRequest(properties);
    if (request) {
      detachOpenCodeEventTask(
        input.interactionHandler.handleQuestion(request),
        input.eventFailure
      );
    }
    return;
  }
  if (event.type === "message.part.updated" && input.onPreview) {
    detachOpenCodeEventTask(
      updateOpenCodePreview({
        assistantMessageIds: input.turnState.assistantMessageIds,
        onPreview: input.onPreview,
        part: properties.part,
        textByPartId: input.textByPartId,
      }),
      input.eventFailure
    );
  }
}

function detachOpenCodeEventTask(
  task: Promise<void>,
  eventFailure: Deferred<never>
): void {
  task.catch(eventFailure.reject);
}

function eventBelongsToTurn(
  properties: Record<string, unknown>,
  turnState: OpenCodeTurnState
): boolean {
  const eventSessionId =
    normalizeOptionalText(properties.sessionID) ??
    normalizeOptionalText(toRecord(properties.part)?.sessionID);
  return (
    eventSessionId === null || turnState.acceptedSessionIds.has(eventSessionId)
  );
}

function observeOpenCodeSessionTree(
  turnState: OpenCodeTurnState,
  eventType: string,
  properties: Record<string, unknown>
): void {
  if (eventType !== "session.created" && eventType !== "session.updated") {
    return;
  }
  const session = toRecord(properties.info);
  const sessionId =
    normalizeOptionalText(properties.sessionID) ??
    normalizeOptionalText(session?.id);
  const parentId = normalizeOptionalText(session?.parentID);
  if (sessionId && parentId && turnState.acceptedSessionIds.has(parentId)) {
    turnState.acceptedSessionIds.add(sessionId);
  }
}

async function observeOpenCodeTurnLifecycle(
  turnState: OpenCodeTurnState,
  eventType: string,
  properties: Record<string, unknown>
): Promise<void> {
  if (eventType === "message.updated") {
    const message = toRecord(properties.info);
    const messageId = normalizeOptionalText(message?.id);
    const messageSessionId =
      normalizeOptionalText(message?.sessionID) ??
      normalizeOptionalText(properties.sessionID);
    if (
      turnState.promptDispatchStarted &&
      message?.role === "user" &&
      messageSessionId === turnState.rootSessionId &&
      messageId === turnState.promptMessageId
    ) {
      turnState.promptMessageObserved = true;
    }
    if (
      message?.role === "assistant" &&
      turnState.promptDispatchStarted &&
      messageSessionId === turnState.rootSessionId &&
      normalizeOptionalText(message.parentID) === turnState.promptMessageId &&
      messageId
    ) {
      const first = turnState.assistantMessageIds.size === 0;
      turnState.assistantMessageIds.add(messageId);
      if (first) {
        await turnState.onAccepted();
      }
    }
    if (
      message?.role === "assistant" &&
      (normalizeOptionalText(message.parentID) === turnState.promptMessageId ||
        (messageSessionId !== turnState.rootSessionId &&
          messageSessionId !== null &&
          turnState.acceptedSessionIds.has(messageSessionId)))
    ) {
      turnState.observeUsage(message);
    }
    return;
  }
  const sessionId = normalizeOptionalText(properties.sessionID);
  const isRootSession = sessionId === turnState.rootSessionId;
  const status = toRecord(properties.status);
  const isIdle =
    eventType === "session.idle" ||
    (eventType === "session.status" && status?.type === "idle");
  if (
    isRootSession &&
    isIdle &&
    turnState.promptMessageObserved &&
    turnState.assistantMessageIds.size > 0
  ) {
    turnState.rootIdleObserved = true;
    maybeResolveOpenCodeTurn(turnState);
  }
}

function maybeResolveOpenCodeTurn(turnState: OpenCodeTurnState): void {
  if (
    turnState.promptMessageObserved &&
    turnState.assistantMessageIds.size > 0 &&
    turnState.rootIdleObserved
  ) {
    turnState.turnCompletion.resolve();
  }
}

function readOpenCodeTurnEventFailure(
  turnState: OpenCodeTurnState,
  eventType: string,
  properties: Record<string, unknown>
): string | null {
  if (eventType === "session.error") {
    return (
      readOpenCodeProviderFailure(properties.error) ??
      "OpenCode reported a session error."
    );
  }
  if (eventType !== "message.updated") {
    return null;
  }
  const message = toRecord(properties.info);
  if (
    message?.role !== "assistant" ||
    normalizeOptionalText(message.parentID) !== turnState.promptMessageId
  ) {
    return null;
  }
  return readOpenCodeProviderFailure(message.error);
}

async function updateOpenCodePreview(input: {
  assistantMessageIds: ReadonlySet<string>;
  onPreview: AdapterPreviewCallback;
  part: unknown;
  textByPartId: Map<string, string>;
}): Promise<void> {
  const part = toRecord(input.part);
  const partId = normalizeOptionalText(part?.id);
  const messageId = normalizeOptionalText(part?.messageID);
  const text =
    part?.type === "text" && part?.ignored !== true
      ? normalizeOutputText(part.text)
      : null;
  if (
    !(partId && messageId && input.assistantMessageIds.has(messageId) && text)
  ) {
    return;
  }
  input.textByPartId.set(partId, text);
  await input.onPreview({
    text: [...input.textByPartId.values()].join(""),
  });
}

async function readOpenCodeTurnOutput(input: {
  client: ReturnType<typeof createOpencodeClient>;
  directory: string;
  promptMessageId: string;
  sessionId: string;
}): Promise<string> {
  const result = await input.client.session.messages(
    {
      directory: input.directory,
      limit: 100,
      sessionID: input.sessionId,
    },
    {
      responseStyle: "data",
      throwOnError: true,
    }
  );
  const messages = unwrapSdkData(result);
  const assistantReplies = Array.isArray(messages)
    ? messages.filter((value) => {
        const message = toRecord(value);
        const info = toRecord(message?.info);
        return (
          info?.role === "assistant" &&
          normalizeOptionalText(info.parentID) === input.promptMessageId
        );
      })
    : [];
  const reply = toRecord(assistantReplies.at(-1));
  const info = toRecord(reply?.info);
  const providerFailure = readOpenCodeProviderFailure(info?.error);
  if (providerFailure) {
    throw new Error(providerFailure);
  }
  return (Array.isArray(reply?.parts) ? reply.parts : [])
    .flatMap((value) => {
      const part = toRecord(value);
      return part?.type === "text" &&
        part.ignored !== true &&
        typeof part.text === "string"
        ? [part.text]
        : [];
    })
    .join("")
    .trim();
}

function unwrapOpenCodeEvent(
  value: unknown
): { properties: unknown; type: string } | null {
  const record = toRecord(value);
  const payload = toRecord(record?.payload) ?? record;
  const type = normalizeOptionalText(payload?.type);
  if (!type) {
    return null;
  }
  return {
    properties: payload?.properties ?? payload?.data,
    type,
  };
}

function readPermissionRequest(
  properties: Record<string, unknown>
): PermissionRequest | null {
  const id = normalizeOptionalText(properties.id);
  const sessionID = normalizeOptionalText(properties.sessionID);
  const permission =
    normalizeOptionalText(properties.permission) ??
    normalizeOptionalText(properties.action);
  if (!(id && sessionID && permission)) {
    return null;
  }
  return {
    always: readStringArray(properties.always ?? properties.save),
    id,
    metadata: toRecord(properties.metadata) ?? {},
    patterns: readStringArray(properties.patterns ?? properties.resources),
    permission,
    sessionID,
    ...(toRecord(properties.tool)
      ? {
          tool: {
            callID:
              normalizeOptionalText(toRecord(properties.tool)?.callID) ?? "",
            messageID:
              normalizeOptionalText(toRecord(properties.tool)?.messageID) ?? "",
          },
        }
      : {}),
  };
}

function readQuestionRequest(
  properties: Record<string, unknown>
): QuestionRequest | null {
  const id = normalizeOptionalText(properties.id);
  const sessionID = normalizeOptionalText(properties.sessionID);
  const questions = Array.isArray(properties.questions)
    ? properties.questions.flatMap((value) => {
        const question = toRecord(value);
        const prompt = normalizeOptionalText(
          question?.question ?? question?.prompt
        );
        if (!prompt) {
          return [];
        }
        return [
          {
            custom: question?.custom === true,
            header: normalizeOptionalText(question?.header) ?? "Question",
            multiple: question?.multiple === true,
            options: (Array.isArray(question?.options)
              ? question.options
              : []
            ).flatMap((optionValue) => {
              const option = toRecord(optionValue);
              const label = normalizeOptionalText(option?.label);
              return label
                ? [
                    {
                      description:
                        normalizeOptionalText(option?.description) ?? "",
                      label,
                    },
                  ]
                : [];
            }),
            question: prompt,
          },
        ];
      })
    : [];
  if (!(id && sessionID && questions.length > 0)) {
    return null;
  }
  return {
    id,
    questions,
    sessionID,
  };
}

function throwInteractionFailure(failure: OpenCodeInteractionFailure): never {
  throw new OpenCodeServerTransportError({
    code: failure.code,
    errorType: "config",
    message: failure.message,
  });
}

class OpenCodeServerProcess {
  apiMajor: 1 | 2 = 1;
  readonly apiPassword = randomUUID();
  readonly #pure: boolean;
  readonly #aiUsage = new Map<
    string,
    NonNullable<AdapterDispatchTelemetry["aiUsage"]>[number]
  >();
  readonly #env?: Record<string, string | undefined>;
  readonly #failure = createDeferred<never>();
  readonly #launchContract: RuntimeAgentControllerLaunchContract;
  readonly #onProcessControlEvent?: AdapterRuntimeProcessCallback;
  readonly #onRuntimeEvent?: AdapterRuntimeEventCallback;
  readonly #openCodeTimeoutMs: number | null;
  readonly #openCodeWorkdir: string;
  #child: ChildProcessWithoutNullStreams | null = null;
  #runtimeProcess: SpawnedAgentControllerProcess | null = null;
  #expectedExit = false;
  #firstOutputAtMs: number | null = null;
  #forceKillTimeout: NodeJS.Timeout | null = null;
  #lineBuffer = "";
  #processTimeout: NodeJS.Timeout | null = null;
  #settledFailure: unknown = null;
  #stderr = "";
  #stdoutBytes = 0;
  #stderrBytes = 0;
  #stdoutLines = 0;
  #readyLineObserved = false;
  #startupStartedAt = 0;
  #port: number | null = null;
  #portProbe: { status: string; elapsedMs?: number; observedAtMs?: number } = {
    status: "not_sampled",
  };
  #slowStartTimer: NodeJS.Timeout | null = null;
  #diagnosticSocket: ReturnType<typeof connect> | null = null;
  #startupReject: ((error: unknown) => void) | null = null;
  #startupResolve: ((url: string) => void) | null = null;
  readonly #startupTimeoutMs: number;
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
    pure?: boolean;
    env?: Record<string, string | undefined>;
    launchContract: RuntimeAgentControllerLaunchContract;
    onProcessControlEvent?: AdapterRuntimeProcessCallback;
    onRuntimeEvent?: AdapterRuntimeEventCallback;
    openCodeTimeoutMs: number | null;
    openCodeWorkdir: string;
    startupTimeoutMs: number;
  }) {
    this.#pure = input.pure === true;
    this.#env = input.env;
    this.#launchContract = input.launchContract;
    this.#onProcessControlEvent = input.onProcessControlEvent;
    this.#onRuntimeEvent = input.onRuntimeEvent;
    this.#openCodeTimeoutMs = input.openCodeTimeoutMs;
    this.#openCodeWorkdir = input.openCodeWorkdir;
    this.#startupTimeoutMs = input.startupTimeoutMs;
    this.#failure.promise.catch(() => undefined);
  }

  async start(): Promise<string> {
    const port = await reserveLocalPort();
    this.#port = port;
    this.#startupStartedAt = performance.now();
    const invocation = buildCliLaunchInvocation({
      args: [
        "serve",
        ...(this.#pure ? ["--pure"] : []),
        `--hostname=${SERVER_HOSTNAME}`,
        `--port=${port}`,
      ],
      launchContract: this.#launchContract,
    });
    const runtimeProcess = spawnAgentControllerProcess({
      args: invocation.args,
      bin: invocation.bin,
      cwd: this.#openCodeWorkdir,
      env: {
        ...process.env,
        ...(this.#env ?? {}),
        OPENCODE_PASSWORD: this.apiPassword,
      },
      shell: invocation.shell ?? false,
    });
    const { child, processId, signalTarget } = runtimeProcess;
    this.#child = child;
    this.#runtimeProcess = runtimeProcess;
    const processSpawnedAtMs = Date.now();
    this.#lifecycle.processId = processId;
    this.#lifecycle.processSpawnedAtMs = processSpawnedAtMs;
    this.#emitRuntimeEvent({
      phase: "process_spawned",
      processId,
      signalTarget,
      tsMs: processSpawnedAtMs,
    });
    this.#onProcessControlEvent?.({
      phase: "process_spawned",
      processId,
      signalTarget,
    });

    const startup = new Promise<string>((resolve, reject) => {
      this.#startupResolve = resolve;
      this.#startupReject = reject;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      this.#stdoutBytes += Buffer.byteLength(chunk);
      if (this.#lifecycle.firstStdoutAtMs === null) {
        const firstStdoutAtMs = Date.now();
        this.#lifecycle.firstStdoutAtMs = firstStdoutAtMs;
        this.#emitRuntimeEvent({
          phase: "first_stdout",
          processId,
          tsMs: firstStdoutAtMs,
        });
      }
      this.#consumeStdout(String(chunk), port);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.#stderrBytes += Buffer.byteLength(chunk);
      if (this.#lifecycle.firstStderrAtMs === null) {
        const firstStderrAtMs = Date.now();
        this.#lifecycle.firstStderrAtMs = firstStderrAtMs;
        this.#emitRuntimeEvent({
          phase: "first_stderr",
          processId,
          tsMs: firstStderrAtMs,
        });
      }
      this.#stderr = `${this.#stderr}${String(chunk)}`.slice(-MAX_STDERR_CHARS);
    });
    child.on("error", (error) => {
      this.#fail(
        new OpenCodeServerTransportError({
          code: "upstream_unreachable",
          errorType: "adapter",
          message: `upstream_unreachable: failed to spawn opencode serve (${error.message})`,
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
      if (!this.#expectedExit) {
        this.#fail(
          new OpenCodeServerTransportError({
            code: "upstream_unreachable",
            errorType: "adapter",
            message: `upstream_unreachable: opencode serve exited before the turn completed${formatStderrSuffix(
              this.#stderr
            )}`,
          })
        );
      }
    });

    if (this.#openCodeTimeoutMs !== null) {
      this.#processTimeout = setTimeout(() => {
        const timeoutTriggeredAtMs = Date.now();
        this.#lifecycle.timeoutTriggeredAtMs = timeoutTriggeredAtMs;
        this.#emitRuntimeEvent({
          phase: "timeout_triggered",
          processId,
          tsMs: timeoutTriggeredAtMs,
        });
        this.#fail(
          new OpenCodeServerTransportError({
            code: "process.timeout",
            errorType: "timeout",
            message: `process.timeout: opencode serve did not complete within ${this.#openCodeTimeoutMs}ms`,
          })
        );
        this.#requestProcessTermination();
      }, this.#openCodeTimeoutMs);
    }

    // Diagnose only a slow startup. This connection never authorizes execution
    // or extends the listener deadline, and it sends no provider request.
    if (this.#startupTimeoutMs > SERVER_SLOW_START_MS) {
      this.#slowStartTimer = setTimeout(
        () => this.#sampleSlowStartup(port),
        SERVER_SLOW_START_MS
      );
      this.#slowStartTimer.unref?.();
    }
    try {
      return await Promise.race([
        startup,
        timeoutAfter(
          this.#startupTimeoutMs,
          `OpenCode did not open its local server within ${this.#startupTimeoutMs}ms.`
        ),
      ]);
    } finally {
      this.#clearStartupDiagnostic();
    }
  }

  readStartupEvidence() {
    return {
      processId: this.#lifecycle.processId,
      processSpawnedAtMs: this.#lifecycle.processSpawnedAtMs,
      elapsedMs: Math.round(performance.now() - this.#startupStartedAt),
      budgetMs: this.#startupTimeoutMs,
      firstStdoutAtMs: this.#lifecycle.firstStdoutAtMs,
      firstStderrAtMs: this.#lifecycle.firstStderrAtMs,
      stdoutBytes: this.#stdoutBytes,
      stderrBytes: this.#stderrBytes,
      stdoutLines: this.#stdoutLines,
      readyLineObserved: this.#readyLineObserved,
      port: this.#port,
      portProbe: this.#portProbe,
      processExitObserved: this.#lifecycle.exitObservedAtMs !== null,
      hostLoadAverage: loadavg().map((value) => Math.round(value * 100) / 100),
    };
  }

  #sampleSlowStartup(port: number): void {
    const startedAt = performance.now();
    const socket = connect({ host: SERVER_HOSTNAME, port });
    this.#diagnosticSocket = socket;
    this.#portProbe = { status: "pending", observedAtMs: Date.now() };
    const finish = (status: string) => {
      if (this.#diagnosticSocket !== socket) {
        return;
      }
      this.#portProbe = {
        status,
        elapsedMs: Math.round(performance.now() - startedAt),
        observedAtMs: Date.now(),
      };
      this.#diagnosticSocket = null;
      socket.destroy();
      console.warn(
        "[openmeld.opencode.server_start.slow]",
        this.readStartupEvidence()
      );
    };
    socket.once("connect", () => finish("connected"));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      finish(error.code === "ECONNREFUSED" ? "refused" : "error")
    );
    socket.setTimeout(SERVER_DIAGNOSTIC_CONNECT_TIMEOUT_MS, () =>
      finish("timeout")
    );
    socket.unref();
  }

  #clearStartupDiagnostic(): void {
    if (this.#slowStartTimer) {
      clearTimeout(this.#slowStartTimer);
      this.#slowStartTimer = null;
    }
    if (this.#diagnosticSocket) {
      this.#diagnosticSocket.destroy();
      this.#diagnosticSocket = null;
      this.#portProbe = { ...this.#portProbe, status: "cancelled" };
    }
  }

  async close(): Promise<boolean> {
    this.#expectedExit = true;
    this.#clearTimers();
    const child = this.#child;
    if (!child) {
      return true;
    }
    if (this.#lifecycle.stdinClosedAtMs === null) {
      this.#lifecycle.stdinClosedAtMs = Date.now();
      this.#emitRuntimeEvent({
        phase: "stdin_closed",
        processId: this.#lifecycle.processId,
        tsMs: this.#lifecycle.stdinClosedAtMs,
      });
    }
    child.stdin.end();
    if (this.#lifecycle.exitObservedAtMs !== null) {
      return true;
    }
    this.#requestProcessTermination();
    return await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(
        () => resolve(this.#lifecycle.exitObservedAtMs !== null),
        SERVER_PROCESS_CLOSE_TIMEOUT_MS
      );
      child.once("close", () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
  }

  observeUsage(message: Record<string, unknown>): void {
    const completedAt = toRecord(message.time)?.completed;
    if (typeof completedAt !== "number") {
      return;
    }
    const tokens = toRecord(message.tokens);
    const cache = toRecord(tokens?.cache);
    if (
      !(
        tokens &&
        typeof tokens.input === "number" &&
        typeof tokens.output === "number" &&
        typeof tokens.reasoning === "number" &&
        typeof cache?.read === "number" &&
        typeof cache.write === "number"
      )
    ) {
      return;
    }
    const inputTokens = tokens.input + cache.read + cache.write;
    const outputTokens = tokens.output + tokens.reasoning;
    const observation = readAdapterAiUsageObservation({
      eventId: `opencode:${message.sessionID}:${message.id}`,
      provider: message.providerID,
      model: message.modelID,
      source: "opencode_message",
      occurredAtMs: completedAt,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        cacheRead: cache.read,
        cacheWrite: cache.write,
        reasoning: tokens.reasoning,
        total: tokens.total ?? inputTokens + outputTokens,
      },
      cost:
        typeof message.cost === "number"
          ? {
              nanoUsd: Math.round(message.cost * 1_000_000_000),
              kind: "provider_estimate",
            }
          : null,
    });
    if (observation) {
      this.#aiUsage.set(observation.eventId, observation);
    }
  }

  buildTelemetry(input: {
    invokedAtMs: number;
    previewEmitted: boolean;
    resumedContext: boolean;
    streamingMode: AdapterStreamingMode;
  }): AdapterDispatchTelemetry {
    return {
      aiUsage: [...this.#aiUsage.values()],
      completedAtMs: Date.now(),
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
    };
  }

  emitProviderConversationObserved(sessionId: string): void {
    this.#emitRuntimeEvent({
      agentControllerConversationId: sessionId,
      phase: "provider_conversation_observed",
      tsMs: Date.now(),
    });
  }

  markAgentOutputObserved(): void {
    this.#firstOutputAtMs ??= Date.now();
  }

  readStartupTimeoutMs(): number {
    return this.#openCodeTimeoutMs === null
      ? SERVER_STARTUP_TIMEOUT_MS
      : Math.min(this.#openCodeTimeoutMs, SERVER_STARTUP_TIMEOUT_MS);
  }

  readStderr(): string {
    return this.#stderr;
  }

  waitForFailure(): Promise<never> {
    return this.#failure.promise;
  }

  #clearTimers(): void {
    this.#clearStartupDiagnostic();
    if (this.#processTimeout !== null) {
      clearTimeout(this.#processTimeout);
      this.#processTimeout = null;
    }
    if (this.#forceKillTimeout !== null) {
      clearTimeout(this.#forceKillTimeout);
      this.#forceKillTimeout = null;
    }
  }

  #consumeStdout(text: string, expectedPort: number): void {
    this.#lineBuffer += text;
    while (true) {
      const newlineIndex = this.#lineBuffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      const line = this.#lineBuffer.slice(0, newlineIndex).trim();
      this.#stdoutLines += 1;
      this.#lineBuffer = this.#lineBuffer.slice(newlineIndex + 1);
      const match = line.match(SERVER_READY_LINE_PATTERN);
      if (!match) {
        continue;
      }
      const reportedUrl = match[1];
      if (!reportedUrl) {
        continue;
      }
      const url = new URL(reportedUrl);
      if (
        url.hostname !== SERVER_HOSTNAME ||
        Number.parseInt(url.port, 10) !== expectedPort
      ) {
        this.#fail(
          new OpenCodeServerTransportError({
            code: "protocol.invalid",
            errorType: "adapter",
            message: `protocol.invalid: opencode serve reported unexpected address '${reportedUrl}'`,
          })
        );
        return;
      }
      this.#startupResolve?.(reportedUrl);
      this.apiMajor = line.startsWith("opencode ") ? 1 : 2;
      this.#readyLineObserved = true;
      this.#startupResolve = null;
      this.#startupReject = null;
    }
  }

  #emitRuntimeEvent(event: AdapterRuntimeEvent): void {
    this.#onRuntimeEvent?.(event);
  }

  #fail(error: unknown): void {
    if (this.#settledFailure) {
      return;
    }
    this.#settledFailure = error;
    this.#startupReject?.(error);
    this.#startupReject = null;
    this.#startupResolve = null;
    this.#failure.reject(error);
  }

  #requestProcessTermination(): void {
    const runtimeProcess = this.#runtimeProcess;
    if (!runtimeProcess || this.#lifecycle.exitObservedAtMs !== null) {
      return;
    }
    runtimeProcess.terminate("SIGTERM");
    this.#forceKillTimeout = setTimeout(() => {
      runtimeProcess.terminate("SIGKILL");
    }, SERVER_PROCESS_KILL_GRACE_MS);
    this.#forceKillTimeout.unref?.();
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function reserveLocalPort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, SERVER_HOSTNAME, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to reserve a local port for opencode serve."));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return port;
}

function parseOpenCodeModel(
  value: unknown
): { modelID: string; providerID: string } | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  const separator = normalized.indexOf("/");
  if (separator <= 0 || separator === normalized.length - 1) {
    throw new OpenCodeServerTransportError({
      code: "model.invalid",
      errorType: "config",
      message:
        "model.invalid: OpenCode models must use the provider/model format",
    });
  }
  return {
    modelID: normalized.slice(separator + 1),
    providerID: normalized.slice(0, separator),
  };
}

function parseOpenCodeSessionModel(
  policy: ConversationPolicy | undefined
): { id: string; providerID: string; variant?: string } | null {
  const model = parseOpenCodeModel(policy?.model);
  if (!model) {
    return null;
  }
  const variant = normalizeOptionalText(policy?.reasoningLevel);
  return {
    id: model.modelID,
    providerID: model.providerID,
    ...(variant ? { variant } : {}),
  };
}

function readOpenCodeProviderFailure(value: unknown): string | null {
  const error = toRecord(value);
  const data = toRecord(error?.data);
  return (
    normalizeOptionalText(data?.message) ??
    normalizeOptionalText(error?.message) ??
    normalizeOptionalText(value)
  );
}

function readOpenCodeSessionId(value: unknown): string {
  const session = toRecord(unwrapSdkData(value));
  const sessionId = normalizeOptionalText(session?.id);
  if (!sessionId) {
    throw new OpenCodeServerTransportError({
      code: "protocol.invalid",
      errorType: "adapter",
      message: "protocol.invalid: OpenCode session response omitted id",
    });
  }
  return sessionId;
}

function unwrapSdkData(value: unknown): unknown {
  const record = toRecord(value);
  return record && "data" in record ? record.data : value;
}

function toOpenCodeServerTransportError(
  error: unknown,
  stderr: string
): OpenCodeServerTransportError {
  if (
    !(error instanceof OpenCodeServerTransportError) &&
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    "errorType" in error &&
    typeof error.errorType === "string"
  ) {
    return new OpenCodeServerTransportError({
      ...error,
      code: error.code,
      errorType: error.errorType as AdapterErrorType,
      message: error.message,
      originalError: createProviderOriginalError(error.message) ?? undefined,
    });
  }
  if (
    error instanceof Error &&
    toRecord(error)?.code === "space.action.delivery_only_unverified"
  ) {
    return new OpenCodeServerTransportError({
      code: "space.action.delivery_only_unverified",
      errorType: "config",
      message: error.message,
    });
  }
  if (error instanceof OpenCodeServerTransportError) {
    const originalError = createProviderOriginalError(
      error.originalError ??
        [error.message, normalizeOptionalText(stderr)]
          .filter(Boolean)
          .join("\n")
    );
    return new OpenCodeServerTransportError({
      ...error,
      message: error.message,
      originalError: originalError ?? undefined,
    });
  }
  const message = [
    error instanceof Error ? error.message : String(error),
    normalizeOptionalText(stderr),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  return new OpenCodeServerTransportError(
    classifyOpenCodeFailureMessage({
      isContextLost: isLikelyOpenCodeContextLostError,
      message,
    })
  );
}

function timeoutAfter(delayMs: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new OpenCodeServerTransportError({
          code: "process.timeout",
          errorType: "timeout",
          message: `process.timeout: ${message}`,
        })
      );
    }, delayMs);
    timeout.unref?.();
  });
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map(normalizeOptionalText)
        .filter((entry): entry is string => entry !== null)
    : [];
}

function normalizeOutputText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatStderrSuffix(stderr: string): string {
  const normalized = normalizeOptionalText(stderr);
  return normalized ? ` (${normalized})` : "";
}
