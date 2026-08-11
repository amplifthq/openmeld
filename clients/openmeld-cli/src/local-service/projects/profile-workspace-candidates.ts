import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { accountsDir, normalizeAccountKey } from "../../config/paths";
import {
  readProfileWorkspaceConfigForAccount,
  resolveConfiguredProfileWorkspacePathForAccount,
} from "../../profile-workspace/service";

export async function collectProfileWorkspaceCandidatePaths(
  signal?: AbortSignal
): Promise<string[]> {
  const paths = new Set<string>();
  throwIfAborted(signal);
  const hostEntries = await readDirectories(accountsDir(), signal);
  for (const hostEntry of hostEntries) {
    throwIfAborted(signal);
    const hostPath = join(accountsDir(), hostEntry);
    for (const userEntry of await readDirectories(hostPath, signal)) {
      throwIfAborted(signal);
      const account = normalizeAccountKey({
        hostKey: hostEntry,
        userKey: userEntry,
      });
      const profilesPath = join(hostPath, userEntry, "profiles");
      for (const profileId of await readDirectories(profilesPath, signal)) {
        throwIfAborted(signal);
        const result = await readProfileWorkspaceConfigForAccount({
          account,
          openMeldProfileId: profileId,
        });
        if (result.status !== "valid") {
          continue;
        }
        paths.add(
          resolveConfiguredProfileWorkspacePathForAccount({
            account,
            value: result.value,
            openMeldProfileId: profileId,
          })
        );
      }
    }
  }
  return [...paths].sort();
}

async function readDirectories(
  path: string,
  signal?: AbortSignal
): Promise<string[]> {
  throwIfAborted(signal);
  const entries = await readdir(path, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  );
  throwIfAborted(signal);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Local Project candidate scan cancelled.");
  }
}
