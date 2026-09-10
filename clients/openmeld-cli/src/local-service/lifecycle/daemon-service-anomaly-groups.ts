import type {
  DaemonServiceAnomalyCode,
  DaemonServiceInventory,
} from "./daemon-service-inventory";

export const DAEMON_SERVICE_FULL_ALIGNMENT_ANOMALIES =
  new Set<DaemonServiceAnomalyCode>([
    "legacy_shared_service_present",
    "version_outdated",
    "legacy_detached_runtime",
    "multiple_active_owners",
    "runtime_bundle_mismatch",
    "runtime_contract_missing",
    "runtime_contract_mismatch",
    "runtime_contract_unavailable",
    "bundle_missing",
    "bundle_content_drift",
    "bundle_id_drift",
    "bundle_version_drift",
    "bundle_lane_drift",
    "bundle_strategy_legacy",
    "bundle_provenance_drift",
    "bundle_path_invalid",
    "duplicate_owned_processes",
    "service_manager_environment_drift",
    "service_manager_startup_policy_drift",
  ]);

export const DAEMON_SERVICE_AUTO_HEAL_ANOMALIES =
  new Set<DaemonServiceAnomalyCode>([
    "runtime_stale",
    "manager_running_without_runtime",
    "service_manager_path_drift",
  ]);

export const DAEMON_SERVICE_REPAIR_ANOMALIES =
  new Set<DaemonServiceAnomalyCode>([
    "runtime_stale",
    "manager_running_without_runtime",
    "legacy_detached_runtime",
    "multiple_active_owners",
    "runtime_bundle_mismatch",
    "runtime_contract_missing",
    "runtime_contract_mismatch",
    "runtime_contract_unavailable",
    "bundle_missing",
    "bundle_content_drift",
    "bundle_id_drift",
    "bundle_version_drift",
    "bundle_lane_drift",
    "bundle_strategy_legacy",
    "bundle_provenance_drift",
    "bundle_path_invalid",
    "service_manager_path_drift",
    "service_manager_environment_drift",
    "service_manager_startup_policy_drift",
    "duplicate_owned_processes",
  ]);

export const DAEMON_SERVICE_ARTIFACT_DRIFT_ANOMALIES =
  new Set<DaemonServiceAnomalyCode>([
    "background_foreground_conflict",
    "bundle_lane_drift",
    "bundle_missing",
    "bundle_content_drift",
    "bundle_id_drift",
    "bundle_path_invalid",
    "bundle_provenance_drift",
    "bundle_strategy_legacy",
    "bundle_version_drift",
    "manager_running_without_runtime",
    "runtime_bundle_mismatch",
    "runtime_contract_missing",
    "runtime_contract_mismatch",
    "runtime_contract_unavailable",
    "runtime_stale",
    "service_manager_path_drift",
    "service_manager_environment_drift",
    "version_outdated",
  ]);

export const DAEMON_SERVICE_RUN_BLOCKING_ANOMALIES =
  new Set<DaemonServiceAnomalyCode>([
    ...[...DAEMON_SERVICE_ARTIFACT_DRIFT_ANOMALIES].filter(
      (code) =>
        code !== "runtime_stale" &&
        code !== "version_outdated" &&
        code !== "bundle_version_drift"
    ),
    "duplicate_owned_processes",
    "foreground_background_conflict",
  ]);

export const DAEMON_SERVICE_WAKEABILITY_HARD_BLOCKER_ANOMALIES =
  new Set<DaemonServiceAnomalyCode>([
    "duplicate_owned_processes",
    "manager_running_without_runtime",
    "multiple_active_owners",
    "runtime_bundle_mismatch",
    "runtime_contract_mismatch",
  ]);

export const DAEMON_SERVICE_WAKEABILITY_CONDITIONAL_ANOMALIES =
  new Set<DaemonServiceAnomalyCode>(["bundle_missing", "bundle_path_invalid"]);

export const DAEMON_SERVICE_WAKEABILITY_ADVISORY_ANOMALIES =
  new Set<DaemonServiceAnomalyCode>([
    "bundle_content_drift",
    "bundle_id_drift",
    "bundle_lane_drift",
    "bundle_provenance_drift",
    "bundle_strategy_legacy",
    "bundle_version_drift",
    "runtime_contract_missing",
    "runtime_contract_unavailable",
    "service_manager_path_drift",
    "version_outdated",
    "service_manager_startup_policy_drift",
  ]);

export type DaemonServiceWakeabilityClassification = {
  advisoryCodes: DaemonServiceAnomalyCode[];
  blockingCodes: DaemonServiceAnomalyCode[];
  blocksWake: boolean;
  conditionalCodes: DaemonServiceAnomalyCode[];
  executionEvidenceSafe: boolean;
};

export type DaemonServiceRunStartabilityClassification = {
  blockingCodes: DaemonServiceAnomalyCode[];
  blocksStart: boolean;
};

export function classifyDaemonServiceWakeability(input: {
  inventory?: DaemonServiceInventory | null;
}): DaemonServiceWakeabilityClassification {
  const anomalyCodes = collectUniqueAnomalyCodes(input.inventory);
  const executionEvidenceSafe = hasVerifiedRunningDaemonExecutionEvidence({
    anomalyCodes,
    inventory: input.inventory,
  });
  const blockingCodes: DaemonServiceAnomalyCode[] = [];
  const advisoryCodes: DaemonServiceAnomalyCode[] = [];
  const conditionalCodes: DaemonServiceAnomalyCode[] = [];

  for (const code of anomalyCodes) {
    if (DAEMON_SERVICE_WAKEABILITY_HARD_BLOCKER_ANOMALIES.has(code)) {
      blockingCodes.push(code);
      continue;
    }

    if (DAEMON_SERVICE_WAKEABILITY_CONDITIONAL_ANOMALIES.has(code)) {
      conditionalCodes.push(code);
      if (
        shouldBlockConditionalWakeabilityAnomaly({
          code,
          executionEvidenceSafe,
        })
      ) {
        blockingCodes.push(code);
      } else {
        advisoryCodes.push(code);
      }
      continue;
    }

    if (DAEMON_SERVICE_WAKEABILITY_ADVISORY_ANOMALIES.has(code)) {
      advisoryCodes.push(code);
    }
  }

  return {
    advisoryCodes,
    blockingCodes,
    blocksWake: blockingCodes.length > 0,
    conditionalCodes,
    executionEvidenceSafe,
  };
}

export function classifyDaemonServiceRunStartability(input: {
  inventory?: DaemonServiceInventory | null;
}): DaemonServiceRunStartabilityClassification {
  const anomalyCodes = collectUniqueAnomalyCodes(input.inventory);
  const executionEvidenceSafe = hasVerifiedRunningDaemonExecutionEvidence({
    anomalyCodes,
    inventory: input.inventory,
  });
  const blockingCodes = anomalyCodes.filter((code) => {
    if (!DAEMON_SERVICE_RUN_BLOCKING_ANOMALIES.has(code)) {
      return false;
    }
    return !(
      executionEvidenceSafe &&
      DAEMON_SERVICE_WAKEABILITY_ADVISORY_ANOMALIES.has(code)
    );
  });
  return {
    blockingCodes,
    blocksStart: blockingCodes.length > 0,
  };
}

function shouldBlockConditionalWakeabilityAnomaly(input: {
  code: DaemonServiceAnomalyCode;
  executionEvidenceSafe: boolean;
}): boolean {
  return !input.executionEvidenceSafe;
}

function hasVerifiedRunningDaemonExecutionEvidence(input: {
  anomalyCodes: readonly DaemonServiceAnomalyCode[];
  inventory?: DaemonServiceInventory | null;
}): boolean {
  const inventory = input.inventory;
  if (inventory?.runtimeStatus.status !== "running") {
    return false;
  }
  if (inventory.runtimeContractCompatibility?.status !== "compatible") {
    return false;
  }
  if (!hasUsableServiceContract(inventory.serviceContract)) {
    return false;
  }
  if (
    !(
      inventory.activeBundleEntryPath &&
      inventory.runtimeCommandEntryPath &&
      inventory.runtimeCommandPathExists === true
    )
  ) {
    return false;
  }
  return !input.anomalyCodes.some((code) =>
    DAEMON_SERVICE_WAKEABILITY_HARD_BLOCKER_ANOMALIES.has(code)
  );
}

function hasUsableServiceContract(
  contract: DaemonServiceInventory["serviceContract"]
): boolean {
  return Boolean(
    contract?.deviceId &&
      contract.gatewayUrl &&
      contract.lane &&
      Number.isFinite(contract.heartbeatMs) &&
      contract.heartbeatMs > 0
  );
}

function collectUniqueAnomalyCodes(
  inventory?: DaemonServiceInventory | null
): DaemonServiceAnomalyCode[] {
  const codes: DaemonServiceAnomalyCode[] = [];
  for (const anomaly of inventory?.anomalies ?? []) {
    if (!codes.includes(anomaly.code)) {
      codes.push(anomaly.code);
    }
  }
  return codes;
}
