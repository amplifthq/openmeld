import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import {
  type ServiceExecutionHostIdentity,
  type ServiceExecutionHostInput,
  type ServiceExecutionHostMethod,
  type ServiceExecutionHostOutput,
  type ServiceExecutionHostSnapshot,
  serviceExecutionHostSnapshotSchema,
} from "@openmeld/schemas";
import { isBinaryDistribution } from "../../runtime/distribution";
import { createExecutionHostClient, ExecutionHostError } from "./channel";
import type { ExecutionHostEvent, ExecutionHostPort } from "./port";
import { childExecutionHostChannel } from "./process-channel";

const HOST_HEALTH_TIMEOUT_MS = 2000;
const PREVIOUS_WORK_RECHECK_MS = 5000;
const EXECUTION_HOST_REASON_CODE_PATTERN = /^host\.[a-z0-9_.-]{1,80}$/u;

export type ExecutionHostUnavailableReason = {
  code: string;
  message: string;
  recoveryAction:
    | "wait_for_previous_work"
    | "restart_computer"
    | "update_openmeld_tools"
    | "open_diagnostics";
};

export type ExecutionHostInitializationOutcome =
  | { status: "ready" }
  | {
      status: "refused";
      reason: ExecutionHostUnavailableReason;
      // The Host's own error, which may name local paths; local logs only.
      detail: string;
      retrying: boolean;
    };

function projectExecutionHostUnavailableReason(
  error: unknown
): ExecutionHostUnavailableReason {
  const code =
    error instanceof ExecutionHostError ? error.code : "host.operation_failed";
  if (code === "host.previous_work_running") {
    return {
      code,
      message:
        "Local agent work from the previous OpenMeld Service session is still finishing on this computer.",
      recoveryAction: "wait_for_previous_work",
    };
  }
  if (code === "host.previous_work_unconfirmed") {
    return {
      code,
      message:
        "OpenMeld cannot confirm that work from the previous local execution host has ended.",
      recoveryAction: "restart_computer",
    };
  }
  // Restarting cannot repair or identify these records; they need inspection.
  if (code === "host.owner_corrupt") {
    return {
      code,
      message:
        "OpenMeld cannot read the local execution ownership record on this computer.",
      recoveryAction: "open_diagnostics",
    };
  }
  if (code === "host.owner_lock_unverified") {
    return {
      code,
      message:
        "OpenMeld cannot identify which process holds local execution on this computer.",
      recoveryAction: "open_diagnostics",
    };
  }
  if (code === "host.entry_unavailable") {
    return {
      code,
      message: "OpenMeld cannot find its bundled local execution host.",
      recoveryAction: "update_openmeld_tools",
    };
  }
  return {
    code: EXECUTION_HOST_REASON_CODE_PATTERN.test(code)
      ? code
      : "host.operation_failed",
    message: "OpenMeld could not start or verify its local execution host.",
    recoveryAction: "open_diagnostics",
  };
}

// Both distributions launch their own exact entry and bundled Host. No PATH
// lookup, newer installed CLI, shell string, or renderer-selected executable.
export function executionHostLaunchArguments(input: {
  binary: boolean;
  entry?: string;
  execArgv: string[];
  hostInstanceId: string;
}): string[] {
  const command = ["service", "execution-host", input.hostInstanceId];
  if (input.binary) {
    return command;
  }
  if (!(input.entry && isAbsolute(input.entry))) {
    throw new ExecutionHostError(
      "host.entry_unavailable",
      "The Service cannot identify its bundled execution-host entry."
    );
  }
  return [...input.execArgv, input.entry, ...command];
}

export function launchExecutionHost(input: {
  identity: ServiceExecutionHostIdentity;
  onFailure(error: Error): void;
  onInitialization?(outcome: ExecutionHostInitializationOutcome): void;
}): ExecutionHostPort & {
  hostInstanceId: string;
  initialized: Promise<ServiceExecutionHostSnapshot>;
  close(): Promise<void>;
} {
  const hostInstanceId = randomUUID();
  const child = spawn(
    process.execPath,
    executionHostLaunchArguments({
      binary: isBinaryDistribution(),
      entry: process.argv[1],
      execArgv: process.execArgv,
      hostInstanceId,
    }),
    {
      cwd: process.cwd(),
      env: { ...process.env, OPENMELD_HOME: input.identity.stateRoot },
      serialization: "json",
      stdio: ["ignore", process.stdout.fd, process.stderr.fd, "ipc"],
      windowsHide: true,
    }
  );
  const exited = new Promise<void>((resolve, reject) => {
    child.once("exit", (code, signal) => {
      if (code === 0 && !signal) {
        resolve();
      } else {
        reject(
          new ExecutionHostError(
            "host.exit_unconfirmed",
            "The Host did not report a clean process exit."
          )
        );
      }
    });
    child.once("error", reject);
  });
  exited.catch(() => undefined);
  let lastSnapshot: ServiceExecutionHostSnapshot | null = null;
  let observedAtMs: number | null = null;
  let responsive = false;
  let failed = false;
  let unavailableReason: ReturnType<
    typeof projectExecutionHostUnavailableReason
  > | null = null;
  let closing = false;
  let initialized: Promise<ServiceExecutionHostSnapshot>;
  let initializationRecheck: ReturnType<typeof setTimeout> | null = null;
  let refusedReasonCode: string | null = null;
  const eventListeners = new Set<(event: ExecutionHostEvent) => void>();
  const availabilityListeners = new Set<() => void>();
  const setResponsive = (next: boolean) => {
    if (responsive === next) {
      return;
    }
    responsive = next;
    for (const listener of availabilityListeners) {
      listener();
    }
  };
  const client = createExecutionHostClient({
    channel: childExecutionHostChannel(child),
    hostInstanceId,
    onEvent: (event) => {
      for (const listener of eventListeners) {
        listener(event);
      }
    },
    onFailure: (error) => {
      failed = true;
      unavailableReason = projectExecutionHostUnavailableReason(error);
      setResponsive(false);
      if (!closing) {
        input.onFailure(error);
      }
    },
  });

  async function call<M extends ServiceExecutionHostMethod>(
    method: M,
    payload: ServiceExecutionHostInput<M>,
    options?: { timeoutMs?: number | null }
  ): Promise<ServiceExecutionHostOutput<M>> {
    try {
      if (method !== "initialize") {
        await initialized;
      }
      const result = await client.call(method, payload, {
        ...(method === "health" ? { timeoutMs: HOST_HEALTH_TIMEOUT_MS } : {}),
        ...options,
      });
      const observation = serviceExecutionHostSnapshotSchema.safeParse(result);
      if (observation.success) {
        if (observation.data.pid !== child.pid) {
          throw new ExecutionHostError(
            "host.identity_mismatch",
            "The Host response belongs to a different process."
          );
        }
        lastSnapshot = observation.data;
        observedAtMs = Date.now();
        unavailableReason = null;
        if (!failed) {
          setResponsive(true);
        }
      }
      return result;
    } catch (error) {
      // A failed health observation closes admission, never kills/restarts work.
      // A later observation of this same process may establish responsiveness.
      if (
        method === "health" ||
        method === "initialize" ||
        method === "heartbeat"
      ) {
        unavailableReason = projectExecutionHostUnavailableReason(error);
        setResponsive(false);
      }
      throw error;
    }
  }

  // The connector starts independently. Callers may await initialization for
  // execution commands; each attempt's outcome is observed here.
  const initialize = () => {
    const attempt = call("initialize", input.identity);
    initialized = attempt;
    attempt.then(
      () => {
        if (refusedReasonCode !== null) {
          refusedReasonCode = null;
          input.onInitialization?.({ status: "ready" });
        }
      },
      (error: unknown) => {
        const reason = projectExecutionHostUnavailableReason(error);
        // Only recorded work that is still alive can clear by waiting. Elapsed
        // time never clears an unconfirmed fence, so that refusal is final here.
        const retrying =
          reason.recoveryAction === "wait_for_previous_work" &&
          !(closing || failed);
        if (reason.code !== refusedReasonCode) {
          refusedReasonCode = reason.code;
          input.onInitialization?.({
            status: "refused",
            reason,
            detail: error instanceof Error ? error.message : String(error),
            retrying,
          });
        }
        if (retrying) {
          initializationRecheck = setTimeout(() => {
            initializationRecheck = null;
            if (!(closing || failed)) {
              initialize();
            }
          }, PREVIOUS_WORK_RECHECK_MS);
          initializationRecheck.unref?.();
        }
      }
    );
  };
  initialize();
  return {
    hostInstanceId,
    get initialized() {
      return initialized;
    },
    call,
    available: () => responsive && !failed,
    snapshot: () => lastSnapshot,
    observation: () => ({
      hostInstanceId,
      observedAtMs,
      responsive: responsive && !failed,
      admission: lastSnapshot?.admission ?? null,
      activeCount: lastSnapshot?.activeCount ?? null,
      pendingCount: lastSnapshot?.pendingCount ?? null,
      unacknowledgedResultCount:
        lastSnapshot?.unacknowledgedResultCount ?? null,
      startupReplayPending: lastSnapshot?.startupReplayPending ?? null,
      unavailableReason,
    }),
    onEvent: (listener) => {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    onAvailabilityChanged: (listener) => {
      availabilityListeners.add(listener);
      return () => {
        availabilityListeners.delete(listener);
      };
    },
    async close() {
      closing = true;
      if (initializationRecheck) {
        clearTimeout(initializationRecheck);
        initializationRecheck = null;
      }
      try {
        // No total task timeout: this joins the Host's accepted drain. A dead
        // Host rejects; its last snapshot is never treated as a successful stop.
        await call("stop", {}, { timeoutMs: null });
        if (child.connected) {
          child.disconnect();
        }
        await exited;
      } finally {
        // Parent loss withdraws observation, never kills accepted work. The
        // Host retains drain ownership after a lost initialization/stop ACK.
        if (child.connected) {
          child.disconnect();
        }
        client.dispose();
        eventListeners.clear();
        availabilityListeners.clear();
      }
    },
  };
}
