import { watch } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AdapterAgentControllerConversationOccupancy } from "@openmeld/adapter-core";

const CODEX_THREAD_WRITER_RECOVERY_RETRY_MS = 30_000;
const CODEX_THREAD_WRITER_MISSING_LOCK_RETRY_MS = 500;
const MIN_MISSING_LOCK_RETRY_MS = 100;
const MAX_MISSING_LOCK_RETRY_MS = 2000;

export type CodexThreadWriterAvailabilityWaitResult =
  | "aborted"
  | "available"
  | "recheck";

export type WaitForCodexThreadWriterAvailability = (input: {
  env?: Record<string, string | undefined>;
  occupancy: AdapterAgentControllerConversationOccupancy;
  signal?: AbortSignal;
}) => Promise<CodexThreadWriterAvailabilityWaitResult>;

export async function waitForCodexThreadWriterAvailability(input: {
  env?: Record<string, string | undefined>;
  missingLockRetryMs?: number;
  occupancy: AdapterAgentControllerConversationOccupancy;
  recoveryRetryMs?: number;
  signal?: AbortSignal;
}): Promise<CodexThreadWriterAvailabilityWaitResult> {
  if (input.signal?.aborted) {
    return "aborted";
  }
  const codexHome =
    input.env?.CODEX_HOME?.trim() ||
    process.env.CODEX_HOME?.trim() ||
    join(homedir(), ".codex");
  const lockDirectory = join(codexHome, "thread-writer-locks");
  const lockFileName = `${input.occupancy.agentControllerConversationId}.lock`;
  const lockPath = join(lockDirectory, lockFileName);
  const lockExists = await pathExists(lockPath);
  if (input.signal?.aborted) {
    return "aborted";
  }
  if (!lockExists) {
    return await waitForRetryOrAbort({
      delayMs: normalizeMissingLockRetryMs(input.missingLockRetryMs),
      signal: input.signal,
    });
  }

  return await new Promise<CodexThreadWriterAvailabilityWaitResult>(
    (resolve) => {
      let settled = false;
      let recoveryTimer: NodeJS.Timeout | null = null;
      let watcher: ReturnType<typeof watch> | null = null;
      const finish = (result: CodexThreadWriterAvailabilityWaitResult) => {
        if (settled) {
          return;
        }
        settled = true;
        if (recoveryTimer) {
          clearTimeout(recoveryTimer);
          recoveryTimer = null;
        }
        watcher?.close();
        input.signal?.removeEventListener("abort", handleAbort);
        resolve(result);
      };
      const handleAbort = () => finish("aborted");
      const observeAvailability = () => {
        pathExists(lockPath)
          .then((exists) => {
            if (!exists) {
              finish("available");
            }
          })
          .catch(() => {
            // The recovery retry below remains the fail-closed backstop.
          });
      };
      input.signal?.addEventListener("abort", handleAbort, { once: true });
      recoveryTimer = setTimeout(
        () => finish("recheck"),
        input.recoveryRetryMs ?? CODEX_THREAD_WRITER_RECOVERY_RETRY_MS
      );
      recoveryTimer.unref?.();
      try {
        watcher = watch(lockDirectory, (_eventType, fileName) => {
          if (fileName === null || String(fileName) === lockFileName) {
            observeAvailability();
          }
        });
        watcher.on("error", () => {
          // Keep waiting for the recovery retry. A watcher error is not proof
          // that the provider released writer ownership.
        });
      } catch {
        // Keep waiting for the recovery retry. Missing filesystem observation is
        // not proof that the provider conversation is available.
      }
      observeAvailability();
    }
  );
}

async function waitForRetryOrAbort(input: {
  delayMs: number;
  signal?: AbortSignal;
}): Promise<"aborted" | "recheck"> {
  if (input.signal?.aborted) {
    return "aborted";
  }
  return await new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (result: "aborted" | "recheck") => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      input.signal?.removeEventListener("abort", handleAbort);
      resolve(result);
    };
    const handleAbort = () => finish("aborted");
    input.signal?.addEventListener("abort", handleAbort, { once: true });
    timer = setTimeout(() => finish("recheck"), input.delayMs);
    timer.unref?.();
  });
}

function normalizeMissingLockRetryMs(value: number | undefined): number {
  if (!(typeof value === "number" && Number.isFinite(value))) {
    return CODEX_THREAD_WRITER_MISSING_LOCK_RETRY_MS;
  }
  return Math.min(
    MAX_MISSING_LOCK_RETRY_MS,
    Math.max(MIN_MISSING_LOCK_RETRY_MS, Math.trunc(value))
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
