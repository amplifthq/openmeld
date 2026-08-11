import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { openMeldRootDir, runtimeDir } from "./paths";
import {
  listCliContextStates,
  readCliContextState,
  resolveCliContext,
  writeCliContextState,
} from "./session-profile";

type SelectedOpenMeldProfileV1 = {
  v: 1;
  sessionId: string;
  sessionSource: string;
  openMeldProfileId: string;
  updatedAt: string;
};

export type SetSelectedOpenMeldProfileResult = {
  persistent: boolean;
  cliContextSource?: string;
};

export type ClearAllSelectedOpenMeldProfileIdsResult = {
  clearedSessionSelections: number;
  failedSessionIds: string[];
  removedFallbackSelection: boolean;
  removedLegacySelectionFile: boolean;
  removedLegacySessionSelectionDirectory: boolean;
};

const SESSION_FILE_HASH_LENGTH = 8;
const SESSION_FILE_MAX_LENGTH = 128;
const FALLBACK_SELECTION_SESSION_ID = "global-default";
const FALLBACK_SELECTION_SOURCE = "fallback:no_runtime_session";

export async function setSelectedOpenMeldProfileId(
  openMeldProfileId: string
): Promise<SetSelectedOpenMeldProfileResult> {
  const normalized = normalizeRequiredString(
    openMeldProfileId,
    "openMeldProfileId"
  );
  await rm(legacySelectionPath(), { force: true }).catch(() => undefined);

  const cliContext = resolveCliContext();
  if (!cliContext) {
    await writeFallbackSelectionPayload(normalized);
    return {
      persistent: true,
      cliContextSource: FALLBACK_SELECTION_SOURCE,
    };
  }

  await writeCliContextState({
    selectedOpenMeldProfileId: normalized,
  });
  await rm(selectionPath(cliContext.cliContextId), {
    force: true,
  }).catch(() => undefined);
  return {
    persistent: true,
    cliContextSource: cliContext.source,
  };
}

export async function getSelectedOpenMeldProfileId(): Promise<string | null> {
  const cliContext = resolveCliContext();
  if (!cliContext) {
    return await readFallbackSelectionPayload();
  }

  const sessionState = await readCliContextState();
  if (sessionState?.selectedOpenMeldProfileId) {
    return sessionState.selectedOpenMeldProfileId;
  }

  const legacySelection = await readLegacySelectionPayload(
    cliContext.cliContextId
  );
  if (!legacySelection?.openMeldProfileId) {
    return null;
  }
  await writeCliContextState({
    sessionId: legacySelection.sessionId,
    sessionSource: legacySelection.sessionSource,
    openMeldProfileId: legacySelection.openMeldProfileId,
  });
  await rm(selectionPath(cliContext.cliContextId), {
    force: true,
  }).catch(() => undefined);
  return legacySelection.openMeldProfileId;
}

export async function clearSelectedOpenMeldProfileId(): Promise<void> {
  const cliContext = resolveCliContext();
  if (!cliContext) {
    await rm(fallbackSelectionPath(), { force: true }).catch(() => undefined);
    await rm(legacySelectionPath(), { force: true }).catch(() => undefined);
    return;
  }

  await writeCliContextState({
    selectedOpenMeldProfileId: null,
  });
  await rm(selectionPath(cliContext.cliContextId), { force: true });
  await rm(legacySelectionPath(), { force: true }).catch(() => undefined);
}

export async function clearAllSelectedOpenMeldProfileIds(): Promise<ClearAllSelectedOpenMeldProfileIdsResult> {
  const sessionStates = await listCliContextStates();
  let clearedSessionSelections = 0;
  const failedSessionIds: string[] = [];

  for (const sessionState of sessionStates) {
    if (!sessionState.selectedOpenMeldProfileId) {
      continue;
    }
    try {
      const written = await writeCliContextState({
        sessionId: sessionState.sessionId,
        sessionSource: sessionState.cliContextSource,
        selectedOpenMeldProfileId: null,
      });
      if (written) {
        clearedSessionSelections += 1;
        continue;
      }
    } catch {
      // Best-effort cleanup: skip unwritable session state and continue logout.
    }
    failedSessionIds.push(sessionState.sessionId);
  }

  const removedFallbackSelection = await removeFileIfPresent(
    fallbackSelectionPath()
  );
  const removedLegacySelectionFile = await removeFileIfPresent(
    legacySelectionPath()
  );
  const removedLegacySessionSelectionDirectory = await removeDirectoryIfPresent(
    sessionSelectionDir()
  );

  return {
    clearedSessionSelections,
    failedSessionIds,
    removedFallbackSelection,
    removedLegacySelectionFile,
    removedLegacySessionSelectionDirectory,
  };
}

export async function alignSelectedOpenMeldProfileStorage(): Promise<{
  migratedSessionSelections: number;
  removedLegacyDirectory: boolean;
  removedLegacySelectionFile: boolean;
}> {
  let migratedSessionSelections = 0;
  const entryNames = await readdir(sessionSelectionDir()).catch(() => []);
  for (const entryName of entryNames) {
    if (!entryName.endsWith(".selected-profile.json")) {
      continue;
    }
    const raw = await readFile(
      join(sessionSelectionDir(), entryName),
      "utf8"
    ).catch(() => null);
    if (!raw) {
      continue;
    }
    const parsed = parseLegacySelectionPayload(raw);
    if (!parsed) {
      continue;
    }
    const written = await writeCliContextState({
      sessionId: parsed.sessionId,
      sessionSource: parsed.sessionSource,
      selectedOpenMeldProfileId: parsed.openMeldProfileId,
    });
    if (written) {
      migratedSessionSelections += 1;
    }
  }

  const legacyDirectoryExists = entryNames.length > 0;
  if (legacyDirectoryExists) {
    await rm(sessionSelectionDir(), { recursive: true, force: true });
  }
  await migrateLegacyFallbackSelection();
  const removedLegacySelectionFile = await removeLegacySelectionFile();
  return {
    migratedSessionSelections,
    removedLegacyDirectory: legacyDirectoryExists,
    removedLegacySelectionFile,
  };
}

function selectionPath(sessionId: string): string {
  return join(
    sessionSelectionDir(),
    `${toSafeSessionFile(sessionId)}.selected-profile.json`
  );
}

function sessionSelectionDir(): string {
  return join(runtimeDir(), "selected-openmeld-profiles");
}

function legacySelectionPath(): string {
  return join(openMeldRootDir(), "auth", "selected-profile.json");
}

function fallbackSelectionPath(): string {
  return join(runtimeDir(), "selected-profile-fallback.json");
}

async function readLegacySelectionPayload(
  sessionId: string
): Promise<SelectedOpenMeldProfileV1 | null> {
  const raw = await readFile(selectionPath(sessionId), "utf8").catch(
    () => null
  );
  if (!raw) {
    return null;
  }
  return parseLegacySelectionPayload(raw);
}

async function readFallbackSelectionPayload(): Promise<string | null> {
  const raw = await readFile(fallbackSelectionPath(), "utf8").catch(() => null);
  if (!raw) {
    const legacyFallback = await readLegacyFallbackSelection();
    if (!legacyFallback) {
      return null;
    }
    await writeFallbackSelectionPayload(legacyFallback.openMeldProfileId);
    await rm(legacySelectionPath(), { force: true }).catch(() => undefined);
    return legacyFallback.openMeldProfileId;
  }
  return parseLegacySelectionPayload(raw)?.openMeldProfileId ?? null;
}

async function writeFallbackSelectionPayload(
  openMeldProfileId: string
): Promise<void> {
  await mkdir(runtimeDir(), { recursive: true });
  const payload: SelectedOpenMeldProfileV1 = {
    v: 1,
    sessionId: FALLBACK_SELECTION_SESSION_ID,
    sessionSource: FALLBACK_SELECTION_SOURCE,
    openMeldProfileId,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(
    fallbackSelectionPath(),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
}

function parseLegacySelectionPayload(
  raw: string
): SelectedOpenMeldProfileV1 | null {
  try {
    const payload = JSON.parse(raw) as Partial<SelectedOpenMeldProfileV1>;
    if (payload.v !== 1) {
      return null;
    }
    const sessionId = normalizeOptionalString(payload.sessionId);
    const openMeldProfileId = normalizeOptionalString(
      payload.openMeldProfileId
    );
    if (!(sessionId && openMeldProfileId)) {
      return null;
    }
    return {
      v: 1,
      sessionId,
      sessionSource: normalizeOptionalString(payload.sessionSource) ?? "manual",
      openMeldProfileId,
      updatedAt:
        normalizeOptionalString(payload.updatedAt) ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

async function readLegacyFallbackSelection(): Promise<SelectedOpenMeldProfileV1 | null> {
  const raw = await readFile(legacySelectionPath(), "utf8").catch(() => null);
  if (!raw) {
    return null;
  }
  const parsed = parseLegacySelectionPayload(raw);
  if (parsed?.sessionSource !== FALLBACK_SELECTION_SOURCE) {
    return null;
  }
  return parsed;
}

async function migrateLegacyFallbackSelection(): Promise<void> {
  const legacyFallback = await readLegacyFallbackSelection();
  if (!legacyFallback) {
    return;
  }
  const existingFallback = await readFile(
    fallbackSelectionPath(),
    "utf8"
  ).catch(() => null);
  if (!existingFallback) {
    await writeFallbackSelectionPayload(legacyFallback.openMeldProfileId);
  }
}

async function removeLegacySelectionFile(): Promise<boolean> {
  const raw = await readFile(legacySelectionPath(), "utf8").catch(() => null);
  if (!raw) {
    return false;
  }
  await rm(legacySelectionPath(), { force: true }).catch(() => undefined);
  return true;
}

function toSafeSessionFile(value: string): string {
  const hash = createHash("sha1")
    .update(value, "utf8")
    .digest("hex")
    .slice(0, SESSION_FILE_HASH_LENGTH);
  const safeBaseRaw = value.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const safeBase = safeBaseRaw.length > 0 ? safeBaseRaw : "session";
  const maxBaseLength = Math.max(
    1,
    SESSION_FILE_MAX_LENGTH - SESSION_FILE_HASH_LENGTH - 1
  );
  const truncatedBase = safeBase.slice(0, maxBaseLength);
  return `${truncatedBase}-${hash}`;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

async function removeFileIfPresent(path: string): Promise<boolean> {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (raw === null) {
    return false;
  }
  await rm(path, { force: true }).catch(() => undefined);
  return true;
}

async function removeDirectoryIfPresent(path: string): Promise<boolean> {
  const directory = await stat(path).catch(() => null);
  if (!directory?.isDirectory()) {
    return false;
  }
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
  return true;
}
