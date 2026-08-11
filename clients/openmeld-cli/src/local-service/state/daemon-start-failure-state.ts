import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { daemonRuntimeRootPath } from "../../config/daemon-state";
import {
  type OpenMeldEnvPreset,
  type OpenMeldPathResolutionInput,
  resolveOpenMeldEnvPreset,
} from "../../config/paths";
import type { DaemonServiceDependencyIssue } from "../../local-service/lifecycle/daemon-service-dependency-diagnostics";
import { dirnamePath, normalizeOptionalText } from "../core/logger";

const DAEMON_START_FAILURE_STATE_FILE = "daemon-start-failure-state.json";
const DAEMON_START_FAILURE_STATE_SCHEMA = "daemon.start.failure.state" as const;

export type DaemonStartFailureStateReason =
  | "service_dependencies_unavailable"
  | "startup_failed";

export type DaemonStartFailureState = {
  schema: typeof DAEMON_START_FAILURE_STATE_SCHEMA;
  v: 1;
  recordedAt: string;
  reason: DaemonStartFailureStateReason;
  detail: string;
  rawLogLine: string | null;
  dependencyIssues: DaemonServiceDependencyIssue[];
  lane: OpenMeldEnvPreset;
};

export function daemonStartFailureStatePath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    daemonRuntimeRootPath(pathInput),
    "data",
    DAEMON_START_FAILURE_STATE_FILE
  );
}

export async function readDaemonStartFailureState(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonStartFailureState | null> {
  const raw = await readFile(
    daemonStartFailureStatePath(pathInput),
    "utf8"
  ).catch(() => null);
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseDaemonStartFailureState(parsed);
}

export async function writeDaemonStartFailureState(input: {
  recordedAt?: string;
  pathInput?: OpenMeldPathResolutionInput;
  reason: DaemonStartFailureStateReason;
  detail: string;
  rawLogLine?: string | null;
  dependencyIssues?: DaemonServiceDependencyIssue[];
}): Promise<DaemonStartFailureState> {
  const lane = resolveOpenMeldEnvPreset(input.pathInput);
  const state: DaemonStartFailureState = {
    schema: DAEMON_START_FAILURE_STATE_SCHEMA,
    v: 1,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    reason: input.reason,
    detail: input.detail,
    rawLogLine: normalizeOptionalText(input.rawLogLine) ?? null,
    dependencyIssues: normalizeDependencyIssues(input.dependencyIssues ?? []),
    lane,
  };
  await writeJsonAtomic({
    path: daemonStartFailureStatePath(input.pathInput),
    value: state,
  });
  return state;
}

export async function clearDaemonStartFailureState(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await rm(daemonStartFailureStatePath(pathInput), {
    force: true,
  }).catch(() => undefined);
}

function parseDaemonStartFailureState(
  value: unknown
): DaemonStartFailureState | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.schema !== DAEMON_START_FAILURE_STATE_SCHEMA || value.v !== 1) {
    return null;
  }
  const recordedAt = normalizeOptionalText(value.recordedAt);
  const detail = normalizeOptionalText(value.detail);
  const lane = value.lane;
  const reason = value.reason;
  const rawLogLine =
    value.rawLogLine === null ? null : normalizeOptionalText(value.rawLogLine);
  if (
    !(recordedAt && detail) ||
    (lane !== "prod" && lane !== "dev-local" && lane !== "canary") ||
    (reason !== "service_dependencies_unavailable" &&
      reason !== "startup_failed")
  ) {
    return null;
  }
  const dependencyIssues = normalizeDependencyIssues(
    Array.isArray(value.dependencyIssues) ? value.dependencyIssues : []
  );
  return {
    schema: DAEMON_START_FAILURE_STATE_SCHEMA,
    v: 1,
    recordedAt,
    reason,
    detail,
    rawLogLine,
    dependencyIssues,
    lane,
  };
}

function normalizeDependencyIssues(
  issues: unknown[]
): DaemonServiceDependencyIssue[] {
  const normalized: DaemonServiceDependencyIssue[] = [];
  for (const issue of issues) {
    if (!isRecord(issue)) {
      continue;
    }
    const kind = issue.kind;
    const status = issue.status;
    const scope = issue.scope;
    const baseUrl = normalizeOptionalText(issue.baseUrl);
    const probeUrl = normalizeOptionalText(issue.probeUrl);
    const httpStatus =
      typeof issue.httpStatus === "number" ? issue.httpStatus : null;
    if (
      (kind !== "auth" && kind !== "gateway") ||
      (status !== "unhealthy_http" && status !== "unreachable") ||
      (scope !== "loopback" && scope !== "remote") ||
      !baseUrl ||
      !probeUrl
    ) {
      continue;
    }
    normalized.push({
      kind,
      status,
      scope,
      baseUrl,
      probeUrl,
      httpStatus,
    });
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeJsonAtomic(input: {
  path: string;
  value: unknown;
}): Promise<void> {
  await mkdir(dirnamePath(input.path), {
    recursive: true,
  });
  const tempPath = `${input.path}.tmp-${Date.now()}-${process.pid}`;
  await writeFile(
    tempPath,
    `${JSON.stringify(input.value, null, 2)}\n`,
    "utf8"
  );
  await rename(tempPath, input.path).catch(async (error) => {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  });
}
