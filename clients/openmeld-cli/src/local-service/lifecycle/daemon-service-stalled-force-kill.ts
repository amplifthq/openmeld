import process from "node:process";
import type { DaemonRuntimeLease } from "@openmeld/schemas/types";
import { sleep } from "@openmeld/utils";
import { readDaemonRuntimeLease } from "../../config/daemon-runtime-lease";
import { emitDaemonLifecycleEvent } from "./daemon-lifecycle-journal";
import type { DaemonOwnedProcess } from "./daemon-service-process-inventory";
import { listDaemonOwnedProcesses } from "./daemon-service-process-inventory";

// Minimum runtime-lease heartbeat stall before the lifecycle stop path may
// escalate a SIGTERM timeout to SIGKILL. The carrier refreshes the lease
// heartbeat every few seconds while its run loop is alive, and the runtime
// observer already treats the lease as stale after DAEMON_HEARTBEAT_STALE_MS
// (3 minutes); ten minutes is more than three full stale windows on top of
// that, so a stall this long means the run loop is wedged, not busy.
export const FORCE_KILL_MIN_HEARTBEAT_STALL_MS = 10 * 60 * 1000;

const FORCE_KILL_EXIT_WAIT_MS = 2000;
const FORCE_KILL_EXIT_POLL_MS = 100;

export type StalledDaemonForceKillSkipReason =
  | "runtime_lease_missing"
  | "lease_pid_invalid"
  | "lease_pid_not_owned"
  | "foreground_process"
  | "heartbeat_unparseable"
  | "heartbeat_fresh";

export type StalledDaemonForceKillVerdict =
  | {
      decision: "force_kill";
      pid: number;
      heartbeatStalledMs: number;
    }
  | {
      decision: "skip";
      reason: StalledDaemonForceKillSkipReason;
      pid: number | null;
      heartbeatStalledMs: number | null;
    };

// Safety boundary for escalating a stop to SIGKILL. Force-kill fires only when
// BOTH hold:
//
// 1. The user (or setup/repair acting on the user's explicit request) asked
//    the lifecycle to stop this daemon and the graceful SIGTERM window
//    already elapsed. This is never a background reaper.
// 2. The daemon's runtime lease heartbeat has been stalled for at least
//    FORCE_KILL_MIN_HEARTBEAT_STALL_MS. The carrier cannot accept, run, or
//    report Wake work without its run loop, and the same run loop owns the
//    heartbeat, so a stalled heartbeat is direct evidence that no in-flight
//    Wake execution can be making progress on this process (pre-0.7.99
//    daemons sleeping through SIGTERM inside an uninterruptible reconnect
//    backoff are the motivating production case).
//
// This does not conflict with the "a running execution must not be failed by
// a fixed wall-clock timeout while fresh lifecycle/progress evidence arrives"
// guardrail: the trigger here is the absence of the daemon's own liveness
// evidence combined with an explicit user stop request, not elapsed time on a
// live execution. A daemon with a fresh heartbeat is never force-killed; the
// caller falls back to the existing bounded-failure path instead. Heartbeat
// staleness is used purely as local stop-safety evidence and must not feed
// any liveness/readiness/availability projection.
export function resolveStalledDaemonForceKillVerdict(input: {
  nowMs: number;
  ownedProcesses: readonly DaemonOwnedProcess[];
  runtimeLease: DaemonRuntimeLease | null;
}): StalledDaemonForceKillVerdict {
  const lease = input.runtimeLease;
  if (!lease) {
    return {
      decision: "skip",
      reason: "runtime_lease_missing",
      pid: null,
      heartbeatStalledMs: null,
    };
  }
  if (!Number.isInteger(lease.pid) || lease.pid <= 0) {
    return {
      decision: "skip",
      reason: "lease_pid_invalid",
      pid: null,
      heartbeatStalledMs: null,
    };
  }
  // Never signal a pid the process inventory does not attribute to an
  // OpenMeld-owned daemon: the lease can outlive its process and the pid can be
  // recycled by the OS.
  const ownedProcess = input.ownedProcesses.find(
    (candidate) =>
      candidate.pid === lease.pid && candidate.ownership !== "unknown"
  );
  if (!ownedProcess) {
    return {
      decision: "skip",
      reason: "lease_pid_not_owned",
      pid: lease.pid,
      heartbeatStalledMs: null,
    };
  }
  // Foreground runs belong to an interactive terminal session; they are not
  // stop candidates for the lifecycle either (see
  // resolveSafeOwnedProcessStopCandidates) and stay out of force-kill scope.
  if (ownedProcess.mode === "foreground") {
    return {
      decision: "skip",
      reason: "foreground_process",
      pid: lease.pid,
      heartbeatStalledMs: null,
    };
  }
  const freshnessTimestamp = lease.heartbeatAt ?? lease.updatedAt;
  const heartbeatMs = Date.parse(freshnessTimestamp);
  if (Number.isNaN(heartbeatMs)) {
    // Fail closed: without parseable heartbeat evidence the stall cannot be
    // proven, so the caller keeps the existing failure path.
    return {
      decision: "skip",
      reason: "heartbeat_unparseable",
      pid: lease.pid,
      heartbeatStalledMs: null,
    };
  }
  const heartbeatStalledMs = input.nowMs - heartbeatMs;
  if (heartbeatStalledMs < FORCE_KILL_MIN_HEARTBEAT_STALL_MS) {
    return {
      decision: "skip",
      reason: "heartbeat_fresh",
      pid: lease.pid,
      heartbeatStalledMs,
    };
  }
  return {
    decision: "force_kill",
    pid: lease.pid,
    heartbeatStalledMs,
  };
}

export type StalledDaemonForceKillOutcome = {
  killed: boolean;
  verdict: StalledDaemonForceKillVerdict;
};

type StalledDaemonForceKillDeps = {
  emitLifecycleEvent: typeof emitDaemonLifecycleEvent;
  killProcess: (pid: number, signal: NodeJS.Signals) => void;
  listOwnedProcesses: () => Promise<readonly DaemonOwnedProcess[]>;
  nowMs: () => number;
  readRuntimeLease: () => Promise<DaemonRuntimeLease | null>;
  waitForProcessExit: (pid: number) => Promise<boolean>;
};

const defaultStalledDaemonForceKillDeps: StalledDaemonForceKillDeps = {
  emitLifecycleEvent: emitDaemonLifecycleEvent,
  killProcess: (pid, signal) => process.kill(pid, signal),
  listOwnedProcesses: async () =>
    await listDaemonOwnedProcesses({
      ignoreProcessIds: [process.pid, process.ppid].filter(
        (pid): pid is number => Number.isInteger(pid) && pid > 0
      ),
    }),
  nowMs: () => Date.now(),
  readRuntimeLease: async () => await readDaemonRuntimeLease(),
  waitForProcessExit: async (pid) => {
    const deadline = Date.now() + FORCE_KILL_EXIT_WAIT_MS;
    while (Date.now() < deadline) {
      if (!isPidAlive(pid)) {
        return true;
      }
      await sleep(FORCE_KILL_EXIT_POLL_MS);
    }
    return !isPidAlive(pid);
  },
};

// Last-resort stop escalation for a daemon that ignored SIGTERM through the
// bounded stop window. Old daemons (before the interruptible reconnect
// backoff) park in `sleep(backoffMs)` for up to 15 minutes and only then
// observe the stop flag, which is far longer than any lifecycle stop window;
// without this fallback, setup/repair on such a machine can never succeed.
// Every decision (kill or skip) lands in the lifecycle journal.
export async function forceKillStalledDaemonAfterStopTimeout(
  input: {
    stage: "stop_or_drain" | "wait_stopped";
  },
  deps: StalledDaemonForceKillDeps = defaultStalledDaemonForceKillDeps
): Promise<StalledDaemonForceKillOutcome> {
  const [runtimeLease, ownedProcesses] = await Promise.all([
    deps.readRuntimeLease().catch(() => null),
    deps.listOwnedProcesses().catch((): readonly DaemonOwnedProcess[] => []),
  ]);
  const verdict = resolveStalledDaemonForceKillVerdict({
    nowMs: deps.nowMs(),
    ownedProcesses,
    runtimeLease,
  });
  if (verdict.decision === "skip") {
    await deps.emitLifecycleEvent({
      type: "process_stop.action",
      result: "force_kill_skipped",
      metadata: {
        heartbeatStalledMs: verdict.heartbeatStalledMs,
        pid: verdict.pid,
        reason: verdict.reason,
        signal: "SIGKILL",
        stage: input.stage,
      },
    });
    return { killed: false, verdict };
  }
  try {
    deps.killProcess(verdict.pid, "SIGKILL");
  } catch (error) {
    if (!isProcessGoneError(error)) {
      await deps.emitLifecycleEvent({
        type: "process_stop.action",
        result: "force_kill_failed",
        metadata: {
          errorMessage: error instanceof Error ? error.message : String(error),
          heartbeatStalledMs: verdict.heartbeatStalledMs,
          pid: verdict.pid,
          reason: "stalled_heartbeat_after_stop_timeout",
          signal: "SIGKILL",
          stage: input.stage,
        },
      });
      return { killed: false, verdict };
    }
  }
  const exited = await deps.waitForProcessExit(verdict.pid);
  await deps.emitLifecycleEvent({
    type: "process_stop.action",
    result: "force_killed",
    metadata: {
      exitObserved: exited,
      heartbeatStalledMs: verdict.heartbeatStalledMs,
      pid: verdict.pid,
      reason: "stalled_heartbeat_after_stop_timeout",
      signal: "SIGKILL",
      stage: input.stage,
    },
  });
  return { killed: true, verdict };
}

function isProcessGoneError(error: unknown): boolean {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === "ESRCH"
  );
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    );
  }
}
