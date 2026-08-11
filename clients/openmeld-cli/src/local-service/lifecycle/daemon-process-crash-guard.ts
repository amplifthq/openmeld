import process from "node:process";
import { clearDaemonServiceRuntimeState } from "../../config/daemon-state";
import { emitDaemonLifecycleEvent } from "./daemon-lifecycle-journal";

type ProcessCrashEvent = "uncaughtException" | "unhandledRejection";

type ProcessCrashHandlerInput = {
  event: ProcessCrashEvent;
  reason: unknown;
};

type ProcessLike = {
  off: (
    eventName: ProcessCrashEvent,
    listener: (...args: unknown[]) => void
  ) => unknown;
  on: (
    eventName: ProcessCrashEvent,
    listener: (...args: unknown[]) => void
  ) => unknown;
};

type CrashGuardOptions = {
  clearRuntimeState?: () => Promise<void>;
  emitLifecycleEvent?: typeof emitDaemonLifecycleEvent;
  exit?: (code: number) => void;
  process?: ProcessLike;
};

export type DaemonProcessCrashGuard = {
  dispose: () => void;
};

export function installDaemonProcessCrashGuard(
  options: CrashGuardOptions = {}
): DaemonProcessCrashGuard {
  const targetProcess = options.process ?? process;
  const exit = options.exit ?? ((code) => process.exit(code));
  let handlingCrash = false;

  const handleCrash = (input: ProcessCrashHandlerInput): void => {
    if (handlingCrash) {
      return;
    }
    handlingCrash = true;
    recordDaemonProcessCrash({
      clearRuntimeState:
        options.clearRuntimeState ?? clearDaemonServiceRuntimeState,
      emitLifecycleEvent:
        options.emitLifecycleEvent ?? emitDaemonLifecycleEvent,
      event: input.event,
      reason: input.reason,
    }).finally(() => {
      exit(1);
    });
  };

  const onUncaughtException = (error: unknown): void => {
    handleCrash({ event: "uncaughtException", reason: error });
  };
  const onUnhandledRejection = (reason: unknown): void => {
    handleCrash({ event: "unhandledRejection", reason });
  };

  targetProcess.on("uncaughtException", onUncaughtException);
  targetProcess.on("unhandledRejection", onUnhandledRejection);

  return {
    dispose: () => {
      targetProcess.off("uncaughtException", onUncaughtException);
      targetProcess.off("unhandledRejection", onUnhandledRejection);
    },
  };
}

export async function recordDaemonProcessCrash(input: {
  clearRuntimeState: () => Promise<void>;
  emitLifecycleEvent: typeof emitDaemonLifecycleEvent;
  event: ProcessCrashEvent;
  reason: unknown;
}): Promise<void> {
  const normalized = normalizeCrashReason(input.reason);
  await input
    .emitLifecycleEvent({
      type: "daemon.crash",
      result: "failed",
      metadata: {
        errorMessage: normalized.message,
        errorName: normalized.name,
        errorStack: normalized.stack,
        event: input.event,
      },
      command: "openmeld service run",
      intent: "run_background",
    })
    .catch(() => undefined);
  await input.clearRuntimeState().catch(() => undefined);
}

function normalizeCrashReason(reason: unknown): {
  message: string;
  name: string;
  stack?: string;
} {
  if (reason instanceof Error) {
    return {
      message: normalizeErrorMessage(reason.message),
      name: normalizeErrorMessage(reason.name) || "Error",
      ...(typeof reason.stack === "string" && reason.stack.trim().length > 0
        ? { stack: reason.stack }
        : {}),
    };
  }
  return {
    message: normalizeErrorMessage(String(reason ?? "")) || "unknown error",
    name: "NonErrorCrashReason",
  };
}

function normalizeErrorMessage(value: string): string {
  return value.trim();
}
