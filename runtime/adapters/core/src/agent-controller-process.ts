import {
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

const PROCESS_TABLE_COLUMN_SEPARATOR = /\s+/u;
const PROCESS_TABLE_LINE_SEPARATOR = /\r?\n/u;
const PROCESS_SUPERVISION_ENV_KEY = "OPENMELD_PROCESS_SUPERVISION_ID";
const PROCESS_SUPERVISION_DISCOVERY_RETRY_DELAY_MS = 100;
const PROCESS_SUPERVISION_DISCOVERY_MAX_ATTEMPTS = 2;
const PROCESS_TABLE_STOP_PHASE_SNAPSHOT_MAX_AGE_MS = 75;
const PROCESS_DISCOVERY_DIAGNOSTIC_WINDOW_MS = 60_000;

type AgentControllerProcessTableSnapshot = {
  capturedAtMs: number;
  pending: boolean;
  processTable: Promise<string>;
};

export type AgentControllerProcessSignalTarget = "process" | "process_group";

export type ListAgentControllerDescendantProcessIds = (
  processId: number
) => Promise<number[]>;

export type ListAgentControllerSupervisedProcessIds = (input: {
  processId: number;
  supervisionId: string;
}) => Promise<number[]>;

export function createAgentControllerProcessTableSnapshotReader(input: {
  maxAgeMs: number;
  now?: () => number;
  readProcessTable: () => Promise<string>;
}): () => Promise<string> {
  if (!(Number.isFinite(input.maxAgeMs) && input.maxAgeMs > 0)) {
    throw new Error("process table snapshot max age must be positive");
  }
  const now = input.now ?? Date.now;
  let snapshot: AgentControllerProcessTableSnapshot | null = null;

  return async () => {
    const readAtMs = now();
    if (snapshot) {
      const ageMs = readAtMs - snapshot.capturedAtMs;
      if (snapshot.pending || (ageMs >= 0 && ageMs < input.maxAgeMs)) {
        return await snapshot.processTable;
      }
    }

    const processTable = input.readProcessTable();
    const currentSnapshot = {
      capturedAtMs: readAtMs,
      pending: true,
      processTable,
    };
    snapshot = currentSnapshot;
    try {
      return await processTable;
    } finally {
      currentSnapshot.pending = false;
    }
  };
}

export type AgentControllerProcessDiscoveryFailure = {
  error: unknown;
  processId: number;
  signal: NodeJS.Signals;
  source: "descendant_tree" | "supervision_marker";
};

export type ReportAgentControllerProcessDiscoveryFailure = (
  failure: AgentControllerProcessDiscoveryFailure
) => void;

type AgentControllerProcessDiscoveryDiagnosticSource =
  AgentControllerProcessDiscoveryFailure["source"];

type AgentControllerProcessDiscoveryDiagnosticWriter = (
  level: "info" | "warn",
  event: string,
  payload: Record<string, unknown>
) => void;

export function createAgentControllerProcessDiscoveryDiagnosticAggregator(input?: {
  now?: () => number;
  windowMs?: number;
  write?: AgentControllerProcessDiscoveryDiagnosticWriter;
}): {
  failure: (
    failure: AgentControllerProcessDiscoveryFailure & {
      reporterError?: unknown;
    }
  ) => void;
  recovered: (source: AgentControllerProcessDiscoveryDiagnosticSource) => void;
} {
  const now = input?.now ?? Date.now;
  const windowMs = input?.windowMs ?? PROCESS_DISCOVERY_DIAGNOSTIC_WINDOW_MS;
  const write: AgentControllerProcessDiscoveryDiagnosticWriter =
    input?.write ?? ((level, event, payload) => console[level](event, payload));
  const aggregates = new Map<
    string,
    {
      affectedProcessIds: Set<number>;
      error: ReturnType<typeof normalizeErrorForDiagnostic>;
      firstAtMs: number;
      lastAtMs: number;
      lastReportedAtMs: number;
      occurrenceCount: number;
      reporterError: ReturnType<typeof normalizeErrorForDiagnostic> | null;
      source: AgentControllerProcessDiscoveryDiagnosticSource;
    }
  >();

  return {
    failure: (failure) => {
      const observedAtMs = now();
      const error = normalizeErrorForDiagnostic(failure.error);
      const reasonCode = isProcessDiscoveryTimeoutError(failure.error)
        ? "process_discovery_timeout"
        : "process_discovery_failed";
      const key = `${failure.source}:${reasonCode}:${error.name}`;
      const aggregate = aggregates.get(key) ?? {
        affectedProcessIds: new Set<number>(),
        error,
        firstAtMs: observedAtMs,
        lastAtMs: observedAtMs,
        lastReportedAtMs: Number.NEGATIVE_INFINITY,
        occurrenceCount: 0,
        reporterError: failure.reporterError
          ? normalizeErrorForDiagnostic(failure.reporterError)
          : null,
        source: failure.source,
      };
      aggregate.affectedProcessIds.add(failure.processId);
      aggregate.error = error;
      aggregate.lastAtMs = observedAtMs;
      aggregate.occurrenceCount += 1;
      aggregates.set(key, aggregate);
      if (observedAtMs - aggregate.lastReportedAtMs < windowMs) {
        return;
      }
      aggregate.lastReportedAtMs = observedAtMs;
      write("warn", "[openmeld.agent_controller.process_discovery_failed]", {
        affectedProcessIds: [...aggregate.affectedProcessIds].slice(0, 20),
        durationMs: observedAtMs - aggregate.firstAtMs,
        errorCode: error.code,
        errorMessage: error.message,
        errorName: error.name,
        occurrenceCount: aggregate.occurrenceCount,
        reasonCode,
        ...(aggregate.reporterError
          ? {
              reporterErrorMessage: aggregate.reporterError.message,
              reporterErrorName: aggregate.reporterError.name,
            }
          : {}),
        signal: failure.signal,
        source: failure.source,
      });
    },
    recovered: (source) => {
      const recoveredAtMs = now();
      for (const [key, aggregate] of aggregates) {
        if (aggregate.source !== source) {
          continue;
        }
        write(
          "info",
          "[openmeld.agent_controller.process_discovery_recovered]",
          {
            affectedProcessIds: [...aggregate.affectedProcessIds].slice(0, 20),
            durationMs: recoveredAtMs - aggregate.firstAtMs,
            occurrenceCount: aggregate.occurrenceCount,
            reasonCode: "process_discovery_recovered",
            source,
          }
        );
        aggregates.delete(key);
      }
    },
  };
}

function isProcessDiscoveryTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const processError = error as NodeJS.ErrnoException & { killed?: boolean };
  return processError.code === "ETIMEDOUT" || processError.killed === true;
}

const processDiscoveryDiagnostics =
  createAgentControllerProcessDiscoveryDiagnosticAggregator();

export type AgentControllerProcessCleanupFailure = {
  error: unknown;
  processId: number | null;
  signal: "SIGKILL";
};

export type ReportAgentControllerProcessCleanupFailure = (
  failure: AgentControllerProcessCleanupFailure
) => void;

export type AgentControllerProcessCleanupResult =
  | {
      ok: true;
      signalSent: boolean;
    }
  | {
      error: unknown;
      ok: false;
      signalSent: boolean;
    };

export type WaitForAgentControllerProcessDiscoveryRetry = () => Promise<void>;

export type SpawnedAgentControllerProcess = {
  child: ChildProcessWithoutNullStreams;
  processId: number | null;
  signalTarget: AgentControllerProcessSignalTarget;
  supervisionId: string;
  terminate: (signal: NodeJS.Signals) => boolean;
  terminateRemainingDescendants: () => Promise<AgentControllerProcessCleanupResult>;
};

export function spawnAgentControllerProcess(input: {
  args: string[];
  bin: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: boolean;
}): SpawnedAgentControllerProcess {
  const signalTarget = resolveAgentControllerProcessSignalTarget();
  const supervisionId = randomUUID();
  const child = spawn(input.bin, input.args, {
    cwd: input.cwd,
    detached: signalTarget === "process_group",
    env: {
      ...input.env,
      [PROCESS_SUPERVISION_ENV_KEY]: supervisionId,
    },
    shell: input.shell,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const processId = typeof child.pid === "number" ? child.pid : null;
  const trackedDescendantProcessIds = new Set<number>();

  return {
    child,
    processId,
    signalTarget,
    supervisionId,
    terminate: (signal) =>
      signalAgentControllerProcessTree({
        processId,
        signal,
        signalTarget,
        trackedDescendantProcessIds,
      }),
    terminateRemainingDescendants: () =>
      terminateRemainingAgentControllerProcesses({
        processId,
        signalTarget,
        supervisionId,
        trackedDescendantProcessIds,
      }),
  };
}

export function resolveAgentControllerProcessSignalTarget(
  platform: NodeJS.Platform = process.platform
): AgentControllerProcessSignalTarget {
  return platform === "win32" ? "process" : "process_group";
}

export function resolveAgentControllerProcessSignalId(input: {
  processId: number;
  signalTarget: AgentControllerProcessSignalTarget;
}): number {
  return input.signalTarget === "process_group"
    ? -input.processId
    : input.processId;
}

export function signalAgentControllerProcessTree(input: {
  killProcess?: typeof process.kill;
  processId: number | null;
  signal: NodeJS.Signals;
  signalTarget: AgentControllerProcessSignalTarget;
  trackedDescendantProcessIds?: Set<number>;
}): boolean {
  if (input.processId === null) {
    return false;
  }
  if (input.signalTarget === "process") {
    return signalProcessId({
      killProcess: input.killProcess,
      processId: input.processId,
      signal: input.signal,
    });
  }

  const trackedDescendantProcessIds =
    input.trackedDescendantProcessIds ?? new Set<number>();

  let sent = false;
  const signalFailures: unknown[] = [];
  const attemptSignal = (processId: number): void => {
    try {
      sent =
        signalProcessId({
          killProcess: input.killProcess,
          processId,
          signal: input.signal,
        }) || sent;
    } catch (error) {
      signalFailures.push(error);
    }
  };
  attemptSignal(
    resolveAgentControllerProcessSignalId({
      processId: input.processId,
      signalTarget: input.signalTarget,
    })
  );
  for (const descendantProcessId of trackedDescendantProcessIds) {
    attemptSignal(descendantProcessId);
  }
  if (signalFailures.length > 0) {
    throw signalFailures[0];
  }
  return sent;
}

export function terminateRemainingAgentControllerProcesses(input: {
  killProcess?: typeof process.kill;
  listSupervisedProcessIds?: ListAgentControllerSupervisedProcessIds;
  processId: number | null;
  reportCleanupFailure?: ReportAgentControllerProcessCleanupFailure;
  reportDiscoveryFailure?: ReportAgentControllerProcessDiscoveryFailure;
  signalTarget: AgentControllerProcessSignalTarget;
  supervisionId: string;
  trackedDescendantProcessIds?: Set<number>;
  waitForDiscoveryRetry?: WaitForAgentControllerProcessDiscoveryRetry;
}): Promise<AgentControllerProcessCleanupResult> {
  return runRemainingAgentControllerProcessCleanup(input);
}

async function runRemainingAgentControllerProcessCleanup(input: {
  killProcess?: typeof process.kill;
  listSupervisedProcessIds?: ListAgentControllerSupervisedProcessIds;
  processId: number | null;
  reportCleanupFailure?: ReportAgentControllerProcessCleanupFailure;
  reportDiscoveryFailure?: ReportAgentControllerProcessDiscoveryFailure;
  signalTarget: AgentControllerProcessSignalTarget;
  supervisionId: string;
  trackedDescendantProcessIds?: Set<number>;
  waitForDiscoveryRetry?: WaitForAgentControllerProcessDiscoveryRetry;
}): Promise<AgentControllerProcessCleanupResult> {
  let sent = false;
  const trackedDescendantProcessIds =
    input.trackedDescendantProcessIds ?? new Set<number>();

  for (
    let attempt = 1;
    attempt <= PROCESS_SUPERVISION_DISCOVERY_MAX_ATTEMPTS;
    attempt += 1
  ) {
    let cleanupError: unknown = null;
    const discoveryError = await collectSupervisedProcessIds({
      listSupervisedProcessIds: input.listSupervisedProcessIds,
      processId: input.processId,
      reportDiscoveryFailure: input.reportDiscoveryFailure,
      signalTarget: input.signalTarget,
      supervisionId: input.supervisionId,
      trackedDescendantProcessIds,
    });
    try {
      sent =
        signalAgentControllerProcessTree({
          killProcess: input.killProcess,
          processId: input.processId,
          signal: "SIGKILL",
          signalTarget: input.signalTarget,
          trackedDescendantProcessIds,
        }) || sent;
    } catch (error) {
      cleanupError = error;
      reportAgentControllerProcessCleanupFailure({
        failure: {
          error,
          processId: input.processId,
          signal: "SIGKILL",
        },
        reporter: input.reportCleanupFailure,
      });
    }

    const terminalError = cleanupError ?? discoveryError;
    const reachedFinalAttempt =
      attempt >= PROCESS_SUPERVISION_DISCOVERY_MAX_ATTEMPTS;
    const cleanupSettled =
      discoveryError === null && (cleanupError !== null || sent);
    if (reachedFinalAttempt || cleanupSettled) {
      return terminalError === null
        ? { ok: true, signalSent: sent }
        : { error: terminalError, ok: false, signalSent: sent };
    }
    await (
      input.waitForDiscoveryRetry ?? waitForAgentControllerProcessDiscoveryRetry
    )();
  }

  return { ok: true, signalSent: sent };
}

async function collectSupervisedProcessIds(input: {
  listSupervisedProcessIds?: ListAgentControllerSupervisedProcessIds;
  processId: number | null;
  reportDiscoveryFailure?: ReportAgentControllerProcessDiscoveryFailure;
  signalTarget: AgentControllerProcessSignalTarget;
  supervisionId: string;
  trackedDescendantProcessIds: Set<number>;
}): Promise<unknown | null> {
  if (input.signalTarget !== "process_group" || input.processId === null) {
    return null;
  }
  const listSupervisedProcessIds =
    input.listSupervisedProcessIds ?? listAgentControllerSupervisedProcessIds;
  try {
    const supervisedProcessIds = await listSupervisedProcessIds({
      processId: input.processId,
      supervisionId: input.supervisionId,
    });
    for (const descendantProcessId of supervisedProcessIds) {
      input.trackedDescendantProcessIds.add(descendantProcessId);
    }
    return null;
  } catch (error) {
    reportAgentControllerProcessDiscoveryFailure({
      failure: {
        error,
        processId: input.processId,
        signal: "SIGKILL",
        source: "supervision_marker",
      },
      reporter: input.reportDiscoveryFailure,
    });
    return error;
  }
}

function waitForAgentControllerProcessDiscoveryRetry(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, PROCESS_SUPERVISION_DISCOVERY_RETRY_DELAY_MS);
  });
}

export const listAgentControllerDescendantProcessIds: ListAgentControllerDescendantProcessIds =
  async (processId) => {
    const processTable = await readProcessTable(["-axo", "pid=,ppid=,pgid="], {
      maxBuffer: 4 * 1024 * 1024,
    });
    processDiscoveryDiagnostics.recovered("descendant_tree");
    return resolveAgentControllerDescendantProcessIds({
      processId,
      processTable,
    });
  };

const readMacOsSupervisedProcessTable =
  createAgentControllerProcessTableSnapshotReader({
    // One Service drain can stop several controllers in the same event-loop
    // turn. They need one system snapshot, not one blocking `ps eww` scan per
    // controller. Pending reads stay shared even when slow; settled snapshots
    // expire before the bounded 100 ms retry, which still receives a fresh read.
    maxAgeMs: PROCESS_TABLE_STOP_PHASE_SNAPSHOT_MAX_AGE_MS,
    readProcessTable: async () =>
      await readProcessTable(["eww", "-axo", "pid=,ppid=,pgid=,command="], {
        maxBuffer: 32 * 1024 * 1024,
      }),
  });

export const listAgentControllerSupervisedProcessIds: ListAgentControllerSupervisedProcessIds =
  async (input) => {
    if (process.platform === "linux") {
      const processTable = await readProcessTable(
        ["-e", "-o", "pid=,ppid=,pgid="],
        { maxBuffer: 4 * 1024 * 1024 }
      );
      processDiscoveryDiagnostics.recovered("supervision_marker");
      return resolveAgentControllerSupervisedProcessIds({
        ...input,
        markedProcessIds: await listLinuxSupervisedProcessIds(
          input.supervisionId
        ),
        processTable,
      });
    }
    const processTable = await readMacOsSupervisedProcessTable();
    processDiscoveryDiagnostics.recovered("supervision_marker");
    return resolveAgentControllerSupervisedProcessIds({
      ...input,
      processTable,
    });
  };

export function resolveAgentControllerSupervisedProcessIds(input: {
  markedProcessIds?: Iterable<number>;
  processId: number;
  processTable: string;
  supervisionId: string;
}): number[] {
  return resolveAgentControllerProcessIdsFromTable({
    ...input,
    supervisionMarker: `${PROCESS_SUPERVISION_ENV_KEY}=${input.supervisionId}`,
  });
}

function resolveAgentControllerProcessIdsFromTable(input: {
  markedProcessIds?: Iterable<number>;
  processId: number;
  processTable: string;
  supervisionMarker?: string;
}): number[] {
  const childrenByParentProcessId = new Map<number, number[]>();
  const processGroupByProcessId = new Map<number, number>();
  const markedProcessIds = new Set<number>(input.markedProcessIds);
  for (const line of input.processTable.split(PROCESS_TABLE_LINE_SEPARATOR)) {
    const [
      processIdText,
      parentProcessIdText,
      processGroupIdText,
      ...commandParts
    ] = line.trim().split(PROCESS_TABLE_COLUMN_SEPARATOR);
    const processId = Number.parseInt(processIdText ?? "", 10);
    const parentProcessId = Number.parseInt(parentProcessIdText ?? "", 10);
    const processGroupId = Number.parseInt(processGroupIdText ?? "", 10);
    if (
      !Number.isInteger(processId) ||
      processId <= 0 ||
      !Number.isInteger(parentProcessId) ||
      parentProcessId < 0 ||
      !Number.isInteger(processGroupId) ||
      processGroupId <= 0
    ) {
      continue;
    }
    const children = childrenByParentProcessId.get(parentProcessId) ?? [];
    children.push(processId);
    childrenByParentProcessId.set(parentProcessId, children);
    processGroupByProcessId.set(processId, processGroupId);
    if (
      input.supervisionMarker !== undefined &&
      commandParts.includes(input.supervisionMarker)
    ) {
      markedProcessIds.add(processId);
    }
  }
  return resolveOutOfGroupAgentControllerProcessIds({
    childrenByParentProcessId,
    markedProcessIds,
    processGroupByProcessId,
    processId: input.processId,
  });
}

async function listLinuxSupervisedProcessIds(
  supervisionId: string
): Promise<number[]> {
  const supervisionMarker = `${PROCESS_SUPERVISION_ENV_KEY}=${supervisionId}`;
  const processIds: number[] = [];
  for (const entry of await readdir("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const processId = Number.parseInt(entry.name, 10);
    if (!(Number.isInteger(processId) && String(processId) === entry.name)) {
      continue;
    }
    try {
      const environment = await readFile(`/proc/${entry.name}/environ`, "utf8");
      if (environment.split("\0").includes(supervisionMarker)) {
        processIds.push(processId);
      }
    } catch (error) {
      if (!isExpectedLinuxProcessInspectionError(error)) {
        throw error;
      }
    }
  }
  return processIds;
}

function readProcessTable(
  args: readonly string[],
  input: { maxBuffer: number }
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "ps",
      [...args],
      {
        encoding: "utf8",
        maxBuffer: input.maxBuffer,
        timeout: 2000,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function isExpectedLinuxProcessInspectionError(error: unknown): boolean {
  if (!(error instanceof Error && "code" in error)) {
    return false;
  }
  const code = String(error.code);
  return (
    code === "EACCES" ||
    code === "ENOENT" ||
    code === "EPERM" ||
    code === "ESRCH"
  );
}

function resolveOutOfGroupAgentControllerProcessIds(input: {
  childrenByParentProcessId: ReadonlyMap<number, readonly number[]>;
  markedProcessIds: ReadonlySet<number>;
  processGroupByProcessId: ReadonlyMap<number, number>;
  processId: number;
}): number[] {
  const processIds = new Set<number>();
  const pending = [
    ...(input.childrenByParentProcessId.get(input.processId) ?? []),
  ];
  const visited = new Set<number>([input.processId]);
  while (pending.length > 0) {
    const descendantProcessId = pending.shift();
    if (descendantProcessId === undefined || visited.has(descendantProcessId)) {
      continue;
    }
    visited.add(descendantProcessId);
    if (
      input.processGroupByProcessId.get(descendantProcessId) !== input.processId
    ) {
      processIds.add(descendantProcessId);
    }
    pending.push(
      ...(input.childrenByParentProcessId.get(descendantProcessId) ?? [])
    );
  }
  for (const markedProcessId of input.markedProcessIds) {
    if (
      markedProcessId !== input.processId &&
      input.processGroupByProcessId.get(markedProcessId) !== input.processId
    ) {
      processIds.add(markedProcessId);
    }
  }
  return [...processIds];
}

export function resolveAgentControllerDescendantProcessIds(input: {
  processId: number;
  processTable: string;
}): number[] {
  return resolveAgentControllerProcessIdsFromTable(input);
}

function signalProcessId(input: {
  killProcess?: typeof process.kill;
  processId: number;
  signal: NodeJS.Signals;
}): boolean {
  try {
    (input.killProcess ?? process.kill)(input.processId, input.signal);
    return true;
  } catch (error) {
    if (
      isNoSuchProcessError(error) ||
      isUnsignalableExitedProcessGroup(error, input.processId)
    ) {
      return false;
    }
    throw error;
  }
}

function isUnsignalableExitedProcessGroup(
  error: unknown,
  processId: number
): boolean {
  // Darwin reports EPERM while an isolated process group contains only its
  // already-exited, not-yet-reaped leader. OpenMeld creates every negative
  // target as a same-user isolated group, so a live member remains signalable.
  return (
    processId < 0 &&
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === "EPERM"
  );
}

function isNoSuchProcessError(error: unknown): boolean {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === "ESRCH"
  );
}

function reportAgentControllerProcessDiscoveryFailure(input: {
  failure: AgentControllerProcessDiscoveryFailure;
  reporter?: ReportAgentControllerProcessDiscoveryFailure;
}): void {
  if (input.reporter) {
    try {
      input.reporter(input.failure);
      return;
    } catch (reporterError) {
      reportAgentControllerProcessDiscoveryFailureToConsole({
        ...input.failure,
        reporterError,
      });
      return;
    }
  }
  reportAgentControllerProcessDiscoveryFailureToConsole(input.failure);
}

function reportAgentControllerProcessCleanupFailure(input: {
  failure: AgentControllerProcessCleanupFailure;
  reporter?: ReportAgentControllerProcessCleanupFailure;
}): void {
  if (input.reporter) {
    try {
      input.reporter(input.failure);
      return;
    } catch (reporterError) {
      reportAgentControllerProcessCleanupFailureToConsole({
        ...input.failure,
        reporterError,
      });
      return;
    }
  }
  reportAgentControllerProcessCleanupFailureToConsole(input.failure);
}

function reportAgentControllerProcessCleanupFailureToConsole(
  input: AgentControllerProcessCleanupFailure & { reporterError?: unknown }
): void {
  const error = normalizeErrorForDiagnostic(input.error);
  const reporterError = input.reporterError
    ? normalizeErrorForDiagnostic(input.reporterError)
    : null;
  console.warn("[openmeld.agent_controller.process_cleanup_failed]", {
    errorCode: error.code,
    errorMessage: error.message,
    errorName: error.name,
    processId: input.processId,
    ...(reporterError
      ? {
          reporterErrorMessage: reporterError.message,
          reporterErrorName: reporterError.name,
        }
      : {}),
    signal: input.signal,
    source: "remaining_descendants_signal",
  });
}

function reportAgentControllerProcessDiscoveryFailureToConsole(
  input: AgentControllerProcessDiscoveryFailure & { reporterError?: unknown }
): void {
  processDiscoveryDiagnostics.failure(input);
}

function normalizeErrorForDiagnostic(error: unknown): {
  code: string | null;
  message: string;
  name: string;
} {
  if (error instanceof Error) {
    return {
      code: (error as NodeJS.ErrnoException).code ?? null,
      message: error.message,
      name: error.name,
    };
  }
  return {
    code: null,
    message: String(error),
    name: "NonError",
  };
}
