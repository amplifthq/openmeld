import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { daemonServiceExecutableWrapperPath } from "../src/local-service/lifecycle/daemon-service-bundle";
import { buildDaemonSystemServiceCommandSpec } from "../src/local-service/lifecycle/daemon-service-command-spec";
import {
  assertServiceManagerProbeSucceeded,
  buildLaunchdPlist,
  buildSystemdUnitFile,
  DaemonServiceWaitTimeoutError,
  formatDaemonServiceJobDiagnosticsEvidence,
  installMissingServiceDefinitionFailAtomically,
  isDaemonServiceBackgroundExecutionBlocked,
  isDaemonServiceJobNeverSpawned,
  isDaemonServiceWaitTimeoutError,
  parseLaunchdServiceJobDiagnostics,
  readDaemonServiceJobCrashExitCode,
  readSystemdServiceActiveProbe,
  readSystemdServiceEnabledProbe,
  readWindowsRunnerCommandSummary,
  runServiceDefinitionRollbackSteps,
} from "../src/local-service/lifecycle/daemon-service-manager";

describe("launchd job diagnostics parsing", () => {
  it("parses the never-spawned incident output into structured evidence", () => {
    const diagnostics = parseLaunchdServiceJobDiagnostics(
      LAUNCHD_PRINT_NEVER_SPAWNED_OUTPUT
    );

    expect(diagnostics).toEqual({
      controller: "launchd",
      loaded: true,
      runs: 0,
      state: "not running",
      lastExitCodeText: "(never exited)",
      lastExitCode: null,
      pendedNondemandSpawn: "speculative",
      keepaliveRunAtLoad: true,
    });
    expect(isDaemonServiceJobNeverSpawned(diagnostics)).toBe(true);
    expect(isDaemonServiceBackgroundExecutionBlocked(diagnostics)).toBe(true);
    expect(readDaemonServiceJobCrashExitCode(diagnostics)).toBeNull();
  });

  it("does not call every never-spawned job a macOS background permission block", () => {
    const diagnostics = parseLaunchdServiceJobDiagnostics(
      LAUNCHD_PRINT_NEVER_SPAWNED_WITHOUT_BACKGROUND_MARKER_OUTPUT
    );

    expect(isDaemonServiceJobNeverSpawned(diagnostics)).toBe(true);
    expect(isDaemonServiceBackgroundExecutionBlocked(diagnostics)).toBe(false);
  });

  it("parses a crash-looping job into a nonzero last exit code", () => {
    const diagnostics = parseLaunchdServiceJobDiagnostics(
      LAUNCHD_PRINT_CRASH_LOOP_OUTPUT
    );

    expect(diagnostics.runs).toBe(4);
    expect(diagnostics.lastExitCodeText).toBe("78");
    expect(diagnostics.lastExitCode).toBe(78);
    expect(isDaemonServiceJobNeverSpawned(diagnostics)).toBe(false);
    expect(readDaemonServiceJobCrashExitCode(diagnostics)).toBe(78);
  });

  it("does not flag a running job as never spawned or crash looping", () => {
    const diagnostics = parseLaunchdServiceJobDiagnostics(
      LAUNCHD_PRINT_RUNNING_OUTPUT
    );

    expect(diagnostics.state).toBe("running");
    expect(diagnostics.runs).toBe(1);
    expect(isDaemonServiceJobNeverSpawned(diagnostics)).toBe(false);
    expect(readDaemonServiceJobCrashExitCode(diagnostics)).toBeNull();
  });

  it("formats the evidence line support reads in cards and journals", () => {
    const diagnostics = parseLaunchdServiceJobDiagnostics(
      LAUNCHD_PRINT_NEVER_SPAWNED_OUTPUT
    );

    expect(formatDaemonServiceJobDiagnosticsEvidence(diagnostics)).toBe(
      "launchd job: state=not running, runs=0, last exit code=(never exited), pended nondemand spawn=speculative, properties=keepalive|runatload"
    );
  });

  it("formats an unloaded job without inventing field values", () => {
    expect(
      formatDaemonServiceJobDiagnosticsEvidence({
        controller: "launchd",
        loaded: false,
        runs: null,
        state: null,
        lastExitCodeText: null,
        lastExitCode: null,
        pendedNondemandSpawn: null,
        keepaliveRunAtLoad: false,
      })
    ).toBe("launchd job: not loaded");
  });
});

// Verbatim shape of `launchctl print gui/<uid>/<label>` for the production
// incident where Background Task Management held the job back: loaded with
// keepalive|runatload, yet launchd never spawned the process at all.
const LAUNCHD_PRINT_NEVER_SPAWNED_OUTPUT = [
  "gui/501/com.openmeld.openmeld-background-service = {",
  "\tactive count = 0",
  "\tpath = /Users/monica/Library/LaunchAgents/com.openmeld.openmeld-background-service.plist",
  "\ttype = LaunchAgent",
  "\tstate = not running",
  "\tprogram = /Users/monica/.openmeld/runtime/daemon/service-manager/openmeld-daemon-service",
  "\tdomain = gui/501 [100005]",
  "\tminimum runtime = 10",
  "\texit timeout = 5",
  "\truns = 0",
  "\tlast exit code = (never exited)",
  "\tpended nondemand spawn = speculative",
  "\tproperties = keepalive | runatload | inferred program",
  "}",
].join("\n");

const LAUNCHD_PRINT_CRASH_LOOP_OUTPUT = [
  "gui/501/com.openmeld.openmeld-background-service = {",
  "\tactive count = 0",
  "\tstate = not running",
  "\truns = 4",
  "\tlast exit code = 78",
  "\tproperties = keepalive | runatload",
  "}",
].join("\n");

const LAUNCHD_PRINT_NEVER_SPAWNED_WITHOUT_BACKGROUND_MARKER_OUTPUT = [
  "gui/501/com.openmeld.openmeld-background-service = {",
  "\tactive count = 0",
  "\tstate = not running",
  "\truns = 0",
  "\tlast exit code = (never exited)",
  "\tproperties = keepalive | runatload",
  "}",
].join("\n");

const LAUNCHD_PRINT_RUNNING_OUTPUT = [
  "gui/501/com.openmeld.openmeld-background-service = {",
  "\tactive count = 1",
  "\tstate = running",
  "\truns = 1",
  "\tlast exit code = (never exited)",
  "\tproperties = keepalive | runatload",
  "}",
].join("\n");

const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.allSettled(
    createdDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, {
        recursive: true,
        force: true,
      });
    })
  );
});

describe("local service manager helpers", () => {
  it("rolls back a newly created service definition when install fails", async () => {
    const rollbackNewDefinition = vi.fn(() => Promise.resolve());
    const verifyNewDefinition = vi.fn(() => Promise.resolve());

    await expect(
      installMissingServiceDefinitionFailAtomically({
        definitionWasPresent: false,
        install: () => Promise.reject(new Error("enable failed")),
        rollbackNewDefinition,
        verifyNewDefinition,
      })
    ).rejects.toThrow("enable failed");
    expect(rollbackNewDefinition).toHaveBeenCalledOnce();
    expect(verifyNewDefinition).not.toHaveBeenCalled();
  });

  it("never removes a definition that existed before a failed install", async () => {
    const rollbackNewDefinition = vi.fn(() => Promise.resolve());
    const verifyNewDefinition = vi.fn(() => Promise.resolve());

    await expect(
      installMissingServiceDefinitionFailAtomically({
        definitionWasPresent: true,
        install: () => Promise.reject(new Error("enable failed")),
        rollbackNewDefinition,
        verifyNewDefinition,
      })
    ).rejects.toThrow("enable failed");
    expect(rollbackNewDefinition).not.toHaveBeenCalled();
    expect(verifyNewDefinition).not.toHaveBeenCalled();
  });

  it("rolls back a new definition when its installed and enabled postcondition fails", async () => {
    const rollbackNewDefinition = vi.fn(() => Promise.resolve());

    await expect(
      installMissingServiceDefinitionFailAtomically({
        definitionWasPresent: false,
        install: () => Promise.resolve(),
        rollbackNewDefinition,
        verifyNewDefinition: () =>
          Promise.reject(new Error("registration remained disabled")),
      })
    ).rejects.toThrow("registration remained disabled");
    expect(rollbackNewDefinition).toHaveBeenCalledOnce();
  });

  it("verifies a partial definition again without deleting a pre-existing definition", async () => {
    const rollbackNewDefinition = vi.fn(() => Promise.resolve());
    const verifyNewDefinition = vi.fn(() =>
      Promise.reject(new Error("registration remained disabled"))
    );

    await expect(
      installMissingServiceDefinitionFailAtomically({
        definitionWasPresent: true,
        install: () => Promise.resolve(),
        rollbackNewDefinition,
        verifyNewDefinition,
      })
    ).rejects.toThrow("registration remained disabled");
    expect(verifyNewDefinition).toHaveBeenCalledOnce();
    expect(rollbackNewDefinition).not.toHaveBeenCalled();
  });

  it("accepts explicit systemd inactive and disabled states but rejects probe errors", () => {
    expect(
      readSystemdServiceActiveProbe({
        exitCode: 3,
        stdout: "inactive\n",
        stderr: "",
      })
    ).toBe(false);
    expect(
      readSystemdServiceEnabledProbe({
        exitCode: 1,
        stdout: "disabled\n",
        stderr: "",
      })
    ).toBe(false);
    expect(() =>
      readSystemdServiceEnabledProbe({
        exitCode: 1,
        stdout: "",
        stderr: "Failed to connect to bus: Permission denied",
      })
    ).toThrow("Failed to connect to bus: Permission denied");
  });

  it("rejects a failed launchd status probe", () => {
    expect(() =>
      assertServiceManagerProbeSucceeded("launchctl print-disabled", {
        exitCode: 1,
        stdout: "",
        stderr: "Operation not permitted",
      })
    ).toThrow("Operation not permitted");
  });

  it("attempts every rollback step and retains every cleanup failure", async () => {
    const disable = vi.fn(() => Promise.reject(new Error("disable failed")));
    const removeDefinition = vi.fn(() => Promise.resolve());
    const refreshManager = vi.fn(() =>
      Promise.reject(new Error("reload failed"))
    );

    await expect(
      runServiceDefinitionRollbackSteps([
        disable,
        removeDefinition,
        refreshManager,
      ])
    ).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: "disable failed" }),
        expect.objectContaining({ message: "reload failed" }),
      ],
    });
    expect(disable).toHaveBeenCalledOnce();
    expect(removeDefinition).toHaveBeenCalledOnce();
    expect(refreshManager).toHaveBeenCalledOnce();
  });

  it("writes launchd ProgramArguments through the system shell and OpenMeld-owned wrapper", () => {
    const spec = buildDaemonSystemServiceCommandSpec({
      controller: "launchd",
    });

    const plist = buildLaunchdPlist(spec);

    expect(plist).toContain("<string>/bin/sh</string>");
    expect(plist).toContain(
      `<string>${daemonServiceExecutableWrapperPath()}</string>`
    );
    expect(plist).not.toContain(`<string>${process.execPath}</string>`);
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(plist).toContain(
      "<key>ThrottleInterval</key>\n  <integer>60</integer>"
    );
    expect(plist).not.toContain("<key>SuccessfulExit</key>");
    expect(plist).not.toContain("<key>Crashed</key>");
  });

  it("backs off systemd restart attempts after a host-level startup failure", () => {
    const spec = buildDaemonSystemServiceCommandSpec({
      controller: "systemd",
    });

    const unit = buildSystemdUnitFile(spec);

    expect(unit).toContain("Restart=always");
    expect(unit).toContain("RestartSec=60");
    expect(unit).not.toContain("RestartSec=5");
  });

  it("reads the quoted OpenMeld command from a Windows runner script", async () => {
    const tempDirectory = await mkdtemp(
      join(tmpdir(), "openmeld-windows-runner-")
    );
    createdDirectories.push(tempDirectory);
    const scriptPath = join(tempDirectory, "openmeld-daemon-runner.bat");
    await writeFile(
      scriptPath,
      [
        "@echo off",
        "setlocal",
        'set "HOME=C:\\Users\\felix"',
        'set "OPENMELD_GATEWAY=https://gateway.openmeld.invalid"',
        '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\felix\\.openmeld\\runtime\\daemon\\service-manager\\daemon-service-launcher.mjs" "service" "run" "--mode" "foreground" "--profile" "agt_existing" "--gateway-url" "https://gateway.openmeld.invalid" "--device-id" "device-123" "--heartbeat-ms" "9000"',
      ].join("\r\n"),
      "utf8"
    );

    const commandSummary = await readWindowsRunnerCommandSummary(scriptPath);

    expect(commandSummary).toBe(
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\felix\\.openmeld\\runtime\\daemon\\service-manager\\daemon-service-launcher.mjs" "service" "run" "--mode" "foreground" "--profile" "agt_existing" "--gateway-url" "https://gateway.openmeld.invalid" "--device-id" "device-123" "--heartbeat-ms" "9000"'
    );
  });

  it("returns null when the Windows runner script does not exist", async () => {
    const commandSummary = await readWindowsRunnerCommandSummary(
      join(tmpdir(), "openmeld-missing-runner.bat")
    );

    expect(commandSummary).toBeNull();
  });
});

describe("service wait timeout error", () => {
  it("carries the launchd job-state verdict for lifecycle journaling", () => {
    const jobDiagnostics = parseLaunchdServiceJobDiagnostics(
      LAUNCHD_PRINT_NEVER_SPAWNED_OUTPUT
    );
    const error = new DaemonServiceWaitTimeoutError({
      message: "timed out waiting for launchd service to become running.",
      jobDiagnostics,
    });

    expect(isDaemonServiceWaitTimeoutError(error)).toBe(true);
    expect(isDaemonServiceWaitTimeoutError(new Error("plain"))).toBe(false);
    expect(error.jobDiagnostics).toBe(jobDiagnostics);
    expect(isDaemonServiceJobNeverSpawned(jobDiagnostics)).toBe(true);
  });

  it("defaults to a null verdict when no job diagnostics are available", () => {
    const error = new DaemonServiceWaitTimeoutError({
      message: "timed out waiting for launchd service to become running.",
    });

    expect(error.jobDiagnostics).toBeNull();
  });
});
