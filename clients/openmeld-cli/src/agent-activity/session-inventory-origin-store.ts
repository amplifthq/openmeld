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
  projectAttributions?: Record<
    string,
    LocalAgentSessionProjectAttribution | "ambiguous"
  >;
  version: typeof STORE_VERSION;
};

export type LocalAgentSessionProjectAttribution = {
  organizationId: string;
  projectId: string;
  repositoryFingerprint: string;
};

export async function recordOpenMeldCreatedLocalAgentSession(input: {
  agentControllerRef: string;
  nativeSessionId: string;
  projectAttribution?: LocalAgentSessionProjectAttribution;
  rootDir?: string;
}): Promise<void> {
  const sessionKey = buildSessionKey(input);
  await withAgentActivityLocalStateLock(input, async () => {
    const store = await readStore(input);
    const existingAttribution = store.projectAttributions?.[sessionKey];
    let projectAttribution = existingAttribution;
    if (input.projectAttribution) {
      projectAttribution =
        existingAttribution &&
        JSON.stringify(existingAttribution) !==
          JSON.stringify(input.projectAttribution)
          ? "ambiguous"
          : input.projectAttribution;
    }
    if (
      store.openMeldCreatedSessionKeys.includes(sessionKey) &&
      JSON.stringify(existingAttribution) === JSON.stringify(projectAttribution)
    ) {
      return;
    }
    await writeStore(input, {
      openMeldCreatedSessionKeys: [
        ...new Set([...store.openMeldCreatedSessionKeys, sessionKey]),
      ].sort(),
      projectAttributions: {
        ...store.projectAttributions,
        ...(projectAttribution ? { [sessionKey]: projectAttribution } : {}),
      },
      version: STORE_VERSION,
    });
  });
}

export async function readOpenMeldCreatedLocalAgentSessionProjectAttributions(input: {
  rootDir?: string;
}): Promise<
  ReadonlyMap<string, LocalAgentSessionProjectAttribution | "ambiguous">
> {
  return new Map(
    Object.entries((await readStore(input)).projectAttributions ?? {})
  );
}

export function resolveOpenMeldCreatedLocalAgentSessionProjectAttribution(input: {
  agentControllerRef: string;
  nativeSessionId: string;
  projectAttributions: ReadonlyMap<
    string,
    LocalAgentSessionProjectAttribution | "ambiguous"
  >;
}): LocalAgentSessionProjectAttribution | null {
  const value = input.projectAttributions.get(buildSessionKey(input));
  return value && value !== "ambiguous" ? value : null;
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
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw new Error(
      `Failed to read the Session Inventory origin store: ${path}`,
      {
        cause: error,
      }
    );
  });
  if (raw === null) {
    return { openMeldCreatedSessionKeys: [], version: STORE_VERSION };
  }
  const value: unknown = JSON.parse(raw);
  const projectAttributions =
    value && typeof value === "object" && "projectAttributions" in value
      ? value.projectAttributions
      : undefined;
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
      ) &&
      (projectAttributions === undefined ||
        (projectAttributions &&
          typeof projectAttributions === "object" &&
          !Array.isArray(projectAttributions) &&
          Object.entries(projectAttributions).every(
            ([key, attribution]) =>
              SESSION_KEY_PATTERN.test(key) &&
              (attribution === "ambiguous" ||
                (attribution &&
                  typeof attribution === "object" &&
                  "organizationId" in attribution &&
                  typeof attribution.organizationId === "string" &&
                  "projectId" in attribution &&
                  typeof attribution.projectId === "string" &&
                  "repositoryFingerprint" in attribution &&
                  typeof attribution.repositoryFingerprint === "string" &&
                  SESSION_KEY_PATTERN.test(attribution.repositoryFingerprint)))
          )))
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

function isNodeError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === code
  );
}
