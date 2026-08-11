import type { SystemServiceStartupFailureVerdict } from "./service-start-failure";

export const DAEMON_RUN_ALREADY_RUNNING_REASON = "already_running";

export const LEGACY_DAEMON_RUN_ALREADY_RUNNING_REASON =
  "service_already_running";

export type DaemonRunAlreadyRunningReason =
  | typeof DAEMON_RUN_ALREADY_RUNNING_REASON
  | typeof LEGACY_DAEMON_RUN_ALREADY_RUNNING_REASON;

export type DaemonRunFailureReason =
  | DaemonRunAlreadyRunningReason
  | "cancelled"
  | "cleanup_required"
  | "authentication_required"
  | "authentication_environment_mismatch"
  | "service_dependencies_unavailable"
  | "start_failed";

export type DaemonRunReason = "started" | DaemonRunFailureReason;

export type NormalizedDaemonRunReason = Exclude<
  DaemonRunReason,
  typeof LEGACY_DAEMON_RUN_ALREADY_RUNNING_REASON
>;

export type DaemonRunResult =
  | {
      ok: true;
      reason: "started" | DaemonRunAlreadyRunningReason;
    }
  | {
      ok: false;
      reason: Exclude<DaemonRunFailureReason, DaemonRunAlreadyRunningReason>;
      // Presentation-only startup-failure verdict captured before a silent
      // reinstall start discards the underlying SystemServiceStartupTimeoutError.
      // Lets callers (participation gate) rebuild the detailed BTM/crash card.
      startFailureVerdict?: SystemServiceStartupFailureVerdict | null;
    };

export function normalizeDaemonRunReason(
  reason: DaemonRunReason
): NormalizedDaemonRunReason {
  return reason === LEGACY_DAEMON_RUN_ALREADY_RUNNING_REASON
    ? DAEMON_RUN_ALREADY_RUNNING_REASON
    : reason;
}

export function isDaemonRunAlreadyRunningReason(
  reason: DaemonRunReason
): boolean {
  return normalizeDaemonRunReason(reason) === DAEMON_RUN_ALREADY_RUNNING_REASON;
}

export function createDaemonAlreadyRunningResult(): Extract<
  DaemonRunResult,
  { ok: true }
> {
  return {
    ok: true,
    reason: LEGACY_DAEMON_RUN_ALREADY_RUNNING_REASON,
  };
}
