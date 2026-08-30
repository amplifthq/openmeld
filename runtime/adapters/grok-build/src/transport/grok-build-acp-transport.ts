import { realpath, stat } from "node:fs/promises";
import type {
  AcpJsonRpcError,
  AdapterDispatchDiagnostics,
  AdapterDispatchTelemetry,
  AdapterErrorType,
  AdapterInteractionCallback,
  AdapterModelNegotiationDiagnostics,
  AdapterPreviewCallback,
  AdapterProviderUsageLimit,
  AdapterRuntimeEvent,
  AdapterRuntimeEventCallback,
  AdapterRuntimeProcessCallback,
  AdapterStreamingMode,
  AgentControllerPermissionMode,
  ConversationPolicy,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import {
  AcpProcessSession,
  buildAcpDispatchSpaceActionMcpServers,
  createAcpToolActivityTracker,
  createProviderOriginalError,
  createUnavailableProviderUsageLimits,
} from "@openmeld/adapter-core";
import { projectGrokBuildUsageLimits } from "../usage/grok-build-usage-limits.js";
import {
  isGrokBuildPlanMethod,
  isGrokBuildQuestionMethod,
  resolveGrokBuildAcpInteraction,
} from "./grok-build-acp-interactions.js";

type GrokBuildModel = {
  currentEffort: string | null;
  displayName: string;
  efforts: string[];
  modelId: string;
};

type GrokBuildModelState = {
  currentModelId: string | null;
  models: GrokBuildModel[];
};

type GrokBuildSessionDescriptor = {
  currentEffort: string | null;
  currentModelId: string;
  diagnostics: AdapterModelNegotiationDiagnostics;
  models: GrokBuildModel[];
  sessionId: string;
};

type GrokBuildInteractionFailure = {
  code: string;
  message: string;
};

export type GrokBuildAcpActiveTurnRegistration = {
  cancel: () => Promise<void>;
  sessionId: string;
  taskId: string;
};

export type GrokBuildAcpActiveTurnRegistrar = (
  registration: GrokBuildAcpActiveTurnRegistration
) => () => void;

export type GrokBuildAcpTransportResult = {
  diagnostics: AdapterDispatchDiagnostics;
  output: string;
  sessionId: string;
  telemetry: AdapterDispatchTelemetry;
};

export type GrokBuildAcpInterfaceProbeResult = {
  authMethodId: "cached_token" | "xai.api_key";
  models: Array<{ displayName: string; id: string }>;
  usageLimits: AdapterProviderUsageLimit[];
};

const ACP_PROTOCOL_VERSION = 1;
const MAX_MODEL_DIAGNOSTIC_IDS = 100;
const MAX_MODEL_DIAGNOSTIC_ID_CHARS = 512;
const CONTEXT_NOT_FOUND_RE =
  /(?:path not found|unknown session|session.+not found|no such session)/iu;
const AUTH_FAILURE_RE =
  /(?:unauthenticated|authentication|sign[ -]?in|required.+login|token.+expired|invalid.+token)/iu;

export class GrokBuildAcpTransportError extends Error {
  readonly code: string;
  readonly diagnostics?: AdapterDispatchDiagnostics;
  readonly errorType: AdapterErrorType;
  readonly originalError?: string;

  constructor(input: {
    cause?: unknown;
    code: string;
    diagnostics?: AdapterDispatchDiagnostics;
    errorType: AdapterErrorType;
    message: string;
    originalError?: string;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause }
    );
    this.name = "GrokBuildAcpTransportError";
    this.code = input.code;
    this.diagnostics = input.diagnostics;
    this.errorType = input.errorType;
    this.originalError = input.originalError;
  }
}

export async function probeGrokBuildAcpInterface(input: {
  env?: Record<string, string | undefined>;
  grokBuildTimeoutMs: number | null;
  grokBuildWorkdir: string;
  launchContract: RuntimeAgentControllerLaunchContract;
}): Promise<GrokBuildAcpInterfaceProbeResult> {
  const workdir = await resolveCanonicalDirectory(input.grokBuildWorkdir);
  const session = new GrokBuildAcpSession({ ...input, workdir });
  try {
    session.start();
    return await session.initialize({ collectUsageLimits: true });
  } catch (error) {
    throw toGrokBuildTransportError(error, session.readStderr(), null);
  } finally {
    await session.closeProcess();
  }
}

export async function invokeGrokBuildAcpTransport(input: {
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  conversationPolicy?: ConversationPolicy;
  env?: Record<string, string | undefined>;
  grokBuildTimeoutMs: number | null;
  grokBuildWorkdir: string;
  launchContract: RuntimeAgentControllerLaunchContract;
  onActiveTurn?: GrokBuildAcpActiveTurnRegistrar;
  onInteractionRequest?: AdapterInteractionCallback;
  onPreview?: AdapterPreviewCallback;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  prompt: string;
  sessionId?: string | null;
  streamingMode?: AdapterStreamingMode;
  taskId: string;
}): Promise<GrokBuildAcpTransportResult> {
  const prompt = normalizeOptionalText(input.prompt);
  if (!prompt) {
    throw new GrokBuildAcpTransportError({
      code: "schema.invalid",
      errorType: "config",
      message: "schema.invalid: prompt is required",
    });
  }
  const workdir = await resolveCanonicalDirectory(input.grokBuildWorkdir);
  const invokedAtMs = Date.now();
  const session = new GrokBuildAcpSession({ ...input, workdir });
  try {
    session.start();
    await session.initialize({ collectUsageLimits: false });
    const existingSessionId = normalizeOptionalText(input.sessionId);
    const descriptor = await session.openSession({
      requestedModelId: normalizeOptionalText(input.conversationPolicy?.model),
      sessionId: existingSessionId,
    });
    session.emitProviderConversationObserved(descriptor.sessionId);
    await session.applyModelSelection({
      descriptor,
      reasoningEffort: normalizeOptionalText(
        input.conversationPolicy?.reasoningLevel
      ),
      requestedModelId: normalizeOptionalText(input.conversationPolicy?.model),
    });
    const unregisterActiveTurn = input.onActiveTurn?.({
      cancel: () => session.cancelAndCloseSession(descriptor.sessionId),
      sessionId: descriptor.sessionId,
      taskId: input.taskId,
    });
    session.beginTurn();
    let promptResult: unknown;
    try {
      try {
        promptResult = await session.request("session/prompt", {
          prompt: [{ text: prompt, type: "text" }],
          sessionId: descriptor.sessionId,
        });
      } catch (error) {
        throw await toPromptWakeFailureError(error, session);
      }
    } finally {
      session.endTurn();
      unregisterActiveTurn?.();
    }
    session.throwIfInteractionFailed();
    session.throwIfCallbackFailed();
    assertSuccessfulStopReason(promptResult);
    const output = session.readCollectedAgentText();
    await emitFinalPreviewIfRequested({
      onPreview: input.onPreview,
      output,
      streamingMode: input.streamingMode,
    });
    await session.closeSession(descriptor.sessionId);
    return {
      diagnostics: { modelNegotiation: descriptor.diagnostics },
      output,
      sessionId: descriptor.sessionId,
      telemetry: session.buildTelemetry({
        invokedAtMs,
        previewEmitted:
          input.streamingMode === "stream" && input.onPreview !== undefined,
        resumedContext: existingSessionId !== null,
        streamingMode: input.streamingMode ?? "final",
      }),
    };
  } catch (error) {
    throw toGrokBuildTransportError(
      error,
      session.readStderr(),
      session.readDiagnostics()
    );
  } finally {
    await session.closeProcess();
  }
}

const PROVIDER_USAGE_EXHAUSTED_ERROR_CODE = "grok-build.quota_or_entitlement";

/**
 * A provider rejection without a self-describing message surfaces as
 * protocol.request_failed. When the usage projection shows credits are
 * exhausted, the quota failure code is far more accurate than a generic
 * protocol error.
 */
export function upgradePromptProtocolFailureWithExhaustedUsage(
  classified: GrokBuildAcpTransportError,
  usageLimits: readonly AdapterProviderUsageLimit[]
): GrokBuildAcpTransportError {
  if (
    classified.code !== "protocol.request_failed" ||
    !usageLimits.some((limit) => limit.status === "exhausted")
  ) {
    return classified;
  }
  return new GrokBuildAcpTransportError({
    cause: classified,
    code: PROVIDER_USAGE_EXHAUSTED_ERROR_CODE,
    errorType: "auth",
    message:
      "grok-build.quota_or_entitlement: the provider account has used all of its included credits for this period",
    ...(classified.originalError
      ? { originalError: classified.originalError }
      : {}),
  });
}

async function toPromptWakeFailureError(
  error: unknown,
  session: GrokBuildAcpSession
): Promise<GrokBuildAcpTransportError> {
  const classified = toGrokBuildTransportError(
    error,
    session.readStderr(),
    session.readDiagnostics()
  );
  if (
    classified.code !== "protocol.request_failed" ||
    isContextNotFoundError(classified)
  ) {
    return classified;
  }
  return upgradePromptProtocolFailureWithExhaustedUsage(
    classified,
    await session.readUsageLimitsSafe()
  );
}

class GrokBuildAcpSession {
  readonly #input: ConstructorParameters<typeof GrokBuildAcpSession>[0];
  readonly #process: AcpProcessSession;
  readonly #streamingMode: AdapterStreamingMode;
  readonly #toolActivityTracker = createAcpToolActivityTracker();
  #callbackFailure: unknown = null;
  #diagnostics: AdapterDispatchDiagnostics | null = null;
  #firstOutputAtMs: number | null = null;
  #initializeModelState: GrokBuildModelState | null = null;
  #interactionFailure: GrokBuildInteractionFailure | null = null;
  #output = "";
  #sessionClosePromise: Promise<void> | null = null;
  #sessionId: string | null = null;
  #supportsClose = false;
  #supportsResume = false;
  #turnActive = false;

  constructor(input: {
    agentControllerPermissionMode?: AgentControllerPermissionMode;
    env?: Record<string, string | undefined>;
    grokBuildTimeoutMs: number | null;
    launchContract: RuntimeAgentControllerLaunchContract;
    onInteractionRequest?: AdapterInteractionCallback;
    onPreview?: AdapterPreviewCallback;
    onProcessControlEvent?: AdapterRuntimeProcessCallback;
    onRuntimeEvent?: AdapterRuntimeEventCallback;
    streamingMode?: AdapterStreamingMode;
    workdir: string;
  }) {
    this.#input = input;
    this.#streamingMode = input.streamingMode ?? "final";
    this.#process = new AcpProcessSession({
      args: buildGrokBuildAcpArgs(input.agentControllerPermissionMode),
      createError: (error) => new GrokBuildAcpTransportError(error),
      cwd: input.workdir,
      env: {
        ...(input.env ?? {}),
        GROK_DISABLE_AUTOUPDATER: "1",
      },
      launchContract: input.launchContract,
      mapJsonRpcError: toGrokBuildJsonRpcTransportError,
      onClientRequest: (request) => this.#handleClientRequest(request),
      onLifecycleEvent: (event) => this.#emitRuntimeEvent(event),
      onNotification: (notification) => this.#handleNotification(notification),
      ...(input.onProcessControlEvent
        ? { onProcessControlEvent: input.onProcessControlEvent }
        : {}),
      processLabel: "Grok Build",
      timeoutMs: input.grokBuildTimeoutMs,
    });
  }

  start(): void {
    this.#process.start();
  }

  async initialize(input: {
    collectUsageLimits: boolean;
  }): Promise<GrokBuildAcpInterfaceProbeResult> {
    const initializeResult = toRecord(
      await this.request("initialize", {
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
        },
        clientInfo: {
          name: "OpenMeld",
          title: "OpenMeld",
          version: "0.0.0",
        },
        protocolVersion: ACP_PROTOCOL_VERSION,
      })
    );
    if (initializeResult?.protocolVersion !== ACP_PROTOCOL_VERSION) {
      throw new GrokBuildAcpTransportError({
        code: "protocol.invalid",
        errorType: "adapter",
        message: `protocol.invalid: Grok Build negotiated unsupported ACP version '${String(
          initializeResult?.protocolVersion ?? "missing"
        )}'`,
      });
    }
    const capabilities = toRecord(initializeResult.agentCapabilities);
    const sessionCapabilities = toRecord(capabilities?.sessionCapabilities);
    this.#supportsResume = toRecord(sessionCapabilities?.resume) !== null;
    this.#supportsClose = toRecord(sessionCapabilities?.close) !== null;
    if (!(this.#supportsResume && this.#supportsClose)) {
      throw new GrokBuildAcpTransportError({
        code: "protocol.invalid",
        errorType: "adapter",
        message:
          "protocol.invalid: Grok Build ACP must advertise session resume and close",
      });
    }
    this.#initializeModelState = readModelState(
      toRecord(initializeResult._meta)?.modelState
    );
    if (!this.#initializeModelState) {
      throw new GrokBuildAcpTransportError({
        code: "model.inventory_unavailable",
        errorType: "adapter",
        message:
          "model.inventory_unavailable: Grok Build initialize did not provide a complete live model inventory",
      });
    }
    const authMethodId = resolveNonInteractiveAuthMethod(initializeResult);
    await this.request("authenticate", {
      _meta: { headless: true },
      methodId: authMethodId,
    });
    const usageLimits = input.collectUsageLimits
      ? await this.readUsageLimits()
      : [];
    return {
      authMethodId,
      models:
        this.#initializeModelState?.models.map((model) => ({
          displayName: model.displayName,
          id: model.modelId,
        })) ?? [],
      usageLimits,
    };
  }

  private async readUsageLimits(): Promise<AdapterProviderUsageLimit[]> {
    return await this.request("_x.ai/billing", {}).then(
      (response) =>
        projectGrokBuildUsageLimits({
          observedAt: new Date().toISOString(),
          response,
        }),
      () => createUnavailableProviderUsageLimits(new Date().toISOString())
    );
  }

  async readUsageLimitsSafe(): Promise<AdapterProviderUsageLimit[]> {
    try {
      return await this.readUsageLimits();
    } catch {
      return createUnavailableProviderUsageLimits(new Date().toISOString());
    }
  }

  async openSession(input: {
    requestedModelId: string | null;
    sessionId: string | null;
  }): Promise<GrokBuildSessionDescriptor> {
    const operation = input.sessionId ? "resume" : "new";
    let result: unknown;
    try {
      result = input.sessionId
        ? await this.request("session/resume", {
            cwd: this.#input.workdir,
            mcpServers: buildAcpDispatchSpaceActionMcpServers(this.#input.env),
            sessionId: input.sessionId,
          })
        : await this.request("session/new", {
            cwd: this.#input.workdir,
            mcpServers: buildAcpDispatchSpaceActionMcpServers(this.#input.env),
          });
    } catch (error) {
      if (input.sessionId && isContextNotFoundError(error)) {
        throw new GrokBuildAcpTransportError({
          cause: error,
          code: "context_not_found",
          errorType: "adapter",
          message:
            "context_not_found: Grok Build could not resume the persisted conversation",
          ...(error instanceof GrokBuildAcpTransportError && error.originalError
            ? { originalError: error.originalError }
            : {}),
        });
      }
      throw error;
    }
    const record = toRecord(result);
    const sessionId =
      normalizeOptionalText(record?.sessionId) ?? input.sessionId ?? null;
    if (!sessionId) {
      throw new GrokBuildAcpTransportError({
        code: "protocol.invalid",
        errorType: "adapter",
        message: `protocol.invalid: Grok Build session/${operation} omitted sessionId`,
      });
    }
    const sessionModelState = readModelState(record?.models);
    const descriptor = buildSessionDescriptor({
      initializeModelState: this.#initializeModelState,
      operation,
      requestedModelId: input.requestedModelId,
      sessionId,
      sessionModelState,
    });
    this.#sessionId = sessionId;
    this.#diagnostics = { modelNegotiation: descriptor.diagnostics };
    return descriptor;
  }

  async applyModelSelection(input: {
    descriptor: GrokBuildSessionDescriptor;
    reasoningEffort: string | null;
    requestedModelId: string | null;
  }): Promise<void> {
    const modelId = input.requestedModelId ?? input.descriptor.currentModelId;
    const model = input.descriptor.models.find(
      (candidate) => candidate.modelId === modelId
    );
    if (!model) {
      throw new GrokBuildAcpTransportError({
        code: "model.unavailable",
        diagnostics: { modelNegotiation: input.descriptor.diagnostics },
        errorType: "config",
        message: `model.unavailable: Grok Build did not offer model '${modelId}' for this account`,
      });
    }
    if (
      input.reasoningEffort &&
      !model.efforts.includes(input.reasoningEffort)
    ) {
      throw new GrokBuildAcpTransportError({
        code: "model.reasoning_unsupported",
        diagnostics: { modelNegotiation: input.descriptor.diagnostics },
        errorType: "config",
        message: `model.reasoning_unsupported: Grok Build model '${modelId}' does not offer reasoning effort '${input.reasoningEffort}'`,
      });
    }
    const shouldSetModel =
      modelId !== input.descriptor.currentModelId ||
      (input.reasoningEffort !== null &&
        input.reasoningEffort !== input.descriptor.currentEffort);
    if (!shouldSetModel) {
      return;
    }
    try {
      await this.request("session/set_model", {
        ...(input.reasoningEffort
          ? { _meta: { reasoningEffort: input.reasoningEffort } }
          : {}),
        modelId,
        sessionId: input.descriptor.sessionId,
      });
    } catch (error) {
      if (
        error instanceof GrokBuildAcpTransportError &&
        error.code === "protocol.invalid_params"
      ) {
        throw new GrokBuildAcpTransportError({
          cause: error,
          code: "model.unavailable",
          diagnostics: { modelNegotiation: input.descriptor.diagnostics },
          errorType: "config",
          message: `model.unavailable: Grok Build rejected model '${modelId}' or its reasoning effort for this session`,
          ...(error.originalError
            ? { originalError: error.originalError }
            : {}),
        });
      }
      throw error;
    }
  }

  beginTurn(): void {
    this.#firstOutputAtMs = null;
    this.#output = "";
    this.#turnActive = true;
  }

  endTurn(): void {
    this.#turnActive = false;
  }

  request(method: string, params: unknown): Promise<unknown> {
    return this.#process.request(method, params);
  }

  readCollectedAgentText(): string {
    return this.#output.trim();
  }

  readDiagnostics(): AdapterDispatchDiagnostics | null {
    return this.#diagnostics;
  }

  readStderr(): string {
    return this.#process.readStderr();
  }

  buildTelemetry(input: {
    invokedAtMs: number;
    previewEmitted: boolean;
    resumedContext: boolean;
    streamingMode: AdapterStreamingMode;
  }): AdapterDispatchTelemetry {
    return this.#process.buildTelemetry({
      ...input,
      firstOutputAtMs: this.#firstOutputAtMs,
    });
  }

  emitProviderConversationObserved(sessionId: string): void {
    this.#emitRuntimeEvent({
      agentControllerConversationId: sessionId,
      phase: "provider_conversation_observed",
      tsMs: Date.now(),
    });
  }

  throwIfInteractionFailed(): void {
    if (this.#interactionFailure) {
      throw new GrokBuildAcpTransportError({
        code: this.#interactionFailure.code,
        errorType: "config",
        message: this.#interactionFailure.message,
      });
    }
  }

  throwIfCallbackFailed(): void {
    if (this.#callbackFailure) {
      throw this.#callbackFailure;
    }
  }

  async cancelAndCloseSession(sessionId: string): Promise<void> {
    this.#process.notify("session/cancel", { sessionId });
    await this.closeSession(sessionId);
    await this.closeProcess();
  }

  async closeSession(sessionId: string): Promise<void> {
    if (!this.#supportsClose) {
      return;
    }
    this.#sessionClosePromise ??= this.request("session/close", {
      sessionId,
    }).then(() => undefined);
    await this.#sessionClosePromise;
  }

  async closeProcess(): Promise<void> {
    await this.#process.close({ gracefulExitMs: 250 });
  }

  #handleNotification(notification: { method: string; params: unknown }): void {
    if (!this.#turnActive) {
      return;
    }
    this.#collectAgentMessageChunk(notification);
    const toolActivity = this.#toolActivityTracker.observe(notification);
    if (toolActivity) {
      this.#emitRuntimeEvent(toolActivity);
    }
  }

  async #handleClientRequest(request: {
    method: string;
    params: unknown;
  }): Promise<
    { error: { code: number; message: string } } | { result: unknown }
  > {
    const requestSessionId = normalizeOptionalText(
      toRecord(request.params)?.sessionId
    );
    const requestMatchesActiveTurn =
      this.#turnActive &&
      requestSessionId !== null &&
      this.#sessionId !== null &&
      requestSessionId === this.#sessionId;
    if (!requestMatchesActiveTurn) {
      this.#recordInteractionFailure(
        "interaction.session_mismatch",
        "interaction.session_mismatch: Grok Build requested input for a different session"
      );
      return {
        error: {
          code: -32_602,
          message:
            "Grok Build interaction session does not match the active turn.",
        },
      };
    }
    if (this.#input.onInteractionRequest) {
      const interaction = await resolveGrokBuildAcpInteraction({
        method: request.method,
        onInteractionRequest: this.#input.onInteractionRequest,
        params: request.params,
      });
      if (interaction.handled) {
        return { result: interaction.result };
      }
    }
    if (request.method === "session/request_permission") {
      this.#recordInteractionFailure(
        "interaction.permission_required",
        "interaction.permission_required: Grok Build requested permission but no OpenMeld interaction client was available"
      );
      return { result: { outcome: { outcome: "cancelled" } } };
    }
    if (isGrokBuildQuestionMethod(request.method)) {
      this.#recordInteractionFailure(
        "interaction.question_required",
        "interaction.question_required: Grok Build requested user input but no OpenMeld interaction client was available"
      );
      return { result: { outcome: "cancelled" } };
    }
    if (isGrokBuildPlanMethod(request.method)) {
      this.#recordInteractionFailure(
        "interaction.plan_required",
        "interaction.plan_required: Grok Build requested plan review but no OpenMeld interaction client was available"
      );
      return { result: { outcome: "abandoned" } };
    }
    this.#recordInteractionFailure(
      "interaction.unsupported",
      `interaction.unsupported: Grok Build ACP requested unsupported client method '${request.method}'`
    );
    return {
      error: {
        code: -32_601,
        message: `OpenMeld does not support Grok Build ACP client method '${request.method}'.`,
      },
    };
  }

  #collectAgentMessageChunk(notification: {
    method: string;
    params: unknown;
  }): void {
    if (notification.method !== "session/update") {
      return;
    }
    const update = toRecord(toRecord(notification.params)?.update);
    if (update?.sessionUpdate !== "agent_message_chunk") {
      return;
    }
    const content = toRecord(update.content);
    const text =
      content?.type === "text" ? normalizeOutputText(content.text) : null;
    if (!text) {
      return;
    }
    this.#firstOutputAtMs ??= Date.now();
    this.#output += text;
    if (this.#streamingMode === "stream" && this.#input.onPreview) {
      Promise.resolve(this.#input.onPreview({ text: this.#output })).catch(
        (error: unknown) => {
          this.#callbackFailure ??= error;
        }
      );
    }
  }

  #recordInteractionFailure(code: string, message: string): void {
    this.#interactionFailure ??= { code, message };
  }

  #emitRuntimeEvent(event: AdapterRuntimeEvent): void {
    if (!this.#input.onRuntimeEvent) {
      return;
    }
    Promise.resolve(this.#input.onRuntimeEvent(event)).catch(
      (error: unknown) => {
        this.#callbackFailure ??= error;
      }
    );
  }
}

function buildSessionDescriptor(input: {
  initializeModelState: GrokBuildModelState | null;
  operation: "new" | "resume";
  requestedModelId: string | null;
  sessionId: string;
  sessionModelState: GrokBuildModelState | null;
}): GrokBuildSessionDescriptor {
  const initializeModels = input.initializeModelState?.models ?? [];
  const sessionModels = input.sessionModelState?.models ?? [];
  const sourcesAgree = modelStatesAgree(
    input.initializeModelState,
    input.sessionModelState
  );
  let sourceState: AdapterModelNegotiationDiagnostics["sourceState"] =
    "consistent";
  if (initializeModels.length === 0 || sessionModels.length === 0) {
    sourceState = "missing";
  } else if (!sourcesAgree) {
    sourceState = "conflicting";
  }
  const currentModelId = input.sessionModelState?.currentModelId ?? null;
  const diagnostics = buildModelNegotiationDiagnostics({
    initializeModelState: input.initializeModelState,
    operation: input.operation,
    requestedModelId: input.requestedModelId,
    sessionModelState: input.sessionModelState,
    sourceState,
  });
  if (sourceState !== "consistent" || !currentModelId) {
    throw new GrokBuildAcpTransportError({
      code: "model.inventory_unavailable",
      diagnostics: { modelNegotiation: diagnostics },
      errorType: "adapter",
      message:
        "model.inventory_unavailable: Grok Build did not provide one complete, consistent live model inventory",
    });
  }
  if (
    input.requestedModelId &&
    !sessionModels.some((model) => model.modelId === input.requestedModelId)
  ) {
    throw new GrokBuildAcpTransportError({
      code: "model.unavailable",
      diagnostics: { modelNegotiation: diagnostics },
      errorType: "config",
      message: `model.unavailable: Grok Build did not offer model '${input.requestedModelId}' for this account`,
    });
  }
  const current = sessionModels.find(
    (model) => model.modelId === currentModelId
  );
  if (!current) {
    throw new GrokBuildAcpTransportError({
      code: "model.inventory_unavailable",
      diagnostics: { modelNegotiation: diagnostics },
      errorType: "adapter",
      message:
        "model.inventory_unavailable: Grok Build's current model was absent from its live inventory",
    });
  }
  return {
    currentEffort: current.currentEffort,
    currentModelId,
    diagnostics,
    models: sessionModels,
    sessionId: input.sessionId,
  };
}

function readModelState(value: unknown): GrokBuildModelState | null {
  const record = toRecord(value);
  const currentModelId = normalizeOptionalText(record?.currentModelId);
  const availableModels = Array.isArray(record?.availableModels)
    ? record.availableModels
    : [];
  const models = availableModels.flatMap((candidate) => {
    const model = toRecord(candidate);
    const modelId = normalizeOptionalText(model?.modelId);
    if (!modelId) {
      return [];
    }
    const meta = toRecord(model?._meta);
    const efforts = Array.isArray(meta?.reasoningEfforts)
      ? uniqueStrings(
          meta.reasoningEfforts.map((effort) => {
            const record = toRecord(effort);
            return record?.value ?? record?.id;
          })
        )
      : [];
    return [
      {
        currentEffort: normalizeOptionalText(meta?.reasoningEffort),
        displayName: normalizeOptionalText(model?.name) ?? modelId,
        efforts,
        modelId,
      },
    ];
  });
  return currentModelId && models.length > 0
    ? { currentModelId, models }
    : null;
}

function modelStatesAgree(
  left: GrokBuildModelState | null,
  right: GrokBuildModelState | null
): boolean {
  if (!(left && right)) {
    return false;
  }
  if (left.models.length !== right.models.length) {
    return false;
  }
  return left.models.every((leftModel) => {
    const rightModel = right.models.find(
      (candidate) => candidate.modelId === leftModel.modelId
    );
    return (
      rightModel !== undefined &&
      haveSameStrings(leftModel.efforts, rightModel.efforts)
    );
  });
}

function buildModelNegotiationDiagnostics(input: {
  initializeModelState: GrokBuildModelState | null;
  operation: "new" | "resume";
  requestedModelId: string | null;
  sessionModelState: GrokBuildModelState | null;
  sourceState: AdapterModelNegotiationDiagnostics["sourceState"];
}): AdapterModelNegotiationDiagnostics {
  const initializeIds =
    input.initializeModelState?.models.map(({ modelId }) => modelId) ?? [];
  const sessionIds =
    input.sessionModelState?.models.map(({ modelId }) => modelId) ?? [];
  return {
    checkAttempt: 1,
    configAvailableModelCount: initializeIds.length,
    configAvailableModelIds: sanitizeDiagnosticModelIds(initializeIds),
    configAvailableModelIdsTruncated:
      wereDiagnosticModelIdsTruncated(initializeIds),
    configCurrentModelId: sanitizeDiagnosticModelId(
      input.initializeModelState?.currentModelId ?? null
    ),
    currentModelId: sanitizeDiagnosticModelId(
      input.sessionModelState?.currentModelId ?? null
    ),
    legacyAvailableModelCount: sessionIds.length,
    legacyAvailableModelIds: sanitizeDiagnosticModelIds(sessionIds),
    legacyAvailableModelIdsTruncated:
      wereDiagnosticModelIdsTruncated(sessionIds),
    legacyCurrentModelId: sanitizeDiagnosticModelId(
      input.sessionModelState?.currentModelId ?? null
    ),
    protocol: "acp/v1",
    requestedModelId: sanitizeDiagnosticModelId(input.requestedModelId),
    requestedPresentInConfigOptions:
      input.requestedModelId !== null &&
      initializeIds.includes(input.requestedModelId),
    requestedPresentInLegacyModels:
      input.requestedModelId !== null &&
      sessionIds.includes(input.requestedModelId),
    sessionOperation: input.operation,
    sourceState: input.sourceState,
  };
}

function resolveNonInteractiveAuthMethod(
  initializeResult: Record<string, unknown>
): GrokBuildAcpInterfaceProbeResult["authMethodId"] {
  const authMethodIds = (
    Array.isArray(initializeResult.authMethods)
      ? initializeResult.authMethods
      : []
  ).flatMap((method) => {
    const methodId = normalizeOptionalText(toRecord(method)?.id);
    return methodId ? [methodId] : [];
  });
  const preferred = normalizeOptionalText(
    toRecord(initializeResult._meta)?.defaultAuthMethodId
  );
  const nonInteractiveMethods = new Set(["cached_token", "xai.api_key"]);
  if (
    preferred &&
    nonInteractiveMethods.has(preferred) &&
    authMethodIds.includes(preferred)
  ) {
    return preferred as GrokBuildAcpInterfaceProbeResult["authMethodId"];
  }
  if (authMethodIds.includes("cached_token")) {
    return "cached_token";
  }
  if (authMethodIds.includes("xai.api_key")) {
    return "xai.api_key";
  }
  throw new GrokBuildAcpTransportError({
    code: "auth.required",
    errorType: "auth",
    message:
      "auth.required: Grok Build has no non-interactive cached authentication; run 'grok login' in a terminal and try again",
  });
}

function buildGrokBuildAcpArgs(
  permissionMode: AgentControllerPermissionMode | undefined
): string[] {
  return [
    "--no-auto-update",
    "--permission-mode",
    resolveGrokBuildPermissionMode(permissionMode),
    "agent",
    "--no-leader",
    "stdio",
  ];
}

function resolveGrokBuildPermissionMode(
  value: AgentControllerPermissionMode | undefined
):
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "default"
  | "dontAsk"
  | "plan" {
  switch (value) {
    case "grok-build:acceptEdits":
      return "acceptEdits";
    case "grok-build:auto":
      return "auto";
    case "grok-build:bypassPermissions":
      return "bypassPermissions";
    case "grok-build:dontAsk":
      return "dontAsk";
    case "grok-build:plan":
      return "plan";
    default:
      return "default";
  }
}

async function resolveCanonicalDirectory(value: string): Promise<string> {
  try {
    const canonical = await realpath(value);
    const info = await stat(canonical);
    if (!info.isDirectory()) {
      throw new TypeError("path is not a directory");
    }
    return canonical;
  } catch (error) {
    throw new GrokBuildAcpTransportError({
      cause: error,
      code: "workspace.invalid",
      errorType: "config",
      message: `workspace.invalid: Grok Build working directory '${value}' does not exist or is not a directory`,
    });
  }
}

function assertSuccessfulStopReason(value: unknown): void {
  const stopReason = normalizeOptionalText(toRecord(value)?.stopReason);
  if (!stopReason) {
    throw new GrokBuildAcpTransportError({
      code: "protocol.invalid",
      errorType: "adapter",
      message: "protocol.invalid: Grok Build session/prompt omitted stopReason",
    });
  }
  if (stopReason === "end_turn") {
    return;
  }
  throw new GrokBuildAcpTransportError({
    code: `runtime.turn.${stopReason}`,
    errorType: "adapter",
    message: `runtime.turn.${stopReason}: Grok Build ended the turn with stopReason '${stopReason}'`,
  });
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

function toGrokBuildTransportError(
  error: unknown,
  stderr: string,
  diagnostics: AdapterDispatchDiagnostics | null
): GrokBuildAcpTransportError {
  const combined = [toErrorMessage(error), normalizeOptionalText(stderr)]
    .filter((value): value is string => value !== null)
    .join("\n");
  const providerFailure =
    !(error instanceof GrokBuildAcpTransportError) ||
    error.code.startsWith("protocol.")
      ? classifyGrokBuildProviderFailure({
          message: combined,
          originalError:
            error instanceof GrokBuildAcpTransportError
              ? error.originalError
              : undefined,
        })
      : null;
  if (providerFailure) {
    return diagnostics
      ? new GrokBuildAcpTransportError({
          cause: error,
          code: providerFailure.code,
          diagnostics,
          errorType: providerFailure.errorType,
          message: providerFailure.message,
          ...(providerFailure.originalError
            ? { originalError: providerFailure.originalError }
            : {}),
        })
      : providerFailure;
  }
  if (error instanceof GrokBuildAcpTransportError) {
    return error.diagnostics || !diagnostics
      ? error
      : new GrokBuildAcpTransportError({
          cause: error,
          code: error.code,
          diagnostics,
          errorType: error.errorType,
          message: error.message,
          ...(error.originalError
            ? { originalError: error.originalError }
            : {}),
        });
  }
  const classified = new GrokBuildAcpTransportError({
    code: "upstream_unreachable",
    errorType: "adapter",
    message: `upstream_unreachable: ${normalizeOptionalText(combined) ?? "Grok Build ACP error"}`,
  });
  return diagnostics
    ? new GrokBuildAcpTransportError({
        cause: error,
        code: classified.code,
        diagnostics,
        errorType: classified.errorType,
        message: classified.message,
      })
    : classified;
}

function toGrokBuildJsonRpcTransportError(
  error: AcpJsonRpcError
): GrokBuildAcpTransportError {
  let code = "protocol.request_failed";
  let errorType: AdapterErrorType = "adapter";
  if (error.code === -32_601) {
    code = "protocol.method_not_found";
  } else if (error.code === -32_602) {
    code = "protocol.invalid_params";
    errorType = "config";
  }
  const message = normalizeOptionalText(error.message) ?? "ACP request failed";
  const originalError = createProviderOriginalError(message);
  return new GrokBuildAcpTransportError({
    code,
    errorType,
    message: `${code}: ${message}`,
    ...(originalError ? { originalError } : {}),
  });
}

function classifyGrokBuildProviderFailure(input: {
  message: string;
  originalError?: string;
}): GrokBuildAcpTransportError | null {
  const normalized =
    normalizeOptionalText(input.message) ?? "Grok Build ACP error";
  if (AUTH_FAILURE_RE.test(normalized)) {
    return new GrokBuildAcpTransportError({
      code: "auth.failed",
      errorType: "auth",
      message: `auth.failed: ${normalized}`,
      ...(input.originalError ? { originalError: input.originalError } : {}),
    });
  }
  return null;
}

function isContextNotFoundError(error: unknown): boolean {
  return (
    error instanceof GrokBuildAcpTransportError &&
    CONTEXT_NOT_FOUND_RE.test(error.message)
  );
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

function haveSameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

function uniqueStrings(values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .map(normalizeOptionalText)
        .filter((value): value is string => value !== null)
    ),
  ];
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
