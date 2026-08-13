import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
  spawn,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

const PROCESS_TABLE_COLUMN_SEPARATOR = /\s+/u;
const PROCESS_TABLE_LINE_SEPARATOR = /\r?\n/u;
const PROCESS_SUPERVISION_ENV_KEY = "OPENMELD_PROCESS_SUPERVISION_ID";
const PROCESS_SUPERVISION_DISCOVERY_RETRY_DELAY_MS = 100;
const PROCESS_SUPERVISION_DISCOVERY_MAX_ATTEMPTS = 2;
const PROCESS_TABLE_STOP_PHASE_SNAPSHOT_MAX_AGE_MS = 75;

type AgentControllerProcessTableSnapshot =
  | {
      capturedAtMs: number;
      ok: true;
      processTable: string;
    }
  | {
      capturedAtMs: number;
      error: unknown;
      ok: false;
    };

export type AgentControllerProcessSignalTarget = "process" | "process_group";

export type ListAgentControllerDescendantProcessIds = (
  processId: number
) => number[];

export type ListAgentControllerSupervisedProcessIds = (input: {
  processId: number;
  supervisionId: string;
}) => number[];

export function createAgentControllerProcessTableSnapshotReader(input: {
  maxAgeMs: number;
  now?: () => number;
  readProcessTable: () => string;
}): () => string {
  if (!(Number.isFinite(input.maxAgeMs) && input.maxAgeMs > 0)) {
    throw new Error("process table snapshot max age must be positive");
  }
  const now = input.now ?? Date.now;
  let snapshot: AgentControllerProcessTableSnapshot | null = null;

  return () => {
    const readAtMs = now();
    if (snapshot) {
      const ageMs = readAtMs - snapshot.capturedAtMs;
      if (ageMs >= 0 && ageMs < input.maxAgeMs) {
        if (!snapshot.ok) {
          throw snapshot.error;
        }
        return snapshot.processTable;
      }
    }

    try {
      const processTable = input.readProcessTable();
      snapshot = {
        capturedAtMs: now(),
        ok: true,
        processTable,
      };
      return processTable;
    } catch (error) {
      snapshot = {
        capturedAtMs: now(),
        error,
        ok: false,
      };
      throw error;
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
        supervisionId,
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
  listDescendantProcessIds?: ListAgentControllerDescendantProcessIds;
  listSupervisedProcessIds?: ListAgentControllerSupervisedProcessIds;
  processId: number | null;
  reportDiscoveryFailure?: ReportAgentControllerProcessDiscoveryFailure;
  signal: NodeJS.Signals;
  signalTarget: AgentControllerProcessSignalTarget;
  supervisionId?: string;
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
  const discoveryFailures: AgentControllerProcessDiscoveryFailure[] = [];
  if (input.supervisionId) {
    const listSupervisedProcessIds =
      input.listSupervisedProcessIds ?? listAgentControllerSupervisedProcessIds;
    try {
      for (const descendantProcessId of listSupervisedProcessIds({
        processId: input.processId,
        supervisionId: input.supervisionId,
      })) {
        trackedDescendantProcessIds.add(descendantProcessId);
      }
    } catch (error) {
      discoveryFailures.push({
        error,
        processId: input.processId,
        signal: input.signal,
        source: "supervision_marker",
      });
    }
  } else {
    const listDescendantProcessIds =
      input.listDescendantProcessIds ?? listAgentControllerDescendantProcessIds;
    try {
      for (const descendantProcessId of listDescendantProcessIds(
        input.processId
      )) {
        trackedDescendantProcessIds.add(descendantProcessId);
      }
    } catch (error) {
      discoveryFailures.push({
        error,
        processId: input.processId,
        signal: input.signal,
        source: "descendant_tree",
      });
    }
  }

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
  for (const discoveryFailure of discoveryFailures) {
    reportAgentControllerProcessDiscoveryFailure({
      failure: discoveryFailure,
      reporter: input.reportDiscoveryFailure,
    });
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
    let discoveryError: unknown = null;
    try {
      sent =
        signalAgentControllerProcessTree({
          killProcess: input.killProcess,
          listSupervisedProcessIds: input.listSupervisedProcessIds,
          processId: input.processId,
          reportDiscoveryFailure: (failure) => {
            discoveryError = failure.error;
            reportAgentControllerProcessDiscoveryFailure({
              failure,
              reporter: input.reportDiscoveryFailure,
            });
          },
          signal: "SIGKILL",
          signalTarget: input.signalTarget,
          supervisionId: input.supervisionId,
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

function waitForAgentControllerProcessDiscoveryRetry(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, PROCESS_SUPERVISION_DISCOVERY_RETRY_DELAY_MS);
  });
}

export const listAgentControllerDescendantProcessIds: ListAgentControllerDescendantProcessIds =
  (processId) => {
    const processTable = execFileSync("ps", ["-axo", "pid=,ppid=,pgid="], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 2000,
    });
    return resolveAgentControllerDescendantProcessIds({
      processId,
      processTable,
    });
  };

const readMacOsSupervisedProcessTable =
  createAgentControllerProcessTableSnapshotReader({
    // One Service drain can stop several controllers in the same event-loop
    // turn. They need one system snapshot, not one blocking `ps eww` scan per
    // controller. The cache expires before the bounded 100 ms discovery retry,
    // so a transient timeout still receives one fresh retry.
    maxAgeMs: PROCESS_TABLE_STOP_PHASE_SNAPSHOT_MAX_AGE_MS,
    readProcessTable: () =>
      execFileSync("ps", ["eww", "-axo", "pid=,ppid=,pgid=,command="], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        timeout: 2000,
      }),
  });

export const listAgentControllerSupervisedProcessIds: ListAgentControllerSupervisedProcessIds =
  (input) => {
    if (process.platform === "linux") {
      const processTable = execFileSync(
        "ps",
        ["-e", "-o", "pid=,ppid=,pgid="],
        {
          encoding: "utf8",
          maxBuffer: 4 * 1024 * 1024,
          timeout: 2000,
        }
      );
      return resolveAgentControllerSupervisedProcessIds({
        ...input,
        markedProcessIds: listLinuxSupervisedProcessIds(input.supervisionId),
        processTable,
      });
    }
    const processTable = readMacOsSupervisedProcessTable();
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
  const supervisionMarker = `${PROCESS_SUPERVISION_ENV_KEY}=${input.supervisionId}`;
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
    if (commandParts.includes(supervisionMarker)) {
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

function listLinuxSupervisedProcessIds(supervisionId: string): number[] {
  const supervisionMarker = `${PROCESS_SUPERVISION_ENV_KEY}=${supervisionId}`;
  const processIds: number[] = [];
  for (const entry of readdirSync("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const processId = Number.parseInt(entry.name, 10);
    if (!(Number.isInteger(processId) && String(processId) === entry.name)) {
      continue;
    }
    try {
      const environment = readFileSync(`/proc/${entry.name}/environ`, "utf8");
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
  const childrenByParentProcessId = new Map<number, number[]>();
  const processGroupByProcessId = new Map<number, number>();

  for (const line of input.processTable.split(PROCESS_TABLE_LINE_SEPARATOR)) {
    const [processIdText, parentProcessIdText, processGroupIdText] = line
      .trim()
      .split(PROCESS_TABLE_COLUMN_SEPARATOR);
    const processId = Number.parseInt(processIdText ?? "", 10);
    const parentProcessId = Number.parseInt(parentProcessIdText ?? "", 10);
    const processGroupId = Number.parseInt(processGroupIdText ?? "", 10);
    if (
      !(
        Number.isInteger(processId) &&
        processId > 0 &&
        Number.isInteger(parentProcessId) &&
        parentProcessId >= 0 &&
        Number.isInteger(processGroupId) &&
        processGroupId > 0
      )
    ) {
      continue;
    }
    const children = childrenByParentProcessId.get(parentProcessId) ?? [];
    children.push(processId);
    childrenByParentProcessId.set(parentProcessId, children);
    processGroupByProcessId.set(processId, processGroupId);
  }

  const descendants: number[] = [];
  const pending = [...(childrenByParentProcessId.get(input.processId) ?? [])];
  const visited = new Set<number>([input.processId]);
  while (pending.length > 0) {
    const descendantProcessId = pending.shift();
    if (descendantProcessId === undefined || visited.has(descendantProcessId)) {
      continue;
    }
    visited.add(descendantProcessId);
    if (processGroupByProcessId.get(descendantProcessId) !== input.processId) {
      descendants.push(descendantProcessId);
    }
    pending.push(...(childrenByParentProcessId.get(descendantProcessId) ?? []));
  }
  return descendants;
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
  const error = normalizeErrorForDiagnostic(input.error);
  const reporterError = input.reporterError
    ? normalizeErrorForDiagnostic(input.reporterError)
    : null;
  console.warn("[openmeld.agent_controller.process_discovery_failed]", {
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
    source: input.source,
  });
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
