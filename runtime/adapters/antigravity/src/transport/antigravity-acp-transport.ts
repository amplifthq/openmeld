import { basename } from "node:path";
import type {
  InitializeResponse,
  NewSessionResponse,
  PromptResponse,
  RequestPermissionRequest,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import {
  type AcpProcessErrorInput,
  AcpProcessSession,
  type AdapterDispatchRequest,
  type AdapterRuntimeProcessCallback,
  buildAcpDispatchSpaceActionMcpServers,
  createAcpToolActivityTracker,
  isDispatchSpaceActionDeliveryOnly,
  type RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import {
  antigravityAcpEnvironment,
  consumeAntigravityAuthLine,
} from "./antigravity-acp-auth.js";
import { answerAntigravityAcpInteraction } from "./antigravity-acp-interactions.js";

export function isAntigravityAcpLaunchContract(
  launch: RuntimeAgentControllerLaunchContract
): boolean {
  const path =
    launch.kind === "node_script" ? launch.scriptPath : launch.commandPath;
  return ["agy_acp_server.par", "agy_acp_server.exe"].includes(
    basename(path).toLowerCase()
  );
}

function acpError(input: AcpProcessErrorInput): Error {
  return Object.assign(new Error(input.message, { cause: input.cause }), {
    code: input.code,
    errorType: input.errorType,
  });
}

const initializeParams = {
  protocolVersion: 1,
  clientInfo: { name: "openmeld", version: "1" },
  clientCapabilities: {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
  },
};

function readInitialize(value: unknown): InitializeResponse {
  const result = value as InitializeResponse | null;
  if (!result || result.protocolVersion !== 1 || !result.agentCapabilities) {
    throw acpError({
      code: "protocol.invalid",
      errorType: "adapter",
      message: "Antigravity did not negotiate ACP version 1.",
    });
  }
  return result;
}

async function admissionRequest(
  process: AcpProcessSession,
  method: string,
  params: unknown
) {
  const timer = setTimeout(
    () =>
      process.fail(
        acpError({
          code: "protocol.timeout",
          errorType: "timeout",
          message: "Antigravity did not finish starting its ACP session.",
        })
      ),
    15_000
  );
  try {
    return await process.request(method, params);
  } finally {
    clearTimeout(timer);
  }
}

export async function probeAntigravityAcp(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  cwd: string;
  timeoutMs?: number | null;
}) {
  const process = new AcpProcessSession({
    args: [],
    cwd: input.cwd,
    env: antigravityAcpEnvironment(input.launchContract),
    consumeNonProtocolLine: consumeAntigravityAuthLine(),
    launchContract: input.launchContract,
    createError: acpError,
    processLabel: "Antigravity",
    timeoutMs: input.timeoutMs ?? 15_000,
  });
  try {
    process.start();
    // Initialize does not authenticate or create a conversation.
    return readInitialize(
      await process.request("initialize", initializeParams)
    );
  } finally {
    await process.close();
  }
}

function mapAcpError(error: { code?: number; message?: string }): Error {
  const message = error.message ?? "Antigravity rejected the request.";
  return acpError({
    code: error.code === -32_000 ? "auth.required" : "protocol.request_failed",
    errorType: error.code === -32_000 ? "auth" : "adapter",
    message,
  });
}

// session/new is the official server's account admission boundary. It does not
// run a prompt or spend model quota. Never call authenticate from a status read.
export async function checkAntigravityAcpAccount(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  signal?: AbortSignal;
  login?: { methodId: string; onAuthorizationUrl: (url: string) => void };
}) {
  const process = new AcpProcessSession({
    args: [],
    cwd: input.cwd,
    env: antigravityAcpEnvironment(input.launchContract, input.env),
    launchContract: input.launchContract,
    createError: acpError,
    consumeNonProtocolLine: consumeAntigravityAuthLine(
      input.login?.onAuthorizationUrl
    ),
    mapJsonRpcError: mapAcpError,
    processLabel: "Antigravity",
    timeoutMs: input.timeoutMs ?? (input.login ? 300_000 : 15_000),
  });
  const abort = () => {
    process.fail(
      acpError({
        code: "auth.cancelled",
        errorType: "auth",
        message: "Antigravity sign-in was cancelled.",
      })
    );
  };
  input.signal?.throwIfAborted();
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    process.start();
    const initialized = readInitialize(
      await process.request("initialize", initializeParams)
    );
    if (input.login) {
      if (
        !initialized.authMethods?.some(
          (method) => method.id === input.login?.methodId
        )
      ) {
        throw acpError({
          code: "auth.method_unavailable",
          errorType: "auth",
          message:
            "This Antigravity installation does not offer the selected sign-in method.",
        });
      }
      await process.request("authenticate", { methodId: input.login.methodId });
    }
    try {
      const session = (await process.request("session/new", {
        cwd: input.cwd,
        mcpServers: [],
      })) as NewSessionResponse;
      if (!session?.sessionId) {
        throw acpError({
          code: "protocol.invalid",
          errorType: "adapter",
          message: "Antigravity did not return a conversation identifier.",
        });
      }
      const config = session.configOptions?.find(
        (option) => option.id === "model" && option.type === "select"
      );
      const choices =
        config?.type === "select"
          ? config.options.flatMap((option) =>
              "value" in option ? [option] : option.options
            )
          : [];
      return {
        initialized,
        authStatus: "authenticated" as const,
        models: choices.map((option) => ({
          id: option.value,
          displayName: option.name,
        })),
      };
    } catch (error) {
      if (
        !input.login &&
        error instanceof Error &&
        "code" in error &&
        error.code === "auth.required"
      ) {
        return {
          initialized,
          authStatus: "unauthenticated" as const,
          models: [],
        };
      }
      throw error;
    }
  } finally {
    input.signal?.removeEventListener("abort", abort);
    await process.close();
  }
}

export async function invokeAntigravityAcpTransport(input: {
  request: AdapterDispatchRequest;
  launchContract: RuntimeAgentControllerLaunchContract;
  sessionId: string | null;
  onProcessControlEvent?: AdapterRuntimeProcessCallback;
  registerCancel?: (cancel: () => Promise<void>) => void;
}) {
  const { request } = input;
  if (
    isDispatchSpaceActionDeliveryOnly(request.env) ||
    request.executionMode === "repair"
  ) {
    throw acpError({
      code: "delivery_scope.unsupported",
      errorType: "config",
      message:
        "Antigravity ACP does not expose an exclusive reply-repair tool scope.",
    });
  }
  const invokedAtMs = Date.now();
  const interactions = new AbortController();
  let sessionId: string | null = null;
  let turnActive = false;
  let output = "";
  let firstOutputAtMs: number | null = null;
  let previewEmitted = false;
  let callbackFailure: unknown;
  let callbacks = Promise.resolve();
  const tracker = createAcpToolActivityTracker();
  const process = new AcpProcessSession({
    args: [],
    cwd: request.runtimeContext.providerRuntimeWorkingDirectory,
    env: antigravityAcpEnvironment(input.launchContract, request.env),
    consumeNonProtocolLine: consumeAntigravityAuthLine(),
    launchContract: input.launchContract,
    createError: acpError,
    processLabel: "Antigravity",
    timeoutMs: request.timeoutMs ?? null,
    mapJsonRpcError: (error) => {
      const message = error.message ?? "Antigravity rejected the request.";
      if (error.code === -32_000 || AUTH_ERROR_RE.test(message)) {
        return acpError({ code: "auth.required", errorType: "auth", message });
      }
      return acpError({
        code: CONTEXT_ERROR_RE.test(message)
          ? "context_not_found"
          : "protocol.request_failed",
        errorType: "adapter",
        message,
      });
    },
    onProcessControlEvent: (event) => {
      if (event.phase === "process_exit") {
        interactions.abort();
      }
      input.onProcessControlEvent?.(event);
    },
    onClientRequest: async ({ method, params }) => {
      if (method !== "session/request_permission") {
        return {
          error: {
            code: -32_601,
            message: `Unsupported ACP client method: ${method}`,
          },
        };
      }
      const permission = params as RequestPermissionRequest;
      if (!turnActive || permission?.sessionId !== sessionId) {
        return { result: { outcome: { outcome: "cancelled" } } };
      }
      if (!request.onInteractionRequest) {
        process.fail(
          acpError({
            code: "interaction.required",
            errorType: "adapter",
            message:
              "Antigravity needs user input, but this run has no interaction channel.",
          })
        );
        return { result: { outcome: { outcome: "cancelled" } } };
      }
      return {
        result: await answerAntigravityAcpInteraction(
          permission,
          request.onInteractionRequest,
          interactions.signal
        ),
      };
    },
    onNotification: (notification) => {
      if (notification.method !== "session/update") {
        return;
      }
      const params = notification.params as SessionNotification;
      // Resume history is not output from this dispatch.
      if (!turnActive || params?.sessionId !== sessionId || !params.update) {
        return;
      }
      callbacks = callbacks
        .then(async () => {
          const update = params.update;
          const activity = tracker.observe(notification);
          if (activity) {
            await request.onRuntimeEvent?.(activity);
          }
          if (
            update.sessionUpdate === "agent_message_chunk" &&
            update.content.type === "text"
          ) {
            output += update.content.text;
            firstOutputAtMs ??= Date.now();
            if (request.streamingMode === "stream" && request.onPreview) {
              await request.onPreview({ text: output });
              previewEmitted = true;
            }
          }
          if (
            update.sessionUpdate === "agent_thought_chunk" &&
            update.content.type === "text"
          ) {
            await request.onRuntimeEvent?.({
              phase: "reasoning",
              blockId: "antigravity-thought",
              mode: "append",
              text: update.content.text,
              tsMs: Date.now(),
            });
          }
        })
        .catch((error) => {
          callbackFailure = error;
          process.fail(error);
        });
    },
  });
  try {
    process.start();
    sessionId = await configureSession(process, input);
    input.registerCancel?.(() => {
      interactions.abort();
      process.notify("session/cancel", { sessionId });
      return Promise.resolve();
    });
    turnActive = true;
    const prompt = request.instructionPrompt
      ? `${request.instructionPrompt.developerInstructions}\n\n${request.instructionPrompt.userPrompt}`
      : request.prompt;
    const pending = process.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: prompt }],
    });
    const result = (await pending) as PromptResponse;
    await callbacks;
    if (callbackFailure) {
      throw callbackFailure;
    }
    if (result.stopReason !== "end_turn") {
      throw acpError({
        code:
          result.stopReason === "cancelled"
            ? "runtime.interrupted"
            : "runtime.incomplete",
        errorType: "adapter",
        message: `Antigravity ended the turn: ${result.stopReason}`,
      });
    }
    if (request.streamingMode !== "stream" && request.onPreview && output) {
      await request.onPreview({ text: output });
      previewEmitted = true;
    }
    return {
      sessionId,
      output,
      telemetry: process.buildTelemetry({
        invokedAtMs,
        firstOutputAtMs,
        previewEmitted,
        resumedContext: input.sessionId !== null,
        streamingMode: request.streamingMode ?? "final",
      }),
    };
  } finally {
    turnActive = false;
    interactions.abort();
    await process.close();
  }
}

async function configureSession(
  process: AcpProcessSession,
  input: { request: AdapterDispatchRequest; sessionId: string | null }
) {
  const { request } = input;
  const initialized = readInitialize(
    await admissionRequest(process, "initialize", initializeParams)
  );
  // The native profile selects the account. Only an explicit login command
  // may call authenticate; Wake must never start an OAuth flow.
  if (
    input.sessionId &&
    !initialized.agentCapabilities?.sessionCapabilities?.resume
  ) {
    throw acpError({
      code: "context.resume_unsupported",
      errorType: "adapter",
      message: "This Antigravity version cannot resume ACP conversations.",
    });
  }
  const descriptor = (await admissionRequest(
    process,
    input.sessionId ? "session/resume" : "session/new",
    {
      cwd: request.runtimeContext.providerRuntimeWorkingDirectory,
      mcpServers: buildAcpDispatchSpaceActionMcpServers(request.env),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    }
  )) as NewSessionResponse;
  const sessionId = input.sessionId ?? descriptor?.sessionId;
  if (!sessionId) {
    throw acpError({
      code: "protocol.invalid",
      errorType: "adapter",
      message: "Antigravity did not return a conversation identifier.",
    });
  }
  await request.onRuntimeEvent?.({
    phase: "provider_conversation_observed",
    agentControllerConversationId: sessionId,
    tsMs: Date.now(),
  });
  const mode = resolveAcpMode(request.agentControllerPermissionMode);
  if (!descriptor.modes?.availableModes.some((value) => value.id === mode)) {
    throw acpError({
      code: "permission.mode_unsupported",
      errorType: "config",
      message: `Antigravity ACP does not offer the selected permission mode '${mode}'.`,
    });
  }
  await process.request("session/set_mode", { sessionId, modeId: mode });
  const model = request.conversationPolicy?.model;
  if (model) {
    const config = descriptor.configOptions?.find(
      (option) => option.id === "model" && option.type === "select"
    );
    const options =
      config?.type === "select"
        ? config.options.flatMap((option) =>
            "value" in option ? [option] : option.options
          )
        : [];
    if (!options.some((option) => option.value === model)) {
      throw acpError({
        code: "model.unavailable",
        errorType: "config",
        message: `Antigravity model '${model}' is not available for this account.`,
      });
    }
    await process.request("session/set_config_option", {
      sessionId,
      configId: "model",
      value: model,
    });
  }
  if (request.conversationPolicy?.reasoningLevel) {
    throw acpError({
      code: "model.reasoning_unsupported",
      errorType: "config",
      message: "Antigravity ACP does not expose a reasoning-level setting.",
    });
  }
  return sessionId;
}

const AUTH_ERROR_RE = /authentication|sign.in|login/iu;
const CONTEXT_ERROR_RE = /session.+not found|unknown session/iu;
function resolveAcpMode(
  mode: AdapterDispatchRequest["agentControllerPermissionMode"]
): string {
  switch (mode) {
    case undefined:
    case "antigravity:default":
      return "default";
    case "antigravity:acceptEdits":
      return "auto_edit";
    case "antigravity:bypassPermissions":
      return "yolo";
    case "antigravity:plan":
      return "plan";
    default:
      throw acpError({
        code: "permission.mode_unsupported",
        errorType: "config",
        message: "Select an Antigravity permission mode.",
      });
  }
}
