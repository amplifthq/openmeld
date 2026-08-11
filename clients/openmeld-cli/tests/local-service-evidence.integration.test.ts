import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  daemonLifecycleJournalPath,
  daemonRuntimeDataPath,
  daemonRuntimeRootPath,
  daemonRuntimeStateRootPath,
} from "../src/config/daemon-state";
import {
  captureDaemonServiceEvidence,
  removeDaemonServiceEvidenceBestEffort,
} from "../src/local-service/lifecycle/daemon-service-evidence";
import { withTempHome } from "./helpers/fs";

const spawnMock = vi.hoisted(() => vi.fn());
const listDaemonOwnedProcessesMock = vi.hoisted(() => vi.fn());
const resolveDaemonStatusSnapshotMock = vi.hoisted(() => vi.fn());
const ORIGINAL_PLATFORM = process.platform;

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock(
  "../src/local-service/lifecycle/daemon-service-process-inventory",
  () => ({
    listDaemonOwnedProcesses: (...args: unknown[]) =>
      listDaemonOwnedProcessesMock(...args),
  })
);

vi.mock("../src/local-service/status/daemon-status-snapshot", () => ({
  resolveDaemonStatusSnapshot: (...args: unknown[]) =>
    resolveDaemonStatusSnapshotMock(...args),
}));

function setProcessPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value,
  });
}

function createMockChildProcess(): EventEmitter & {
  kill: ReturnType<typeof vi.fn>;
  stderr: EventEmitter;
  stdout: EventEmitter;
} {
  const child = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    stderr: EventEmitter;
    stdout: EventEmitter;
  };
  child.kill = vi.fn();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function createSuccessfulChildProcess(
  input: { exitCode?: number; stderr?: string; stdout?: string } = {}
): ReturnType<typeof createMockChildProcess> {
  const child = createMockChildProcess();
  queueMicrotask(() => {
    if (input.stdout) {
      child.stdout.emit("data", input.stdout);
    }
    if (input.stderr) {
      child.stderr.emit("data", input.stderr);
    }
    child.emit("close", input.exitCode ?? 0);
  });
  return child;
}

function createHangingChildProcess(): ReturnType<
  typeof createMockChildProcess
> {
  const child = createMockChildProcess();
  return child;
}

describe("local service evidence", () => {
  beforeEach(() => {
    vi.useRealTimers();
    spawnMock.mockReset();
    listDaemonOwnedProcessesMock.mockReset();
    resolveDaemonStatusSnapshotMock.mockReset();

    listDaemonOwnedProcessesMock.mockResolvedValue([]);
    resolveDaemonStatusSnapshotMock.mockResolvedValue({
      attention: null,
      currentReplyReadiness: {
        daemonStatus: {
          installed: false,
        },
      },
      latestLifecycleEvent: null,
      runtimeContractRepairReport: null,
    });
    spawnMock.mockImplementation(() =>
      createSuccessfulChildProcess({
        stdout: "launchctl output\n",
      })
    );
  });

  afterEach(() => {
    setProcessPlatform(ORIGINAL_PLATFORM);
    vi.useRealTimers();
  });

  it("records before_cleanup and after_failure captures in a single manifest", async () => {
    await withTempHome(async () => {
      const runtimeRootPath = daemonRuntimeRootPath();
      const runtimeLogsPath = join(runtimeRootPath, "logs");
      const runtimeStatePath = daemonRuntimeStateRootPath();
      const runtimeDataPath = daemonRuntimeDataPath();
      const lifecycleJournalFile = daemonLifecycleJournalPath();

      await mkdir(runtimeLogsPath, { recursive: true });
      await mkdir(runtimeStatePath, { recursive: true });
      await mkdir(runtimeDataPath, { recursive: true });
      await writeFile(join(runtimeLogsPath, "daemon.log"), "log\n", "utf8");
      await writeFile(
        lifecycleJournalFile,
        '{"type":"lifecycle.command.begin"}\n',
        "utf8"
      );
      await writeFile(join(runtimeStatePath, "runtime.json"), "{}\n", "utf8");
      await writeFile(join(runtimeDataPath, "ledger.ndjson"), "{}\n", "utf8");

      const beforeCleanup = await captureDaemonServiceEvidence({
        phase: "before_cleanup",
      });
      const afterFailure = await captureDaemonServiceEvidence({
        evidencePath: beforeCleanup.evidencePath,
        phase: "after_failure",
      });

      expect(afterFailure.evidencePath).toBe(beforeCleanup.evidencePath);

      const manifest = JSON.parse(
        await readFile(beforeCleanup.manifestPath, "utf8")
      ) as {
        captures: Record<
          "after_failure" | "before_cleanup",
          {
            artifacts: {
              lifecycleJournal: { status: string };
              runtimeData: { status: string };
              runtimeLogs: { status: string };
              runtimeState: { status: string };
            };
            phase: "after_failure" | "before_cleanup";
          }
        >;
        schema: string;
        v: number;
      };

      expect(manifest.schema).toBe("openmeld-daemon-service-evidence-v3");
      expect(manifest.v).toBe(3);
      expect(manifest.captures.before_cleanup.phase).toBe("before_cleanup");
      expect(manifest.captures.after_failure.phase).toBe("after_failure");
      expect(
        manifest.captures.before_cleanup.artifacts.lifecycleJournal.status
      ).toBe("captured");
      expect(
        manifest.captures.before_cleanup.artifacts.runtimeLogs.status
      ).toBe("captured");
      expect(
        manifest.captures.before_cleanup.artifacts.runtimeState.status
      ).toBe("captured");
      expect(
        manifest.captures.before_cleanup.artifacts.runtimeData.status
      ).toBe("captured");
      expect(manifest.captures.after_failure.artifacts.runtimeLogs.status).toBe(
        "captured"
      );
      expect(
        manifest.captures.after_failure.artifacts.runtimeState.status
      ).toBe("captured");
      expect(manifest.captures.after_failure.artifacts.runtimeData.status).toBe(
        "captured"
      );

      await removeDaemonServiceEvidenceBestEffort(beforeCleanup.evidencePath);
    });
  });

  it("records a deterministic timeout error when system service diagnostics hang", async () => {
    await withTempHome(async () => {
      vi.useFakeTimers();
      setProcessPlatform("darwin");

      const hangingChild = createHangingChildProcess();
      let resolveSpawnStarted: (() => void) | null = null;
      const spawnStarted = new Promise<void>((resolve) => {
        resolveSpawnStarted = resolve;
      });
      spawnMock.mockImplementation(() => {
        resolveSpawnStarted?.();
        return hangingChild;
      });

      const capturePromise = captureDaemonServiceEvidence({
        phase: "snapshot",
      });

      await spawnStarted;
      hangingChild.stdout.emit("data", "partial launchctl output\n");
      await vi.advanceTimersByTimeAsync(5000);

      const capture = await capturePromise;
      const manifest = JSON.parse(
        await readFile(capture.manifestPath, "utf8")
      ) as {
        captures: {
          snapshot: {
            artifacts: {
              systemServiceDiagnostics: {
                errorMessage: string | null;
                status: string;
              };
            };
          };
        };
      };
      const diagnosticsPath = join(
        capture.evidencePath,
        "snapshot",
        "diagnostics",
        "system-service.txt"
      );
      const diagnosticsText = await readFile(diagnosticsPath, "utf8");

      expect(hangingChild.kill).toHaveBeenCalledTimes(1);
      expect(
        manifest.captures.snapshot.artifacts.systemServiceDiagnostics.status
      ).toBe("error");
      expect(
        manifest.captures.snapshot.artifacts.systemServiceDiagnostics
          .errorMessage
      ).toBe("timed out after 5000ms");
      expect(diagnosticsText).toContain("exitCode: 1");
      expect(diagnosticsText).toContain("partial launchctl output");
      expect(diagnosticsText).toContain("timed out after 5000ms");

      await removeDaemonServiceEvidenceBestEffort(capture.evidencePath);
    });
  });

  it("records successful system service diagnostics output when launchctl exits", async () => {
    await withTempHome(async () => {
      setProcessPlatform("darwin");
      spawnMock.mockImplementation(() =>
        createSuccessfulChildProcess({
          stdout: "service is loaded\n",
        })
      );

      const capture = await captureDaemonServiceEvidence({
        phase: "snapshot",
      });
      const manifest = JSON.parse(
        await readFile(capture.manifestPath, "utf8")
      ) as {
        captures: {
          snapshot: {
            artifacts: {
              systemServiceDiagnostics: {
                errorMessage: string | null;
                status: string;
              };
            };
          };
        };
      };
      const diagnosticsPath = join(
        capture.evidencePath,
        "snapshot",
        "diagnostics",
        "system-service.txt"
      );
      const diagnosticsText = await readFile(diagnosticsPath, "utf8");

      expect(
        manifest.captures.snapshot.artifacts.systemServiceDiagnostics.status
      ).toBe("captured");
      expect(
        manifest.captures.snapshot.artifacts.systemServiceDiagnostics
          .errorMessage
      ).toBeNull();
      expect(diagnosticsText).toContain("exitCode: 0");
      expect(diagnosticsText).toContain("service is loaded");

      await removeDaemonServiceEvidenceBestEffort(capture.evidencePath);
    });
  });
});
