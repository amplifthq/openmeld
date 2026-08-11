import { readFileSync } from "node:fs";
import {
  isDevGuardCommand,
  isRepoProcessCommand,
  normalizeProcessMatchText,
} from "./process-matchers.mjs";

export function readDevLockPayload(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (typeof parsed.pid !== "number" || !Number.isFinite(parsed.pid)) {
      return null;
    }

    return {
      pid: parsed.pid,
      repoRoot: typeof parsed.repoRoot === "string" ? parsed.repoRoot : null,
    };
  } catch {
    return null;
  }
}

export function findActiveDevLockHolder(lockPayload, rows, options = {}) {
  const { repoRoot, matcherContext, isPidAlive = defaultIsPidAlive } = options;

  if (
    !lockPayload ||
    typeof lockPayload.pid !== "number" ||
    !Number.isFinite(lockPayload.pid) ||
    lockPayload.pid <= 0
  ) {
    return null;
  }
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    return null;
  }
  if (
    lockPayload.repoRoot !== null &&
    lockPayload.repoRoot !== undefined &&
    lockPayload.repoRoot !== repoRoot
  ) {
    return null;
  }
  if (!(matcherContext && isPidAlive(lockPayload.pid))) {
    return null;
  }

  const row = rows.find((processRow) => processRow.pid === lockPayload.pid);
  if (!row) {
    return null;
  }

  const normalizedCommand = normalizeProcessMatchText(row.command);
  if (
    !(
      isRepoProcessCommand(normalizedCommand, matcherContext) &&
      isDevGuardCommand(normalizedCommand, matcherContext)
    )
  ) {
    return null;
  }

  return row;
}

function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
