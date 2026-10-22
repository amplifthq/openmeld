import { createHash, randomUUID } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Worker } from "node:worker_threads";
import { getAuthSessionState } from "../config/auth-session";
import { resolveOpenMeldRootDir } from "../config/paths";
import { drainAgentActivityHookInbox } from "./hook-inbox";
import { isCoveredByRecentAgentActivityHook } from "./hook-projection-store";
import { enqueueAgentActivityEvent } from "./local-event-store";
import {
  buildAgentActivityEvent,
  parseClaudeTranscriptSnapshot,
  parseCodexRolloutSnapshot,
  parseOpenCodeSessionRow,
  resolveObservedAgentActivityBinding,
} from "./observer-adapters";
import { resolveOpenCodeDatabasePath } from "./opencode-storage";
import {
  canonicalizeLocalProjectPath,
  isProjectConnectionReadableByOwner,
} from "./project-binding-resolution";
import { listProjectBindings } from "./project-bindings";
import { readCodexSessionTitles } from "./provider-session-titles";
import {
  readOpenMeldCreatedLocalAgentSessionProjectAttributions,
  resolveOpenMeldCreatedLocalAgentSessionProjectAttribution,
} from "./session-inventory-origin-store";

const STARTUP_RECONCILIATION_WINDOW_MS = 10 * 60_000;
const MAX_PROVIDER_FILES_PER_PROVIDER = 2000;
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 128 * 1024;

type ObserverState = {
  files: Record<string, { size: number }>;
  openCodeCursor: { id: string; updatedAtMs: number };
  version: 2;
};

type ObserverInput = {
  drainInbox?: boolean;
  homeDir?: string;
  nowMs?: number;
  rootDir?: string;
};

export type AgentActivityObserverResult = {
  changedFileCount: number;
  driftCount: number;
  observedCount: number;
  queuedCount: number;
};

async function listCurrentOwnerProjectBindings(input: { rootDir?: string }) {
  const bindings = await listProjectBindings({ rootDir: input.rootDir });
  if (!bindings.some((binding) => binding.ownerUserId)) {
    return bindings;
  }
  const ownerUserId = (
    await getAuthSessionState({ validateRemote: false }).catch(() => null)
  )?.session?.user?.id;
  return bindings.filter((binding) =>
    isProjectConnectionReadableByOwner(binding, ownerUserId)
  );
}

export async function scanLocalAgentActivity(
  input: ObserverInput = {}
): Promise<AgentActivityObserverResult> {
  const nowMs = input.nowMs ?? Date.now();
  const inbox =
    input.drainInbox === false
      ? { driftCount: 0, observedCount: 0, queuedCount: 0 }
      : await drainAgentActivityHookInbox({
          nowMs,
          rootDir: input.rootDir,
        });
  const bindings = await listCurrentOwnerProjectBindings(input);
  if (bindings.length === 0) {
    return {
      changedFileCount: 0,
      driftCount: inbox.driftCount,
      observedCount: inbox.observedCount,
      queuedCount: inbox.queuedCount,
    };
  }
  const home = input.homeDir ?? homedir();
  const codexSessionTitles = await readCodexSessionTitles({ homeDir: home });
  const state = await readObserverState(input);
  const previousFiles = state.files;
  state.files = {};
  const result: AgentActivityObserverResult = {
    changedFileCount: 0,
    driftCount: inbox.driftCount,
    observedCount: inbox.observedCount,
    queuedCount: inbox.queuedCount,
  };
  const transcript = await scanTranscriptProviders({
    bindings,
    codexSessionTitles,
    home,
    input,
    nowMs,
    previousFiles,
    state,
  });
  result.changedFileCount += transcript.changedFileCount;
  result.driftCount += transcript.driftCount;
  result.observedCount += transcript.observedCount;
  result.queuedCount += transcript.queuedCount;
  const openCode = await scanOpenCode({
    bindings,
    home,
    nowMs,
    state,
    ...input,
  });
  result.driftCount += openCode.driftCount;
  result.observedCount += openCode.observedCount;
  result.queuedCount += openCode.queuedCount;
  await writeObserverState(input, state);
  return result;
}

async function scanTranscriptProviders(input: {
  bindings: Awaited<ReturnType<typeof listProjectBindings>>;
  codexSessionTitles: ReadonlyMap<string, string>;
  home: string;
  input: ObserverInput;
  nowMs: number;
  previousFiles: ObserverState["files"];
  state: ObserverState;
}): Promise<AgentActivityObserverResult> {
  const result: AgentActivityObserverResult = {
    changedFileCount: 0,
    driftCount: 0,
    observedCount: 0,
    queuedCount: 0,
  };
  for (const file of await discoverProviderFiles(input.home)) {
    const observed = await scanTranscriptProviderFile(input, file);
    result.changedFileCount += observed.changedFileCount;
    result.driftCount += observed.driftCount;
    result.observedCount += observed.observedCount;
    result.queuedCount += observed.queuedCount;
  }
  return result;
}

async function scanTranscriptProviderFile(
  input: Parameters<typeof scanTranscriptProviders>[0],
  file: Awaited<ReturnType<typeof discoverProviderFiles>>[number]
): Promise<AgentActivityObserverResult> {
  const empty = {
    changedFileCount: 0,
    driftCount: 0,
    observedCount: 0,
    queuedCount: 0,
  };
  const stateKey = createHash("sha256").update(file.path).digest("hex");
  const previous = input.previousFiles[stateKey];
  input.state.files[stateKey] = { size: file.size };
  if (
    previous?.size === file.size ||
    (!previous &&
      file.modifiedAtMs < input.nowMs - STARTUP_RECONCILIATION_WINDOW_MS)
  ) {
    return empty;
  }
  return await observeChangedTranscriptFile({
    bindings: input.bindings,
    codexSessionTitles: input.codexSessionTitles,
    file,
    nowMs: input.nowMs,
    rootDir: input.input.rootDir,
  });
}

async function observeChangedTranscriptFile(input: {
  bindings: Awaited<ReturnType<typeof listProjectBindings>>;
  codexSessionTitles: ReadonlyMap<string, string>;
  file: Awaited<ReturnType<typeof discoverProviderFiles>>[number];
  nowMs: number;
  rootDir?: string;
}): Promise<AgentActivityObserverResult> {
  const empty = {
    changedFileCount: 0,
    driftCount: 0,
    observedCount: 0,
    queuedCount: 0,
  };
  const identityCwd = await readProviderIdentityCwd(
    input.file.path,
    input.file.provider
  ).catch(() => null);
  const canonicalIdentityCwd = identityCwd
    ? await canonicalizeLocalProjectPath(identityCwd)
    : null;
  if (
    !(
      canonicalIdentityCwd &&
      input.bindings.some(
        (binding) =>
          canonicalIdentityCwd === binding.repositoryPath ||
          canonicalIdentityCwd.startsWith(`${binding.repositoryPath}${sep}`)
      )
    )
  ) {
    return empty;
  }
  const lines = await readJsonLinesSnapshot(input.file.path).catch(() => null);
  if (!lines) {
    return { ...empty, changedFileCount: 1, driftCount: 1 };
  }
  const observed =
    input.file.provider === "codex"
      ? parseCodexRolloutSnapshot({
          lines,
          nowMs: input.nowMs,
          titles: input.codexSessionTitles,
        })
      : parseClaudeTranscriptSnapshot({ lines, nowMs: input.nowMs });
  if (!observed) {
    return { ...empty, changedFileCount: 1, driftCount: 1 };
  }
  if (
    await isCoveredByRecentAgentActivityHook({
      nowMs: input.nowMs,
      provider: observed.provider,
      providerSessionId: observed.providerSessionId,
      rootDir: input.rootDir,
      status: observed.status,
    })
  ) {
    return { ...empty, changedFileCount: 1, observedCount: 1 };
  }
  const event = await buildAgentActivityEvent({
    bindings: input.bindings,
    observed,
    projectAttribution:
      resolveOpenMeldCreatedLocalAgentSessionProjectAttribution({
        agentControllerRef: `builtin:${observed.provider}`,
        nativeSessionId: observed.providerSessionId,
        projectAttributions:
          await readOpenMeldCreatedLocalAgentSessionProjectAttributions({
            rootDir: input.rootDir,
          }),
      }),
  });
  if (!event) {
    return { ...empty, changedFileCount: 1, observedCount: 1 };
  }
  const outcome = await enqueueAgentActivityEvent({
    event,
    nowMs: input.nowMs,
    rootDir: input.rootDir,
  });
  return {
    ...empty,
    changedFileCount: 1,
    observedCount: 1,
    queuedCount: outcome === "queued" ? 1 : 0,
  };
}

export function startAgentActivityTranscriptWatchers(input: {
  homeDir?: string;
  onError?: (error: unknown) => void;
  rootDir?: string;
  watchFactory?: typeof watch;
  watchRetryMs?: number;
}) {
  const home = input.homeDir ?? homedir();
  const candidates = [
    { provider: "codex" as const, root: join(home, ".codex", "sessions") },
    { provider: "claude" as const, root: join(home, ".claude", "projects") },
  ];
  const watchers = new Map<string, FSWatcher>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const inFlight = new Set<Promise<unknown>>();
  const attachMissingWatchers = () => {
    for (const candidate of candidates) {
      if (watchers.has(candidate.provider)) {
        continue;
      }
      try {
        const watcher = (input.watchFactory ?? watch)(
          candidate.root,
          { recursive: true },
          (_eventType, fileName) => {
            const relative = String(fileName ?? "");
            if (!relative.endsWith(".jsonl")) {
              return;
            }
            const path = resolve(candidate.root, relative);
            if (
              !(
                path === candidate.root ||
                path.startsWith(`${candidate.root}${sep}`)
              )
            ) {
              return;
            }
            const prior = pending.get(path);
            if (prior) {
              clearTimeout(prior);
            }
            const timer = setTimeout(() => {
              pending.delete(path);
              const task = observeWatchedTranscriptFile({
                homeDir: home,
                path,
                provider: candidate.provider,
                rootDir: input.rootDir,
              })
                .catch((error) => input.onError?.(error))
                .finally(() => inFlight.delete(task));
              inFlight.add(task);
            }, 150);
            timer.unref();
            pending.set(path, timer);
          }
        );
        watcher.on("error", (error) => {
          if (watchers.get(candidate.provider) !== watcher) {
            return;
          }
          watcher.close();
          watchers.delete(candidate.provider);
          input.onError?.(error);
        });
        watcher.unref();
        watchers.set(candidate.provider, watcher);
      } catch {
        // A fresh provider profile may not have created this root yet. The
        // retry timer attaches it later; reconciliation remains the fallback
        // when recursive watching is unavailable on the platform.
      }
    }
  };
  attachMissingWatchers();
  const watcherRetry = setInterval(
    attachMissingWatchers,
    input.watchRetryMs ?? 30_000
  );
  watcherRetry.unref();
  return async () => {
    clearInterval(watcherRetry);
    for (const timer of pending.values()) {
      clearTimeout(timer);
    }
    pending.clear();
    for (const watcher of watchers.values()) {
      watcher.close();
    }
    watchers.clear();
    await Promise.allSettled(inFlight);
  };
}

async function observeWatchedTranscriptFile(input: {
  homeDir: string;
  path: string;
  provider: "claude" | "codex";
  rootDir?: string;
}) {
  const bindings = await listCurrentOwnerProjectBindings(input);
  if (bindings.length === 0) {
    return;
  }
  const metadata = await stat(input.path).catch(() => null);
  if (!metadata?.isFile()) {
    return;
  }
  await observeChangedTranscriptFile({
    bindings,
    codexSessionTitles: await readCodexSessionTitles({
      homeDir: input.homeDir,
    }),
    file: {
      modifiedAtMs: metadata.mtimeMs,
      path: input.path,
      provider: input.provider,
      size: metadata.size,
    },
    nowMs: Date.now(),
    rootDir: input.rootDir,
  });
}

async function scanOpenCode(
  input: ObserverInput & {
    bindings: Awaited<ReturnType<typeof listProjectBindings>>;
    home: string;
    nowMs: number;
    state: ObserverState;
  }
) {
  const result = { driftCount: 0, observedCount: 0, queuedCount: 0 };
  const databasePath = resolveOpenCodeDatabasePath({ homeDir: input.home });
  const metadata = await stat(databasePath).catch(() => null);
  if (!metadata?.isFile()) {
    return result;
  }
  const cursor =
    input.state.openCodeCursor.updatedAtMs > 0
      ? input.state.openCodeCursor
      : {
          id: "",
          updatedAtMs: input.nowMs - STARTUP_RECONCILIATION_WINDOW_MS,
        };
  let identityRows: Record<string, unknown>[];
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      identityRows = database
        .prepare(
          `
            SELECT id, directory, time_updated
            FROM session
            WHERE time_updated > ?
               OR (time_updated = ? AND id > ?)
            ORDER BY time_updated ASC, id ASC
            LIMIT 1000
          `
        )
        .all(cursor.updatedAtMs, cursor.updatedAtMs, cursor.id) as Record<
        string,
        unknown
      >[];
      await processOpenCodeIdentityRows(input, database, identityRows, result);
    } finally {
      database.close();
    }
  } catch {
    result.driftCount += 1;
    return result;
  }
  return result;
}

/**
 * Reads provider session identity metadata for Project discovery only.
 * This deliberately does not touch the Agent Activity observer state or queue.
 */
export async function collectObservedSessionWorkingDirectories(
  input: {
    homeDir?: string;
    onDiagnostic?: (input: {
      code: "session_identity_read_failed" | "opencode_identity_read_failed";
      errorCode: string | null;
      errorName: string;
      provider: "claude" | "codex" | "opencode";
    }) => void;
    signal?: AbortSignal;
  } = {}
): Promise<string[]> {
  const home = input.homeDir ?? homedir();
  const workingDirectories = new Set<string>();
  throwIfCandidateCollectionAborted(input.signal);
  for (const file of await discoverProviderFiles(
    home,
    (provider, error) => {
      reportCandidateReadDiagnostic(input, {
        code: "session_identity_read_failed",
        error,
        provider,
      });
    },
    input.signal
  )) {
    throwIfCandidateCollectionAborted(input.signal);
    const cwd = await readProviderIdentityCwd(file.path, file.provider).catch(
      (error: unknown) => {
        reportCandidateReadDiagnostic(input, {
          code: "session_identity_read_failed",
          error,
          provider: file.provider,
        });
        return null;
      }
    );
    if (cwd) {
      workingDirectories.add(cwd);
    }
  }

  const databasePath = resolveOpenCodeDatabasePath({ homeDir: home });
  throwIfCandidateCollectionAborted(input.signal);
  const metadata = await stat(databasePath).catch((error: unknown) => {
    if (isMissingPathError(error)) {
      return null;
    }
    reportCandidateReadDiagnostic(input, {
      code: "opencode_identity_read_failed",
      error,
      provider: "opencode",
    });
    return null;
  });
  if (metadata?.isFile()) {
    try {
      throwIfCandidateCollectionAborted(input.signal);
      const directories = await readOpenCodeWorkingDirectories({
        databasePath,
        signal: input.signal,
      });
      for (const directory of directories) {
        throwIfCandidateCollectionAborted(input.signal);
        workingDirectories.add(directory);
      }
    } catch (error) {
      reportCandidateReadDiagnostic(input, {
        code: "opencode_identity_read_failed",
        error,
        provider: "opencode",
      });
    }
  }
  return [...workingDirectories].sort();
}

const OPENCODE_DIRECTORY_QUERY_WORKER = `
  const { parentPort, workerData } = require("node:worker_threads");
  try {
    const { DatabaseSync } = require("node:sqlite");
    const database = new DatabaseSync(workerData.databasePath, {
      readOnly: true,
    });
    try {
      const rows = database.prepare(
        "SELECT directory, MAX(time_updated) AS latest_update " +
        "FROM session " +
        "WHERE directory IS NOT NULL AND directory != '' " +
        "GROUP BY directory " +
        "ORDER BY latest_update DESC " +
        "LIMIT 2000"
      ).all();
      parentPort.postMessage({
        directories: rows
          .map((row) => row.directory)
          .filter((directory) =>
            typeof directory === "string" && directory.trim().length > 0
          ),
        ok: true,
      });
    } finally {
      database.close();
    }
  } catch (error) {
    parentPort.postMessage({
      errorCode:
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : null,
      errorName: error instanceof Error ? error.name : "UnknownError",
      ok: false,
    });
  }
`;

async function readOpenCodeWorkingDirectories(input: {
  databasePath: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  throwIfCandidateCollectionAborted(input.signal);
  const worker = new Worker(OPENCODE_DIRECTORY_QUERY_WORKER, {
    eval: true,
    execArgv: ["--no-warnings"],
    workerData: { databasePath: input.databasePath },
  });
  try {
    return await new Promise<string[]>((resolveWorker, rejectWorker) => {
      let settled = false;
      const settle = (operation: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        input.signal?.removeEventListener("abort", onAbort);
        operation();
      };
      const onAbort = () =>
        settle(() =>
          rejectWorker(
            input.signal?.reason ??
              new Error("Local Project candidate scan cancelled.")
          )
        );
      input.signal?.addEventListener("abort", onAbort, { once: true });
      worker.once("error", (error) => settle(() => rejectWorker(error)));
      worker.once("exit", (code) => {
        if (code !== 0) {
          settle(() =>
            rejectWorker(
              new Error(`OpenCode identity worker exited with code ${code}.`)
            )
          );
        }
      });
      worker.once(
        "message",
        (message: {
          directories?: unknown;
          errorCode?: string | null;
          errorName?: string;
          ok?: boolean;
        }) => {
          const directories = message.directories;
          if (message.ok && Array.isArray(directories)) {
            settle(() =>
              resolveWorker(
                directories.filter(
                  (directory: unknown): directory is string =>
                    typeof directory === "string" && directory.trim().length > 0
                )
              )
            );
            return;
          }
          const error = new Error(
            "OpenMeld could not read OpenCode session identities."
          ) as Error & { code?: string };
          error.name = message.errorName ?? "Error";
          if (message.errorCode) {
            error.code = message.errorCode;
          }
          settle(() => rejectWorker(error));
        }
      );
    });
  } finally {
    await worker.terminate();
  }
}

function reportCandidateReadDiagnostic(
  input: {
    onDiagnostic?: (input: {
      code: "session_identity_read_failed" | "opencode_identity_read_failed";
      errorCode: string | null;
      errorName: string;
      provider: "claude" | "codex" | "opencode";
    }) => void;
  },
  diagnostic: {
    code: "session_identity_read_failed" | "opencode_identity_read_failed";
    error: unknown;
    provider: "claude" | "codex" | "opencode";
  }
): void {
  const error = diagnostic.error;
  const event = {
    code: diagnostic.code,
    errorCode:
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : null,
    errorName: error instanceof Error ? error.name : "UnknownError",
    provider: diagnostic.provider,
  } as const;
  if (input.onDiagnostic) {
    input.onDiagnostic(event);
    return;
  }
  process.stderr.write(
    `[openmeld.local_project_discovery.${event.code}] ${JSON.stringify(event)}\n`
  );
}

async function processOpenCodeIdentityRows(
  input: ObserverInput & {
    bindings: Awaited<ReturnType<typeof listProjectBindings>>;
    nowMs: number;
    state: ObserverState;
  },
  database: {
    prepare(sql: string): {
      get(...values: unknown[]): unknown;
    };
  },
  identityRows: readonly Record<string, unknown>[],
  result: { driftCount: number; observedCount: number; queuedCount: number }
) {
  for (const identity of identityRows) {
    const id = text(identity.id);
    const directory = text(identity.directory);
    const updatedAtMs = Number(identity.time_updated) || 0;
    input.state.openCodeCursor = { id: id ?? "", updatedAtMs };
    if (
      !(
        id &&
        directory &&
        (await resolveObservedAgentActivityBinding(directory, input.bindings))
      )
    ) {
      continue;
    }
    const row = database
      .prepare(
        `
          SELECT
            id, parent_id, directory, title, version, time_created,
            time_updated, time_archived, agent, model, cost, tokens_input,
            tokens_output, tokens_reasoning, tokens_cache_read,
            tokens_cache_write
          FROM session
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row) {
      result.driftCount += 1;
      continue;
    }
    const observed = parseOpenCodeSessionRow({ nowMs: input.nowMs, row });
    if (!observed) {
      result.driftCount += 1;
      continue;
    }
    result.observedCount += 1;
    if (
      await isCoveredByRecentAgentActivityHook({
        nowMs: input.nowMs,
        provider: observed.provider,
        providerSessionId: observed.providerSessionId,
        rootDir: input.rootDir,
        status: observed.status,
      })
    ) {
      continue;
    }
    const event = await buildAgentActivityEvent({
      bindings: input.bindings,
      observed,
    });
    if (event) {
      const outcome = await enqueueAgentActivityEvent({
        event,
        nowMs: input.nowMs,
        rootDir: input.rootDir,
      });
      if (outcome === "queued") {
        result.queuedCount += 1;
      }
    }
  }
}

async function discoverProviderFiles(
  home: string,
  onDiagnostic?: (provider: "claude" | "codex", error: unknown) => void,
  signal?: AbortSignal
) {
  const candidates = [
    { provider: "codex" as const, root: join(home, ".codex", "sessions") },
    { provider: "claude" as const, root: join(home, ".claude", "projects") },
  ];
  const files: Array<{
    modifiedAtMs: number;
    path: string;
    provider: "claude" | "codex";
    size: number;
  }> = [];
  for (const candidate of candidates) {
    throwIfCandidateCollectionAborted(signal);
    const providerFiles: typeof files = [];
    let paths: string[];
    try {
      paths = await listJsonlFiles(candidate.root, signal);
    } catch (error) {
      if (isMissingPathError(error)) {
        continue;
      }
      if (!onDiagnostic) {
        throw error;
      }
      onDiagnostic(candidate.provider, error);
      continue;
    }
    for (const path of paths) {
      throwIfCandidateCollectionAborted(signal);
      const metadata = await stat(path).catch((error: unknown) => {
        if (isMissingPathError(error)) {
          return null;
        }
        if (!onDiagnostic) {
          throw error;
        }
        onDiagnostic(candidate.provider, error);
        return null;
      });
      if (metadata?.isFile()) {
        providerFiles.push({
          modifiedAtMs: metadata.mtimeMs,
          path,
          provider: candidate.provider,
          size: metadata.size,
        });
      }
    }
    files.push(
      ...providerFiles
        .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)
        .slice(0, MAX_PROVIDER_FILES_PER_PROVIDER)
    );
  }
  return files.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs);
}

async function listJsonlFiles(
  root: string,
  signal?: AbortSignal
): Promise<string[]> {
  throwIfCandidateCollectionAborted(signal);
  const entries = await readdir(root, { withFileTypes: true });
  throwIfCandidateCollectionAborted(signal);
  const files: string[] = [];
  for (const entry of entries) {
    throwIfCandidateCollectionAborted(signal);
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonlFiles(path, signal)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files;
}

function throwIfCandidateCollectionAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Local Project candidate scan cancelled.");
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );
}

async function readJsonLinesSnapshot(path: string): Promise<unknown[]> {
  const handle = await open(path, "r");
  try {
    const metadata = await handle.stat();
    const headLength = Math.min(HEAD_BYTES, metadata.size);
    const tailStart = Math.max(headLength, metadata.size - TAIL_BYTES);
    const chunks = [
      await readChunk(handle, 0, headLength),
      tailStart < metadata.size
        ? await readChunk(handle, tailStart, metadata.size - tailStart)
        : "",
    ];
    return chunks
      .flatMap((chunk, index) => {
        const lines = chunk.split("\n");
        if (index === 1 && tailStart > headLength) {
          lines.shift();
        }
        return lines;
      })
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as unknown];
        } catch {
          return [];
        }
      });
  } finally {
    await handle.close();
  }
}

async function readProviderIdentityCwd(
  path: string,
  provider: "claude" | "codex"
): Promise<string | null> {
  const handle = await open(path, "r");
  try {
    const metadata = await handle.stat();
    const maximum = Math.min(HEAD_BYTES, metadata.size);
    let raw = "";
    for (let position = 0; position < maximum; position += 4096) {
      raw += await readChunk(
        handle,
        position,
        Math.min(4096, maximum - position)
      );
      let newline = raw.indexOf("\n");
      while (newline >= 0) {
        const cwd = projectIdentityCwd(provider, raw.slice(0, newline));
        if (cwd) {
          return cwd;
        }
        raw = raw.slice(newline + 1);
        newline = raw.indexOf("\n");
      }
    }
    return projectIdentityCwd(provider, raw);
  } finally {
    await handle.close();
  }
}

function projectIdentityCwd(
  provider: "claude" | "codex",
  raw: string
): string | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!(value && typeof value === "object")) {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (provider === "codex") {
      if (
        record.type === "session_meta" &&
        record.payload &&
        typeof record.payload === "object"
      ) {
        const cwd = (record.payload as Record<string, unknown>).cwd;
        if (typeof cwd === "string" && cwd.trim()) {
          return cwd.trim();
        }
      }
      return null;
    }
    if (
      typeof record.sessionId === "string" &&
      record.sessionId.trim() &&
      typeof record.cwd === "string" &&
      record.cwd.trim()
    ) {
      return record.cwd.trim();
    }
  } catch {
    return null;
  }
  return null;
}

async function readChunk(
  handle: Awaited<ReturnType<typeof open>>,
  position: number,
  length: number
) {
  if (length <= 0) {
    return "";
  }
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead).toString("utf8");
}

async function readObserverState(input: ObserverInput): Promise<ObserverState> {
  const path = observerStatePath(input);
  const raw = await readFile(path, "utf8").catch(() => null);
  if (!raw) {
    return {
      files: {},
      openCodeCursor: { id: "", updatedAtMs: 0 },
      version: 2,
    };
  }
  const value: unknown = JSON.parse(raw);
  if (
    value &&
    typeof value === "object" &&
    "version" in value &&
    value.version === 1
  ) {
    const legacy = value as {
      files?: ObserverState["files"];
      openCodeUpdatedAtMs?: number;
    };
    return {
      files: legacy.files ?? {},
      openCodeCursor: {
        id: "",
        updatedAtMs: Number(legacy.openCodeUpdatedAtMs) || 0,
      },
      version: 2,
    };
  }
  if (
    !(
      value &&
      typeof value === "object" &&
      "version" in value &&
      value.version === 2
    )
  ) {
    throw new Error(`Agent Activity observer state is invalid: ${path}`);
  }
  return value as ObserverState;
}

async function writeObserverState(input: ObserverInput, state: ObserverState) {
  const path = observerStatePath(input);
  await mkdir(join(path, ".."), { mode: 0o700, recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function observerStatePath(input: ObserverInput) {
  return join(
    input.rootDir ?? resolveOpenMeldRootDir(),
    "device",
    "agent-activity",
    "observer-state.json"
  );
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
