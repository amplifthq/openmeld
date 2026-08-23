import { describe, expect, it, vi } from "vitest";
import {
  buildSystemServiceStartupFailureDiagnostics,
  buildSystemServiceStartupFailureReport,
  buildSystemServiceStartupFailureReportFromVerdict,
  buildSystemServiceStartupTimeoutMessage,
  resolveSystemServiceStartupFailureVerdict,
  SystemServiceStartupTimeoutError,
  waitForSystemServiceStartup,
} from "../src/commands/service-start-failure";
import type {
  DaemonServiceJobDiagnostics,
  DaemonServiceManager,
} from "../src/local-service/lifecycle/daemon-service-manager";

// Use plain rejecting functions (not vi.fn().mockRejectedValue) so the global
// afterEach vi.restoreAllMocks() in setup-env.ts cannot wipe the implementation
// between tests — otherwise later tests would call these and get `undefined`,
// then crash on `undefined.catch(...)` inside waitForSystemServiceStartup.
vi.mock(
  "../src/local-service/lifecycle/daemon-service-inventory",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../src/local-service/lifecycle/daemon-service-inventory")
      >();
    return {
      ...actual,
      inspectDaemonServiceInventory: () =>
        Promise.reject(new Error("inventory unavailable in test")),
    };
  }
);

vi.mock("../src/local-service/lifecycle/daemon-service-runtime", () => ({
  readCurrentObservedDaemonRuntimeStatus: () =>
    Promise.reject(new Error("runtime status unavailable in test")),
}));

const LAUNCHD_EVIDENCE_MESSAGE_PATTERN =
  /launchd job: state=not running, runs=0/;

// Structured form of the production incident: launchd accepted the bootstrap
// (keepalive|runatload) but Background Task Management held the spawn back.
const NEVER_SPAWNED_JOB_DIAGNOSTICS: DaemonServiceJobDiagnostics = {
  controller: "launchd",
  loaded: true,
  runs: 0,
  state: "not running",
  lastExitCodeText: "(never exited)",
  lastExitCode: null,
  pendedNondemandSpawn: "speculative",
  keepaliveRunAtLoad: true,
};

const NEVER_SPAWNED_WITHOUT_BACKGROUND_MARKER_DIAGNOSTICS: DaemonServiceJobDiagnostics =
  {
    ...NEVER_SPAWNED_JOB_DIAGNOSTICS,
    pendedNondemandSpawn: null,
  };

const CRASH_LOOP_JOB_DIAGNOSTICS: DaemonServiceJobDiagnostics = {
  controller: "launchd",
  loaded: true,
  runs: 4,
  state: "not running",
  lastExitCodeText: "78",
  lastExitCode: 78,
  pendedNondemandSpawn: null,
  keepaliveRunAtLoad: true,
};

const NOT_RUNNING_MANAGER_STATUS = {
  installed: true,
  running: false,
  enabled: true,
};

function buildTimeoutError(
  jobDiagnostics: DaemonServiceJobDiagnostics | null
): SystemServiceStartupTimeoutError {
  return new SystemServiceStartupTimeoutError({
    inventory: null,
    managerStatus: NOT_RUNNING_MANAGER_STATUS,
    runtimeStatus: null,
    jobDiagnostics,
  });
}

function findRowValue(
  rows: Array<{ label: string; value: string }>,
  labelFragment: string
): string {
  const row = rows.find((candidate) => candidate.label.includes(labelFragment));
  if (!row) {
    throw new Error(`expected a row labeled with ${labelFragment}`);
  }
  return row.value;
}

describe("system service startup failure diagnostics", () => {
  it("tells the user macOS blocked the background item when launchd never spawned the job", () => {
    const report = buildSystemServiceStartupFailureReport({
      controller: "launchd",
      error: buildTimeoutError(NEVER_SPAWNED_JOB_DIAGNOSTICS),
    });

    expect(report.summary).toBe(
      "macOS blocked OpenMeld Service from running in the background."
    );
    const nextStep = findRowValue(report.rows, "Next");
    expect(nextStep).toContain("Login Items & Extensions");
    expect(nextStep).toContain("try again");
    expect(nextStep).not.toContain("Path B");
    expect(nextStep).not.toContain("--mode foreground");
    expect(nextStep).not.toContain("repair");
    expect(report.rows).toHaveLength(2);
    expect(report.rows.map((row) => row.label)).toEqual([
      "What happened",
      "Next",
    ]);
  });

  it("keeps service-log detail out of the Human View card", () => {
    const report = buildSystemServiceStartupFailureReport({
      controller: "launchd",
      error: buildTimeoutError(NEVER_SPAWNED_JOB_DIAGNOSTICS),
      detail: "error: fetch failed",
    });

    expect(report.rows).toHaveLength(2);
    expect(report.rows.some((row) => row.value.includes("fetch failed"))).toBe(
      false
    );
  });

  it("surfaces the nonzero last exit code as crash-loop evidence", () => {
    const report = buildSystemServiceStartupFailureReport({
      controller: "launchd",
      error: buildTimeoutError(CRASH_LOOP_JOB_DIAGNOSTICS),
    });

    expect(report.summary).toBe(
      "OpenMeld Service keeps stopping after it starts."
    );
    expect(findRowValue(report.rows, "Next")).toBe(
      "Run `openmeld service start --mode foreground` to see what stopped it."
    );
    expect(report.rows.some((row) => row.value.includes("exit code 78"))).toBe(
      false
    );
  });

  it("builds the never-spawned card directly from a carried verdict", () => {
    const report = buildSystemServiceStartupFailureReportFromVerdict(
      {
        controller: "launchd",
        message: "startup timed out",
        detail: null,
        jobDiagnostics: NEVER_SPAWNED_JOB_DIAGNOSTICS,
        localMachineIssue: {
          schemaVersion: 1,
          code: "local_machine.background_execution.blocked",
          operation: "start_background_service",
          recoveryPolicy: "user_action",
          summary:
            "macOS blocked OpenMeld Service from running in the background.",
          primaryAction:
            "Open System Settings > General > Login Items & Extensions, enable OpenMeld, then try again.",
          diagnostics: {
            systemCode: "BACKGROUND_EXECUTION_BLOCKED",
            detail:
              "launchd job: state=not running, runs=0, last exit code=(never exited), pended nondemand spawn=speculative, properties=keepalive|runatload",
          },
        },
      },
      { autoRepairAttempted: true }
    );

    expect(report.summary).toBe(
      "macOS blocked OpenMeld Service from running in the background."
    );
    const nextStep = findRowValue(report.rows, "Next");
    expect(nextStep).toContain("Login Items & Extensions");
    expect(nextStep).toContain("try again");
    expect(report.rows).toHaveLength(2);
  });

  it("resolves a verdict carrying launchd job diagnostics from a timeout error", () => {
    const verdict = resolveSystemServiceStartupFailureVerdict({
      controller: "launchd",
      error: buildTimeoutError(CRASH_LOOP_JOB_DIAGNOSTICS),
    });

    expect(verdict.jobDiagnostics).toEqual(CRASH_LOOP_JOB_DIAGNOSTICS);
    expect(verdict.localMachineIssue).toBeNull();
    const report = buildSystemServiceStartupFailureReportFromVerdict(verdict);
    expect(report.summary).toContain("keeps stopping");
  });

  it("keeps a never-spawned job generic without the macOS background marker", () => {
    const verdict = resolveSystemServiceStartupFailureVerdict({
      controller: "launchd",
      error: buildTimeoutError(
        NEVER_SPAWNED_WITHOUT_BACKGROUND_MARKER_DIAGNOSTICS
      ),
    });

    expect(verdict.jobDiagnostics).toEqual(
      NEVER_SPAWNED_WITHOUT_BACKGROUND_MARKER_DIAGNOSTICS
    );
    expect(verdict.localMachineIssue).toBeNull();
    const report = buildSystemServiceStartupFailureReportFromVerdict(verdict);
    expect(report.summary).toBe(
      "OpenMeld could not finish starting OpenMeld Service (launchd)."
    );
    expect(findRowValue(report.rows, "Next")).not.toContain(
      "Login Items & Extensions"
    );
  });

  it("carries exhausted storage as the same structured local machine issue", () => {
    const verdict = resolveSystemServiceStartupFailureVerdict({
      controller: "launchd",
      error: Object.assign(new Error("no space left on device"), {
        code: "ENOSPC",
      }),
    });

    expect(verdict.localMachineIssue).toMatchObject({
      code: "local_machine.storage.exhausted",
      operation: "start_background_service",
      recoveryPolicy: "user_action",
      diagnostics: {
        systemCode: "ENOSPC",
      },
    });
  });

  it("falls back to the generic startup failure card without job evidence", () => {
    const report = buildSystemServiceStartupFailureReport({
      controller: "launchd",
      error: buildTimeoutError(null),
    });

    expect(report.summary).toBe(
      "OpenMeld could not finish starting OpenMeld Service (launchd)."
    );
    const nextStep = findRowValue(report.rows, "Next");
    expect(nextStep).not.toContain("Login Items & Extensions");
  });

  it("appends the launchd evidence to the startup timeout message", () => {
    const message = buildSystemServiceStartupTimeoutMessage({
      inventory: null,
      managerStatus: NOT_RUNNING_MANAGER_STATUS,
      runtimeStatus: null,
      jobDiagnostics: NEVER_SPAWNED_JOB_DIAGNOSTICS,
    });

    expect(message).toContain("managerRunning=false");
    expect(message).toContain(
      "launchd job: state=not running, runs=0, last exit code=(never exited), pended nondemand spawn=speculative, properties=keepalive|runatload"
    );
  });

  it("exposes the job evidence in agent-view failure diagnostics", () => {
    const diagnostics = buildSystemServiceStartupFailureDiagnostics({
      controller: "launchd",
      error: buildTimeoutError(NEVER_SPAWNED_JOB_DIAGNOSTICS),
      recovery: null,
    });

    expect(diagnostics.jobDiagnostics).toEqual(NEVER_SPAWNED_JOB_DIAGNOSTICS);
    expect(diagnostics.localMachineIssue).toMatchObject({
      code: "local_machine.background_execution.blocked",
    });
  });

  it("captures job diagnostics from the manager when the startup wait times out", async () => {
    const readJobDiagnostics = vi
      .fn()
      .mockResolvedValue(NEVER_SPAWNED_JOB_DIAGNOSTICS);
    const manager: DaemonServiceManager = {
      controller: "launchd",
      install: async () => undefined,
      uninstall: async () => undefined,
      enableAutostart: async () => undefined,
      disableAutostart: async () => undefined,
      start: async () => undefined,
      stop: async () => undefined,
      deactivate: async () => undefined,
      status: async () => NOT_RUNNING_MANAGER_STATUS,
      waitUntilAbsent: async () => undefined,
      waitUntilStopped: async () => undefined,
      waitUntilRunning: async () => undefined,
      readJobDiagnostics,
    };

    const startupWait = waitForSystemServiceStartup({
      expectedVersion: "0.7.96",
      manager,
      waitMs: 5,
      pollMs: 1,
    });

    await expect(startupWait).rejects.toThrow(SystemServiceStartupTimeoutError);
    await expect(startupWait).rejects.toThrow(LAUNCHD_EVIDENCE_MESSAGE_PATTERN);
    expect(readJobDiagnostics).toHaveBeenCalledTimes(1);
    const error = await startupWait.then(
      () => {
        throw new Error("expected the startup wait to time out");
      },
      (caught: unknown) => caught as SystemServiceStartupTimeoutError
    );
    expect(error.jobDiagnostics).toEqual(NEVER_SPAWNED_JOB_DIAGNOSTICS);
  });

  it("still times out cleanly when the manager cannot provide job diagnostics", async () => {
    const manager: DaemonServiceManager = {
      controller: "launchd",
      install: async () => undefined,
      uninstall: async () => undefined,
      enableAutostart: async () => undefined,
      disableAutostart: async () => undefined,
      start: async () => undefined,
      stop: async () => undefined,
      deactivate: async () => undefined,
      status: async () => NOT_RUNNING_MANAGER_STATUS,
      waitUntilAbsent: async () => undefined,
      waitUntilStopped: async () => undefined,
      waitUntilRunning: async () => undefined,
      readJobDiagnostics: () =>
        Promise.reject(new Error("launchctl unavailable in test")),
    };

    const error = await waitForSystemServiceStartup({
      expectedVersion: "0.7.96",
      manager,
      waitMs: 5,
      pollMs: 1,
    }).then(
      () => {
        throw new Error("expected the startup wait to time out");
      },
      (caught: unknown) => caught as SystemServiceStartupTimeoutError
    );

    expect(error).toBeInstanceOf(SystemServiceStartupTimeoutError);
    expect(error.jobDiagnostics).toBeNull();
    expect(error.message).toContain("managerRunning=false");
  });
});
