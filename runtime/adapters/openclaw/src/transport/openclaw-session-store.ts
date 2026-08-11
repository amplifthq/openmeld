import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const SESSION_ERROR_STALE_WINDOW_MS = 30_000;

export async function readRecentOpenClawSessionErrorMessage(input: {
  agentId: string;
  env?: Record<string, string | undefined>;
  minTimestampMs: number;
  sessionKey: string;
}): Promise<string | null> {
  const sessionIndex = await readSessionIndex({
    agentId: input.agentId,
    env: input.env,
  });
  if (!sessionIndex) {
    return null;
  }

  const sessionEntry = sessionIndex[input.sessionKey];
  if (!sessionEntry) {
    return null;
  }

  const updatedAtMs = normalizeOptionalNumber(sessionEntry.updatedAt);
  if (
    updatedAtMs !== null &&
    updatedAtMs < input.minTimestampMs - SESSION_ERROR_STALE_WINDOW_MS
  ) {
    return null;
  }

  const sessionFilePath = resolveSessionFilePath({
    agentId: input.agentId,
    env: input.env,
    sessionEntry,
  });
  if (!sessionFilePath) {
    return null;
  }

  let sessionDocument: string;
  try {
    sessionDocument = await readFile(sessionFilePath, "utf8");
  } catch {
    return null;
  }

  return extractRecentSessionErrorMessage({
    minTimestampMs: input.minTimestampMs,
    sessionDocument,
  });
}

type SessionIndexEntry = {
  sessionFile?: unknown;
  sessionId?: unknown;
  updatedAt?: unknown;
};

async function readSessionIndex(input: {
  agentId: string;
  env?: Record<string, string | undefined>;
}): Promise<Record<string, SessionIndexEntry> | null> {
  const sessionIndexPath = join(
    resolveOpenClawStateDir(input.env),
    "agents",
    input.agentId,
    "sessions",
    "sessions.json"
  );

  let document: string;
  try {
    document = await readFile(sessionIndexPath, "utf8");
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(document) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, SessionIndexEntry>;
  } catch {
    return null;
  }
}

function resolveOpenClawStateDir(
  env?: Record<string, string | undefined>
): string {
  const configuredStateDir = normalizeOptionalText(env?.OPENCLAW_STATE_DIR);
  if (configuredStateDir) {
    return configuredStateDir;
  }
  return join(homedir(), ".openclaw");
}

function resolveSessionFilePath(input: {
  agentId: string;
  env?: Record<string, string | undefined>;
  sessionEntry: SessionIndexEntry;
}): string | null {
  const sessionsDir = join(
    resolveOpenClawStateDir(input.env),
    "agents",
    input.agentId,
    "sessions"
  );
  const sessionFile = normalizeOptionalText(input.sessionEntry.sessionFile);
  if (sessionFile) {
    return isAbsolute(sessionFile)
      ? sessionFile
      : join(sessionsDir, sessionFile);
  }

  const sessionId = normalizeOptionalText(input.sessionEntry.sessionId);
  if (!sessionId) {
    return null;
  }
  return join(sessionsDir, `${sessionId}.jsonl`);
}

function extractRecentSessionErrorMessage(input: {
  minTimestampMs: number;
  sessionDocument: string;
}): string | null {
  const lines = input.sessionDocument
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    const errorRecord = parseSessionErrorRecord(line);
    if (!errorRecord) {
      continue;
    }
    if (
      errorRecord.timestampMs <
      input.minTimestampMs - SESSION_ERROR_STALE_WINDOW_MS
    ) {
      return null;
    }
    return errorRecord.errorMessage;
  }

  return null;
}

function parseSessionErrorRecord(
  line: string
): { errorMessage: string; timestampMs: number } | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as {
      message?: unknown;
      timestamp?: unknown;
      type?: unknown;
    };
    if (normalizeOptionalText(record.type) !== "message") {
      return null;
    }

    const message =
      record.message && typeof record.message === "object"
        ? (record.message as {
            errorMessage?: unknown;
            stopReason?: unknown;
            timestamp?: unknown;
          })
        : null;
    if (!message) {
      return null;
    }

    if (normalizeOptionalText(message.stopReason) !== "error") {
      return null;
    }

    const errorMessage = normalizeOptionalText(message.errorMessage);
    if (!errorMessage) {
      return null;
    }

    const messageTimestampMs =
      normalizeOptionalNumber(message.timestamp) ??
      normalizeIsoTimestampMs(record.timestamp);
    if (messageTimestampMs === null) {
      return null;
    }

    return {
      errorMessage,
      timestampMs: messageTimestampMs,
    };
  } catch {
    return null;
  }
}

function normalizeIsoTimestampMs(value: unknown): number | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}
