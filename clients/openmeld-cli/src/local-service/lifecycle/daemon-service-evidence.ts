import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import {
  daemonLifecycleJournalPath,
  daemonRuntimeDataPath,
  daemonRuntimeRootPath,
  daemonRuntimeStateRootPath,
} from "../../config/daemon-state";
import { openMeldBackupsDir, openMeldRootDir } from "../../config/paths";
import type { RuntimeContext } from "../../runtime/context";
import {
  type DaemonStatusSnapshot,
  resolveDaemonStatusSnapshot,
} from "../status/daemon-status-snapshot";
import {
  getDaemonServiceLaunchdLabel,
  getDaemonSystemServiceLogPath,
} from "./daemon-service-manager";
import { listDaemonOwnedProcesses } from "./daemon-service-process-inventory";

const DAEMON_SERVICE_EVIDENCE_SCHEMA = "openmeld-daemon-service-evidence-v3";
const SYSTEM_SERVICE_DIAGNOSTICS_TIMEOUT_MS = 5000;

export type DaemonServiceEvidencePhase =
  | "after_failure"
  | "before_cleanup"
  | "snapshot";

export type DaemonServiceFailureStage =
  | "inspect"
  | "backup"
  | "stop_or_drain"
  | "wait_stopped"
  | "unregister"
  | "wait_absent"
  | "prepare_bundle"
  | "install_bundle"
  | "write_contract"
  | "register_service"
  | "restore_runtime_data"
  | "start_if_desired"
  | "wait_running"
  | "verify_final_inventory"
  | "restored_verified_previous_state"
  | "stopped_safe_current_version"
  | "failed_before_safe_state"
  | "pre-stop"
  | "stop-wait"
  | "uninstall-verify"
  | "reinstall-install"
  | "restore-last-known-good";

type EvidenceArtifactStatus = {
  errorMessage: string | null;
  relativePath: string | null;
  sourcePath: string | null;
  status: "captured" | "error" | "missing" | "skipped";
};

type DaemonServiceEvidenceCapturePhase = {
  artifacts: {
    lifecycleJournal: EvidenceArtifactStatus;
    ownedProcesses: EvidenceArtifactStatus;
    runtimeData: EvidenceArtifactStatus;
    runtimeLogs: EvidenceArtifactStatus;
    runtimeState: EvidenceArtifactStatus;
    systemServiceDiagnostics: EvidenceArtifactStatus;
  };
  capturedAt: string;
  observedStatusSnapshot: DaemonStatusSnapshot | null;
  observedStatusSnapshotError: string | null;
  phase: DaemonServiceEvidencePhase;
};

type DaemonServiceEvidenceManifest = {
  captures: Partial<
    Record<DaemonServiceEvidencePhase, DaemonServiceEvidenceCapturePhase>
  >;
  createdAt: string;
  evidencePath: string;
  laneRootPath: string;
  paths: {
    backupsRootPath: string;
    lifecycleJournalPath: string;
    runtimeDataPath: string;
    runtimeLogsPath: string;
    runtimeRootPath: string;
    runtimeStatePath: string;
    systemServiceLogPath: string;
  };
  serviceIdentity: {
    launchdLabel: string;
  };
  schema: typeof DAEMON_SERVICE_EVIDENCE_SCHEMA;
  v: 3;
};

export type DaemonServiceEvidenceCapture = {
  evidencePath: string;
  manifestPath: string;
  phase: DaemonServiceEvidencePhase;
};

export async function captureDaemonServiceEvidence(
  input: {
    evidencePath?: string;
    phase?: DaemonServiceEvidencePhase;
    profile?: string;
    runtime?: RuntimeContext;
    view?: string;
  } = {}
): Promise<DaemonServiceEvidenceCapture> {
  const phase = input.phase ?? "snapshot";
  const capturedAt = new Date().toISOString();
  const evidencePath =
    input.evidencePath ?? (await createEvidenceRoot(capturedAt));
  const manifestPath = join(evidencePath, "manifest.json");
  const phaseRootPath = join(evidencePath, phase);
  const runtimeRootPath = daemonRuntimeRootPath();
  const runtimeLogsPath = join(runtimeRootPath, "logs");
  const runtimeStatePath = daemonRuntimeStateRootPath();
  const runtimeDataPath = daemonRuntimeDataPath();
  const lifecycleJournalPath = daemonLifecycleJournalPath();
  const systemServiceLogPath = getDaemonSystemServiceLogPath();

  const [statusSnapshotResult, ownedProcessesResult, systemDiagnosticsResult] =
    await Promise.all([
      resolveDaemonStatusSnapshot({
        profile: input.profile,
        runtime: input.runtime,
        view: input.view,
      })
        .then((snapshot) => ({
          snapshot,
          errorMessage: null,
        }))
        .catch((error) => ({
          snapshot: null,
          errorMessage: toErrorMessage(error),
        })),
      captureOwnedProcessesArtifact(phaseRootPath),
      captureSystemServiceDiagnosticsArtifact(phaseRootPath),
    ]);
  const runtimeLogsArtifact = await captureDirectoryArtifact({
    evidencePath: phaseRootPath,
    relativePath: join("runtime", "logs"),
    sourcePath: runtimeLogsPath,
  });
  const lifecycleJournalArtifact = await captureFileArtifact({
    evidencePath: phaseRootPath,
    relativePath: join("runtime", "daemon-lifecycle-journal.jsonl"),
    sourcePath: lifecycleJournalPath,
  });
  const runtimeStateArtifact = await captureDirectoryArtifact({
    evidencePath: phaseRootPath,
    relativePath: join("runtime", "state"),
    sourcePath: runtimeStatePath,
  });
  const runtimeDataArtifact = await captureDirectoryArtifact({
    evidencePath: phaseRootPath,
    relativePath: join("runtime", "data"),
    sourcePath: runtimeDataPath,
  });

  const phaseCapture: DaemonServiceEvidenceCapturePhase = {
    artifacts: {
      lifecycleJournal: lifecycleJournalArtifact,
      ownedProcesses: ownedProcessesResult.artifact,
      runtimeData: runtimeDataArtifact,
      runtimeLogs: runtimeLogsArtifact,
      runtimeState: runtimeStateArtifact,
      systemServiceDiagnostics: systemDiagnosticsResult.artifact,
    },
    observedStatusSnapshot: statusSnapshotResult.snapshot,
    observedStatusSnapshotError: statusSnapshotResult.errorMessage,
    capturedAt,
    phase,
  };
  const existingManifest =
    await readDaemonServiceEvidenceManifest(manifestPath);
  const manifest: DaemonServiceEvidenceManifest = {
    captures: {
      ...(existingManifest?.captures ?? {}),
      [phase]: phaseCapture,
    },
    createdAt: existingManifest?.createdAt ?? capturedAt,
    evidencePath,
    laneRootPath: openMeldRootDir(),
    paths: {
      backupsRootPath: openMeldBackupsDir(),
      lifecycleJournalPath,
      runtimeDataPath,
      runtimeLogsPath,
      runtimeRootPath,
      runtimeStatePath,
      systemServiceLogPath,
    },
    serviceIdentity: {
      launchdLabel: getDaemonServiceLaunchdLabel(),
    },
    schema: DAEMON_SERVICE_EVIDENCE_SCHEMA,
    v: 3,
  };

  await writeFile(`${manifestPath}`, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
  });

  return {
    evidencePath,
    manifestPath,
    phase,
  };
}

export async function captureDaemonServiceEvidenceBestEffort(
  input: {
    evidencePath?: string;
    phase?: DaemonServiceEvidencePhase;
    profile?: string;
    runtime?: RuntimeContext;
    view?: string;
  } = {}
): Promise<string | null> {
  return await captureDaemonServiceEvidence(input)
    .then((result) => result.evidencePath)
    .catch(() => null);
}

export async function removeDaemonServiceEvidenceBestEffort(
  evidencePath: string | null | undefined
): Promise<void> {
  if (!evidencePath) {
    return;
  }
  await rm(evidencePath, {
    force: true,
    recursive: true,
  }).catch(() => undefined);
}

export function formatDaemonFailureRetentionText(input: {
  backupDataPath?: string | null;
  evidencePath?: string | null;
  wrapPaths?: boolean;
}): string {
  const formatPath = (value: string): string =>
    input.wrapPaths === true ? `\`${value}\`` : value;
  const notes = [
    input.backupDataPath
      ? `Runtime data backup retained at ${formatPath(input.backupDataPath)}.`
      : null,
    input.evidencePath
      ? `Service evidence snapshot saved at ${formatPath(input.evidencePath)}.`
      : null,
  ].filter((value): value is string => value !== null);
  return notes.join(" ");
}

export function formatDaemonFailureContextText(input: {
  backupDataPath?: string | null;
  evidencePath?: string | null;
  failureStage?: DaemonServiceFailureStage | null;
  wrapPaths?: boolean;
}): string {
  const notes = [
    input.failureStage ? `Failure stage: ${input.failureStage}.` : null,
    formatDaemonFailureRetentionText(input),
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  return notes.join(" ");
}

async function createEvidenceRoot(createdAt: string): Promise<string> {
  const timestampSegment = createdAt.replaceAll(":", "-");
  const evidencePath = join(
    openMeldBackupsDir(),
    "service-evidence",
    `${timestampSegment}-${String(process.pid)}`
  );
  await mkdir(evidencePath, {
    recursive: true,
  });
  return evidencePath;
}

async function readDaemonServiceEvidenceManifest(
  manifestPath: string
): Promise<DaemonServiceEvidenceManifest | null> {
  const raw = await readFile(manifestPath, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DaemonServiceEvidenceManifest>;
    if (
      parsed?.schema !== DAEMON_SERVICE_EVIDENCE_SCHEMA ||
      parsed.v !== 3 ||
      typeof parsed.evidencePath !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.laneRootPath !== "string" ||
      !parsed.paths ||
      !parsed.serviceIdentity
    ) {
      return null;
    }
    return parsed as DaemonServiceEvidenceManifest;
  } catch {
    return null;
  }
}

async function captureDirectoryArtifact(input: {
  evidencePath: string;
  relativePath: string;
  sourcePath: string;
}): Promise<EvidenceArtifactStatus> {
  const sourceStats = await stat(input.sourcePath).catch(() => null);
  if (!sourceStats?.isDirectory()) {
    return {
      errorMessage: null,
      relativePath: null,
      sourcePath: input.sourcePath,
      status: "missing",
    };
  }

  const targetPath = join(input.evidencePath, input.relativePath);
  await mkdir(join(targetPath, ".."), {
    recursive: true,
  });
  try {
    await cp(input.sourcePath, targetPath, {
      recursive: true,
    });
    return {
      errorMessage: null,
      relativePath: input.relativePath,
      sourcePath: input.sourcePath,
      status: "captured",
    };
  } catch (error) {
    return {
      errorMessage: toErrorMessage(error),
      relativePath: null,
      sourcePath: input.sourcePath,
      status: "error",
    };
  }
}

async function captureFileArtifact(input: {
  evidencePath: string;
  relativePath: string;
  sourcePath: string;
}): Promise<EvidenceArtifactStatus> {
  const sourceStats = await stat(input.sourcePath).catch(() => null);
  if (!sourceStats?.isFile()) {
    return {
      errorMessage: null,
      relativePath: null,
      sourcePath: input.sourcePath,
      status: "missing",
    };
  }

  const targetPath = join(input.evidencePath, input.relativePath);
  await mkdir(join(targetPath, ".."), {
    recursive: true,
  });
  try {
    await cp(input.sourcePath, targetPath);
    return {
      errorMessage: null,
      relativePath: input.relativePath,
      sourcePath: input.sourcePath,
      status: "captured",
    };
  } catch (error) {
    return {
      errorMessage: toErrorMessage(error),
      relativePath: null,
      sourcePath: input.sourcePath,
      status: "error",
    };
  }
}

async function captureOwnedProcessesArtifact(evidencePath: string): Promise<{
  artifact: EvidenceArtifactStatus;
}> {
  const relativePath = join("diagnostics", "owned-processes.json");
  const targetPath = join(evidencePath, relativePath);
  await mkdir(join(targetPath, ".."), {
    recursive: true,
  });
  try {
    const ownedProcesses = await listDaemonOwnedProcesses();
    await writeFile(
      `${targetPath}`,
      `${JSON.stringify(ownedProcesses, null, 2)}\n`,
      "utf8"
    );
    return {
      artifact: {
        errorMessage: null,
        relativePath,
        sourcePath: null,
        status: "captured",
      },
    };
  } catch (error) {
    return {
      artifact: {
        errorMessage: toErrorMessage(error),
        relativePath: null,
        sourcePath: null,
        status: "error",
      },
    };
  }
}

async function captureSystemServiceDiagnosticsArtifact(
  evidencePath: string
): Promise<{
  artifact: EvidenceArtifactStatus;
}> {
  if (process.platform !== "darwin") {
    return {
      artifact: {
        errorMessage:
          "system service diagnostics are only implemented for macOS in this release",
        relativePath: null,
        sourcePath: null,
        status: "skipped",
      },
    };
  }

  const uid =
    typeof process.getuid === "function" ? String(process.getuid()) : null;
  if (!uid) {
    return {
      artifact: {
        errorMessage:
          "could not resolve local user id for launchctl diagnostics",
        relativePath: null,
        sourcePath: null,
        status: "error",
      },
    };
  }

  const launchdLabel = getDaemonServiceLaunchdLabel();
  const command = "launchctl";
  const args = ["print", `gui/${uid}/${launchdLabel}`];
  const result = await runCommand(command, args, {
    timeoutMs: SYSTEM_SERVICE_DIAGNOSTICS_TIMEOUT_MS,
  });
  const relativePath = join("diagnostics", "system-service.txt");
  const targetPath = join(evidencePath, relativePath);
  await mkdir(join(targetPath, ".."), {
    recursive: true,
  });
  const body = [
    `command: ${command} ${args.join(" ")}`,
    `exitCode: ${String(result.exitCode)}`,
    "",
    "stdout:",
    result.stdout.trimEnd(),
    "",
    "stderr:",
    result.stderr.trimEnd(),
    "",
  ].join("\n");
  await writeFile(`${targetPath}`, body, "utf8");
  return {
    artifact: {
      errorMessage:
        result.exitCode === 0
          ? null
          : result.stderr.trim() ||
            `launchctl exited with ${String(result.exitCode)}`,
      relativePath,
      sourcePath: null,
      status: result.exitCode === 0 ? "captured" : "error",
    },
  };
}

async function runCommand(
  command: string,
  args: string[],
  input: {
    timeoutMs?: number;
  } = {}
): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const clearListenersAndTimer = (): void => {
      child.removeListener("error", handleError);
      child.removeListener("close", handleClose);
      child.stdout?.removeListener("data", handleStdout);
      child.stderr?.removeListener("data", handleStderr);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    };

    const resolveOnce = (result: {
      exitCode: number;
      stderr: string;
      stdout: string;
    }): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearListenersAndTimer();
      resolve(result);
    };

    const handleStdout = (chunk: Buffer | string): void => {
      stdout += chunk.toString();
    };
    const handleStderr = (chunk: Buffer | string): void => {
      stderr += chunk.toString();
    };
    const handleError = (error: Error): void => {
      resolveOnce({
        exitCode: 1,
        stderr: String(error),
        stdout,
      });
    };
    const handleClose = (code: number | null): void => {
      resolveOnce({
        exitCode: typeof code === "number" ? code : 1,
        stderr,
        stdout,
      });
    };
    const timeoutHandle =
      typeof input.timeoutMs === "number" && input.timeoutMs > 0
        ? setTimeout(() => {
            if (settled) {
              return;
            }
            settled = true;
            clearListenersAndTimer();
            child.kill("SIGKILL");
            resolve({
              exitCode: 1,
              stderr: `timed out after ${input.timeoutMs}ms`,
              stdout,
            });
          }, input.timeoutMs)
        : null;

    child.stdout?.on("data", handleStdout);
    child.stderr?.on("data", handleStderr);
    child.once("error", handleError);
    child.once("close", handleClose);
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
