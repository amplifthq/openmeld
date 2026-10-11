import type { CloudComputerStorage } from "@openmeld/schemas";
import {
  AGENT_COMPUTER_STORAGE_CAPACITY_BYTES,
  AGENT_COMPUTER_STORAGE_RESERVE_BYTES,
} from "./computer-workspace-config";

// Application admission leaves room for receipts and bounded cleanup below
// the platform hard ceiling. This is not Linux temporary disk capacity.
const PERSISTENT_LIMIT_BYTES =
  AGENT_COMPUTER_STORAGE_CAPACITY_BYTES - AGENT_COMPUTER_STORAGE_RESERVE_BYTES;
const SQLITE_FULL = /SQLITE_FULL|database or disk is full/iu;
const DISK_FULL = /\bENOSPC\b|no space left on device/iu;

export function describeComputerStorage(
  databaseBytes: number,
  observedAtMs = Date.now()
): CloudComputerStorage {
  if (!Number.isSafeInteger(databaseBytes) || databaseBytes < 0) {
    throw new Error(
      "computer.storage_unavailable: Unable to measure persistent storage."
    );
  }
  let status: CloudComputerStorage["status"] = "available";
  if (databaseBytes >= PERSISTENT_LIMIT_BYTES) {
    status = "at_limit";
  } else if (databaseBytes >= PERSISTENT_LIMIT_BYTES * 0.9) {
    status = "near_limit";
  }
  return {
    scope: "persistent",
    databaseBytes,
    limitBytes: PERSISTENT_LIMIT_BYTES,
    growthHeadroomBytes: Math.max(0, PERSISTENT_LIMIT_BYTES - databaseBytes),
    status,
    observedAtMs,
    guidance: `${status === "available" ? "" : "Tell the user that persistent Computer storage is nearly full before starting more downloads or builds. "}Database size includes files and internal records, but excludes reusable database pages. Growth headroom is not guaranteed free space. Check Linux temporary disk and inodes separately with df -h /tmp and df -i /tmp. Reuse project repositories. Inspect selected files before cleanup; preserve uncommitted and unpushed work. No files are deleted automatically.`,
  };
}

export function computerCapacityMessage(message: string): string | undefined {
  if (
    message.includes(
      "Computer storage is full; remove files before writing more"
    )
  ) {
    return "computer.storage_full: Computer storage has reached its write limit. Existing files remain available. Inspect storage, preserve needed work, and delete only selected disposable files. Background cleanup can take time. Verify a small write before resuming and check the existing command receipt before retrying a command.";
  }
  if (SQLITE_FULL.test(message)) {
    return "computer.storage_full: Persistent Computer storage could not accept a write. Stop large writes. Use computer describe to inspect storage, then file tools to read or export needed files and delete only explicitly selected disposable files. Deletion may not reclaim retained provider data; verify a small write before resuming. If capacity is still exhausted, preserve files and report that provider storage recovery is required. Do not reset repositories or blindly retry commands. Inspect any existing command receipt before retrying; a failed receipt write does not prove that the command did not run.";
  }
  if (DISK_FULL.test(message)) {
    return "computer.disk_full: A filesystem could not accept a write. Check the affected path, Linux disk and inode usage, and Computer persistent storage separately. Preserve user work and remove only selected disposable files. Inspect the existing command before retrying.";
  }
  return undefined;
}

export async function withComputerCapacityErrors<T>(
  operation: () => Promise<T>
): Promise<T> {
  try {
    const result = await operation();
    return explainComputerCapacityResult(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? computerCapacityMessage(error.message)
        : undefined;
    if (message) {
      throw new Error(message, { cause: error });
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Official file tools can return an error result instead of throwing. Failed
// shell commands likewise retain their exit receipt and stderr.
function explainComputerCapacityResult<T>(value: T): T {
  if (!isRecord(value)) {
    return value;
  }
  if (
    value.status === "completed" &&
    typeof value.exitCode === "number" &&
    value.exitCode !== 0 &&
    typeof value.stderr === "string"
  ) {
    // A command may operate its own SQLite database. Its stderr alone cannot
    // establish which disk or database exhausted capacity.
    const nextAction = computerCapacityMessage(value.stderr)
      ? computerCapacityMessage("ENOSPC")
      : undefined;
    return nextAction ? { ...value, nextAction } : value;
  }
  const result = value.result;
  if (
    value.kind !== "files" ||
    !isRecord(result) ||
    result.isError !== true ||
    !Array.isArray(result.content)
  ) {
    return value;
  }
  const text = result.content
    .filter(isRecord)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  const message = computerCapacityMessage(text);
  return message
    ? {
        ...value,
        result: {
          ...result,
          content: [...result.content, { type: "text", text: message }],
        },
      }
    : value;
}
