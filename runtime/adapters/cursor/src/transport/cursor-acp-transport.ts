import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  AdapterDispatchDiagnostics,
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterInteractionCallback,
  AdapterModelNegotiationDiagnostics,
  AdapterPreviewCallback,
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
  buildCliLaunchInvocation,
  spawnAgentControllerProcess,
} from "@openmeld/adapter-core";
import { createCursorAcpToolActivityTracker } from "../output/cursor-tool-activity.js";
import {
  readCursorPermissionOptions,
  resolveCursorAcpInteraction,
} from "./cursor-acp-interactions.js";

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
};

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

type CursorAcpModeId = "agent" | "ask" | "plan";

type CursorAcpInteractionFailure = {
  code: string;
  message: string;
};

type CursorAcpSessionDescriptor = {
  availableModelIds: string[];
  configAvailableModelIds: string[];
  configCurrentModelId: string | null;
  currentModeId: string | null;
  currentModelId: string | null;
  legacyAvailableModelIds: string[];
  legacyCurrentModelId: string | null;
  modelSourceState: AdapterModelNegotiationDiagnostics["sourceState"];
  sessionOperation: AdapterModelNegotiationDiagnostics["sessionOperation"];
  sessionId: string;
};

export type CursorAcpActiveTurnRegistration = {
  cancel: () => Promise<void>;
  sessionId: string;
  taskId: string;
};

export type CursorAcpActiveTurnRegistrar = (
  registration: CursorAcpActiveTurnRegistration
) => () => void;

export type CursorAcpTransportResult = {
  diagnostics: AdapterDispatchDiagnostics;
  output: string;
  sessionId: string;
  telemetry: AdapterDispatchTelemetry;
};

const ACP_PROTOCOL_VERSION = 1;
const ACP_PROCESS_KILL_GRACE_MS = 1000;
const MAX_MODEL_DIAGNOSTIC_IDS = 100;
const MAX_MODEL_DIAGNOSTIC_ID_CHARS = 512;
const MAX_STDERR_CHARS = 16_000;
const CURSOR_PLAN_UPGRADE_REQUIRED_RE =
  /^upgrade your plan to continue[.!]?$/iu;

export class CursorAcpTransportError extends Error {
  readonly code: string;
  readonly diagnostics?: AdapterDispatchDiagnostics;
  readonly errorType: AdapterErrorType;

  constructor(input: {
    cause?: unknown;
    code: string;
    diagnostics?: AdapterDispatchDiagnostics;
    errorType: AdapterErrorType;
    message: string;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause }
    );
    this.name = "CursorAcpTransportError";
    this.code = input.code;
    this.diagnostics = input.diagnostics;
    this.errorType = input.errorType;
  }
}

export async function invokeCursorAcpTransport(input: {
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  conversationPolicy?: ConversationPolicy;
  cursorTimeoutMs: number | null;
  cursorWorkdir: string;
  env?: Record<string, string | undefined>;
  launchContract: RuntimeAgentControllerLaunchContract;
  onActiveTurn?: CursorAcpActiveTurnRegistrar;
  onInteractionRequest?: AdapterInteractionCallback;
  onPreview?: AdapterPreviewCallback;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  sessionId?: string | null;
  streamingMode?: AdapterStreamingMode;
  taskId: string;
}): Promise<CursorAcpTransportResult> {
  const prompt = normalizeOptionalText(input.prompt);
  if (!prompt) {
    throw new CursorAcpTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: prompt is required",
    });
  }
  const requestedReasoningLevel = normalizeOptionalText(
    input.conversationPolicy?.reasoningLevel
  );
  if (requestedReasoningLevel) {
    throw new CursorAcpTransportError({
      code: "model.reasoning_unsupported",
      errorType: "config",
      message:
        "model.reasoning_unsupported: Cursor ACP does not expose reasoning strength as an independent session option; choose an exact Cursor ACP model variant instead",
    });
  }

  const invokedAtMs = Date.now();
  return await withCursorAcpSession(
    {
      agentControllerPermissionMode: input.agentControllerPermissionMode,
      cursorTimeoutMs: input.cursorTimeoutMs,
      cursorWorkdir: input.cursorWorkdir,
      env: input.env,
      launchContract: input.launchContract,
      onInteractionRequest: input.onInteractionRequest,
      onPreview: input.onPreview,
      onProcessControlEvent: input.onProcessControlEvent,
      onRuntimeEvent: input.onRuntimeEvent,
      streamingMode: input.streamingMode,
    },
    (session) =>
      runCursorAcpTurn({
        input,
        invokedAtMs,
        prompt,
        session,
      })
  );
}

async function runCursorAcpTurn(input: {
  input: Parameters<typeof invokeCursorAcpTransport>[0];
  invokedAtMs: number;
  prompt: string;
  session: CursorAcpSession;
}): Promise<CursorAcpTransportResult> {
  await input.session.initialize();
  const existingSessionId = normalizeOptionalText(input.input.sessionId);
  const initialDescriptor = await input.session.openSession({
    sessionId: existingSessionId,
  });
  input.session.emitProviderConversationObserved(initialDescriptor.sessionId);
  const modelResolution = await resolveCursorSessionModel({
    descriptor: initialDescriptor,
    model: normalizeOptionalText(input.input.conversationPolicy?.model),
    session: input.session,
  });
  const { descriptor } = modelResolution;
  input.session.recordDispatchDiagnostics({
    modelNegotiation: modelResolution.diagnostics,
  });
  await applyCursorSessionMode({
    descriptor,
    permissionMode: input.input.agentControllerPermissionMode,
    session: input.session,
  });
  await applyCursorSessionModel({
    descriptor,
    diagnostics: modelResolution.diagnostics,
    model: modelResolution.diagnostics.requestedModelId,
    session: input.session,
  });
  const unregisterActiveTurn = input.input.onActiveTurn?.({
    cancel: () => {
      input.session.notify("session/cancel", {
        sessionId: descriptor.sessionId,
      });
      return Promise.resolve();
    },
    sessionId: descriptor.sessionId,
    taskId: input.input.taskId,
  });
  let promptResult: unknown;
  input.session.beginTurn();
  try {
    promptResult = await input.session.request("session/prompt", {
      prompt: [{ text: input.prompt, type: "text" }],
      sessionId: descriptor.sessionId,
    });
  } finally {
    input.session.endTurn();
    unregisterActiveTurn?.();
  }
  const interactionFailure = input.session.readInteractionFailure();
  if (interactionFailure) {
    throw new CursorAcpTransportError({
      code: interactionFailure.code,
      errorType: "config",
      message: interactionFailure.message,
    });
  }
  assertSuccessfulStopReason(promptResult);
  const output = input.session.readCollectedAgentText();
  assertCursorOutputIsNotAccountBlock(output);
  await emitFinalPreviewIfRequested({
    onPreview: input.input.onPreview,
    output,
    streamingMode: input.input.streamingMode,
  });
  return {
    diagnostics: {
      modelNegotiation: modelResolution.diagnostics,
    },
    output,
    sessionId: descriptor.sessionId,
    telemetry: input.session.buildTelemetry({
      invokedAtMs: input.invokedAtMs,
      previewEmitted:
        input.input.streamingMode === "stream" &&
        input.input.onPreview !== undefined,
      resumedContext: existingSessionId !== null,
      streamingMode: input.input.streamingMode ?? "final",
    }),
  };
}

async function resolveCursorSessionModel(input: {
  descriptor: CursorAcpSessionDescriptor;
  model: string | null;
  session: CursorAcpSession;
}): Promise<{
  descriptor: CursorAcpSessionDescriptor;
  diagnostics: AdapterModelNegotiationDiagnostics;
}> {
  let descriptor = input.descriptor;
  let checkAttempt: 1 | 2 = 1;
  if (input.model && !isCompleteModelInventory(descriptor)) {
    descriptor = await input.session.openSession({
      sessionId: descriptor.sessionId,
    });
    checkAttempt = 2;
  }
  const diagnostics = buildModelNegotiationDiagnostics({
    checkAttempt,
    descriptor,
    requestedModelId: input.model,
  });
  const dispatchDiagnostics = { modelNegotiation: diagnostics };
  if (input.model && !isCompleteModelInventory(descriptor)) {
    throw new CursorAcpTransportError({
      code: "model.inventory_unavailable",
      diagnostics: dispatchDiagnostics,
      errorType: "adapter",
      message:
        "model.inventory_unavailable: Cursor ACP did not provide one complete, consistent model inventory after a bounded recheck",
    });
  }
  if (input.model && !descriptor.availableModelIds.includes(input.model)) {
    throw new CursorAcpTransportError({
      code: "model.unavailable",
      diagnostics: dispatchDiagnostics,
      errorType: "config",
      message: `model.unavailable: Cursor ACP did not offer model '${input.model}' for this account`,
    });
  }
  return { descriptor, diagnostics };
}

async function applyCursorSessionMode(input: {
  descriptor: CursorAcpSessionDescriptor;
  permissionMode?: AgentControllerPermissionMode;
  session: CursorAcpSession;
}): Promise<void> {
  const requestedMode = resolveCursorAcpMode(input.permissionMode);
  if (input.descriptor.currentModeId === requestedMode) {
    return;
  }
  await input.session.request("session/set_mode", {
    modeId: requestedMode,
    sessionId: input.descriptor.sessionId,
  });
}

async function applyCursorSessionModel(input: {
  descriptor: CursorAcpSessionDescriptor;
  diagnostics: AdapterModelNegotiationDiagnostics;
  model: string | null;
  session: CursorAcpSession;
}): Promise<void> {
  const model = input.model;
  if (!model) {
    return;
  }
  if (model === input.descriptor.currentModelId) {
    return;
  }
  try {
    await input.session.request("session/set_config_option", {
      configId: "model",
      sessionId: input.descriptor.sessionId,
      type: "id",
      value: model,
    });
  } catch (error) {
    if (
      error instanceof CursorAcpTransportError &&
      error.code === "protocol.method_not_found"
    ) {
      await applyLegacyCursorSessionModel({ ...input, model });
      return;
    }
    if (
      error instanceof CursorAcpTransportError &&
      error.code === "protocol.invalid_params"
    ) {
      throw new CursorAcpTransportError({
        code: "model.unavailable",
        diagnostics: { modelNegotiation: input.diagnostics },
        errorType: "config",
        message: `model.unavailable: Cursor ACP rejected model '${model}' for this session`,
      });
    }
    throw error;
  }
}

async function applyLegacyCursorSessionModel(input: {
  descriptor: CursorAcpSessionDescriptor;
  diagnostics: AdapterModelNegotiationDiagnostics;
  model: string;
  session: CursorAcpSession;
}): Promise<void> {
  try {
    await input.session.request("session/set_model", {
      modelId: input.model,
      sessionId: input.descriptor.sessionId,
    });
  } catch (error) {
    if (
      error instanceof CursorAcpTransportError &&
      error.code === "protocol.invalid_params"
    ) {
      throw new CursorAcpTransportError({
        code: "model.unavailable",
        diagnostics: { modelNegotiation: input.diagnostics },
        errorType: "config",
        message: `model.unavailable: Cursor ACP rejected model '${input.model}' for this session`,
      });
    }
    throw error;
  }
}

async function withCursorAcpSession<T>(
  input: ConstructorParameters<typeof CursorAcpSession>[0],
  callback: (session: CursorAcpSession) => Promise<T>
): Promise<T> {
  const session = new CursorAcpSession(input);
  try {
    session.start();
    return await callback(session);
  } catch (error) {
    throw toCursorAcpTransportError(
      error,
      session.readStderr(),
      session.readDispatchDiagnostics()
    );
  } finally {
    await session.close();
  }
}

class CursorAcpSession {
  readonly #agentControllerPermissionMode?: AgentControllerPermissionMode;
  readonly #cursorTimeoutMs: number | null;
  readonly #cursorWorkdir: string;
  readonly #env?: Record<string, string | undefined>;
  readonly #launchContract: RuntimeAgentControllerLaunchContract;
  readonly #onInteractionRequest?: AdapterInteractionCallback;
  readonly #onPreview?: AdapterPreviewCallback;
  readonly #onProcessControlEvent?: AdapterRuntimeProcessCallback;
  readonly #onRuntimeEvent?: AdapterRuntimeEventCallback;
  readonly #pending = new Map<JsonRpcId, PendingJsonRpcRequest>();
  readonly #streamingMode: AdapterStreamingMode;
  readonly #toolActivityTracker = createCursorAcpToolActivityTracker();
  #child: ChildProcessWithoutNullStreams | null = null;
  #runtimeProcess: SpawnedAgentControllerProcess | null = null;
  #dispatchDiagnostics: AdapterDispatchDiagnostics | null = null;
  #forceKillTimeout: NodeJS.Timeout | null = null;
  #firstOutputAtMs: number | null = null;
  #interactionFailure: CursorAcpInteractionFailure | null = null;
  #lineBuffer = "";
  #nextRequestId = 1;
  #output = "";
  #processTimeout: NodeJS.Timeout | null = null;
  #settledFailure: unknown = null;
  #stderr = "";
  #turnActive = false;
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
    agentControllerPermissionMode?: AgentControllerPermissionMode;
    cursorTimeoutMs: number | null;
    cursorWorkdir: string;
    env?: Record<string, string | undefined>;
    launchContract: RuntimeAgentControllerLaunchContract;
    onInteractionRequest?: AdapterInteractionCallback;
    onPreview?: AdapterPreviewCallback;
    onProcessControlEvent?: AdapterRuntimeProcessCallback;
    onRuntimeEvent?: AdapterRuntimeEventCallback;
    streamingMode?: AdapterStreamingMode;
  }) {
    this.#agentControllerPermissionMode = input.agentControllerPermissionMode;
    this.#cursorTimeoutMs = input.cursorTimeoutMs;
    this.#cursorWorkdir = input.cursorWorkdir;
    this.#env = input.env;
    this.#launchContract = input.launchContract;
    this.#onInteractionRequest = input.onInteractionRequest;
    this.#onPreview = input.onPreview;
    this.#onProcessControlEvent = input.onProcessControlEvent;
    this.#onRuntimeEvent = input.onRuntimeEvent;
    this.#streamingMode = input.streamingMode ?? "final";
  }

  start(): void {
    const invocation = buildCliLaunchInvocation({
      args: buildCursorAcpArgs(this.#agentControllerPermissionMode),
      launchContract: this.#launchContract,
    });
    const runtimeProcess = spawnAgentControllerProcess({
      args: invocation.args,
      bin: invocation.bin,
      cwd: this.#cursorWorkdir,
      env: {
        ...process.env,
        ...(this.#env ?? {}),
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

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (this.#lifecycle.firstStdoutAtMs === null) {
        const firstStdoutAtMs = Date.now();
        this.#lifecycle.firstStdoutAtMs = firstStdoutAtMs;
        this.#emitRuntimeEvent({
          phase: "first_stdout",
          processId,
          tsMs: firstStdoutAtMs,
        });
      }
      this.#consumeStdoutText(String(chunk));
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
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
    child.stdin.on("error", (error) => {
      this.#failAll(this.#buildStdinWriteError(error));
    });
    child.on("error", (error) => {
      this.#failAll(
        new CursorAcpTransportError({
          code: "upstream_unreachable",
          errorType: "adapter",
          message: `upstream_unreachable: failed to spawn cursor-agent acp (${error.message})`,
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
      if (this.#pending.size > 0) {
        this.#failAll(
          new CursorAcpTransportError({
            code: "upstream_unreachable",
            errorType: "adapter",
            message: `upstream_unreachable: cursor-agent acp exited before completing the request${formatStderrSuffix(
              this.#stderr
            )}`,
          })
        );
      }
    });
    this.#processTimeout =
      this.#cursorTimeoutMs === null
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
              new CursorAcpTransportError({
                code: "process.timeout",
                errorType: "timeout",
                message: `process.timeout: cursor-agent acp did not complete within ${this.#cursorTimeoutMs}ms`,
              })
            );
            this.#requestProcessTermination();
          }, this.#cursorTimeoutMs);
  }

  async initialize(): Promise<void> {
    const initializeResult = toRecord(
      await this.request("initialize", {
        clientCapabilities: {
          fs: {
            readTextFile: false,
            writeTextFile: false,
          },
        },
        clientInfo: {
          name: "OpenMeld",
          version: "0.0.0",
        },
        protocolVersion: ACP_PROTOCOL_VERSION,
      })
    );
    if (initializeResult?.protocolVersion !== ACP_PROTOCOL_VERSION) {
      throw new CursorAcpTransportError({
        code: "protocol.invalid",
        errorType: "adapter",
        message: `protocol.invalid: Cursor ACP negotiated unsupported protocol version '${String(
          initializeResult?.protocolVersion ?? "missing"
        )}'`,
      });
    }
    const supportsCursorLogin =
      Array.isArray(initializeResult.authMethods) &&
      initializeResult.authMethods.some(
        (authMethod) => toRecord(authMethod)?.id === "cursor_login"
      );
    if (!supportsCursorLogin) {
      throw new CursorAcpTransportError({
        code: "protocol.invalid",
        errorType: "adapter",
        message:
          "protocol.invalid: Cursor ACP did not offer the required cursor_login authentication method",
      });
    }
    await this.request("authenticate", {
      methodId: "cursor_login",
    });
  }

  async openSession(input: {
    sessionId: string | null;
  }): Promise<CursorAcpSessionDescriptor> {
    const params = {
      cwd: this.#cursorWorkdir,
      mcpServers: [],
    };
    if (input.sessionId) {
      let result: unknown;
      try {
        result = await this.request("session/load", {
          ...params,
          sessionId: input.sessionId,
        });
      } catch (error) {
        if (
          error instanceof CursorAcpTransportError &&
          error.code === "protocol.invalid_params"
        ) {
          throw new CursorAcpTransportError({
            cause: error,
            code: "context_not_found",
            errorType: "adapter",
            message:
              "context_not_found: Cursor ACP could not load the persisted conversation",
          });
        }
        throw error;
      }
      return readSessionDescriptor(result, input.sessionId, "load");
    }
    const result = await this.request("session/new", params);
    const record = toRecord(result);
    const sessionId = normalizeOptionalText(record?.sessionId);
    if (!sessionId) {
      throw new CursorAcpTransportError({
        code: "protocol.invalid",
        errorType: "adapter",
        message:
          "protocol.invalid: Cursor ACP session/new response omitted sessionId",
      });
    }
    return readSessionDescriptor(result, sessionId, "new");
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
      const timeout = setTimeout(resolve, ACP_PROCESS_KILL_GRACE_MS);
      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  async request(method: string, params: unknown): Promise<unknown> {
    if (this.#settledFailure) {
      throw this.#settledFailure;
    }
    const id = this.#nextRequestId;
    this.#nextRequestId += 1;
    const result = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { reject, resolve });
    });
    this.#write({
      id,
      jsonrpc: "2.0",
      method,
      params,
    });
    return await result;
  }

  notify(method: string, params?: unknown): void {
    this.#write({
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  beginTurn(): void {
    this.#firstOutputAtMs = null;
    this.#output = "";
    this.#turnActive = true;
  }

  endTurn(): void {
    this.#turnActive = false;
  }

  readCollectedAgentText(): string {
    return this.#output.trim();
  }

  readDispatchDiagnostics(): AdapterDispatchDiagnostics | null {
    return this.#dispatchDiagnostics;
  }

  readInteractionFailure(): CursorAcpInteractionFailure | null {
    return this.#interactionFailure;
  }

  readStderr(): string {
    return this.#stderr;
  }

  recordDispatchDiagnostics(diagnostics: AdapterDispatchDiagnostics): void {
    this.#dispatchDiagnostics = diagnostics;
  }

  buildTelemetry(input: {
    invokedAtMs: number;
    previewEmitted: boolean;
    resumedContext: boolean;
    streamingMode: AdapterStreamingMode;
  }): AdapterDispatchTelemetry {
    return {
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

  #consumeStdoutText(text: string): void {
    this.#lineBuffer += text;
    while (true) {
      const newlineIndex = this.#lineBuffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      const line = this.#lineBuffer.slice(0, newlineIndex).trim();
      this.#lineBuffer = this.#lineBuffer.slice(newlineIndex + 1);
      if (line) {
        this.#handleStdoutLine(line);
      }
    }
  }

  #handleStdoutLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch (error) {
      this.#failAll(
        new CursorAcpTransportError({
          code: "protocol.invalid",
          errorType: "adapter",
          message: `protocol.invalid: cursor-agent acp emitted non-JSON output (${toErrorMessage(
            error
          )})`,
        })
      );
      return;
    }
    if (message.id !== undefined && message.method) {
      this.#handleAgentRequest(message).catch((error: unknown) => {
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
    if (message.error) {
      pending.reject(toJsonRpcTransportError(message.error));
      return;
    }
    pending.resolve(message.result);
  }

  #handleNotification(message: JsonRpcMessage): void {
    if (!this.#turnActive) {
      return;
    }
    this.#collectAgentMessageChunk(message);
    const toolActivity = this.#toolActivityTracker.observe(message);
    if (toolActivity) {
      this.#emitRuntimeEvent(toolActivity);
    }
  }

  async #handleAgentRequest(message: JsonRpcMessage): Promise<void> {
    const id = message.id;
    if (!(typeof id === "number" || typeof id === "string")) {
      return;
    }
    if (
      message.method === "session/request_permission" &&
      resolveCursorPermissionMode(this.#agentControllerPermissionMode) ===
        "cursor:force"
    ) {
      this.#handlePermissionRequest(id, message.params);
      return;
    }
    if (this.#onInteractionRequest && message.method) {
      const interaction = await resolveCursorAcpInteraction({
        method: message.method,
        onInteractionRequest: this.#onInteractionRequest,
        params: message.params,
      });
      if (interaction.handled) {
        this.#write({
          id,
          jsonrpc: "2.0",
          result: interaction.result,
        });
        return;
      }
    }
    if (message.method === "session/request_permission") {
      this.#handlePermissionRequest(id, message.params);
      return;
    }
    if (message.method === "cursor/ask_question") {
      this.#interactionFailure ??= {
        code: "interaction.question_required",
        message:
          "interaction.question_required: Cursor requested user input, which OpenMeld phase 1 does not support",
      };
      this.#write({
        id,
        jsonrpc: "2.0",
        result: {
          outcome: {
            outcome: "skipped",
            reason:
              "OpenMeld does not support interactive Cursor questions yet.",
          },
        },
      });
      return;
    }
    if (message.method === "cursor/create_plan") {
      this.#interactionFailure ??= {
        code: "interaction.plan_required",
        message:
          "interaction.plan_required: Cursor requested plan approval, which OpenMeld phase 1 does not support",
      };
      this.#write({
        id,
        jsonrpc: "2.0",
        result: {
          outcome: {
            outcome: "rejected",
            reason:
              "OpenMeld does not support interactive Cursor plan approval yet.",
          },
        },
      });
      return;
    }
    this.#interactionFailure ??= {
      code: "interaction.unsupported",
      message: `interaction.unsupported: Cursor ACP requested unsupported client method '${message.method}'`,
    };
    this.#write({
      error: {
        code: -32_601,
        message: `OpenMeld does not support Cursor ACP client method '${message.method}'.`,
      },
      id,
      jsonrpc: "2.0",
    });
  }

  #handlePermissionRequest(id: JsonRpcId, params: unknown): void {
    const options = readCursorPermissionOptions(params);
    const forceMode =
      resolveCursorPermissionMode(this.#agentControllerPermissionMode) ===
      "cursor:force";
    const selectedOption = forceMode
      ? options.find((option) => option.kind === "allow_once")
      : options.find((option) => option.kind === "reject_once");
    if (!(forceMode && selectedOption?.kind === "allow_once")) {
      this.#interactionFailure ??= {
        code: "interaction.permission_required",
        message:
          "interaction.permission_required: Cursor requested permission that the selected OpenMeld mode did not grant",
      };
    }
    this.#write({
      id,
      jsonrpc: "2.0",
      result: selectedOption
        ? {
            outcome: {
              optionId: selectedOption.optionId,
              outcome: "selected",
            },
          }
        : {
            outcome: {
              outcome: "cancelled",
            },
          },
    });
  }

  #collectAgentMessageChunk(message: JsonRpcMessage): void {
    if (message.method !== "session/update") {
      return;
    }
    const params = toRecord(message.params);
    const update = toRecord(params?.update);
    if (update?.sessionUpdate !== "agent_message_chunk") {
      return;
    }
    const content = toRecord(update.content);
    const text =
      content?.type === "text" ? normalizeOutputText(content.text) : null;
    if (!text) {
      return;
    }
    if (this.#firstOutputAtMs === null) {
      this.#firstOutputAtMs = Date.now();
    }
    this.#output += text;
    if (this.#streamingMode === "stream" && this.#onPreview) {
      Promise.resolve(this.#onPreview({ text: this.#output })).catch(
        (error) => {
          this.#failAll(error);
        }
      );
    }
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

  #buildStdinWriteError(cause?: unknown): CursorAcpTransportError {
    const detail =
      cause instanceof Error && cause.message.trim()
        ? ` (${cause.message.trim()})`
        : "";
    return new CursorAcpTransportError({
      code: "upstream_unreachable",
      errorType: "adapter",
      message: `upstream_unreachable: cursor-agent acp is not accepting responses${detail}`,
    });
  }

  #failAll(error: unknown): void {
    if (!this.#settledFailure) {
      this.#settledFailure = error;
    }
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #requestProcessTermination(): void {
    const runtimeProcess = this.#runtimeProcess;
    if (!runtimeProcess || this.#lifecycle.exitObservedAtMs !== null) {
      return;
    }
    runtimeProcess.terminate("SIGTERM");
    this.#forceKillTimeout = setTimeout(() => {
      runtimeProcess.terminate("SIGKILL");
    }, ACP_PROCESS_KILL_GRACE_MS);
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
  }

  #emitRuntimeEvent(event: AdapterRuntimeEvent): void {
    this.#onRuntimeEvent?.(event);
  }
}

function readSessionDescriptor(
  value: unknown,
  sessionId: string,
  sessionOperation: CursorAcpSessionDescriptor["sessionOperation"]
): CursorAcpSessionDescriptor {
  const record = toRecord(value);
  const modes = toRecord(record?.modes);
  const models = toRecord(record?.models);
  const modelConfig = readConfigOption(record, "model");
  const legacyAvailableModelIds = readLegacyAvailableModelIds(models);
  const configAvailableModelIds = readConfigAvailableModelIds(modelConfig);
  const legacyCurrentModelId = normalizeOptionalText(models?.currentModelId);
  const configCurrentModelId = normalizeOptionalText(modelConfig?.currentValue);
  const modelInventory = resolveModelInventory({
    configAvailableModelIds,
    configCurrentModelId,
    configOptionPresent: modelConfig !== null,
    legacyAvailableModelIds,
    legacyCurrentModelId,
  });
  return {
    availableModelIds: modelInventory.availableModelIds,
    configAvailableModelIds,
    configCurrentModelId,
    currentModeId:
      normalizeOptionalText(modes?.currentModeId) ??
      readCurrentConfigValue(record, "mode"),
    currentModelId: modelInventory.currentModelId,
    legacyAvailableModelIds,
    legacyCurrentModelId,
    modelSourceState: modelInventory.sourceState,
    sessionOperation,
    sessionId,
  };
}

function readLegacyAvailableModelIds(
  models: Record<string, unknown> | null
): string[] {
  const directModels = Array.isArray(models?.availableModels)
    ? models.availableModels
    : [];
  return uniqueModelIds(directModels.map((model) => toRecord(model)?.modelId));
}

function readConfigAvailableModelIds(
  modelConfig: Record<string, unknown> | null
): string[] {
  const options = Array.isArray(modelConfig?.options)
    ? modelConfig.options
    : [];
  return uniqueModelIds(options.map((option) => toRecord(option)?.value));
}

function uniqueModelIds(values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .map(normalizeOptionalText)
        .filter((modelId): modelId is string => modelId !== null)
    ),
  ];
}

function resolveModelInventory(input: {
  configAvailableModelIds: string[];
  configCurrentModelId: string | null;
  configOptionPresent: boolean;
  legacyAvailableModelIds: string[];
  legacyCurrentModelId: string | null;
}): {
  availableModelIds: string[];
  currentModelId: string | null;
  sourceState: AdapterModelNegotiationDiagnostics["sourceState"];
} {
  const currentModelId =
    input.configCurrentModelId ?? input.legacyCurrentModelId;
  if (input.configAvailableModelIds.length > 0) {
    const sourcesConflict =
      (input.legacyAvailableModelIds.length > 0 &&
        !haveSameModelIds(
          input.configAvailableModelIds,
          input.legacyAvailableModelIds
        )) ||
      (input.configCurrentModelId !== null &&
        input.legacyCurrentModelId !== null &&
        input.configCurrentModelId !== input.legacyCurrentModelId) ||
      (currentModelId !== null &&
        !input.configAvailableModelIds.includes(currentModelId));
    if (sourcesConflict) {
      return {
        availableModelIds: [],
        currentModelId,
        sourceState: "conflicting",
      };
    }
    return {
      availableModelIds: input.configAvailableModelIds,
      currentModelId,
      sourceState:
        input.legacyAvailableModelIds.length > 0
          ? "consistent"
          : "config_options_only",
    };
  }
  if (input.configOptionPresent) {
    return {
      availableModelIds: [],
      currentModelId,
      sourceState:
        input.legacyAvailableModelIds.length > 0 ? "conflicting" : "missing",
    };
  }
  if (input.legacyAvailableModelIds.length > 0) {
    return {
      availableModelIds: input.legacyAvailableModelIds,
      currentModelId: input.legacyCurrentModelId,
      sourceState:
        input.legacyCurrentModelId !== null &&
        !input.legacyAvailableModelIds.includes(input.legacyCurrentModelId)
          ? "conflicting"
          : "legacy_models_only",
    };
  }
  return {
    availableModelIds: [],
    currentModelId,
    sourceState: "missing",
  };
}

function haveSameModelIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightIds = new Set(right);
  return left.every((modelId) => rightIds.has(modelId));
}

function isCompleteModelInventory(
  descriptor: CursorAcpSessionDescriptor
): boolean {
  return (
    descriptor.modelSourceState !== "conflicting" &&
    descriptor.modelSourceState !== "missing"
  );
}

function buildModelNegotiationDiagnostics(input: {
  checkAttempt: 1 | 2;
  descriptor: CursorAcpSessionDescriptor;
  requestedModelId: string | null;
}): AdapterModelNegotiationDiagnostics {
  const configAvailableModelIds = sanitizeDiagnosticModelIds(
    input.descriptor.configAvailableModelIds
  );
  const legacyAvailableModelIds = sanitizeDiagnosticModelIds(
    input.descriptor.legacyAvailableModelIds
  );
  return {
    checkAttempt: input.checkAttempt,
    configAvailableModelCount: input.descriptor.configAvailableModelIds.length,
    configAvailableModelIds,
    configAvailableModelIdsTruncated: wereDiagnosticModelIdsTruncated(
      input.descriptor.configAvailableModelIds
    ),
    configCurrentModelId: sanitizeDiagnosticModelId(
      input.descriptor.configCurrentModelId
    ),
    currentModelId: sanitizeDiagnosticModelId(input.descriptor.currentModelId),
    legacyAvailableModelCount: input.descriptor.legacyAvailableModelIds.length,
    legacyAvailableModelIds,
    legacyAvailableModelIdsTruncated: wereDiagnosticModelIdsTruncated(
      input.descriptor.legacyAvailableModelIds
    ),
    legacyCurrentModelId: sanitizeDiagnosticModelId(
      input.descriptor.legacyCurrentModelId
    ),
    protocol: "acp/v1",
    requestedModelId: sanitizeDiagnosticModelId(input.requestedModelId),
    requestedPresentInConfigOptions:
      input.requestedModelId !== null &&
      input.descriptor.configAvailableModelIds.includes(input.requestedModelId),
    requestedPresentInLegacyModels:
      input.requestedModelId !== null &&
      input.descriptor.legacyAvailableModelIds.includes(input.requestedModelId),
    sessionOperation: input.descriptor.sessionOperation,
    sourceState: input.descriptor.modelSourceState,
  };
}

function sanitizeDiagnosticModelIds(modelIds: string[]): string[] {
  return modelIds
    .slice(0, MAX_MODEL_DIAGNOSTIC_IDS)
    .map((modelId) => sanitizeDiagnosticModelId(modelId))
    .filter((modelId): modelId is string => modelId !== null);
}

function wereDiagnosticModelIdsTruncated(modelIds: string[]): boolean {
  return (
    modelIds.length > MAX_MODEL_DIAGNOSTIC_IDS ||
    modelIds.some((modelId) => modelId.length > MAX_MODEL_DIAGNOSTIC_ID_CHARS)
  );
}

function sanitizeDiagnosticModelId(modelId: string | null): string | null {
  return modelId === null
    ? null
    : modelId.slice(0, MAX_MODEL_DIAGNOSTIC_ID_CHARS);
}

function readCurrentConfigValue(
  record: Record<string, unknown> | null,
  id: string
): string | null {
  return normalizeOptionalText(readConfigOption(record, id)?.currentValue);
}

function readConfigOption(
  record: Record<string, unknown> | null,
  id: string
): Record<string, unknown> | null {
  const configOptions = Array.isArray(record?.configOptions)
    ? record.configOptions
    : [];
  return (
    configOptions
      .map(toRecord)
      .find(
        (option) =>
          (normalizeOptionalText(option?.configId) ??
            normalizeOptionalText(option?.id)) === id
      ) ?? null
  );
}

function resolveCursorAcpMode(
  value: AgentControllerPermissionMode | undefined
): CursorAcpModeId {
  switch (resolveCursorPermissionMode(value)) {
    case "cursor:ask":
      return "ask";
    case "cursor:plan":
      return "plan";
    default:
      return "agent";
  }
}

function resolveCursorPermissionMode(
  value: AgentControllerPermissionMode | undefined
):
  | "cursor:ask"
  | "cursor:autoReview"
  | "cursor:default"
  | "cursor:force"
  | "cursor:plan" {
  switch (value) {
    case "cursor:ask":
    case "cursor:autoReview":
    case "cursor:default":
    case "cursor:force":
    case "cursor:plan":
      return value;
    default:
      return "cursor:default";
  }
}

function buildCursorAcpArgs(
  permissionMode: AgentControllerPermissionMode | undefined
): string[] {
  switch (resolveCursorPermissionMode(permissionMode)) {
    case "cursor:autoReview":
      return ["--auto-review", "acp"];
    case "cursor:force":
      return ["--force", "acp"];
    default:
      return ["acp"];
  }
}

function assertSuccessfulStopReason(value: unknown): void {
  const stopReason = normalizeOptionalText(toRecord(value)?.stopReason);
  if (!stopReason) {
    throw new CursorAcpTransportError({
      code: "protocol.invalid",
      errorType: "adapter",
      message: "protocol.invalid: Cursor ACP session/prompt omitted stopReason",
    });
  }
  if (stopReason === "end_turn") {
    return;
  }
  throw new CursorAcpTransportError({
    code: `runtime.turn.${stopReason}`,
    errorType: "adapter",
    message: `runtime.turn.${stopReason}: Cursor ACP ended the turn with stopReason '${stopReason}'`,
  });
}

function assertCursorOutputIsNotAccountBlock(output: string): void {
  if (!isCursorPlanUpgradeRequired(output)) {
    return;
  }
  throw new CursorAcpTransportError({
    code: "cursor.plan_upgrade_required",
    errorType: "adapter",
    message: output.trim(),
  });
}

function isCursorPlanUpgradeRequired(value: string): boolean {
  return CURSOR_PLAN_UPGRADE_REQUIRED_RE.test(value.trim());
}

async function emitFinalPreviewIfRequested(input: {
  onPreview?: AdapterPreviewCallback;
  output: string;
  streamingMode?: AdapterStreamingMode;
}): Promise<void> {
  if (input.streamingMode === "stream" || !input.onPreview) {
    return;
  }
  await input.onPreview({ text: input.output });
}

function toJsonRpcTransportError(error: JsonRpcError): CursorAcpTransportError {
  const message = normalizeOptionalText(error.message) ?? "Cursor ACP error";
  if (error.code === -32_601) {
    return new CursorAcpTransportError({
      code: "protocol.method_not_found",
      errorType: "adapter",
      message,
    });
  }
  if (error.code === -32_602) {
    return new CursorAcpTransportError({
      code: "protocol.invalid_params",
      errorType: "config",
      message,
    });
  }
  return classifyCursorFailure(message);
}

function toCursorAcpTransportError(
  error: unknown,
  stderr: string,
  diagnostics: AdapterDispatchDiagnostics | null
): CursorAcpTransportError {
  if (error instanceof CursorAcpTransportError) {
    return error.diagnostics || !diagnostics
      ? error
      : new CursorAcpTransportError({
          code: error.code,
          diagnostics,
          errorType: error.errorType,
          message: error.message,
        });
  }
  const combined = [toErrorMessage(error), normalizeOptionalText(stderr)]
    .filter((value): value is string => value !== null)
    .join("\n");
  const classified = classifyCursorFailure(combined);
  return diagnostics
    ? new CursorAcpTransportError({
        code: classified.code,
        diagnostics,
        errorType: classified.errorType,
        message: classified.message,
      })
    : classified;
}

function classifyCursorFailure(message: string): CursorAcpTransportError {
  const normalized = normalizeOptionalText(message) ?? "Cursor ACP error";
  const lowered = normalized.toLowerCase();
  if (isCursorPlanUpgradeRequired(normalized)) {
    return new CursorAcpTransportError({
      code: "cursor.plan_upgrade_required",
      errorType: "adapter",
      message: normalized,
    });
  }
  if (
    lowered.includes("network") ||
    lowered.includes("fetch failed") ||
    lowered.includes("connection") ||
    lowered.includes("econn") ||
    lowered.includes("dns")
  ) {
    return new CursorAcpTransportError({
      code: "network.unavailable",
      errorType: "network",
      message: normalized,
    });
  }
  if (
    lowered.includes("not logged in") ||
    lowered.includes("unauthorized") ||
    lowered.includes("authentication") ||
    lowered.includes("invalid api key") ||
    lowered.includes("401")
  ) {
    return new CursorAcpTransportError({
      code: "auth.required",
      errorType: "auth",
      message: normalized,
    });
  }
  if (
    lowered.includes("session not found") ||
    lowered.includes("unknown session")
  ) {
    return new CursorAcpTransportError({
      code: "context_not_found",
      errorType: "config",
      message: normalized,
    });
  }
  return new CursorAcpTransportError({
    code: "upstream_unreachable",
    errorType: "adapter",
    message: normalized,
  });
}

function formatStderrSuffix(stderr: string): string {
  const normalized = normalizeOptionalText(stderr);
  return normalized ? ` (${normalized})` : "";
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
