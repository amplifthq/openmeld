import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { RuntimeAgentControllerLaunchContract } from "@openmeld/schemas/types";
import type { AgentControllerProcessSignalTarget } from "./agent-controller-process.js";
import {
  type AgentControllerProcessCleanupResult,
  type SpawnedAgentControllerProcess,
  spawnAgentControllerProcess,
} from "./agent-controller-process.js";
import { buildCliLaunchInvocation } from "./launch-contract.js";

export type AcpJsonRpcId = number | string;

export type AcpJsonRpcError = {
  code?: number;
  data?: unknown;
  message?: string;
};

export type AcpJsonRpcMessage = {
  error?: AcpJsonRpcError;
  id?: AcpJsonRpcId | null;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
  result?: unknown;
};

export type AcpProcessErrorType =
  | "adapter"
  | "auth"
  | "config"
  | "network"
  | "timeout"
  | "unknown";

export type AcpProcessErrorInput = {
  cause?: unknown;
  code: string;
  errorType: AcpProcessErrorType;
  message: string;
};

export type AcpProcessErrorFactory = (input: AcpProcessErrorInput) => Error;

export type AcpClientRequestResponse =
  | { error: AcpJsonRpcError }
  | { result: unknown };

export type AcpClientRequestHandler = (input: {
  method: string;
  params: unknown;
}) => AcpClientRequestResponse | Promise<AcpClientRequestResponse>;

export type AcpNotificationHandler = (input: {
  method: string;
  params: unknown;
}) => void;

export type AcpProcessLifecycleEvent =
  | {
      phase: "process_spawned";
      processId: number | null;
      signalTarget: AgentControllerProcessSignalTarget;
      tsMs: number;
    }
  | {
      phase: "stdin_closed";
      processId: number | null;
      tsMs: number;
    }
  | {
      phase: "first_stdout" | "first_stderr" | "timeout_triggered";
      processId: number | null;
      tsMs: number;
    }
  | {
      exitCode: number | null;
      phase: "process_exit";
      processId: number | null;
      signal: NodeJS.Signals | null;
      signalTarget: AgentControllerProcessSignalTarget;
      tsMs: number;
    };

export type AcpProcessControlEvent = {
  phase: "process_exit" | "process_spawned";
  processId: number | null;
  signalTarget: AgentControllerProcessSignalTarget;
};

export type AcpProcessLifecycle = {
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

export type AcpProcessTelemetry = {
  completedAtMs: number;
  exitCode?: number | null;
  exitObservedAtMs?: number;
  exitSignal?: NodeJS.Signals | null;
  firstOutputAtMs?: number;
  firstStderrAtMs?: number;
  firstStdoutAtMs?: number;
  invokedAtMs: number;
  previewEmitted?: boolean;
  processId?: number;
  processSpawnedAtMs?: number;
  resumedContext: boolean;
  stdinClosedAtMs?: number;
  streamingMode?: "final" | "stream";
  timeoutTriggeredAtMs?: number;
};

type PendingJsonRpcRequest = {
  reject: (error: unknown) => void;
  resolve: (value: unknown) => void;
};

const ACP_PROCESS_KILL_GRACE_MS = 1000;
const MAX_STDERR_CHARS = 16_000;

export class AcpProcessSession {
  readonly #args: readonly string[];
  readonly #createError: AcpProcessErrorFactory;
  readonly #cwd: string;
  readonly #env?: Record<string, string | undefined>;
  readonly #launchContract: RuntimeAgentControllerLaunchContract;
  readonly #mapJsonRpcError?: (error: AcpJsonRpcError) => Error;
  readonly #onClientRequest?: AcpClientRequestHandler;
  readonly #onLifecycleEvent?: (event: AcpProcessLifecycleEvent) => void;
  readonly #onNotification?: AcpNotificationHandler;
  readonly #onProcessControlEvent?: (event: AcpProcessControlEvent) => void;
  readonly #pending = new Map<AcpJsonRpcId, PendingJsonRpcRequest>();
  readonly #processLabel: string;
  readonly #timeoutMs: number | null;
  #child: ChildProcessWithoutNullStreams | null = null;
  #cleanupPromise: Promise<AgentControllerProcessCleanupResult> | null = null;
  #forceKillTimeout: NodeJS.Timeout | null = null;
  readonly #lifecycle: AcpProcessLifecycle = {
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
  #lineBuffer = "";
  #nextRequestId = 1;
  #processTimeout: NodeJS.Timeout | null = null;
  #runtimeProcess: SpawnedAgentControllerProcess | null = null;
  #settledFailure: unknown = null;
  #stderr = "";

  constructor(input: {
    args: readonly string[];
    createError: AcpProcessErrorFactory;
    cwd: string;
    env?: Record<string, string | undefined>;
    launchContract: RuntimeAgentControllerLaunchContract;
    mapJsonRpcError?: (error: AcpJsonRpcError) => Error;
    onClientRequest?: AcpClientRequestHandler;
    onLifecycleEvent?: (event: AcpProcessLifecycleEvent) => void;
    onNotification?: AcpNotificationHandler;
    onProcessControlEvent?: (event: AcpProcessControlEvent) => void;
    processLabel: string;
    timeoutMs: number | null;
  }) {
    this.#args = input.args;
    this.#createError = input.createError;
    this.#cwd = input.cwd;
    this.#env = input.env;
    this.#launchContract = input.launchContract;
    this.#mapJsonRpcError = input.mapJsonRpcError;
    this.#onClientRequest = input.onClientRequest;
    this.#onLifecycleEvent = input.onLifecycleEvent;
    this.#onNotification = input.onNotification;
    this.#onProcessControlEvent = input.onProcessControlEvent;
    this.#processLabel = input.processLabel;
    this.#timeoutMs = input.timeoutMs;
  }

  start(): void {
    if (this.#child) {
      throw this.#error({
        code: "protocol.invalid",
        errorType: "adapter",
        message: `protocol.invalid: ${this.#processLabel} ACP process has already started`,
      });
    }
    const invocation = buildCliLaunchInvocation({
      args: [...this.#args],
      launchContract: this.#launchContract,
    });
    const runtimeProcess = spawnAgentControllerProcess({
      args: invocation.args,
      bin: invocation.bin,
      cwd: this.#cwd,
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
    this.#onLifecycleEvent?.({
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
        this.#onLifecycleEvent?.({
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
        this.#onLifecycleEvent?.({
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
        this.#error({
          cause: error,
          code: "upstream_unreachable",
          errorType: "adapter",
          message: `upstream_unreachable: failed to spawn ${this.#processLabel} ACP (${error.message})`,
        })
      );
    });
    child.on("close", (exitCode, signal) => {
      this.#ensureRemainingDescendantsCleanup();
      this.#clearTimers();
      this.#lifecycle.exitCode = exitCode;
      this.#lifecycle.exitObservedAtMs = Date.now();
      this.#lifecycle.exitSignal = signal;
      this.#onLifecycleEvent?.({
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
          this.#error({
            code: "upstream_unreachable",
            errorType: "adapter",
            message: `upstream_unreachable: ${this.#processLabel} ACP exited before completing the request${this.formatStderrSuffix()}`,
          })
        );
      }
    });
    this.#processTimeout =
      this.#timeoutMs === null
        ? null
        : setTimeout(() => {
            const timeoutTriggeredAtMs = Date.now();
            this.#lifecycle.timeoutTriggeredAtMs = timeoutTriggeredAtMs;
            this.#onLifecycleEvent?.({
              phase: "timeout_triggered",
              processId,
              tsMs: timeoutTriggeredAtMs,
            });
            this.#failAll(
              this.#error({
                code: "process.timeout",
                errorType: "timeout",
                message: `process.timeout: ${this.#processLabel} ACP did not complete within ${this.#timeoutMs}ms`,
              })
            );
            this.#requestProcessTermination("SIGTERM");
          }, this.#timeoutMs);
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

  fail(error: unknown): void {
    this.#failAll(error);
  }

  readLifecycle(): AcpProcessLifecycle {
    return { ...this.#lifecycle };
  }

  readStderr(): string {
    return this.#stderr;
  }

  buildTelemetry(input: {
    firstOutputAtMs?: number | null;
    invokedAtMs: number;
    previewEmitted: boolean;
    resumedContext: boolean;
    streamingMode: "final" | "stream";
  }): AcpProcessTelemetry {
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
      ...(input.firstOutputAtMs === null || input.firstOutputAtMs === undefined
        ? {}
        : { firstOutputAtMs: input.firstOutputAtMs }),
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

  async close(input?: { gracefulExitMs?: number }): Promise<void> {
    this.#clearProcessTimeout();
    const child = this.#child;
    if (!child) {
      return;
    }
    if (this.#lifecycle.stdinClosedAtMs === null) {
      this.#lifecycle.stdinClosedAtMs = Date.now();
      this.#onLifecycleEvent?.({
        phase: "stdin_closed",
        processId: this.#lifecycle.processId,
        tsMs: this.#lifecycle.stdinClosedAtMs,
      });
    }
    if (!(child.stdin.destroyed || child.stdin.writableEnded)) {
      child.stdin.end();
    }
    if (this.#lifecycle.exitObservedAtMs !== null) {
      await this.#finishRemainingDescendantsCleanup();
      return;
    }

    const gracefulExitMs = input?.gracefulExitMs ?? 0;
    if (gracefulExitMs > 0 && (await this.#waitForClose(gracefulExitMs))) {
      await this.#finishRemainingDescendantsCleanup();
      return;
    }
    this.#requestProcessTermination("SIGTERM");
    if (await this.#waitForClose(ACP_PROCESS_KILL_GRACE_MS)) {
      await this.#finishRemainingDescendantsCleanup();
      return;
    }
    this.#requestProcessTermination("SIGKILL");
    await this.#waitForClose(ACP_PROCESS_KILL_GRACE_MS);
    await this.#finishRemainingDescendantsCleanup();
  }

  formatStderrSuffix(): string {
    const normalized = this.#stderr.trim();
    return normalized ? `: ${normalized}` : "";
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
    let message: AcpJsonRpcMessage;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
        throw new TypeError("JSON-RPC message must be an object");
      }
      message = parsed as AcpJsonRpcMessage;
    } catch (error) {
      this.#failAll(
        this.#error({
          cause: error,
          code: "protocol.invalid",
          errorType: "adapter",
          message: `protocol.invalid: ${this.#processLabel} ACP emitted non-JSON-RPC output (${toErrorMessage(error)})`,
        })
      );
      return;
    }
    if (message.id !== undefined && message.method) {
      this.#handleClientRequest(message).catch((error: unknown) => {
        this.#failAll(error);
      });
      return;
    }
    if (message.id !== undefined) {
      this.#handleResponse(message);
      return;
    }
    if (message.method) {
      this.#onNotification?.({
        method: message.method,
        params: message.params,
      });
    }
  }

  #handleResponse(message: AcpJsonRpcMessage): void {
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
      pending.reject(this.#toJsonRpcError(message.error));
      return;
    }
    pending.resolve(message.result);
  }

  async #handleClientRequest(message: AcpJsonRpcMessage): Promise<void> {
    const id = message.id;
    const method = message.method;
    if (!((typeof id === "number" || typeof id === "string") && method)) {
      return;
    }
    const response = this.#onClientRequest
      ? await this.#onClientRequest({
          method,
          params: message.params,
        })
      : {
          error: {
            code: -32_601,
            message: `OpenMeld does not support ACP client method '${method}'.`,
          },
        };
    this.#write({
      id,
      jsonrpc: "2.0",
      ...response,
    });
  }

  #write(message: AcpJsonRpcMessage): void {
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

  #buildStdinWriteError(cause?: unknown): Error {
    const detail =
      cause instanceof Error && cause.message.trim()
        ? ` (${cause.message.trim()})`
        : "";
    return this.#error({
      cause,
      code: "upstream_unreachable",
      errorType: "adapter",
      message: `upstream_unreachable: ${this.#processLabel} ACP is not accepting responses${detail}`,
    });
  }

  #toJsonRpcError(error: AcpJsonRpcError): Error {
    if (this.#mapJsonRpcError) {
      return this.#mapJsonRpcError(error);
    }
    let code = "protocol.request_failed";
    if (error.code === -32_601) {
      code = "protocol.method_not_found";
    } else if (error.code === -32_602) {
      code = "protocol.invalid_params";
    }
    const message =
      normalizeOptionalText(error.message) ?? "ACP request failed";
    return this.#error({
      code,
      errorType: "adapter",
      message: `${code}: ${message}`,
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

  #requestProcessTermination(signal: NodeJS.Signals): void {
    const runtimeProcess = this.#runtimeProcess;
    if (!runtimeProcess || this.#lifecycle.exitObservedAtMs !== null) {
      return;
    }
    runtimeProcess.terminate(signal);
    if (signal === "SIGTERM") {
      this.#forceKillTimeout = setTimeout(() => {
        if (this.#lifecycle.exitObservedAtMs === null) {
          runtimeProcess.terminate("SIGKILL");
        }
      }, ACP_PROCESS_KILL_GRACE_MS);
      this.#forceKillTimeout.unref?.();
    }
  }

  #ensureRemainingDescendantsCleanup(): Promise<AgentControllerProcessCleanupResult> {
    this.#cleanupPromise ??=
      this.#runtimeProcess?.terminateRemainingDescendants() ??
      Promise.resolve({ ok: true, signalSent: false });
    return this.#cleanupPromise;
  }

  async #finishRemainingDescendantsCleanup(): Promise<void> {
    const result = await this.#ensureRemainingDescendantsCleanup();
    if (result.ok) {
      return;
    }
    throw this.#error({
      cause: result.error,
      code: "process.cleanup_failed",
      errorType: "adapter",
      message: `process.cleanup_failed: OpenMeld could not stop every ${this.#processLabel} process`,
    });
  }

  async #waitForClose(timeoutMs: number): Promise<boolean> {
    const child = this.#child;
    if (!child || this.#lifecycle.exitObservedAtMs !== null) {
      return true;
    }
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const onClose = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(true);
      };
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.off("close", onClose);
        resolve(false);
      }, timeoutMs);
      timeout.unref?.();
      child.once("close", onClose);
    });
  }

  #clearProcessTimeout(): void {
    if (this.#processTimeout !== null) {
      clearTimeout(this.#processTimeout);
      this.#processTimeout = null;
    }
  }

  #clearTimers(): void {
    this.#clearProcessTimeout();
    if (this.#forceKillTimeout !== null) {
      clearTimeout(this.#forceKillTimeout);
      this.#forceKillTimeout = null;
    }
  }

  #error(input: AcpProcessErrorInput): Error {
    return this.#createError(input);
  }
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
