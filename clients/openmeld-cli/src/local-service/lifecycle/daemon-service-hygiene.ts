import type {
  DaemonLifecycleIntent,
  DaemonRunMode,
} from "../../config/daemon-state";
import { DAEMON_SERVICE_FULL_ALIGNMENT_ANOMALIES } from "./daemon-service-anomaly-groups";
import type {
  DaemonServiceAnomalyCode,
  DaemonServiceInventory,
} from "./daemon-service-inventory";

export type DaemonServiceDesiredState =
  | "not_installed"
  | "stopped"
  | "running_background"
  | "running_foreground";

export type DaemonServiceCleanupAction =
  | "clear_stale_runtime_state"
  | "stop_owned_processes"
  | "remove_system_service_registration"
  | "remove_runtime_artifacts"
  | "prepare_latest_bundle"
  | "repair_service_manager_registration"
  | "remove_inactive_bundles";

export type DaemonServiceCleanupPlan = {
  intent: DaemonLifecycleIntent;
  desiredState: DaemonServiceDesiredState;
  anomalies: DaemonServiceInventory["anomalies"];
  actions: DaemonServiceCleanupAction[];
  requiresConfirmation: boolean;
  autoApply: boolean;
  primaryFinding: string;
  summary: string;
};

export type DaemonServiceCleanupResult = {
  appliedActions: DaemonServiceCleanupAction[];
  forceUsed: boolean;
};

const PREPARE_LATEST_BUNDLE_ANOMALIES = new Set<DaemonServiceAnomalyCode>(
  [...DAEMON_SERVICE_FULL_ALIGNMENT_ANOMALIES].filter(
    (code) =>
      code !== "legacy_shared_service_present" &&
      code !== "legacy_detached_runtime" &&
      code !== "runtime_bundle_mismatch" &&
      code !== "duplicate_owned_processes"
  )
);

const SERVICE_FILE_REPAIR_PRIMARY_FINDING_PRIORITY: DaemonServiceAnomalyCode[] =
  [
    "service_manager_path_drift",
    "runtime_bundle_mismatch",
    ...[...PREPARE_LATEST_BUNDLE_ANOMALIES].filter(
      (code) => code !== "version_outdated"
    ),
    "version_outdated",
  ];

const SERVICE_FILE_REPAIR_ANOMALIES = new Set<DaemonServiceAnomalyCode>([
  "service_manager_path_drift",
  "runtime_bundle_mismatch",
  ...SERVICE_FILE_REPAIR_PRIMARY_FINDING_PRIORITY.filter(
    (code) =>
      code !== "service_manager_path_drift" &&
      code !== "runtime_bundle_mismatch"
  ),
]);

export function buildDaemonServiceCleanupPlan(input: {
  intent: DaemonLifecycleIntent;
  inventory: DaemonServiceInventory;
  requestedMode?: DaemonRunMode;
}): DaemonServiceCleanupPlan {
  const anomalies = input.inventory.anomalies;
  const anomalyCodes = new Set(anomalies.map((anomaly) => anomaly.code));
  const desiredState = resolveDesiredState({
    intent: input.intent,
    requestedMode: input.requestedMode,
  });
  const actions = new Set<DaemonServiceCleanupAction>();

  if (hasAnomaly(anomalyCodes, "runtime_stale")) {
    actions.add("clear_stale_runtime_state");
  }
  if (
    hasAnyAnomaly(anomalyCodes, [
      "duplicate_owned_processes",
      "foreground_background_conflict",
      "background_foreground_conflict",
      "legacy_detached_runtime",
    ])
  ) {
    actions.add("stop_owned_processes");
  }
  if (
    hasAnyAnomaly(anomalyCodes, [
      "service_manager_path_drift",
      "manager_running_without_runtime",
      "runtime_bundle_mismatch",
    ])
  ) {
    actions.add("remove_system_service_registration");
    actions.add("repair_service_manager_registration");
  }
  if (hasAnyAnomalyFromSet(anomalyCodes, PREPARE_LATEST_BUNDLE_ANOMALIES)) {
    actions.add("prepare_latest_bundle");
  }
  if (input.intent === "uninstall") {
    actions.add("stop_owned_processes");
    actions.add("remove_system_service_registration");
    actions.add("remove_runtime_artifacts");
  }
  if (input.intent === "reinstall" || input.intent === "upgrade_reconcile") {
    actions.add("stop_owned_processes");
    actions.add("remove_system_service_registration");
    actions.add("prepare_latest_bundle");
    actions.add("remove_inactive_bundles");
  }

  const requiresConfirmation =
    input.intent === "uninstall" ||
    ((input.intent === "status_cleanup" ||
      input.intent === "start" ||
      input.intent === "startup_check") &&
      actions.size > 0);
  const autoApply =
    input.intent === "reinstall" || input.intent === "upgrade_reconcile";

  return {
    intent: input.intent,
    desiredState,
    anomalies,
    actions: [...actions],
    requiresConfirmation,
    autoApply,
    primaryFinding: buildCleanupPlanPrimaryFinding({
      anomalies,
      anomalyCodes,
      desiredState,
    }),
    summary: buildCleanupPlanSummary({
      anomalyCodes,
      desiredState,
    }),
  };
}

function resolveDesiredState(input: {
  intent: DaemonLifecycleIntent;
  requestedMode?: DaemonRunMode;
}): DaemonServiceDesiredState {
  if (input.intent === "uninstall") {
    return "not_installed";
  }
  if (input.intent === "run_foreground") {
    return "running_foreground";
  }
  if (input.intent === "run_background" || input.intent === "start") {
    return "running_background";
  }
  if (input.requestedMode === "foreground") {
    return "running_foreground";
  }
  return "stopped";
}

function hasAnyAnomaly(
  anomalyCodes: Set<DaemonServiceAnomalyCode>,
  codes: DaemonServiceAnomalyCode[]
): boolean {
  return codes.some((code) => anomalyCodes.has(code));
}

function hasAnomaly(
  anomalyCodes: Set<DaemonServiceAnomalyCode>,
  code: DaemonServiceAnomalyCode
): boolean {
  return anomalyCodes.has(code);
}

function hasAnyAnomalyFromSet(
  anomalyCodes: Set<DaemonServiceAnomalyCode>,
  allowedCodes: ReadonlySet<DaemonServiceAnomalyCode>
): boolean {
  for (const code of allowedCodes) {
    if (anomalyCodes.has(code)) {
      return true;
    }
  }
  return false;
}

function buildCleanupPlanSummary(input: {
  anomalyCodes: Set<DaemonServiceAnomalyCode>;
  desiredState: DaemonServiceDesiredState;
}): string {
  if (input.desiredState === "not_installed") {
    return "OpenMeld will cleanly remove the background service from this device.";
  }
  if (hasAnomaly(input.anomalyCodes, "duplicate_owned_processes")) {
    return "OpenMeld found multiple local service processes and will clean them up before continuing.";
  }
  if (hasAnyAnomalyFromSet(input.anomalyCodes, SERVICE_FILE_REPAIR_ANOMALIES)) {
    return "OpenMeld needs to repair local service files before the background service can be trusted again.";
  }
  return "OpenMeld will bring the background service back to one healthy managed instance.";
}

function buildCleanupPlanPrimaryFinding(input: {
  anomalies: DaemonServiceInventory["anomalies"];
  anomalyCodes: Set<DaemonServiceAnomalyCode>;
  desiredState: DaemonServiceDesiredState;
}): string {
  const preferredCodes = resolvePrimaryFindingCodes(input);
  for (const code of preferredCodes) {
    const match = input.anomalies.find((anomaly) => anomaly.code === code);
    if (match) {
      return match.message;
    }
  }
  return (
    input.anomalies[0]?.message ??
    buildCleanupPlanSummary({
      anomalyCodes: input.anomalyCodes,
      desiredState: input.desiredState,
    })
  );
}

function resolvePrimaryFindingCodes(input: {
  anomalyCodes: Set<DaemonServiceAnomalyCode>;
  desiredState: DaemonServiceDesiredState;
}): DaemonServiceAnomalyCode[] {
  if (input.desiredState === "not_installed") {
    return ["not_installed"];
  }
  if (hasAnomaly(input.anomalyCodes, "duplicate_owned_processes")) {
    return ["duplicate_owned_processes"];
  }
  if (hasAnyAnomalyFromSet(input.anomalyCodes, SERVICE_FILE_REPAIR_ANOMALIES)) {
    return SERVICE_FILE_REPAIR_PRIMARY_FINDING_PRIORITY;
  }
  return [
    "runtime_stale",
    "manager_running_without_runtime",
    "legacy_detached_runtime",
    "foreground_background_conflict",
    "background_foreground_conflict",
    "lifecycle_locked",
    "downgrade_blocked",
  ];
}
