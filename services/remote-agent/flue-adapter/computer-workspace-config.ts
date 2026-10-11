import type { WorkspaceClient } from "@cloudflare/computer";

export const AGENT_COMPUTER_BINDING = "AGENT_COMPUTER";
export const AGENT_COMPUTER_SHELL_BACKEND_ID = "worker-shell";
export const AGENT_COMPUTER_CONTAINER_BACKEND_ID = "container";
export const AGENT_COMPUTER_STORAGE_CAPACITY_BYTES = 4 * 1024 ** 3;
export const AGENT_COMPUTER_STORAGE_RESERVE_BYTES = 64 * 1024 ** 2;

/** Root layout of the computer. Prompt conventions reference these. */
export const AGENT_COMPUTER_ROOT = "/computer";
export const AGENT_COMPUTER_CONTAINER_ENV = {
  MOUNT_POINT: AGENT_COMPUTER_ROOT,
  COMPUTERD_DB: "/var/lib/computerd/workspace.sqlite",
  // A completed sync must be visible to the next Linux command, including
  // equal-mtime/size changes. Keep per-open page caching and 512 KiB blocks.
  COMPUTERD_FUSE_ATTR_TIMEOUT: "0",
  COMPUTERD_FUSE_AUTO_CACHE: "0",
} as const;
export const AGENT_COMPUTER_LAYOUT_DIRECTORIES = [
  `${AGENT_COMPUTER_ROOT}/org`,
  `${AGENT_COMPUTER_ROOT}/projects`,
  `${AGENT_COMPUTER_ROOT}/spaces`,
  `${AGENT_COMPUTER_ROOT}/routines`,
  `${AGENT_COMPUTER_ROOT}/home`,
  `${AGENT_COMPUTER_ROOT}/tasks`,
] as const;

export function buildAgentComputerSpaceDirectory(spaceId: string): string {
  return `${AGENT_COMPUTER_ROOT}/spaces/${spaceId}`;
}

export function buildAgentComputerRoutineDirectory(routineId: string): string {
  return `${AGENT_COMPUTER_ROOT}/routines/${encodePathIdentity(routineId)}`;
}

export function resolveAgentComputerWorkingDirectory(input: {
  taskId?: string;
  conversationId?: string | null;
  routineId?: string | null;
  spaceId: string | null;
}): string {
  if (input.taskId) {
    return `${AGENT_COMPUTER_ROOT}/tasks/${encodePathIdentity(input.taskId)}`;
  }
  if (input.routineId) {
    return buildAgentComputerRoutineDirectory(input.routineId);
  }
  return input.spaceId
    ? buildAgentComputerSpaceDirectory(input.spaceId)
    : `${AGENT_COMPUTER_ROOT}/home`;
}

/**
 * Idempotently create the computer's base layout plus the working
 * directory for the current conversation.
 */
export async function ensureAgentComputerLayout(
  workspace: Pick<WorkspaceClient, "fs">,
  input: {
    taskId?: string;
    conversationId?: string | null;
    routineId?: string | null;
    spaceId: string | null;
  }
): Promise<{ workingDirectory: string }> {
  for (const directory of AGENT_COMPUTER_LAYOUT_DIRECTORIES) {
    await workspace.fs.mkdir(directory, { recursive: true });
  }
  const workingDirectory = resolveAgentComputerWorkingDirectory(input);
  await workspace.fs.mkdir(workingDirectory, { recursive: true });
  return { workingDirectory };
}

function encodePathIdentity(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Agent Computer directory identity cannot be empty.");
  }
  return encodeURIComponent(normalized);
}
