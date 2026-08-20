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
import type { AgentActivityInventorySessionOrigin } from "@openmeld/schemas/types";
import { resolveOpenMeldRootDir } from "../config/paths";
import { withAgentActivityLocalStateLock } from "./local-state-lock";

const STORE_VERSION = 1 as const;
const SESSION_KEY_PATTERN = /^sha256:[a-f0-9]{64}$/u;

type SessionOriginStore = {
  openMeldCreatedSessionKeys: string[];
  version: typeof STORE_VERSION;
};

export async function recordOpenMeldCreatedLocalAgentSession(input: {
  agentControllerRef: string;
  nativeSessionId: string;
  rootDir?: string;
}): Promise<void> {
  const sessionKey = buildSessionKey(input);
  await withAgentActivityLocalStateLock(input, async () => {
    const store = await readStore(input);
    if (store.openMeldCreatedSessionKeys.includes(sessionKey)) {
      return;
    }
    await writeStore(input, {
      openMeldCreatedSessionKeys: [
        ...store.openMeldCreatedSessionKeys,
        sessionKey,
      ].sort(),
      version: STORE_VERSION,
    });
  });
}

export async function readOpenMeldCreatedLocalAgentSessionKeys(input: {
  rootDir?: string;
}): Promise<ReadonlySet<string>> {
  return new Set((await readStore(input)).openMeldCreatedSessionKeys);
}

export function resolveLocalAgentSessionOrigin(input: {
  agentControllerRef: string;
  fallback: Exclude<AgentActivityInventorySessionOrigin, "openmeld">;
  nativeSessionId: string;
  openMeldCreatedSessionKeys: ReadonlySet<string>;
}): AgentActivityInventorySessionOrigin {
  return input.openMeldCreatedSessionKeys.has(buildSessionKey(input))
    ? "openmeld"
    : input.fallback;
}

function buildSessionKey(input: {
  agentControllerRef: string;
  nativeSessionId: string;
}): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify([
        input.agentControllerRef.trim(),
        input.nativeSessionId.trim(),
      ])
    )
    .digest("hex")}`;
}

async function readStore(input: {
  rootDir?: string;
}): Promise<SessionOriginStore> {
  const path = storePath(input);
  const raw = await readFile(path, "utf8").catch(() => null);
  if (!raw) {
    return { openMeldCreatedSessionKeys: [], version: STORE_VERSION };
  }
  const value: unknown = JSON.parse(raw);
  if (
    !(
      value &&
      typeof value === "object" &&
      "version" in value &&
      value.version === STORE_VERSION &&
      "openMeldCreatedSessionKeys" in value &&
      Array.isArray(value.openMeldCreatedSessionKeys) &&
      value.openMeldCreatedSessionKeys.every(
        (entry) => typeof entry === "string" && SESSION_KEY_PATTERN.test(entry)
      )
    )
  ) {
    throw new Error(`Session Inventory origin store is invalid: ${path}`);
  }
  return value as SessionOriginStore;
}

async function writeStore(
  input: { rootDir?: string },
  store: SessionOriginStore
): Promise<void> {
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

function storePath(input: { rootDir?: string }): string {
  return join(
    input.rootDir ?? resolveOpenMeldRootDir(),
    "device",
    "agent-activity",
    "session-inventory-origins.json"
  );
}
