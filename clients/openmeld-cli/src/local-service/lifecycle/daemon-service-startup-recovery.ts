import type { DaemonServiceAnomalyCode } from "./daemon-service-inventory";

const STARTUP_RECOVERY_ANOMALIES = new Set<DaemonServiceAnomalyCode>([
  "bundle_content_drift",
  "bundle_id_drift",
  "bundle_lane_drift",
  "bundle_missing",
  "bundle_path_invalid",
  "bundle_provenance_drift",
  "bundle_strategy_legacy",
  "bundle_version_drift",
  "manager_running_without_runtime",
  "runtime_bundle_mismatch",
  "runtime_contract_mismatch",
  "runtime_contract_missing",
  "runtime_contract_unavailable",
  "runtime_stale",
  "service_manager_path_drift",
  "version_outdated",
]);

export type DaemonServiceStartupRecoveryDecision =
  | {
      shouldAttempt: true;
      reasonCodes: DaemonServiceAnomalyCode[];
    }
  | {
      shouldAttempt: false;
      reason: "already_attempted" | "no_recoverable_anomalies";
      reasonCodes: DaemonServiceAnomalyCode[];
    };

export function resolveDaemonServiceStartupRecoveryDecision(input: {
  alreadyAttempted?: boolean;
  anomalyCodes: readonly DaemonServiceAnomalyCode[];
}): DaemonServiceStartupRecoveryDecision {
  const reasonCodes = uniqueCodes(
    input.anomalyCodes.filter((code) => STARTUP_RECOVERY_ANOMALIES.has(code))
  );

  if (input.alreadyAttempted) {
    return {
      shouldAttempt: false,
      reason: "already_attempted",
      reasonCodes,
    };
  }

  if (reasonCodes.length === 0) {
    return {
      shouldAttempt: false,
      reason: "no_recoverable_anomalies",
      reasonCodes,
    };
  }

  return {
    shouldAttempt: true,
    reasonCodes,
  };
}

function uniqueCodes(
  codes: readonly DaemonServiceAnomalyCode[]
): DaemonServiceAnomalyCode[] {
  return [...new Set(codes)];
}
