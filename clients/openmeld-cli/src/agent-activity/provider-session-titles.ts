import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENT_ACTIVITY_TITLE_MAX_CHARS } from "@openmeld/schemas";

export async function readCodexSessionTitles(input: {
  homeDir?: string;
}): Promise<ReadonlyMap<string, string>> {
  const path = join(
    input.homeDir ?? homedir(),
    ".codex",
    "session_index.jsonl"
  );
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw new Error(`Failed to read the Codex session title index: ${path}`, {
      cause: error,
    });
  });
  if (!raw) {
    return new Map();
  }
  const titles = new Map<string, string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const record: unknown = JSON.parse(line);
      if (!isRecord(record)) {
        continue;
      }
      const sessionId = text(record.id);
      const title = normalizeSharedSessionTitle(record.thread_name);
      if (sessionId && title) {
        titles.set(sessionId, title);
      }
    } catch {
      // Codex appends to this file. One malformed or partially written record
      // must not hide titles from the remaining valid records.
    }
  }
  return titles;
}

export function normalizeSharedSessionTitle(value: unknown): string | null {
  const normalized = text(value);
  return normalized && normalized.length <= AGENT_ACTIVITY_TITLE_MAX_CHARS
    ? normalized
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
