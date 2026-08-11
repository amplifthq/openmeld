import type { DaemonServiceRuntimeStatus } from "../../config/daemon-state";
import { resolveServiceReadiness } from "../../system/service-readiness-resolver";
import type { DaemonLifecycleEvent } from "../lifecycle/daemon-lifecycle-journal";
import {
  classifyDaemonServiceRunStartability,
  classifyDaemonServiceWakeability,
} from "../lifecycle/daemon-service-anomaly-groups";
import { resolveDaemonServiceFreshnessWarning } from "../lifecycle/daemon-service-freshness";
import type {
  DaemonServiceAnomalyCode,
  DaemonServiceInventory,
} from "../lifecycle/daemon-service-inventory";
import {
  buildDaemonServiceRefreshNextStep,
  buildDaemonServiceUpdateRequiredNextStep,
  formatDaemonServiceRefreshReliabilityMessage,
  formatDaemonServiceUpdateRequiredMessage,
} from "../lifecycle/daemon-service-repair-guidance";

const STATUS_LOCK_ANOMALY_CODES = new Set<DaemonServiceAnomalyCode>([
  "foreground_background_conflict",
  "background_foreground_conflict",
  "lifecycle_locked",
]);

export type DaemonStatusAttention = {
  level: "info" | "warning";
  code:
    | "authentication_required"
    | "service_dependencies_unavailable"
    | "foreground_service_active"
    | "lifecycle_action_in_progress"
    | "service_repair_recommended"
    | "service_update_available"
    | "service_update_required";
  title: string;
  message: string;
  nextStep: string | null;
  anomalyCodes: DaemonServiceAnomalyCode[];
};

export function resolveDaemonStatusAuthenticationAttention(input: {
  latestConnectionStateEvent: DaemonLifecycleEvent | null;
}): DaemonStatusAttention | null {
  const event = input.latestConnectionStateEvent;
  if (
    event?.type !== "connection.state" ||
    event.result !== "authentication_required"
  ) {
    return null;
  }

  const authState = normalizeAuthState(event.metadata?.authState);
  return {
    level: "warning",
    code: "authentication_required",
    title: "Sign In to OpenMeld",
    message: `OpenMeld Service is running, but it cannot connect to OpenMeld because this computer is ${formatAuthenticationRequiredReason(authState)}. Wake will recover automatically after sign-in.`,
    nextStep:
      "Run `openmeld auth login`. If OpenMeld Service still cannot reconnect after sign-in, run `openmeld service repair`.",
    anomalyCodes: [],
  };
}

export function resolveDaemonStatusAttention(input: {
  inventory: DaemonServiceInventory | null;
  runtimeState: DaemonServiceRuntimeStatus | null;
}): DaemonStatusAttention | null {
  if (!input.inventory) {
    return null;
  }

  const wakeability = classifyDaemonServiceWakeability({
    inventory: input.inventory,
  });
  const startability = classifyDaemonServiceRunStartability({
    inventory: input.inventory,
  });
  const lockCodes = collectAnomalyCodes(
    input.inventory,
    STATUS_LOCK_ANOMALY_CODES
  );
  const repairCodes = dedupeAnomalyCodes([
    ...wakeability.blockingCodes,
    ...startability.blockingCodes,
  ]).filter((code) => !lockCodes.includes(code));
  if (lockCodes.length > 0 && repairCodes.length > 0) {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createStatusAttentionReplyReadiness(),
      inventory: input.inventory,
      runtimeStatus: input.runtimeState,
    });
    return {
      level: "warning",
      code: "service_repair_recommended",
      title: "OpenMeld Service Repair Paused",
      message: readiness.detailText,
      nextStep: readiness.nextStepSummary,
      anomalyCodes: dedupeAnomalyCodes([...repairCodes, ...lockCodes]),
    };
  }
  if (lockCodes.length > 0 && isForegroundRuntimeActive(input.runtimeState)) {
    return {
      level: "info",
      code: "foreground_service_active",
      title: "Foreground Service Active",
      message:
        "A foreground OpenMeld service is active on this device, so background cleanup and auto-heal stay paused to avoid fighting the live route owner.",
      nextStep:
        "No action is required. Stop the foreground service first if you want OpenMeld to resume background repair or management.",
      anomalyCodes: lockCodes,
    };
  }

  if (lockCodes.length > 0) {
    return {
      level: "info",
      code: "lifecycle_action_in_progress",
      title: "OpenMeld Service Task In Progress",
      message:
        "Another OpenMeld Service task is already running, so this status check stays read-only until it finishes.",
      nextStep:
        "Try `openmeld service status` again after the current OpenMeld Service task finishes.",
      anomalyCodes: lockCodes,
    };
  }
  if (repairCodes.length === 0) {
    const freshnessWarning = resolveDaemonServiceFreshnessWarning({
      inventory: input.inventory,
    });
    if (freshnessWarning) {
      return {
        level: freshnessWarning.level,
        code: freshnessWarning.code,
        title: freshnessWarning.title,
        message: freshnessWarning.detailText,
        nextStep: freshnessWarning.nextStep,
        anomalyCodes: freshnessWarning.anomalyCodes,
      };
    }
    return null;
  }

  const readiness = resolveServiceReadiness({
    deviceReplyReadiness: createStatusAttentionReplyReadiness(),
    inventory: input.inventory,
    runtimeStatus: input.runtimeState,
  });
  const serviceIsRunning = isRuntimeActive(input.runtimeState);
  if (isRuntimeContractUpdateRequired(repairCodes)) {
    return {
      level: "warning",
      code: "service_update_required",
      title: "Update OpenMeld Service",
      message: formatDaemonServiceUpdateRequiredMessage({
        serviceIsRunning,
      }),
      nextStep: buildDaemonServiceUpdateRequiredNextStep({
        serviceIsRunning,
      }),
      anomalyCodes: readiness.anomalyCodes.filter((code) =>
        repairCodes.includes(code)
      ),
    };
  }
  return {
    level: "warning",
    code: "service_repair_recommended",
    title: "OpenMeld Service Needs Repair",
    message: formatDaemonServiceRefreshReliabilityMessage(),
    nextStep: readiness.nextStepSummary ?? buildDaemonServiceRefreshNextStep(),
    anomalyCodes: readiness.anomalyCodes.filter((code) =>
      repairCodes.includes(code)
    ),
  };
}

function collectAnomalyCodes(
  inventory: DaemonServiceInventory,
  allowedCodes: ReadonlySet<DaemonServiceAnomalyCode>
): DaemonServiceAnomalyCode[] {
  const codes: DaemonServiceAnomalyCode[] = [];
  for (const anomaly of inventory.anomalies) {
    if (allowedCodes.has(anomaly.code) && !codes.includes(anomaly.code)) {
      codes.push(anomaly.code);
    }
  }
  return codes;
}

function isForegroundRuntimeActive(
  runtimeState: DaemonServiceRuntimeStatus | null
): boolean {
  return (
    runtimeState?.status === "running" && runtimeState.mode === "foreground"
  );
}

function isRuntimeActive(
  runtimeState: DaemonServiceRuntimeStatus | null
): boolean {
  return runtimeState?.status === "running";
}

function isRuntimeContractUpdateRequired(
  repairCodes: readonly DaemonServiceAnomalyCode[]
): boolean {
  return (
    repairCodes.length === 1 && repairCodes[0] === "runtime_contract_mismatch"
  );
}

function normalizeAuthState(value: unknown): string {
  return typeof value === "string" ? value : "unknown";
}

function formatAuthenticationRequiredReason(authState: string): string {
  switch (authState) {
    case "expired":
      return "signed in with an expired session";
    case "missing":
      return "not signed in";
    case "invalid":
      return "signed in with an invalid local session";
    case "revoked":
      return "signed in with a revoked session";
    default:
      return "not currently authenticated";
  }
}

function createStatusAttentionReplyReadiness() {
  return {
    reasonCodes: [],
    reasonText:
      "OpenMeld Service status attention is based on local service state.",
    replyReadiness: "ready" as const,
    updatedAt: new Date(0).toISOString(),
    wakeableRouteCount: 0,
  };
}

function dedupeAnomalyCodes(
  anomalyCodes: readonly DaemonServiceAnomalyCode[]
): DaemonServiceAnomalyCode[] {
  return [...new Set(anomalyCodes)];
}
