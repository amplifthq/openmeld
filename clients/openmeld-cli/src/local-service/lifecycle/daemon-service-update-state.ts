import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  daemonServiceUpdateJobSchema,
  OPENMELD_DAEMON_SERVICE_UPDATE_JOB_SCHEMA,
  storedDaemonServiceUpdateJobSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldToolsUpdateOperation,
  DaemonServiceUpdateJob as SharedDaemonServiceUpdateJob,
} from "@openmeld/schemas/types";
import { daemonRuntimeStateRootPath } from "../../config/daemon-state";
import type { OpenMeldPathResolutionInput } from "../../config/paths";

const TERMINAL_UPDATE_VISIBILITY_MS = 24 * 60 * 60 * 1000;

export const DAEMON_SERVICE_UPDATE_JOB_SCHEMA =
  OPENMELD_DAEMON_SERVICE_UPDATE_JOB_SCHEMA;
export type DaemonServiceUpdateJob = SharedDaemonServiceUpdateJob;

export function daemonServicePendingUpdatePath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(daemonRuntimeStateRootPath(pathInput), "service-update.json");
}

export function daemonServiceLastUpdatePath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    daemonRuntimeStateRootPath(pathInput),
    "service-update-last.json"
  );
}

export async function readPendingDaemonServiceUpdate(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonServiceUpdateJob | null> {
  return await readDaemonServiceUpdateJob(
    daemonServicePendingUpdatePath(pathInput)
  );
}

export async function readLastDaemonServiceUpdate(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonServiceUpdateJob | null> {
  return await readDaemonServiceUpdateJob(
    daemonServiceLastUpdatePath(pathInput)
  );
}

export async function persistPendingDaemonServiceUpdate(
  job: DaemonServiceUpdateJob,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await writeUpdateJobAtomically({
    job,
    path: daemonServicePendingUpdatePath(pathInput),
  });
}

export async function completePendingDaemonServiceUpdate(
  job: DaemonServiceUpdateJob,
  pathInput: OpenMeldPathResolutionInput = {},
  retainPending = false
): Promise<void> {
  await writeUpdateJobAtomically({
    job,
    path: daemonServiceLastUpdatePath(pathInput),
  });
  if (retainPending) {
    // Keep the existing OS trigger until Prepare and its auth handoff finish.
    // The update itself is terminal; this does not schedule another update.
    await persistPendingDaemonServiceUpdate(job, pathInput);
    return;
  }
  await rm(daemonServicePendingUpdatePath(pathInput), { force: true });
}

export async function resolveDaemonServiceUpdateOperation(
  pathInput: OpenMeldPathResolutionInput = {},
  nowMs = Date.now()
): Promise<OpenMeldToolsUpdateOperation | null> {
  const pending = await readPendingDaemonServiceUpdate(pathInput);
  if (pending) {
    return projectUpdateOperation(pending);
  }
  const last = await readLastDaemonServiceUpdate(pathInput);
  if (!(last && isRecentTerminalUpdate(last, nowMs))) {
    return null;
  }
  return projectUpdateOperation(last);
}

function isRecentTerminalUpdate(
  job: DaemonServiceUpdateJob,
  nowMs: number
): boolean {
  if (
    job.phase !== "updated" &&
    job.phase !== "restored" &&
    job.phase !== "needs_help"
  ) {
    return false;
  }
  const updatedAtMs = Date.parse(job.updatedAt);
  return (
    Number.isFinite(updatedAtMs) &&
    nowMs >= updatedAtMs &&
    nowMs - updatedAtMs <= TERMINAL_UPDATE_VISIBILITY_MS
  );
}

function projectUpdateOperation(
  job: DaemonServiceUpdateJob
): OpenMeldToolsUpdateOperation {
  return {
    operationId: job.jobId,
    phase: job.phase,
    requestSource: job.requestSource,
    requestedAt: job.requestedAt,
    targetVersion: job.targetVersion,
    updatedAt: job.updatedAt,
    urgency: job.urgency,
  };
}

async function readDaemonServiceUpdateJob(
  path: string
): Promise<DaemonServiceUpdateJob | null> {
  const raw = await readFile(path, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  );
  if (raw === null) {
    return null;
  }
  const parsed = storedDaemonServiceUpdateJobSchema.safeParse(
    JSON.parse(raw) as unknown
  );
  if (!parsed.success) {
    throw new Error("OpenMeld Service update state is invalid.");
  }
  if (parsed.data.v === 2) {
    return parsed.data;
  }
  const { status, ...legacyJob } = parsed.data;
  return daemonServiceUpdateJobSchema.parse({
    ...legacyJob,
    v: 2,
    schema: DAEMON_SERVICE_UPDATE_JOB_SCHEMA,
    phase: migrateLegacyPhase(status),
    requestSource: "cli",
  });
}

function migrateLegacyPhase(
  status: "scheduled" | "running" | "completed" | "failed"
): DaemonServiceUpdateJob["phase"] {
  switch (status) {
    case "scheduled":
      return "waiting_for_work";
    case "running":
      return "updating";
    case "completed":
      return "updated";
    case "failed":
      return "needs_help";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

async function writeUpdateJobAtomically(input: {
  job: DaemonServiceUpdateJob;
  path: string;
}): Promise<void> {
  const temporaryPath = `${input.path}.${String(process.pid)}.tmp`;
  await mkdir(dirname(input.path), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(input.job, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, input.path);
}
