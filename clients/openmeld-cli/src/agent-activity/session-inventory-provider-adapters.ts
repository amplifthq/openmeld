import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { resolveInstalledClaudeCodeLaunchCandidates } from "@openmeld/adapter-claude-code";
import { resolveInstalledCodexLaunchCandidates } from "@openmeld/adapter-codex";
import {
  buildCliLaunchInvocation,
  type InstalledLaunchCandidatesFailureReason,
  type RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import { resolveInstalledGrokBuildLaunchCandidates } from "@openmeld/adapter-grok-build";
import { resolveInstalledOpenCodeLaunchCandidates } from "@openmeld/adapter-opencode";
import { observedLocalAgentSessionSchema } from "@openmeld/schemas";
import type {
  AgentActivityInventorySessionStatus,
  LocalAgentSessionProvider,
  ObservedLocalAgentSession,
} from "@openmeld/schemas/types";
import { readRecentAgentActivityHookStatus } from "./hook-projection-store";
import { resolveObservedAgentActivityBinding } from "./observer-adapters";
import { resolveOpenCodeDatabasePath } from "./opencode-storage";
import type { ProjectBinding } from "./project-bindings";
import { normalizeSharedSessionTitle } from "./provider-session-titles";
import {
  readOpenMeldCreatedLocalAgentSessionKeys,
  resolveLocalAgentSessionOrigin,
} from "./session-inventory-origin-store";

const PROVIDER_PROBE_TIMEOUT_MS = 5000;
const PROVIDER_DISCOVERY_TIMEOUT_MS = 30_000;
const MAX_JSON_RPC_LINE_BYTES = 8 * 1024 * 1024;
const OPENCODE_SESSION_QUERY = `SELECT id, directory, title, time_created, time_updated, time_archived
  FROM session
  ORDER BY time_updated DESC, id ASC`;
const CODEX_THREAD_SOURCE_KINDS = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
  "unknown",
] as const;

type ProviderDiscoveryProblem = {
  problemCode: string;
  result: "error" | "unsupported";
};

export type BoundObservedLocalAgentSession = {
  binding: ProjectBinding;
  session: ObservedLocalAgentSession;
};

export type LocalAgentSessionProviderDiscovery =
  | {
      agentControllerRef: `builtin:${string}`;
      provider: LocalAgentSessionProvider;
      result: "sessions";
      sessions: BoundObservedLocalAgentSession[];
    }
  | ({
      agentControllerRef: `builtin:${string}`;
      provider: LocalAgentSessionProvider;
    } & ProviderDiscoveryProblem);

export async function discoverLocalAgentSessionProviders(input: {
  bindings: readonly ProjectBinding[];
  homeDir?: string;
  nowMs?: number;
  rootDir?: string;
  xdgDataHome?: string;
}): Promise<LocalAgentSessionProviderDiscovery[]> {
  const homeDir = input.homeDir ?? homedir();
  const nowMs = input.nowMs ?? Date.now();
  return await Promise.all([
    discoverCodex({ ...input, homeDir, nowMs }),
    discoverClaudeCode({ ...input, homeDir, nowMs }),
    Promise.resolve({
      agentControllerRef: "builtin:cursor" as const,
      problemCode: "cursor_complete_inventory_unavailable",
      provider: "cursor" as const,
      result: "unsupported" as const,
    }),
    discoverOpenCode({ ...input, homeDir, nowMs }),
    discoverGrokBuild({ ...input, homeDir, nowMs }),
  ]);
}

async function discoverCodex(input: {
  bindings: readonly ProjectBinding[];
  homeDir: string;
  nowMs: number;
  rootDir?: string;
}): Promise<LocalAgentSessionProviderDiscovery> {
  const launch = await resolveInstalledCodexLaunchCandidates({
    timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
  });
  if (!launch.ok) {
    return providerLaunchFailure("codex", launch.reason);
  }
  try {
    return sessionsResult(
      "codex",
      await discoverCodexThreads({
        bindings: input.bindings,
        launchContract: launch.candidates[0]?.launchContract,
        nowMs: input.nowMs,
        rootDir: input.rootDir,
      })
    );
  } catch {
    return failed("codex", "codex_thread_list_failed");
  }
}

export async function discoverCodexThreads(input: {
  bindings: readonly ProjectBinding[];
  launchContract: RuntimeAgentControllerLaunchContract | undefined;
  nowMs: number;
  rootDir?: string;
}): Promise<BoundObservedLocalAgentSession[]> {
  if (!input.launchContract) {
    throw new Error("Codex launch contract is unavailable.");
  }
  const pages = await listAllCodexThreads(input.launchContract);
  const openMeldCreatedSessionKeys =
    await readOpenMeldCreatedLocalAgentSessionKeys(input);
  const result: BoundObservedLocalAgentSession[] = [];
  const identityKeys = new Set<string>();
  for (const page of pages) {
    for (const thread of page.data) {
      const mapped = await mapCodexThread({
        archived: page.archived,
        bindings: input.bindings,
        openMeldCreatedSessionKeys,
        thread,
      });
      if (!mapped) {
        continue;
      }
      const identityKey = `${mapped.binding.organizationId}\0${mapped.session.nativeSessionId}`;
      if (identityKeys.has(identityKey)) {
        throw new Error("Codex returned a duplicate native Session identity.");
      }
      identityKeys.add(identityKey);
      result.push(mapped);
    }
  }
  return stableSessions(result);
}

async function mapCodexThread(input: {
  archived: boolean;
  bindings: readonly ProjectBinding[];
  openMeldCreatedSessionKeys: ReadonlySet<string>;
  thread: Record<string, unknown>;
}): Promise<BoundObservedLocalAgentSession | null> {
  const nativeSessionId = text(input.thread.id);
  const cwd = text(input.thread.cwd);
  const lastActiveAtMs = secondsTimestamp(
    input.thread.recencyAt ?? input.thread.updatedAt
  );
  if (!(nativeSessionId && cwd && lastActiveAtMs !== null)) {
    throw new Error("Codex returned a malformed retained thread record.");
  }
  const binding = await resolveObservedAgentActivityBinding(
    cwd,
    input.bindings
  );
  if (!binding) {
    return null;
  }
  const runtimeStatus = isRecord(input.thread.status)
    ? text(input.thread.status.type)
    : null;
  return {
    binding,
    session: observedLocalAgentSessionSchema.parse({
      canFork: false,
      canResume: !(input.archived || input.thread.ephemeral === true),
      lastActiveAtMs,
      nativeSessionId,
      nativeSessionTitle: normalizeSharedSessionTitle(input.thread.name),
      origin: resolveLocalAgentSessionOrigin({
        agentControllerRef: "builtin:codex",
        fallback: mapCodexOrigin(input.thread.source),
        nativeSessionId,
        openMeldCreatedSessionKeys: input.openMeldCreatedSessionKeys,
      }),
      startedAtMs: secondsTimestamp(input.thread.createdAt),
      status: input.archived ? "ended" : mapCodexRuntimeStatus(runtimeStatus),
    }),
  };
}

type CodexThreadPage = {
  archived: boolean;
  data: Record<string, unknown>[];
};

async function listAllCodexThreads(
  launchContract: RuntimeAgentControllerLaunchContract
): Promise<CodexThreadPage[]> {
  const client = createCodexJsonRpcClient(launchContract);
  try {
    await client.request("initialize", {
      capabilities: { experimentalApi: true },
      clientInfo: { name: "openmeld-session-inventory", version: "1" },
    });
    client.notify("initialized", {});
    const pages: CodexThreadPage[] = [];
    for (const archived of [false, true]) {
      let cursor: string | null = null;
      do {
        const response = await client.request("thread/list", {
          archived,
          cursor,
          limit: 100,
          sortDirection: "desc",
          sortKey: "updated_at",
          sourceKinds: CODEX_THREAD_SOURCE_KINDS,
          useStateDbOnly: false,
        });
        if (
          !(
            isRecord(response) &&
            Array.isArray(response.data) &&
            response.data.every(isRecord)
          )
        ) {
          throw new Error("Codex thread/list response is invalid.");
        }
        pages.push({
          archived,
          data: response.data,
        });
        cursor = nullableText(response.nextCursor);
      } while (cursor !== null);
    }
    return pages;
  } finally {
    await client.close();
  }
}

function createCodexJsonRpcClient(
  launchContract: RuntimeAgentControllerLaunchContract
) {
  const invocation = buildCliLaunchInvocation({
    args: ["app-server", "--listen", "stdio://"],
    launchContract,
  });
  const child = spawn(invocation.bin, invocation.args, {
    env: process.env,
    shell: invocation.shell ?? false,
    stdio: ["pipe", "pipe", "ignore"],
  });
  let nextId = 1;
  let buffer = "";
  let closed = false;
  const pending = new Map<
    number,
    {
      reject(error: unknown): void;
      resolve(value: unknown): void;
      timer: NodeJS.Timeout;
    }
  >();
  const rejectPending = (error: Error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer = consumeCodexJsonRpcChunk({
      buffer,
      chunk,
      kill: () => child.kill("SIGTERM"),
      pending,
      rejectPending,
    });
  });
  child.on("error", (error) => rejectPending(error));
  child.on("close", () => {
    closed = true;
    rejectPending(new Error("Codex app-server closed during discovery."));
  });
  return {
    close: async () => {
      if (closed) {
        return;
      }
      child.kill("SIGTERM");
      await new Promise<void>((resolveClose) => {
        const timer = setTimeout(resolveClose, 1000);
        child.once("close", () => {
          clearTimeout(timer);
          resolveClose();
        });
      });
    },
    notify: (method: string, params: unknown) => {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`
      );
    },
    request: (method: string, params: unknown): Promise<unknown> => {
      if (closed) {
        return Promise.reject(new Error("Codex app-server is closed."));
      }
      const id = nextId;
      nextId += 1;
      return new Promise((resolveRequest, rejectRequest) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectRequest(new Error(`Codex ${method} timed out.`));
        }, PROVIDER_DISCOVERY_TIMEOUT_MS);
        pending.set(id, {
          reject: rejectRequest,
          resolve: resolveRequest,
          timer,
        });
        child.stdin.write(
          `${JSON.stringify({ id, jsonrpc: "2.0", method, params })}\n`
        );
      });
    },
  };
}

function consumeCodexJsonRpcChunk(input: {
  buffer: string;
  chunk: string;
  kill(): void;
  pending: Map<
    number,
    {
      reject(error: unknown): void;
      resolve(value: unknown): void;
      timer: NodeJS.Timeout;
    }
  >;
  rejectPending(error: Error): void;
}): string {
  let buffer = input.buffer + input.chunk;
  if (Buffer.byteLength(buffer) > MAX_JSON_RPC_LINE_BYTES) {
    input.rejectPending(
      new Error("Codex app-server response exceeded its bound.")
    );
    input.kill();
    return "";
  }
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) {
      return buffer;
    }
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) {
      continue;
    }
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      input.rejectPending(new Error("Codex app-server returned invalid JSON."));
      input.kill();
      return "";
    }
    settleCodexJsonRpcResponse(message, input.pending);
  }
}

function settleCodexJsonRpcResponse(
  message: unknown,
  pending: Map<
    number,
    {
      reject(error: unknown): void;
      resolve(value: unknown): void;
      timer: NodeJS.Timeout;
    }
  >
): void {
  if (!isRecord(message) || typeof message.id !== "number") {
    return;
  }
  const request = pending.get(message.id);
  if (!request) {
    return;
  }
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (isRecord(message.error)) {
    request.reject(
      new Error(
        text(message.error.message) ?? "Codex app-server request failed."
      )
    );
    return;
  }
  request.resolve(message.result);
}

async function discoverClaudeCode(input: {
  bindings: readonly ProjectBinding[];
  homeDir: string;
  nowMs: number;
  rootDir?: string;
}): Promise<LocalAgentSessionProviderDiscovery> {
  const launch = await resolveInstalledClaudeCodeLaunchCandidates({
    timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
  });
  if (!launch.ok) {
    return providerLaunchFailure("claude-code", launch.reason);
  }
  try {
    const registrySessions = await readClaudeAgentSessions(
      launch.candidates[0]?.launchContract
    );
    return sessionsResult(
      "claude-code",
      await discoverClaudeRetainedSessions({
        bindings: input.bindings,
        configDir:
          nullableText(process.env.CLAUDE_CONFIG_DIR) ??
          join(input.homeDir, ".claude"),
        nowMs: input.nowMs,
        registrySessions,
        rootDir: input.rootDir,
      })
    );
  } catch {
    return failed("claude-code", "claude_code_retained_inventory_failed");
  }
}

export async function discoverClaudeRetainedSessions(input: {
  bindings: readonly ProjectBinding[];
  configDir: string;
  nowMs: number;
  registrySessions?: ReadonlyMap<string, ClaudeAgentRegistrySession>;
  rootDir?: string;
}): Promise<BoundObservedLocalAgentSession[]> {
  const openMeldCreatedSessionKeys =
    await readOpenMeldCreatedLocalAgentSessionKeys(input);
  const projectsRoot = join(input.configDir, "projects");
  const files = await listFiles(projectsRoot, {
    excludeDirectoryNames: new Set(["subagents"]),
    fileName: (name) => name.endsWith(".jsonl"),
  });
  const result: BoundObservedLocalAgentSession[] = [];
  const identities = new Map<string, string>();
  for (const path of files) {
    const metadata = await readClaudeSessionMetadata(path);
    if (metadata.isSidechain) {
      continue;
    }
    const priorPath = identities.get(metadata.nativeSessionId);
    if (priorPath && priorPath !== path) {
      throw new Error("Claude Code native Session identity is duplicated.");
    }
    identities.set(metadata.nativeSessionId, path);
    const binding = await resolveObservedAgentActivityBinding(
      metadata.cwd,
      input.bindings
    );
    if (!binding) {
      continue;
    }
    const registrySession = input.registrySessions?.get(
      metadata.nativeSessionId
    );
    const hookStatus = await readRecentAgentActivityHookStatus({
      nowMs: input.nowMs,
      provider: "claude-code",
      providerSessionId: metadata.nativeSessionId,
      rootDir: input.rootDir,
    });
    result.push({
      binding,
      session: observedLocalAgentSessionSchema.parse({
        canFork: false,
        canResume: true,
        lastActiveAtMs: metadata.lastActiveAtMs,
        nativeSessionId: metadata.nativeSessionId,
        nativeSessionTitle: metadata.nativeSessionTitle,
        origin: resolveLocalAgentSessionOrigin({
          agentControllerRef: "builtin:claude-code",
          fallback: "unknown",
          nativeSessionId: metadata.nativeSessionId,
          openMeldCreatedSessionKeys,
        }),
        startedAtMs: metadata.startedAtMs,
        status: registrySession?.status ?? mapLegacyHookStatus(hookStatus),
      }),
    });
  }
  for (const registrySession of input.registrySessions?.values() ?? []) {
    if (identities.has(registrySession.nativeSessionId)) {
      continue;
    }
    const binding = await resolveObservedAgentActivityBinding(
      registrySession.cwd,
      input.bindings
    );
    if (!binding) {
      continue;
    }
    result.push({
      binding,
      session: observedLocalAgentSessionSchema.parse({
        canFork: false,
        canResume: true,
        lastActiveAtMs: registrySession.lastActiveAtMs,
        nativeSessionId: registrySession.nativeSessionId,
        nativeSessionTitle: null,
        origin: resolveLocalAgentSessionOrigin({
          agentControllerRef: "builtin:claude-code",
          fallback: "unknown",
          nativeSessionId: registrySession.nativeSessionId,
          openMeldCreatedSessionKeys,
        }),
        startedAtMs: null,
        status: registrySession.status,
      }),
    });
  }
  return stableSessions(result);
}

async function readClaudeSessionMetadata(path: string): Promise<{
  cwd: string;
  isSidechain: boolean;
  lastActiveAtMs: number;
  nativeSessionId: string;
  nativeSessionTitle: string | null;
  startedAtMs: number | null;
}> {
  const lines = createInterface({
    crlfDelay: Number.POSITIVE_INFINITY,
    input: createReadStream(path, { encoding: "utf8" }),
  });
  const state: ClaudeSessionMetadataState = {
    cwd: null,
    isSidechain: false,
    lastActiveAtMs: null,
    nativeSessionId: null,
    nativeSessionTitle: null,
    startedAtMs: null,
  };
  for await (const line of lines) {
    applyClaudeSessionLine(state, line);
  }
  if (!(state.cwd && state.nativeSessionId && state.lastActiveAtMs !== null)) {
    throw new Error("Claude Code Session file is missing required metadata.");
  }
  return {
    cwd: state.cwd,
    isSidechain: state.isSidechain,
    lastActiveAtMs: state.lastActiveAtMs,
    nativeSessionId: state.nativeSessionId,
    nativeSessionTitle: state.nativeSessionTitle,
    startedAtMs: state.startedAtMs,
  };
}

type ClaudeSessionMetadataState = {
  cwd: string | null;
  isSidechain: boolean;
  lastActiveAtMs: number | null;
  nativeSessionId: string | null;
  nativeSessionTitle: string | null;
  startedAtMs: number | null;
};

function applyClaudeSessionLine(
  state: ClaudeSessionMetadataState,
  line: string
): void {
  if (!line.trim()) {
    return;
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error("Claude Code Session file contains malformed JSON.", {
      cause: error,
    });
  }
  if (!isRecord(value)) {
    return;
  }
  const rowSessionId = text(value.sessionId);
  if (rowSessionId && state.nativeSessionId !== rowSessionId) {
    if (state.nativeSessionId) {
      throw new Error("Claude Code Session file contains conflicting IDs.");
    }
    state.nativeSessionId = rowSessionId;
  }
  const observedAtMs = timestamp(value.timestamp);
  if (observedAtMs !== null) {
    state.startedAtMs =
      state.startedAtMs === null
        ? observedAtMs
        : Math.min(state.startedAtMs, observedAtMs);
    if (state.lastActiveAtMs === null || observedAtMs >= state.lastActiveAtMs) {
      state.lastActiveAtMs = observedAtMs;
      state.cwd = text(value.cwd) ?? state.cwd;
    }
  } else if (!state.cwd) {
    state.cwd = text(value.cwd);
  }
  state.isSidechain ||= value.isSidechain === true;
  if (value.type === "custom-title") {
    state.nativeSessionTitle = normalizeSharedSessionTitle(
      value.customTitle ?? value.custom_title ?? value.title
    );
  }
}

type ClaudeAgentRegistrySession = {
  cwd: string;
  lastActiveAtMs: number;
  nativeSessionId: string;
  status: AgentActivityInventorySessionStatus;
};

async function readClaudeAgentSessions(
  launchContract: RuntimeAgentControllerLaunchContract | undefined
): Promise<Map<string, ClaudeAgentRegistrySession>> {
  if (!launchContract) {
    throw new Error("Claude Code launch contract is unavailable.");
  }
  const output = await executeJsonCommand({
    args: ["agents", "--json", "--all"],
    launchContract,
  });
  const sessions = new Map<string, ClaudeAgentRegistrySession>();
  for (const record of collectRecords(output)) {
    const candidate = parseClaudeAgentRegistrySession(record);
    if (!candidate) {
      continue;
    }
    sessions.set(
      candidate.nativeSessionId,
      mergeClaudeAgentRegistrySession(
        sessions.get(candidate.nativeSessionId),
        candidate
      )
    );
  }
  return sessions;
}

function parseClaudeAgentRegistrySession(
  record: Record<string, unknown>
): ClaudeAgentRegistrySession | null {
  const nativeSessionId = text(record.sessionId ?? record.session_id);
  if (!nativeSessionId) {
    return null;
  }
  const cwd = text(record.cwd);
  const lastActiveAtMs = timestamp(record.startedAt ?? record.started_at);
  const status = mapClaudeAgentStatus(record.status ?? record.state);
  if (!(cwd && lastActiveAtMs !== null && status)) {
    throw new Error("Claude Code agent registry Session is incomplete.");
  }
  return { cwd, lastActiveAtMs, nativeSessionId, status };
}

function mergeClaudeAgentRegistrySession(
  existing: ClaudeAgentRegistrySession | undefined,
  candidate: ClaudeAgentRegistrySession
): ClaudeAgentRegistrySession {
  if (!existing) {
    return candidate;
  }
  if (existing.cwd !== candidate.cwd) {
    throw new Error(
      "Claude Code agent registry Session has conflicting Project paths."
    );
  }
  const latest =
    candidate.lastActiveAtMs >= existing.lastActiveAtMs ? candidate : existing;
  return {
    ...latest,
    lastActiveAtMs: Math.max(existing.lastActiveAtMs, candidate.lastActiveAtMs),
    status:
      existing.status === "working" || candidate.status === "working"
        ? "working"
        : latest.status,
  };
}

async function discoverOpenCode(input: {
  bindings: readonly ProjectBinding[];
  homeDir: string;
  nowMs: number;
  rootDir?: string;
  xdgDataHome?: string;
}): Promise<LocalAgentSessionProviderDiscovery> {
  const launch = await resolveInstalledOpenCodeLaunchCandidates({
    timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
  });
  if (!launch.ok) {
    return providerLaunchFailure("opencode", launch.reason);
  }
  const databasePath = resolveOpenCodeDatabasePath({
    homeDir: input.homeDir,
    xdgDataHome: input.xdgDataHome,
  });
  let database: Awaited<ReturnType<typeof stat>>;
  try {
    database = await stat(databasePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return sessionsResult("opencode", []);
    }
    return failed("opencode", "opencode_retained_inventory_failed");
  }
  if (!database.isFile()) {
    return failed("opencode", "opencode_retained_inventory_failed");
  }
  try {
    return sessionsResult(
      "opencode",
      await discoverOpenCodeRetainedSessions({
        bindings: input.bindings,
        databasePath,
        nowMs: input.nowMs,
        rootDir: input.rootDir,
      })
    );
  } catch {
    return failed("opencode", "opencode_retained_inventory_failed");
  }
}

export async function discoverOpenCodeRetainedSessions(input: {
  bindings: readonly ProjectBinding[];
  databasePath: string;
  nowMs: number;
  rootDir?: string;
}): Promise<BoundObservedLocalAgentSession[]> {
  const openMeldCreatedSessionKeys =
    await readOpenMeldCreatedLocalAgentSessionKeys(input);
  const rows = await readOpenCodeSessionRows(input.databasePath);
  const result: BoundObservedLocalAgentSession[] = [];
  for (const row of rows) {
    const nativeSessionId = text(row.id);
    const cwd = text(row.directory);
    const lastActiveAtMs = timestamp(row.time_updated);
    if (!(nativeSessionId && cwd && lastActiveAtMs !== null)) {
      throw new Error("OpenCode returned a malformed retained Session row.");
    }
    const binding = await resolveObservedAgentActivityBinding(
      cwd,
      input.bindings
    );
    if (!binding) {
      continue;
    }
    const archivedAtMs = timestamp(row.time_archived);
    const hookStatus = await readRecentAgentActivityHookStatus({
      nowMs: input.nowMs,
      provider: "opencode",
      providerSessionId: nativeSessionId,
      rootDir: input.rootDir,
    });
    result.push({
      binding,
      session: observedLocalAgentSessionSchema.parse({
        canFork: false,
        canResume: archivedAtMs === null,
        lastActiveAtMs,
        nativeSessionId,
        nativeSessionTitle: normalizeSharedSessionTitle(row.title),
        origin: resolveLocalAgentSessionOrigin({
          agentControllerRef: "builtin:opencode",
          fallback: "unknown",
          nativeSessionId,
          openMeldCreatedSessionKeys,
        }),
        startedAtMs: timestamp(row.time_created),
        status:
          archivedAtMs === null ? mapLegacyHookStatus(hookStatus) : "ended",
      }),
    });
  }
  return stableSessions(result);
}

async function readOpenCodeSessionRows(
  databasePath: string
): Promise<Record<string, unknown>[]> {
  if (typeof process.versions.bun === "string") {
    // @ts-expect-error bun:sqlite exists only in the standalone Bun runtime.
    const bunSqlite = await import("bun:sqlite");
    const { Database } = bunSqlite as {
      Database: new (
        path: string,
        options: { create: boolean; readonly: boolean }
      ) => {
        close: () => void;
        query: (sql: string) => { all: () => Record<string, unknown>[] };
      };
    };
    const database = new Database(databasePath, {
      create: false,
      readonly: true,
    });
    try {
      return database.query(OPENCODE_SESSION_QUERY).all();
    } finally {
      database.close();
    }
  }
  const { default: Database } = await import("better-sqlite3");
  const database = new Database(databasePath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    return database.prepare(OPENCODE_SESSION_QUERY).all() as Record<
      string,
      unknown
    >[];
  } finally {
    database.close();
  }
}

async function discoverGrokBuild(input: {
  bindings: readonly ProjectBinding[];
  homeDir: string;
  nowMs: number;
  rootDir?: string;
}): Promise<LocalAgentSessionProviderDiscovery> {
  const launch = await resolveInstalledGrokBuildLaunchCandidates({
    timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
  });
  if (!launch.ok) {
    return providerLaunchFailure("grok-build", launch.reason);
  }
  try {
    return sessionsResult(
      "grok-build",
      await discoverGrokBuildRetainedSessions({
        bindings: input.bindings,
        grokHome:
          nullableText(process.env.GROK_HOME) ?? join(input.homeDir, ".grok"),
        rootDir: input.rootDir,
      })
    );
  } catch {
    return failed("grok-build", "grok_build_retained_inventory_failed");
  }
}

export async function discoverGrokBuildRetainedSessions(input: {
  bindings: readonly ProjectBinding[];
  grokHome: string;
  rootDir?: string;
}): Promise<BoundObservedLocalAgentSession[]> {
  const openMeldCreatedSessionKeys =
    await readOpenMeldCreatedLocalAgentSessionKeys(input);
  const paths = await listFiles(join(input.grokHome, "sessions"), {
    excludeDirectoryNames: new Set(["subagents"]),
    fileName: (name) => name === "summary.json",
  });
  const result: BoundObservedLocalAgentSession[] = [];
  const identities = new Set<string>();
  for (const path of paths) {
    const summary: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(summary)) {
      throw new Error("Grok Build summary metadata is invalid.");
    }
    const topLevelIdentity = {
      cwd: text(summary.cwd),
      nativeSessionId: text(summary.id),
    };
    const nestedInfo = isRecord(summary.info) ? summary.info : null;
    const nestedIdentity = {
      cwd: text(nestedInfo?.cwd),
      nativeSessionId: text(nestedInfo?.id),
    };
    const identity =
      topLevelIdentity.nativeSessionId && topLevelIdentity.cwd
        ? topLevelIdentity
        : nestedIdentity;
    const { cwd, nativeSessionId } = identity;
    const lastActiveAtMs = timestamp(
      summary.last_active_at ?? summary.updated_at
    );
    if (!(nativeSessionId && cwd && lastActiveAtMs !== null)) {
      throw new Error("Grok Build summary identity is incomplete.");
    }
    if (identities.has(nativeSessionId)) {
      throw new Error("Grok Build native Session identity is duplicated.");
    }
    identities.add(nativeSessionId);
    const binding = await resolveObservedAgentActivityBinding(
      cwd,
      input.bindings
    );
    if (!binding) {
      continue;
    }
    result.push({
      binding,
      session: observedLocalAgentSessionSchema.parse({
        canFork: false,
        canResume: true,
        lastActiveAtMs,
        nativeSessionId,
        nativeSessionTitle: normalizeSharedSessionTitle(
          summary.generated_title
        ),
        origin: resolveLocalAgentSessionOrigin({
          agentControllerRef: "builtin:grok-build",
          fallback: "unknown",
          nativeSessionId,
          openMeldCreatedSessionKeys,
        }),
        startedAtMs: timestamp(summary.created_at),
        status: "unknown",
      }),
    });
  }
  return stableSessions(result);
}

async function listFiles(
  root: string,
  input: {
    excludeDirectoryNames: ReadonlySet<string>;
    fileName(name: string): boolean;
  }
): Promise<string[]> {
  const rootStat = await stat(root).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw new Error(
      `Failed to inspect the Local Agent Session inventory root: ${root}`,
      { cause: error }
    );
  });
  if (rootStat === null) {
    return [];
  }
  if (!rootStat.isDirectory()) {
    throw new Error(
      `Local Agent Session inventory root is not a directory: ${root}`
    );
  }
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!input.excludeDirectoryNames.has(entry.name)) {
          await visit(path);
        }
      } else if (entry.isFile() && input.fileName(entry.name)) {
        files.push(path);
      }
    }
  };
  await visit(root);
  return files;
}

async function executeJsonCommand(input: {
  args: string[];
  launchContract: RuntimeAgentControllerLaunchContract;
}): Promise<unknown> {
  const invocation = buildCliLaunchInvocation(input);
  return await new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(invocation.bin, invocation.args, {
      env: process.env,
      shell: invocation.shell ?? false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectCommand(new Error("Provider metadata command timed out."));
    }, PROVIDER_DISCOVERY_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_JSON_RPC_LINE_BYTES) {
        child.kill("SIGTERM");
        clearTimeout(timer);
        rejectCommand(
          new Error("Provider metadata output exceeded its bound.")
        );
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectCommand(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rejectCommand(new Error("Provider metadata command failed."));
        return;
      }
      try {
        resolveCommand(JSON.parse(stdout));
      } catch (error) {
        rejectCommand(error);
      }
    });
  });
}

function sessionsResult(
  provider: LocalAgentSessionProvider,
  sessions: BoundObservedLocalAgentSession[]
): LocalAgentSessionProviderDiscovery {
  return {
    agentControllerRef: `builtin:${provider}`,
    provider,
    result: "sessions",
    sessions,
  };
}

function unsupported(
  provider: LocalAgentSessionProvider,
  problemCode: string
): LocalAgentSessionProviderDiscovery {
  return {
    agentControllerRef: `builtin:${provider}`,
    problemCode,
    provider,
    result: "unsupported",
  };
}

function providerLaunchFailure(
  provider: LocalAgentSessionProvider,
  reason: InstalledLaunchCandidatesFailureReason
): LocalAgentSessionProviderDiscovery {
  const problemCodePrefix = provider.replaceAll("-", "_");
  return reason === "not_installed"
    ? unsupported(provider, `${problemCodePrefix}_provider_not_installed`)
    : failed(provider, `${problemCodePrefix}_provider_not_launchable`);
}

function failed(
  provider: LocalAgentSessionProvider,
  problemCode: string
): LocalAgentSessionProviderDiscovery {
  return {
    agentControllerRef: `builtin:${provider}`,
    problemCode,
    provider,
    result: "error",
  };
}

function stableSessions(
  sessions: BoundObservedLocalAgentSession[]
): BoundObservedLocalAgentSession[] {
  return sessions.sort(
    (left, right) =>
      left.binding.organizationId.localeCompare(right.binding.organizationId) ||
      left.binding.projectId.localeCompare(right.binding.projectId) ||
      left.binding.bindingGeneration.localeCompare(
        right.binding.bindingGeneration
      ) ||
      left.session.nativeSessionId.localeCompare(right.session.nativeSessionId)
  );
}

function mapCodexRuntimeStatus(
  value: string | null
): AgentActivityInventorySessionStatus {
  if (value === "active") {
    return "working";
  }
  if (value === "idle") {
    return "idle";
  }
  if (value === "systemError") {
    return "error";
  }
  return "unknown";
}

function mapCodexOrigin(value: unknown): "local" | "unknown" {
  return value === "cli" || value === "vscode" || value === "exec"
    ? "local"
    : "unknown";
}

function mapLegacyHookStatus(
  value: "active" | "ended" | "error" | "idle" | "unknown" | null
): AgentActivityInventorySessionStatus {
  return value === "active" ? "working" : (value ?? "unknown");
}

function mapClaudeAgentStatus(
  value: unknown
): AgentActivityInventorySessionStatus | null {
  const normalized = text(value)?.toLowerCase();
  if (normalized === "running" || normalized === "active") {
    return "working";
  }
  if (normalized === "idle") {
    return "idle";
  }
  if (
    normalized === "completed" ||
    normalized === "stopped" ||
    normalized === "ended"
  ) {
    return "ended";
  }
  if (normalized === "failed" || normalized === "error") {
    return "error";
  }
  return null;
}

function collectRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectRecords);
  }
  if (!isRecord(value)) {
    return [];
  }
  return [value, ...Object.values(value).flatMap(collectRecords)];
}

function secondsTimestamp(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.trunc(number * 1000)
    : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function text(value: unknown): string | null {
  return nullableText(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === code
  );
}
