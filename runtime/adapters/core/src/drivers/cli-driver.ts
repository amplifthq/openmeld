import { spawnAgentControllerProcess } from "../agent-controller-process.js";
import type {
  CliDriverInvocation,
  CliDriverInvocationResult,
  CliDriverLifecycleEvent,
  CliDriverLifecycleTelemetry,
  CliDriverLineDecision,
  CliDriverLineEvent,
  CliDriverProcessControlEvent,
} from "./driver-types.js";

export type CliDriverErrorCode =
  | "input.invalid"
  | "process.spawn_failed"
  | "process.timeout"
  | "process.non_zero_exit";

const PROCESS_TIMEOUT_FORCE_KILL_GRACE_MS = 1000;

export class CliDriverError extends Error {
  readonly code: CliDriverErrorCode;
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly stderrText?: string;
  readonly stdoutText?: string;

  constructor(input: {
    code: CliDriverErrorCode;
    message: string;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    stderrText?: string;
    stdoutText?: string;
  }) {
    super(input.message);
    this.code = input.code;
    this.name = "CliDriverError";
    this.exitCode = input.exitCode;
    this.signal = input.signal;
    this.stderrText = input.stderrText;
    this.stdoutText = input.stdoutText;
  }
}

export async function runCliDriver(
  input: CliDriverInvocation
): Promise<CliDriverInvocationResult> {
  const args = [...input.args];
  const timeoutMs = normalizeTimeoutMs(input.timeoutMs);
  const binary = normalizeRequiredText(input.bin, "bin");
  const cwd = normalizeRequiredText(input.cwd, "cwd");

  return await new Promise<CliDriverInvocationResult>((resolve, reject) => {
    const runtimeProcess = spawnAgentControllerProcess({
      args,
      bin: binary,
      cwd,
      env: {
        ...process.env,
        ...(input.env ?? {}),
      },
      shell: input.shell ?? false,
    });
    const { child, processId, signalTarget } = runtimeProcess;

    let settled = false;
    let stdoutText = "";
    let stderrText = "";
    let stdoutLineBuffer = "";
    let stderrLineBuffer = "";
    let pendingTimeoutFailure: { timeoutMs: number } | null = null;
    const lifecycle: CliDriverLifecycleTelemetry = {
      exitCode: null,
      exitObservedAtMs: null,
      exitSignal: null,
      firstStderrAtMs: null,
      firstStdoutAtMs: null,
      processId,
      processSpawnedAtMs: Date.now(),
      stdinClosedAtMs: null,
      timeoutTriggeredAtMs: null,
    };

    const processSpawnedAtMs = Date.now();
    lifecycle.processSpawnedAtMs = processSpawnedAtMs;
    emitLifecycleEvent(input.onLifecycleEvent, {
      phase: "process_spawned",
      processId,
      signalTarget,
      tsMs: processSpawnedAtMs,
    });
    emitProcessControlEvent(input.onProcessControlEvent, {
      phase: "process_spawned",
      processId,
      signalTarget,
    });

    const complete = <T>(
      handler: (value: T | PromiseLike<T>) => void,
      value: T
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      handler(value);
    };

    const fail = (error: unknown): void => {
      if (error instanceof CliDriverError) {
        complete(reject, error);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      complete(
        reject,
        new CliDriverError({
          code: "process.spawn_failed",
          message: `process.spawn_failed: ${message}`,
        })
      );
    };

    let forceKillTimeout: NodeJS.Timeout | null = null;
    let processTimeout: NodeJS.Timeout | null = null;
    const clearTimers = (): void => {
      if (processTimeout !== null) {
        clearTimeout(processTimeout);
      }
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
    };

    const requestProcessTermination = (): void => {
      runtimeProcess.terminate("SIGTERM");
      forceKillTimeout = setTimeout(() => {
        runtimeProcess.terminate("SIGKILL");
      }, PROCESS_TIMEOUT_FORCE_KILL_GRACE_MS);
      forceKillTimeout.unref?.();
    };

    const completeFromProviderTerminalOutput = (
      decision: CliDriverLineDecision
    ): void => {
      if (settled || decision.complete !== true) {
        return;
      }
      clearTimers();
      if (decision.terminateProcess !== false) {
        requestProcessTermination();
      }
      complete(resolve, {
        exitCode: lifecycle.exitCode ?? 0,
        lifecycle: {
          ...lifecycle,
        },
        signal: lifecycle.exitSignal,
        stderrText,
        stdoutText,
      });
    };

    const markStdinClosed = (): void => {
      if (lifecycle.stdinClosedAtMs !== null) {
        return;
      }
      const stdinClosedAtMs = Date.now();
      lifecycle.stdinClosedAtMs = stdinClosedAtMs;
      emitLifecycleEvent(input.onLifecycleEvent, {
        phase: "stdin_closed",
        processId,
        tsMs: stdinClosedAtMs,
      });
    };

    processTimeout =
      timeoutMs === null
        ? null
        : setTimeout(() => {
            const timeoutTriggeredAtMs = Date.now();
            lifecycle.timeoutTriggeredAtMs = timeoutTriggeredAtMs;
            emitLifecycleEvent(input.onLifecycleEvent, {
              phase: "timeout_triggered",
              processId,
              tsMs: timeoutTriggeredAtMs,
            });
            pendingTimeoutFailure = {
              timeoutMs,
            };
            runtimeProcess.terminate("SIGTERM");
            forceKillTimeout = setTimeout(() => {
              runtimeProcess.terminate("SIGKILL");
            }, PROCESS_TIMEOUT_FORCE_KILL_GRACE_MS);
          }, timeoutMs);

    child.on("error", (error) => {
      clearTimers();
      fail(error);
    });

    child.stdin.on("error", (error) => {
      if (isBenignStdinCloseError(error)) {
        markStdinClosed();
        return;
      }
      fail(error);
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (settled) {
        return;
      }
      const text = String(chunk);
      if (lifecycle.firstStdoutAtMs === null) {
        const firstStdoutAtMs = Date.now();
        lifecycle.firstStdoutAtMs = firstStdoutAtMs;
        emitLifecycleEvent(input.onLifecycleEvent, {
          phase: "first_stdout",
          processId,
          tsMs: firstStdoutAtMs,
        });
      }
      stdoutText += text;
      const lineEmission = emitLines({
        buffer: stdoutLineBuffer + text,
        onLine: input.onStdoutLine,
      });
      stdoutLineBuffer = lineEmission.buffer;
      if (lineEmission.completionDecision) {
        completeFromProviderTerminalOutput(lineEmission.completionDecision);
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (settled) {
        return;
      }
      const text = String(chunk);
      if (lifecycle.firstStderrAtMs === null) {
        const firstStderrAtMs = Date.now();
        lifecycle.firstStderrAtMs = firstStderrAtMs;
        emitLifecycleEvent(input.onLifecycleEvent, {
          phase: "first_stderr",
          processId,
          tsMs: firstStderrAtMs,
        });
      }
      stderrText += text;
      const lineEmission = emitLines({
        buffer: stderrLineBuffer + text,
        onLine: input.onStderrLine,
      });
      stderrLineBuffer = lineEmission.buffer;
      if (lineEmission.completionDecision) {
        completeFromProviderTerminalOutput(lineEmission.completionDecision);
      }
    });

    child.on("close", async (exitCode, signal) => {
      await runtimeProcess.terminateRemainingDescendants();
      clearTimers();
      const exitObservedAtMs = Date.now();
      lifecycle.exitCode = exitCode;
      lifecycle.exitSignal = signal;
      lifecycle.exitObservedAtMs = exitObservedAtMs;
      emitLifecycleEvent(input.onLifecycleEvent, {
        exitCode,
        phase: "process_exit",
        processId,
        signal,
        signalTarget,
        tsMs: exitObservedAtMs,
      });
      emitProcessControlEvent(input.onProcessControlEvent, {
        phase: "process_exit",
        processId,
        signalTarget,
      });
      flushLineBuffer(stdoutLineBuffer, input.onStdoutLine);
      flushLineBuffer(stderrLineBuffer, input.onStderrLine);

      const closeFailure = resolveCliDriverCloseFailure({
        allowNonZeroExit: input.allowNonZeroExit,
        exitCode,
        pendingTimeoutFailure,
        signal,
        stderrText,
        stdoutText,
      });
      if (closeFailure) {
        complete(reject, closeFailure);
        return;
      }

      complete(resolve, {
        exitCode: exitCode ?? 0,
        lifecycle,
        signal,
        stderrText,
        stdoutText,
      });
    });

    child.stdin.end((input.inputText ?? "").toString(), () => {
      markStdinClosed();
    });
  });
}

const normalizeTimeoutMs = (
  value: number | null | undefined
): number | null => {
  if (value === null || typeof value === "undefined") {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliDriverError({
      code: "input.invalid",
      message: "input.invalid: timeoutMs must be a positive integer",
    });
  }
  return value;
};

const resolveCliDriverCloseFailure = (input: {
  allowNonZeroExit?: boolean;
  exitCode: number | null;
  pendingTimeoutFailure: { timeoutMs: number } | null;
  signal: NodeJS.Signals | null;
  stderrText: string;
  stdoutText: string;
}): CliDriverError | null => {
  if (input.pendingTimeoutFailure) {
    return new CliDriverError({
      code: "process.timeout",
      message: `process.timeout: command exceeded ${String(input.pendingTimeoutFailure.timeoutMs)}ms`,
      exitCode: input.exitCode,
      signal: input.signal,
      stderrText: input.stderrText,
      stdoutText: input.stdoutText,
    });
  }

  if (input.exitCode === 0 || input.allowNonZeroExit === true) {
    return null;
  }

  return new CliDriverError({
    code: "process.non_zero_exit",
    message: `process.non_zero_exit: command exited with code ${String(input.exitCode)}${
      input.signal ? ` (signal=${input.signal})` : ""
    }`,
    exitCode: input.exitCode,
    signal: input.signal,
    stderrText: input.stderrText,
    stdoutText: input.stdoutText,
  });
};

const normalizeRequiredText = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new CliDriverError({
      code: "input.invalid",
      message: `input.invalid: ${field} is required`,
    });
  }
  return normalized;
};

const isBenignStdinCloseError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const code =
    "code" in error && typeof error.code === "string" ? error.code : null;
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED";
};

const emitLines = (input: {
  buffer: string;
  onLine?: (event: CliDriverLineEvent) => CliDriverLineDecision | undefined;
}): {
  buffer: string;
  completionDecision: CliDriverLineDecision | null;
} => {
  const lines = input.buffer.split("\n");
  const pending = lines.pop() ?? "";
  let completionDecision: CliDriverLineDecision | null = null;
  for (const line of lines) {
    const decision = input.onLine?.({
      line,
    });
    if (isCliDriverLineDecision(decision) && decision.complete === true) {
      completionDecision = decision;
    }
  }
  return {
    buffer: pending,
    completionDecision,
  };
};

const flushLineBuffer = (
  lineBuffer: string,
  onLine?: (event: CliDriverLineEvent) => CliDriverLineDecision | undefined
): void => {
  if (!lineBuffer) {
    return;
  }
  onLine?.({
    line: lineBuffer,
  });
};

const isCliDriverLineDecision = (
  value: CliDriverLineDecision | undefined
): value is CliDriverLineDecision =>
  typeof value === "object" && value !== null;

const emitLifecycleEvent = (
  onLifecycleEvent: ((event: CliDriverLifecycleEvent) => void) | undefined,
  event: CliDriverLifecycleEvent
): void => {
  onLifecycleEvent?.(event);
};

const emitProcessControlEvent = (
  onProcessControlEvent:
    | ((event: CliDriverProcessControlEvent) => void)
    | undefined,
  event: CliDriverProcessControlEvent
): void => {
  onProcessControlEvent?.(event);
};
