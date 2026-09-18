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
      stdio: ["ignore", "inherit", "inherit", "ipc"],
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
  let responsive = false;
  let failed = false;
  let closing = false;
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
        if (!failed) {
          setResponsive(true);
        }
      }
      return result;
    } catch (error) {
      // A failed health observation closes admission, never kills/restarts work.
      // A later observation of this same process may establish responsiveness.
      if (method === "health" || method === "initialize") {
        setResponsive(false);
      }
      throw error;
    }
  }

  const initialized = call("initialize", input.identity);
  // The connector starts independently. Callers may await initialization for
  // execution commands; retaining this handler prevents an unobserved rejection.
  initialized.catch(() => undefined);
  return {
    hostInstanceId,
    initialized,
    call,
    available: () => responsive && !failed,
    snapshot: () => lastSnapshot,
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
