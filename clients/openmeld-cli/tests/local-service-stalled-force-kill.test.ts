import type { DaemonRuntimeLease } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { DaemonOwnedProcess } from "../src/local-service/lifecycle/daemon-service-process-inventory";
import {
  FORCE_KILL_MIN_HEARTBEAT_STALL_MS,
  forceKillStalledDaemonAfterStopTimeout,
  resolveStalledDaemonForceKillVerdict,
} from "../src/local-service/lifecycle/daemon-service-stalled-force-kill";

const NOW_MS = Date.parse("2026-07-03T09:00:00.000Z");

function buildLease(
  overrides: Partial<DaemonRuntimeLease> = {}
): DaemonRuntimeLease {
  return {
    schema: "openmeld-daemon-runtime-lease-v1",
    v: 1,
    generation: 3,
    bundleId: "bundle-1",
    pid: 4242,
    mode: "background",
    startedAt: "2026-07-03T05:00:00.000Z",
    updatedAt: "2026-07-03T05:26:00.000Z",
    heartbeatAt: "2026-07-03T05:27:00.000Z",
    serviceController: "launchd",
    managedBySystemService: true,
    ...overrides,
  };
}

function buildOwnedProcess(
  overrides: Partial<DaemonOwnedProcess> = {}
): DaemonOwnedProcess {
  return {
    pid: 4242,
    parentPid: 1,
    command: "/usr/local/bin/node /openmeld/bundle/daemon.js",
    mode: "background",
    ownership: "stable_launcher",
    ...overrides,
  };
}

describe("resolveStalledDaemonForceKillVerdict", () => {
  it("force-kills a background daemon whose heartbeat stalled past the threshold", () => {
    // The production shape: heartbeat frozen for 3.5 hours while the process
    // sleeps inside the 15-minute auth_rejected backoff tier.
    const verdict = resolveStalledDaemonForceKillVerdict({
      nowMs: NOW_MS,
      ownedProcesses: [buildOwnedProcess()],
      runtimeLease: buildLease(),
    });

    expect(verdict).toEqual({
      decision: "force_kill",
      pid: 4242,
      heartbeatStalledMs: NOW_MS - Date.parse("2026-07-03T05:27:00.000Z"),
    });
  });

  it("never force-kills while the heartbeat is fresh", () => {
    const freshHeartbeatAt = new Date(NOW_MS - 30_000).toISOString();
    const verdict = resolveStalledDaemonForceKillVerdict({
      nowMs: NOW_MS,
      ownedProcesses: [buildOwnedProcess()],
      runtimeLease: buildLease({ heartbeatAt: freshHeartbeatAt }),
    });

    expect(verdict).toMatchObject({
      decision: "skip",
      reason: "heartbeat_fresh",
      heartbeatStalledMs: 30_000,
    });
  });

  it("skips a heartbeat stalled just under the threshold", () => {
    const nearThresholdHeartbeatAt = new Date(
      NOW_MS - FORCE_KILL_MIN_HEARTBEAT_STALL_MS + 1
    ).toISOString();
    const verdict = resolveStalledDaemonForceKillVerdict({
      nowMs: NOW_MS,
      ownedProcesses: [buildOwnedProcess()],
      runtimeLease: buildLease({ heartbeatAt: nearThresholdHeartbeatAt }),
    });

    expect(verdict).toMatchObject({
      decision: "skip",
      reason: "heartbeat_fresh",
    });
  });

  it("falls back to updatedAt when heartbeatAt is null", () => {
    const verdict = resolveStalledDaemonForceKillVerdict({
      nowMs: NOW_MS,
      ownedProcesses: [buildOwnedProcess()],
      runtimeLease: buildLease({ heartbeatAt: null }),
    });

    expect(verdict).toMatchObject({
      decision: "force_kill",
      heartbeatStalledMs: NOW_MS - Date.parse("2026-07-03T05:26:00.000Z"),
    });
  });

  it("skips when the runtime lease is missing", () => {
    const verdict = resolveStalledDaemonForceKillVerdict({
      nowMs: NOW_MS,
      ownedProcesses: [buildOwnedProcess()],
      runtimeLease: null,
    });

    expect(verdict).toMatchObject({
      decision: "skip",
      reason: "runtime_lease_missing",
    });
  });

  it("skips when the lease pid is not attributed to an OpenMeld-owned process", () => {
    // Lease pid recycled by the OS: process inventory has no matching entry.
    const verdict = resolveStalledDaemonForceKillVerdict({
      nowMs: NOW_MS,
      ownedProcesses: [buildOwnedProcess({ pid: 9999 })],
      runtimeLease: buildLease(),
    });

    expect(verdict).toMatchObject({
      decision: "skip",
      reason: "lease_pid_not_owned",
      pid: 4242,
    });
  });

  it("skips when the matching process has unknown ownership", () => {
    const verdict = resolveStalledDaemonForceKillVerdict({
      nowMs: NOW_MS,
      ownedProcesses: [buildOwnedProcess({ ownership: "unknown" })],
      runtimeLease: buildLease(),
    });

    expect(verdict).toMatchObject({
      decision: "skip",
      reason: "lease_pid_not_owned",
    });
  });

  it("skips foreground processes", () => {
    const verdict = resolveStalledDaemonForceKillVerdict({
      nowMs: NOW_MS,
      ownedProcesses: [buildOwnedProcess({ mode: "foreground" })],
      runtimeLease: buildLease({ mode: "foreground" }),
    });

    expect(verdict).toMatchObject({
      decision: "skip",
      reason: "foreground_process",
    });
  });

  it("fails closed when the heartbeat timestamp is unparseable", () => {
    const verdict = resolveStalledDaemonForceKillVerdict({
      nowMs: NOW_MS,
      ownedProcesses: [buildOwnedProcess()],
      runtimeLease: buildLease({
        heartbeatAt: "not-a-timestamp",
      }),
    });

    expect(verdict).toMatchObject({
      decision: "skip",
      reason: "heartbeat_unparseable",
    });
  });
});

describe("forceKillStalledDaemonAfterStopTimeout", () => {
  function buildDeps(overrides: {
    killProcess?: (pid: number, signal: NodeJS.Signals) => void;
    lease?: DaemonRuntimeLease | null;
    ownedProcesses?: readonly DaemonOwnedProcess[];
  }) {
    const emitLifecycleEvent = vi.fn().mockResolvedValue(undefined);
    const killProcess = vi.fn(overrides.killProcess ?? (() => undefined));
    const waitForProcessExit = vi.fn().mockResolvedValue(true);
    return {
      deps: {
        emitLifecycleEvent,
        killProcess,
        listOwnedProcesses: vi
          .fn()
          .mockResolvedValue(overrides.ownedProcesses ?? [buildOwnedProcess()]),
        nowMs: () => NOW_MS,
        readRuntimeLease: vi
          .fn()
          .mockResolvedValue(
            overrides.lease === undefined ? buildLease() : overrides.lease
          ),
        waitForProcessExit,
      },
      emitLifecycleEvent,
      killProcess,
      waitForProcessExit,
    };
  }

  it("sends SIGKILL and journals a force_killed event for a stalled daemon", async () => {
    const { deps, emitLifecycleEvent, killProcess, waitForProcessExit } =
      buildDeps({});

    const outcome = await forceKillStalledDaemonAfterStopTimeout(
      { stage: "wait_stopped" },
      deps
    );

    expect(outcome.killed).toBe(true);
    expect(killProcess).toHaveBeenCalledWith(4242, "SIGKILL");
    expect(waitForProcessExit).toHaveBeenCalledWith(4242);
    expect(emitLifecycleEvent).toHaveBeenCalledWith({
      type: "process_stop.action",
      result: "force_killed",
      metadata: {
        exitObserved: true,
        heartbeatStalledMs: NOW_MS - Date.parse("2026-07-03T05:27:00.000Z"),
        pid: 4242,
        reason: "stalled_heartbeat_after_stop_timeout",
        signal: "SIGKILL",
        stage: "wait_stopped",
      },
    });
  });

  it("does not kill and journals the skip when the heartbeat is fresh", async () => {
    const { deps, emitLifecycleEvent, killProcess } = buildDeps({
      lease: buildLease({
        heartbeatAt: new Date(NOW_MS - 5000).toISOString(),
      }),
    });

    const outcome = await forceKillStalledDaemonAfterStopTimeout(
      { stage: "stop_or_drain" },
      deps
    );

    expect(outcome.killed).toBe(false);
    expect(killProcess).not.toHaveBeenCalled();
    expect(emitLifecycleEvent).toHaveBeenCalledWith({
      type: "process_stop.action",
      result: "force_kill_skipped",
      metadata: {
        heartbeatStalledMs: 5000,
        pid: 4242,
        reason: "heartbeat_fresh",
        signal: "SIGKILL",
        stage: "stop_or_drain",
      },
    });
  });

  it("treats an already-exited process (ESRCH) as killed", async () => {
    const esrchError = Object.assign(new Error("kill ESRCH"), {
      code: "ESRCH",
    });
    const { deps } = buildDeps({
      killProcess: () => {
        throw esrchError;
      },
    });

    const outcome = await forceKillStalledDaemonAfterStopTimeout(
      { stage: "wait_stopped" },
      deps
    );

    expect(outcome.killed).toBe(true);
  });

  it("reports force_kill_failed when the kill signal cannot be sent", async () => {
    const permissionError = Object.assign(new Error("kill EPERM"), {
      code: "EPERM",
    });
    const { deps, emitLifecycleEvent } = buildDeps({
      killProcess: () => {
        throw permissionError;
      },
    });

    const outcome = await forceKillStalledDaemonAfterStopTimeout(
      { stage: "wait_stopped" },
      deps
    );

    expect(outcome.killed).toBe(false);
    expect(emitLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "process_stop.action",
        result: "force_kill_failed",
      })
    );
  });
});
