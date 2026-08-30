import { watch } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AdapterAgentControllerConversationOccupancy } from "@openmeld/adapter-core";

const CODEX_THREAD_WRITER_RECOVERY_RETRY_MS = 30_000;

export type WaitForCodexThreadWriterAvailability = (input: {
  env?: Record<string, string | undefined>;
  occupancy: AdapterAgentControllerConversationOccupancy;
}) => Promise<void>;

export async function waitForCodexThreadWriterAvailability(input: {
  env?: Record<string, string | undefined>;
  occupancy: AdapterAgentControllerConversationOccupancy;
  recoveryRetryMs?: number;
}): Promise<void> {
  const codexHome =
    input.env?.CODEX_HOME?.trim() ||
    process.env.CODEX_HOME?.trim() ||
    join(homedir(), ".codex");
  const lockDirectory = join(codexHome, "thread-writer-locks");
  const lockFileName = `${input.occupancy.agentControllerConversationId}.lock`;
  const lockPath = join(lockDirectory, lockFileName);
  if (!(await pathExists(lockPath))) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let watcher: ReturnType<typeof watch> | null = null;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(recoveryTimer);
      watcher?.close();
      resolve();
    };
    const observeAvailability = () => {
      pathExists(lockPath)
        .then((exists) => {
          if (!exists) {
            finish();
          }
        })
        .catch(() => {
          // The recovery retry below remains the fail-closed backstop.
        });
    };
    const recoveryTimer = setTimeout(
      finish,
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
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
