import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizeOpenMeldProfileId,
  type OpenMeldProfileId,
  sessionsDir,
} from "./paths";

export const OPENMELD_CLI_CONTEXT_ENV_KEY = "OPENMELD_CLI_CONTEXT_ID";
export const LEGACY_OPENMELD_AGENT_SESSION_ENV_KEY =
  "OPENMELD_AGENT_SESSION_ID";

export const CLI_CONTEXT_ENV_KEYS = [
  OPENMELD_CLI_CONTEXT_ENV_KEY,
  LEGACY_OPENMELD_AGENT_SESSION_ENV_KEY,
] as const;

const SESSION_FILE_MAX_LENGTH = 128;
const SESSION_FILE_HASH_LENGTH = 8;

export type CliContextResolution = {
  cliContextId: string;
  source: string;
};

export type CliContextStateV1 = {
  v: 1;
  sessionId: string;
  updatedAt: string;
  cliContextSource?: string;
  openMeldProfileId?: string;
  selectedOpenMeldProfileId?: string;
};

export function resolveCliContext(
  profileIdInput?: string
): CliContextResolution | null {
  const explicit = normalizeSessionId(profileIdInput);
  if (explicit) {
    return {
      cliContextId: explicit,
      source: "manual",
    };
  }

  for (const key of CLI_CONTEXT_ENV_KEYS) {
    const sessionId = normalizeSessionId(process.env[key]);
    if (sessionId) {
      return {
        cliContextId: sessionId,
        source: `environment:${key}`,
      };
    }
  }

  return resolveTerminalSessionId();
}

export function resolveCliContextId(profileIdInput?: string): string | null {
  return resolveCliContext(profileIdInput)?.cliContextId ?? null;
}

export function buildSessionProfilePayload(
  session: CliContextResolution,
  openMeldProfileId: OpenMeldProfileId
): CliContextStateV1 {
  return {
    v: 1,
    sessionId: session.cliContextId,
    cliContextSource: session.source,
    openMeldProfileId: normalizeOpenMeldProfileId(openMeldProfileId),
    updatedAt: new Date().toISOString(),
  };
}

export function formatCliContextSource(source: string): string {
  if (source === "manual") {
    return "manual";
  }
  if (source.startsWith("environment:")) {
    return `environment:${source.slice("environment:".length)}`;
  }
  if (source.startsWith("terminal:")) {
    return "terminal-fingerprint";
  }
  return source;
}

export function normalizeCliContextResolution(
  value: unknown
): CliContextResolution | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybe = value as {
    cliContextId?: unknown;
    source?: unknown;
  };
  const cliContextId = normalizeSessionId(maybe.cliContextId);
  const source = normalizeSessionSource(maybe.source);
  if (!(cliContextId && source)) {
    return null;
  }

  return { cliContextId, source };
}

function normalizeSessionSource(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) {
    return null;
  }
  return value;
}

export async function setSessionOpenMeldProfileId(
  openMeldProfileId: OpenMeldProfileId
): Promise<boolean> {
  return await writeCliContextState({
    openMeldProfileId,
  });
}

export async function getSessionOpenMeldProfileId(): Promise<OpenMeldProfileId | null> {
  return (await readCliContextState())?.openMeldProfileId ?? null;
}

export async function clearSessionOpenMeldProfileId(): Promise<boolean> {
  return await writeCliContextState({
    openMeldProfileId: null,
  });
}

export async function readCliContextState(input?: {
  sessionId?: string;
}): Promise<CliContextStateV1 | null> {
  const cliContextId = resolveSessionStateId(input?.sessionId);
  if (!cliContextId) {
    return null;
  }

  const raw = await readFile(cliContextStatePath(cliContextId), "utf8").catch(
    () => null
  );
  if (!raw) {
    return null;
  }

  return parseCliContextState(raw);
}

export async function listCliContextStates(): Promise<CliContextStateV1[]> {
  const entryNames = await readdir(sessionsDir()).catch(() => []);
  const states: CliContextStateV1[] = [];
  for (const entryName of entryNames) {
    if (!entryName.endsWith(".json")) {
      continue;
    }
    const raw = await readFile(join(sessionsDir(), entryName), "utf8").catch(
      () => null
    );
    if (!raw) {
      continue;
    }
    const parsed = parseCliContextState(raw);
    if (!parsed) {
      continue;
    }
    states.push(parsed);
  }
  return states.sort((left, right) =>
    left.sessionId.localeCompare(right.sessionId)
  );
}

export async function writeCliContextState(input: {
  sessionId?: string;
  sessionSource?: string;
  openMeldProfileId?: string | null;
  selectedOpenMeldProfileId?: string | null;
}): Promise<boolean> {
  const cliContext = resolveCliContextStateInput(input) ?? resolveCliContext();
  if (!cliContext) {
    return false;
  }

  await mkdir(sessionsDir(), { recursive: true });
  const existing = await readCliContextState({
    sessionId: cliContext.cliContextId,
  });
  const nextOpenMeldProfileId = resolveNextSessionOpenMeldProfileId(
    existing,
    input
  );
  const nextSelectedOpenMeldProfileId = resolveNextSelectedOpenMeldProfileId(
    existing,
    input
  );
  const outputPath = cliContextStatePath(cliContext.cliContextId);

  if (!(nextOpenMeldProfileId || nextSelectedOpenMeldProfileId)) {
    await rm(outputPath, { force: true });
    return true;
  }

  const payload: CliContextStateV1 = {
    v: 1,
    sessionId: cliContext.cliContextId,
    cliContextSource:
      cliContext.source ?? existing?.cliContextSource ?? "manual",
    ...(nextOpenMeldProfileId
      ? { openMeldProfileId: nextOpenMeldProfileId }
      : {}),
    ...(nextSelectedOpenMeldProfileId
      ? { selectedOpenMeldProfileId: nextSelectedOpenMeldProfileId }
      : {}),
    updatedAt: new Date().toISOString(),
  };

  await writeCliContextStateFile(outputPath, payload);
  return true;
}

export function cliContextStatePath(sessionId: string): string {
  return join(sessionsDir(), `${toSafeSessionFile(sessionId)}.json`);
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

function resolveCliContextStateInput(input: {
  sessionId?: string;
  sessionSource?: string;
}): CliContextResolution | null {
  const sessionId = normalizeSessionId(input.sessionId);
  if (!sessionId) {
    return null;
  }
  return {
    cliContextId: sessionId,
    source: normalizeSessionSource(input.sessionSource) ?? "manual",
  };
}

function resolveSessionStateId(sessionId?: string): string | null {
  const explicit = normalizeSessionId(sessionId);
  if (explicit) {
    return explicit;
  }
  return resolveCliContext()?.cliContextId ?? null;
}

function parseCliContextState(raw: string): CliContextStateV1 | null {
  let parsed: Partial<CliContextStateV1> & {
    profile?: unknown;
  };
  try {
    parsed = JSON.parse(raw) as Partial<CliContextStateV1> & {
      profile?: unknown;
    };
  } catch {
    return null;
  }

  if (parsed.v !== 1) {
    return null;
  }
  const sessionId = normalizeSessionId(parsed.sessionId);
  if (!sessionId) {
    return null;
  }
  const openMeldProfileId = resolveStoredSessionOpenMeldProfileId(parsed);
  const selectedOpenMeldProfileId =
    resolveStoredSelectedOpenMeldProfileId(parsed);
  if (!(openMeldProfileId || selectedOpenMeldProfileId)) {
    return null;
  }
  const cliContextSource = normalizeSessionSource(parsed.cliContextSource);
  return {
    v: 1,
    sessionId,
    ...(cliContextSource ? { cliContextSource } : {}),
    ...(openMeldProfileId ? { openMeldProfileId } : {}),
    ...(selectedOpenMeldProfileId ? { selectedOpenMeldProfileId } : {}),
    updatedAt:
      typeof parsed.updatedAt === "string" && parsed.updatedAt.trim().length > 0
        ? parsed.updatedAt
        : new Date(0).toISOString(),
  };
}

function resolveNextSessionOpenMeldProfileId(
  existing: CliContextStateV1 | null,
  input: {
    openMeldProfileId?: string | null;
    selectedOpenMeldProfileId?: string | null;
  }
): string | undefined {
  if (!("openMeldProfileId" in input)) {
    return existing?.openMeldProfileId;
  }
  return (
    normalizeOptionalOpenMeldProfileId(input.openMeldProfileId) ?? undefined
  );
}

function resolveNextSelectedOpenMeldProfileId(
  existing: CliContextStateV1 | null,
  input: {
    openMeldProfileId?: string | null;
    selectedOpenMeldProfileId?: string | null;
  }
): string | undefined {
  if (!("selectedOpenMeldProfileId" in input)) {
    return existing?.selectedOpenMeldProfileId;
  }
  return (
    normalizeOptionalOpenMeldProfileId(input.selectedOpenMeldProfileId) ??
    undefined
  );
}

async function writeCliContextStateFile(
  outputPath: string,
  payload: CliContextStateV1
): Promise<void> {
  const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  const file = await open(tempPath, "w");
  let writeFailure: unknown = null;
  try {
    await file.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await file.sync();
  } catch (error) {
    writeFailure = error;
  }
  try {
    await file.close();
  } catch (error) {
    if (!writeFailure) {
      writeFailure = error;
    }
  }
  if (writeFailure) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw writeFailure;
  }

  try {
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function normalizeSessionId(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  return raw.slice(0, 256);
}

function resolveTerminalSessionId(): CliContextResolution | null {
  if (!(process.stdin.isTTY || process.stdout.isTTY)) {
    return null;
  }

  const parentPid = Number(process.ppid);
  if (!Number.isInteger(parentPid) || parentPid <= 1) {
    return null;
  }

  return {
    cliContextId: `terminal-ppid-${parentPid}`,
    source: `terminal:ppid-${parentPid}`,
  };
}

function resolveStoredSessionOpenMeldProfileId(input: {
  openMeldProfileId?: unknown;
  profile?: unknown;
}): OpenMeldProfileId | null {
  const openMeldProfileId = normalizeOptionalOpenMeldProfileId(
    input.openMeldProfileId
  );
  const legacyProfile = normalizeOptionalOpenMeldProfileId(input.profile);
  if (
    openMeldProfileId &&
    legacyProfile &&
    openMeldProfileId !== legacyProfile
  ) {
    throw new Error(
      `conflicting stored OpenMeld profile identity: openMeldProfileId=${openMeldProfileId}, profile=${legacyProfile}. Remove or reconcile the legacy profile field so it matches openMeldProfileId.`
    );
  }
  return openMeldProfileId ?? legacyProfile;
}

function resolveStoredSelectedOpenMeldProfileId(input: {
  selectedOpenMeldProfileId?: unknown;
}): OpenMeldProfileId | null {
  return normalizeOptionalOpenMeldProfileId(input.selectedOpenMeldProfileId);
}

function normalizeOptionalOpenMeldProfileId(
  value: unknown
): OpenMeldProfileId | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return normalizeOpenMeldProfileId(value);
  } catch {
    return null;
  }
}
