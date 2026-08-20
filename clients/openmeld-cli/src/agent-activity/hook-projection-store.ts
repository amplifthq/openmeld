import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentActivityEvent } from "@openmeld/schemas/types";
import { resolveOpenMeldRootDir } from "../config/paths";
import { withAgentActivityLocalStateLock } from "./local-state-lock";

const STORE_LIMIT = 2000;
const HOOK_RECONCILIATION_GRACE_MS = 2 * 60_000;

type HookProjectionStore = {
  entries: Record<
    string,
    { observedAtMs: number; status: AgentActivityEvent["status"] }
  >;
  version: 1;
};

export async function recordAgentActivityHookProjection(input: {
  event: AgentActivityEvent;
  rootDir?: string;
}) {
  await withAgentActivityLocalStateLock(input, async () => {
    const store = await readStore(input);
    store.entries[projectionKey(input.event)] = {
      observedAtMs: input.event.observedAtMs,
      status: input.event.status,
    };
    const entries = Object.entries(store.entries)
      .sort((left, right) => right[1].observedAtMs - left[1].observedAtMs)
      .slice(0, STORE_LIMIT);
    await writeStore(input, {
      entries: Object.fromEntries(entries),
      version: 1,
    });
  });
}

export async function isCoveredByRecentAgentActivityHook(input: {
  nowMs: number;
  provider: AgentActivityEvent["provider"];
  providerSessionId: string;
  rootDir?: string;
  status: AgentActivityEvent["status"];
}) {
  const store = await readStore(input).catch(() => null);
  if (!store) {
    return false;
  }
  const projection =
    store.entries[
      projectionKey({
        provider: input.provider,
        providerSessionId: input.providerSessionId,
      })
    ];
  return Boolean(
    projection &&
      projection.status === input.status &&
      projection.observedAtMs <= input.nowMs &&
      input.nowMs - projection.observedAtMs <= HOOK_RECONCILIATION_GRACE_MS
  );
}

export async function readRecentAgentActivityHookStatus(input: {
  nowMs: number;
  provider: AgentActivityEvent["provider"];
  providerSessionId: string;
  rootDir?: string;
}): Promise<AgentActivityEvent["status"] | null> {
  const store = await readStore(input).catch(() => null);
  const projection =
    store?.entries[
      projectionKey({
        provider: input.provider,
        providerSessionId: input.providerSessionId,
      })
    ];
  if (
    !(
      projection &&
      projection.observedAtMs <= input.nowMs &&
      input.nowMs - projection.observedAtMs <= HOOK_RECONCILIATION_GRACE_MS
    )
  ) {
    return null;
  }
  return projection.status;
}

function projectionKey(input: {
  provider: AgentActivityEvent["provider"];
  providerSessionId: string;
}) {
  return createHash("sha256")
    .update(`${input.provider}\0${input.providerSessionId}`)
    .digest("hex");
}

async function readStore(input: {
  rootDir?: string;
}): Promise<HookProjectionStore> {
  const path = storePath(input);
  const raw = await readFile(path, "utf8").catch(() => null);
  if (!raw) {
    return { entries: {}, version: 1 };
  }
  const value: unknown = JSON.parse(raw);
  if (
    !(
      value &&
      typeof value === "object" &&
      "version" in value &&
      value.version === 1 &&
      "entries" in value &&
      value.entries &&
      typeof value.entries === "object"
    )
  ) {
    throw new Error(`Agent Activity hook projection store is invalid: ${path}`);
  }
  return value as HookProjectionStore;
}

async function writeStore(
  input: { rootDir?: string },
  store: HookProjectionStore
) {
  const path = storePath(input);
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(store)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

function storePath(input: { rootDir?: string }) {
  return join(
    input.rootDir ?? resolveOpenMeldRootDir(),
    "device",
    "agent-activity",
    "hook-projections.json"
  );
}
