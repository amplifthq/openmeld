import type { DaemonServiceRuntimeStatus } from "../config/daemon-state";
import {
  classifyDaemonServiceWakeability,
  DAEMON_SERVICE_WAKEABILITY_ADVISORY_ANOMALIES,
  DAEMON_SERVICE_WAKEABILITY_CONDITIONAL_ANOMALIES,
  DAEMON_SERVICE_WAKEABILITY_HARD_BLOCKER_ANOMALIES,
} from "../local-service/lifecycle/daemon-service-anomaly-groups";
import {
  resolveDaemonServiceFreshnessWarning,
  resolveDaemonServiceFreshnessWarningForAnomalyCodes,
} from "../local-service/lifecycle/daemon-service-freshness";
import type {
  DaemonServiceAnomalyCode,
  DaemonServiceInventory,
} from "../local-service/lifecycle/daemon-service-inventory";
import {
  buildDaemonServiceRefreshBlockedMessage,
  buildDaemonServiceRefreshBlockedNextStep,
  buildDaemonServiceRefreshReadinessDetail,
  buildDaemonServiceRepairGuidance,
  buildDaemonServiceUpdateRequiredNextStep,
  formatDaemonServiceRefreshReliabilityMessage,
  formatDaemonServiceUpdateRequiredMessage,
} from "../local-service/lifecycle/daemon-service-repair-guidance";
import {
  formatOpenMeldCliCommand,
  formatOpenMeldCliCommands,
} from "../runtime/cli-entry-command";
import { resolveGatewayChainRepairGuidance } from "./gateway-chain-readiness";
import type {
  DeviceReplyReadinessStatus,
  ReplyReadinessReasonCode,
} from "./reply-readiness";

export type ServiceReadinessState =
  | "ready"
  | "update_available"
  | "refresh_needed"
  | "refresh_blocked"
  | "not_installed"
  | "not_running"
  | "local_repair_needed"
  | "profile_required"
  | "unknown";

export type ServiceRuntimeHeadline =
  | "running"
  | "stale"
  | "not running"
  | "unknown";

export type ServiceReadinessProjection = {
  anomalyCodes: DaemonServiceAnomalyCode[];
  detailText: string;
  nextStepSummary: string | null;
  nextSteps: string[];
  reasonCodes: ReplyReadinessReasonCode[];
  runtimeHeadline: ServiceRuntimeHeadline;
  state: ServiceReadinessState;
  summaryText: string;
};

export type ServiceReadinessServiceStatus =
  | {
      expectedVersion: string;
      installedVersion: string | null;
      kind: "ready";
      runtimeStatus: DaemonServiceRuntimeStatus["status"];
      advisoryAnomalyCodes?: DaemonServiceAnomalyCode[];
    }
  | {
      expectedVersion: string;
      kind: "missing";
    }
  | {
      expectedVersion: string;
      installedVersion: string;
      kind: "outdated";
    }
  | {
      expectedVersion: string;
      installedVersion: string | null;
      kind: "not_running";
      runtimeStatus: DaemonServiceRuntimeStatus["status"] | null;
    }
  | {
      anomalyCodes: string[];
      detail: string;
      expectedVersion: string;
      installedVersion: string | null;
      kind: "needs_repair";
      runtimeStatus: DaemonServiceRuntimeStatus["status"] | null;
    }
  | {
      detail: string;
      kind: "inspection_failed" | "repair_blocked" | "repair_failed";
    };

const SERVICE_LOCK_ANOMALY_CODES = new Set<DaemonServiceAnomalyCode>([
  "foreground_background_conflict",
  "background_foreground_conflict",
  "lifecycle_locked",
]);

const LOCAL_REPAIR_REASON_CODES = new Set<ReplyReadinessReasonCode>([
  "projection.missing",
  "controller.launch.needs_repair",
  "workspace.missing",
  "workspace.invalid",
]);

const SERVICE_DIAGNOSTIC_ONLY_ANOMALY_CODES = new Set<DaemonServiceAnomalyCode>(
  ["bundle_content_drift", "bundle_version_drift", "version_outdated"]
);

export function resolveServiceReadiness(input: {
  deviceReplyReadiness: DeviceReplyReadinessStatus;
  inventory?: DaemonServiceInventory | null;
  profileRequired?: boolean;
  runtimeStatus?: DaemonServiceRuntimeStatus | null;
}): ServiceReadinessProjection {
  const reasonCodes = input.deviceReplyReadiness.reasonCodes;
  const anomalyCodes = collectServiceAnomalyCodes(input.inventory);
  const freshnessWarning = resolveDaemonServiceFreshnessWarning({
    inventory: input.inventory,
  });
  const wakeabilityClassification = classifyDaemonServiceWakeability({
    inventory: input.inventory,
  });
  const repairAnomalyCodes = wakeabilityClassification.blockingCodes;
  const lockAnomalyCodes = anomalyCodes.filter((code) =>
    SERVICE_LOCK_ANOMALY_CODES.has(code)
  );
  const runtimeHeadline = resolveServiceRuntimeHeadline(input.runtimeStatus);

  if (input.profileRequired) {
    return {
      anomalyCodes,
      detailText: "Choose an Agent Profile to check local service readiness.",
      nextStepSummary: "Choose an Agent Profile, then run this command again.",
      nextSteps: [],
      reasonCodes,
      runtimeHeadline,
      state: "profile_required",
      summaryText: "Choose an Agent Profile",
    };
  }

  if (repairAnomalyCodes.length > 0 && lockAnomalyCodes.length > 0) {
    const reason =
      input.runtimeStatus?.status === "running" &&
      input.runtimeStatus.mode === "foreground"
        ? "foreground_service_active"
        : "lifecycle_action_in_progress";
    return {
      anomalyCodes,
      detailText: buildDaemonServiceRefreshBlockedMessage({ reason }),
      nextStepSummary: buildDaemonServiceRefreshBlockedNextStep({ reason }),
      nextSteps: [],
      reasonCodes,
      runtimeHeadline,
      state: "refresh_blocked",
      summaryText: "Repair paused",
    };
  }

  if (
    reasonCodes.includes("service.drifted") ||
    repairAnomalyCodes.length > 0
  ) {
    if (isRuntimeContractUpdateRequired(repairAnomalyCodes)) {
      return createRuntimeContractUpdateRequiredProjection({
        anomalyCodes,
        reasonCodes,
        runtimeHeadline,
      });
    }
    const guidance = buildDaemonServiceRepairGuidance();
    return {
      anomalyCodes,
      detailText: buildDaemonServiceRefreshReadinessDetail(),
      nextStepSummary: guidance.summary,
      nextSteps: guidance.nextSteps,
      reasonCodes,
      runtimeHeadline,
      state: "refresh_needed",
      summaryText: "Needs repair",
    };
  }

  if (reasonCodes.includes("service.not_installed")) {
    const nextSteps = formatOpenMeldCliCommands(["openmeld setup"]);
    return {
      anomalyCodes,
      detailText: input.deviceReplyReadiness.reasonText,
      nextStepSummary: `Run \`${nextSteps[0]}\` to connect OpenMeld Service.`,
      nextSteps,
      reasonCodes,
      runtimeHeadline,
      state: "not_installed",
      summaryText: "Not installed",
    };
  }

  if (reasonCodes.includes("service.not_running")) {
    const nextSteps = formatOpenMeldCliCommands(["openmeld setup"]);
    return {
      anomalyCodes,
      detailText: input.deviceReplyReadiness.reasonText,
      nextStepSummary: `Run \`${nextSteps[0]}\` to reconnect OpenMeld Service.`,
      nextSteps,
      reasonCodes,
      runtimeHeadline,
      state: "not_running",
      summaryText: "Not running",
    };
  }

  if (reasonCodes.includes("service.gateway_chain_unhealthy")) {
    const guidance = resolveGatewayChainRepairGuidance({});
    return {
      anomalyCodes,
      detailText: input.deviceReplyReadiness.reasonText,
      nextStepSummary: guidance.summary,
      nextSteps: guidance.nextSteps,
      reasonCodes,
      runtimeHeadline,
      state: "local_repair_needed",
      summaryText: "Needs repair",
    };
  }

  if (reasonCodes.includes("dispatch.storage_not_ready")) {
    const guidance = resolveGatewayChainRepairGuidance({
      failureKind: "dispatch_storage_not_ready",
    });
    return {
      anomalyCodes,
      detailText: input.deviceReplyReadiness.reasonText,
      nextStepSummary: guidance.summary,
      nextSteps: guidance.nextSteps,
      reasonCodes,
      runtimeHeadline,
      state: "unknown",
      summaryText: "OpenMeld cloud temporarily unavailable",
    };
  }

  if (reasonCodes.some((code) => LOCAL_REPAIR_REASON_CODES.has(code))) {
    const nextSteps: [string] = [
      formatOpenMeldCliCommand("openmeld doctor --repair"),
    ];
    return {
      anomalyCodes,
      detailText: input.deviceReplyReadiness.reasonText,
      nextStepSummary: `Run \`${nextSteps[0]}\`, then retry.`,
      nextSteps,
      reasonCodes,
      runtimeHeadline,
      state: "local_repair_needed",
      summaryText: "Needs repair",
    };
  }

  if (reasonCodes.includes("local_agents.none_needed")) {
    const nextSteps = formatOpenMeldCliCommands(["openmeld setup"]);
    return {
      anomalyCodes,
      detailText: input.deviceReplyReadiness.reasonText,
      nextStepSummary: `If you later bring local agents from this device into a space, run \`${nextSteps[0]}\`.`,
      nextSteps,
      reasonCodes,
      runtimeHeadline,
      state: "unknown",
      summaryText: "Not needed for this action",
    };
  }

  if (input.deviceReplyReadiness.replyReadiness === "ready") {
    if (freshnessWarning) {
      return createServiceStatusProjection({
        anomalyCodes,
        detailText: freshnessWarning.detailText,
        nextStepSummary: freshnessWarning.nextStep,
        nextSteps: freshnessWarning.nextSteps,
        reasonCodes,
        runtimeHeadline,
        state: "update_available",
        summaryText: freshnessWarning.summaryText,
      });
    }
    return {
      anomalyCodes,
      detailText:
        "OpenMeld Service is running and the local service link is available on this device",
      nextStepSummary: null,
      nextSteps: [],
      reasonCodes,
      runtimeHeadline,
      state: "ready",
      summaryText: "Running",
    };
  }

  const nextSteps: [string] = [
    formatOpenMeldCliCommand("openmeld service status"),
  ];
  return {
    anomalyCodes,
    detailText: input.deviceReplyReadiness.reasonText,
    nextStepSummary: `Run \`${nextSteps[0]}\` to inspect OpenMeld Service on this device.`,
    nextSteps,
    reasonCodes,
    runtimeHeadline,
    state: "unknown",
    summaryText: "Unknown",
  };
}

export function resolveServiceReadinessFromServiceStatus(
  serviceStatus: ServiceReadinessServiceStatus
): ServiceReadinessProjection {
  const runtimeHeadline =
    resolveRuntimeHeadlineFromServiceStatus(serviceStatus);

  if (serviceStatus.kind === "ready") {
    const freshnessProjection = createServiceFreshnessProjection({
      anomalyCodes: serviceStatus.advisoryAnomalyCodes ?? [],
      runtimeHeadline,
    });
    if (freshnessProjection) {
      return freshnessProjection;
    }
    return createServiceStatusProjection({
      detailText: "OpenMeld Service is running on this device.",
      nextStepSummary: null,
      nextSteps: [],
      runtimeHeadline,
      state: "ready",
      summaryText: "Running",
    });
  }

  if (serviceStatus.kind === "missing") {
    const nextSteps = formatOpenMeldCliCommands(["openmeld setup"]);
    return createServiceStatusProjection({
      detailText: "OpenMeld Service is not installed on this device.",
      nextStepSummary:
        "Run `openmeld setup` to connect OpenMeld Service for local Wake work.",
      nextSteps,
      runtimeHeadline,
      state: "not_installed",
      summaryText: "Not installed",
    });
  }

  if (serviceStatus.kind === "outdated") {
    return createServiceStatusProjection({
      anomalyCodes: ["version_outdated"],
      detailText: "OpenMeld Service version is older than this CLI.",
      nextStepSummary: "Run `openmeld setup` to update OpenMeld Service.",
      nextSteps: [formatOpenMeldCliCommand("openmeld setup")],
      runtimeHeadline,
      state: "update_available",
      summaryText: "Update OpenMeld Service",
    });
  }

  if (serviceStatus.kind === "not_running") {
    const nextSteps: [string] = [formatOpenMeldCliCommand("openmeld setup")];
    return createServiceStatusProjection({
      detailText: "OpenMeld Service is installed but not running.",
      nextStepSummary:
        "Run `openmeld setup` to reconnect OpenMeld Service for local Wake work.",
      nextSteps,
      runtimeHeadline,
      state: "not_running",
      summaryText: "Not running",
    });
  }

  if (serviceStatus.kind === "needs_repair") {
    const anomalyCodes = normalizeServiceAnomalyCodes(
      serviceStatus.anomalyCodes
    );
    if (isRuntimeContractUpdateRequired(anomalyCodes)) {
      return createRuntimeContractUpdateRequiredProjection({
        anomalyCodes,
        reasonCodes: [],
        runtimeHeadline,
      });
    }
    if (
      anomalyCodes.length > 0 &&
      shouldTreatServiceStatusAnomaliesAsDiagnosticOnly({
        anomalyCodes,
        runtimeHeadline,
      })
    ) {
      return createServiceDiagnosticEvidenceProjection({
        anomalyCodes,
        runtimeHeadline,
      });
    }
    const guidance = buildDaemonServiceRepairGuidance();
    return createServiceStatusProjection({
      anomalyCodes,
      detailText: formatDaemonServiceRefreshReliabilityMessage(),
      nextStepSummary: guidance.summary,
      nextSteps: guidance.nextSteps,
      runtimeHeadline,
      state: "refresh_needed",
      summaryText: "Needs repair",
    });
  }

  if (serviceStatus.kind === "repair_blocked") {
    return createServiceStatusProjection({
      detailText:
        "OpenMeld Service needs manual repair before OpenMeld can align it automatically.",
      nextStepSummary: buildDaemonServiceRefreshBlockedNextStep({
        reason: "lifecycle_action_in_progress",
      }),
      nextSteps: formatOpenMeldCliCommands(["openmeld service repair"]),
      runtimeHeadline,
      state: "refresh_blocked",
      summaryText: "Repair paused",
    });
  }

  if (serviceStatus.kind === "repair_failed") {
    const guidance = buildDaemonServiceRepairGuidance();
    return createServiceStatusProjection({
      detailText:
        "OpenMeld tried to repair OpenMeld Service automatically, but the service still needs attention.",
      nextStepSummary: guidance.summary,
      nextSteps: guidance.nextSteps,
      runtimeHeadline,
      state: "refresh_needed",
      summaryText: "Needs repair",
    });
  }

  return createServiceStatusProjection({
    detailText: "OpenMeld could not inspect OpenMeld Service on this device.",
    nextStepSummary:
      "Run `openmeld service status` first. If OpenMeld still cannot inspect the service, run `openmeld service repair`.",
    nextSteps: formatOpenMeldCliCommands([
      "openmeld service status",
      "openmeld service repair",
    ]),
    runtimeHeadline,
    state: "unknown",
    summaryText: "Unknown",
  });
}

export function resolveServiceRuntimeHeadline(
  runtimeStatus: DaemonServiceRuntimeStatus | null | undefined
): ServiceRuntimeHeadline {
  if (!runtimeStatus) {
    return "unknown";
  }
  if (runtimeStatus.status === "running") {
    return "running";
  }
  if (runtimeStatus.status === "stale") {
    return "stale";
  }
  if (runtimeStatus.status === "not_running") {
    return "not running";
  }
  return "unknown";
}

function collectServiceAnomalyCodes(
  inventory: DaemonServiceInventory | null | undefined
): DaemonServiceAnomalyCode[] {
  if (!inventory) {
    return [];
  }
  const codes: DaemonServiceAnomalyCode[] = [];
  for (const anomaly of inventory.anomalies) {
    if (!codes.includes(anomaly.code)) {
      codes.push(anomaly.code);
    }
  }
  return codes;
}

function resolveRuntimeHeadlineFromServiceStatus(
  serviceStatus: ServiceReadinessServiceStatus
): ServiceRuntimeHeadline {
  if (!("runtimeStatus" in serviceStatus)) {
    return "unknown";
  }
  return resolveRuntimeHeadlineFromStatus(serviceStatus.runtimeStatus);
}

function resolveRuntimeHeadlineFromStatus(
  status: DaemonServiceRuntimeStatus["status"] | null | undefined
): ServiceRuntimeHeadline {
  if (status === "running") {
    return "running";
  }
  if (status === "stale") {
    return "stale";
  }
  if (status === "not_running") {
    return "not running";
  }
  return "unknown";
}

function createServiceDiagnosticEvidenceProjection(input: {
  anomalyCodes?: DaemonServiceAnomalyCode[];
  runtimeHeadline: ServiceRuntimeHeadline;
}): ServiceReadinessProjection {
  const freshnessProjection = createServiceFreshnessProjection(input);
  if (freshnessProjection) {
    return freshnessProjection;
  }
  const nextSteps: [string] = [
    formatOpenMeldCliCommand("openmeld service status"),
  ];
  return createServiceStatusProjection({
    anomalyCodes: input.anomalyCodes,
    detailText:
      "OpenMeld Service is installed. CLI version and service file differences are diagnostic unless service compatibility fails.",
    nextStepSummary:
      "Run `openmeld service status` to inspect OpenMeld Service on this device.",
    nextSteps,
    runtimeHeadline: input.runtimeHeadline,
    state: "unknown",
    summaryText: "Installed",
  });
}

function createServiceFreshnessProjection(input: {
  anomalyCodes?: DaemonServiceAnomalyCode[];
  runtimeHeadline: ServiceRuntimeHeadline;
}): ServiceReadinessProjection | null {
  if (input.runtimeHeadline !== "running") {
    return null;
  }
  const warning = resolveDaemonServiceFreshnessWarningForAnomalyCodes({
    anomalyCodes: input.anomalyCodes ?? [],
  });
  if (!warning) {
    return null;
  }
  return createServiceStatusProjection({
    anomalyCodes: warning.anomalyCodes,
    detailText: warning.detailText,
    nextStepSummary: warning.nextStep,
    nextSteps: warning.nextSteps,
    runtimeHeadline: input.runtimeHeadline,
    state: "update_available",
    summaryText: warning.summaryText,
  });
}

function createRuntimeContractUpdateRequiredProjection(input: {
  anomalyCodes?: DaemonServiceAnomalyCode[];
  reasonCodes: ReplyReadinessReasonCode[];
  runtimeHeadline: ServiceRuntimeHeadline;
}): ServiceReadinessProjection {
  const nextSteps: [string] = [formatOpenMeldCliCommand("openmeld setup")];
  const serviceIsRunning = input.runtimeHeadline === "running";
  return createServiceStatusProjection({
    anomalyCodes: input.anomalyCodes,
    detailText: formatDaemonServiceUpdateRequiredMessage({
      serviceIsRunning,
    }),
    nextStepSummary: buildDaemonServiceUpdateRequiredNextStep({
      serviceIsRunning,
    }),
    nextSteps,
    reasonCodes: input.reasonCodes,
    runtimeHeadline: input.runtimeHeadline,
    state: "refresh_needed",
    summaryText: "Update OpenMeld Service",
  });
}

function createServiceStatusProjection(input: {
  anomalyCodes?: DaemonServiceAnomalyCode[];
  detailText: string;
  nextStepSummary: string | null;
  nextSteps: string[];
  reasonCodes?: ReplyReadinessReasonCode[];
  runtimeHeadline: ServiceRuntimeHeadline;
  state: ServiceReadinessState;
  summaryText: string;
}): ServiceReadinessProjection {
  return {
    anomalyCodes: input.anomalyCodes ?? [],
    detailText: input.detailText,
    nextStepSummary: input.nextStepSummary,
    nextSteps: input.nextSteps,
    reasonCodes: input.reasonCodes ?? [],
    runtimeHeadline: input.runtimeHeadline,
    state: input.state,
    summaryText: input.summaryText,
  };
}

function isRuntimeContractUpdateRequired(
  anomalyCodes: readonly DaemonServiceAnomalyCode[]
): boolean {
  return (
    anomalyCodes.length === 1 && anomalyCodes[0] === "runtime_contract_mismatch"
  );
}

function shouldTreatServiceStatusAnomaliesAsDiagnosticOnly(input: {
  anomalyCodes: readonly DaemonServiceAnomalyCode[];
  runtimeHeadline: ServiceRuntimeHeadline;
}): boolean {
  return input.anomalyCodes.every((code) => {
    if (code === "bundle_content_drift") {
      return input.runtimeHeadline === "running";
    }
    return SERVICE_DIAGNOSTIC_ONLY_ANOMALY_CODES.has(code);
  });
}

function normalizeServiceAnomalyCodes(
  anomalyCodes: readonly string[]
): DaemonServiceAnomalyCode[] {
  const normalized: DaemonServiceAnomalyCode[] = [];
  for (const code of anomalyCodes) {
    const serviceCode = code as DaemonServiceAnomalyCode;
    if (
      (DAEMON_SERVICE_WAKEABILITY_HARD_BLOCKER_ANOMALIES.has(serviceCode) ||
        DAEMON_SERVICE_WAKEABILITY_CONDITIONAL_ANOMALIES.has(serviceCode) ||
        DAEMON_SERVICE_WAKEABILITY_ADVISORY_ANOMALIES.has(serviceCode) ||
        SERVICE_LOCK_ANOMALY_CODES.has(serviceCode)) &&
      !normalized.includes(serviceCode)
    ) {
      normalized.push(serviceCode);
    }
  }
  return normalized;
}
