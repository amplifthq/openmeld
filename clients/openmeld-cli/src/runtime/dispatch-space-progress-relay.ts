import { appendFileSync, chmodSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  type DispatchSpaceActionContext,
  OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV,
  readDispatchSpaceActionContextFromEnv,
} from "./dispatch-space-action-context";

const DISPATCH_PROGRESS_RELAY_FILENAME = "progress.ndjson";
const DISPATCH_PROGRESS_RELAY_POLL_INTERVAL_MS = 50;
const DISPATCH_PROGRESS_RELAY_MAX_BYTES = 128 * 1024;

type DispatchSpaceProgressRelayRecord = {
  contextId: string;
  createdAtMs: number;
  nonce: string;
  update: string;
  version: 1;
};

export function recordDispatchSpaceProgress(
  update: string,
  env: NodeJS.ProcessEnv = process.env
): { status: "accepted" } {
  const context = readDispatchSpaceActionContextFromEnv(env);
  const relayPath = resolveDispatchSpaceProgressRelayPath(env);
  appendFileSync(
    relayPath,
    `${JSON.stringify({
      version: 1,
      contextId: context.contextId,
      nonce: context.nonce,
      createdAtMs: Date.now(),
      update,
    } satisfies DispatchSpaceProgressRelayRecord)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  chmodSync(relayPath, 0o600);
  return { status: "accepted" };
}

export function startDispatchSpaceProgressRelay(input: {
  context: DispatchSpaceActionContext;
  contextPath: string;
  reportProgress: (
    update: string
  ) =>
    | Promise<{ status: "accepted" | "duplicate" | "unavailable" }>
    | { status: "accepted" | "duplicate" | "unavailable" };
  pollIntervalMs?: number;
}): { close: () => Promise<void> } {
  let closed = false;
  let consumedCount = 0;
  const relayPath = join(
    dirname(input.contextPath),
    DISPATCH_PROGRESS_RELAY_FILENAME
  );
  const drain = async () => {
    const records = readProgressRelayRecords({
      context: input.context,
      relayPath,
    });
    for (const record of records.slice(consumedCount)) {
      await input.reportProgress(record.update);
      consumedCount++;
    }
  };
  const loop = (async () => {
    while (!closed) {
      await delay(
        input.pollIntervalMs ?? DISPATCH_PROGRESS_RELAY_POLL_INTERVAL_MS
      );
      await drain();
    }
    await drain();
  })();
  return {
    close: async () => {
      closed = true;
      await loop;
    },
  };
}

function resolveDispatchSpaceProgressRelayPath(env: NodeJS.ProcessEnv): string {
  const contextPath = env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV];
  if (!contextPath) {
    throw new Error("No active OpenMeld Space Action context path was found.");
  }
  return join(dirname(contextPath), DISPATCH_PROGRESS_RELAY_FILENAME);
}

function readProgressRelayRecords(input: {
  context: DispatchSpaceActionContext;
  relayPath: string;
}): DispatchSpaceProgressRelayRecord[] {
  let text: string;
  try {
    text = readFileSync(input.relayPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  if (Buffer.byteLength(text, "utf8") > DISPATCH_PROGRESS_RELAY_MAX_BYTES) {
    throw new Error("The dispatch progress relay exceeded its safe size.");
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => parseProgressRelayRecord(line, input.context));
}

function parseProgressRelayRecord(
  line: string,
  context: DispatchSpaceActionContext
): DispatchSpaceProgressRelayRecord {
  const value = JSON.parse(line) as Partial<DispatchSpaceProgressRelayRecord>;
  if (
    value.version !== 1 ||
    value.contextId !== context.contextId ||
    value.nonce !== context.nonce ||
    typeof value.createdAtMs !== "number" ||
    typeof value.update !== "string" ||
    value.update.trim().length === 0 ||
    value.update.length > 600
  ) {
    throw new Error("The dispatch progress relay record is invalid.");
  }
  return value as DispatchSpaceProgressRelayRecord;
}
