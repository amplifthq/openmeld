import {
  type OpenMeldEnvironmentTarget,
  resolveOpenMeldEnvironmentTargetFromEnv,
} from "../../config/openmeld-environment-target";
import {
  type OpenMeldDistribution,
  resolveOpenMeldDistribution,
} from "../../runtime/distribution";
import {
  DAEMON_SERVICE_AUTO_HEAL_ANOMALIES,
  DAEMON_SERVICE_FULL_ALIGNMENT_ANOMALIES,
} from "./daemon-service-anomaly-groups";
import type { DaemonBundleFormat } from "./daemon-service-bundle";
import type {
  DaemonServiceAnomalyCode,
  DaemonServiceInventory,
} from "./daemon-service-inventory";
import { resolveVersionChangeDirection } from "./version-change-direction";

const BLOCKED_ALIGNMENT_ANOMALIES = new Set<DaemonServiceAnomalyCode>([
  "downgrade_blocked",
  "foreground_background_conflict",
  "background_foreground_conflict",
  "lifecycle_locked",
]);

export type DaemonServiceTargetSpec = {
  daemonVersion: string;
  bundleFormat: DaemonBundleFormat;
  environmentTarget: OpenMeldEnvironmentTarget;
};

export type DaemonServiceAlignmentDecision = {
  status:
    | "already_aligned"
    | "not_installed"
    | "needs_auto_heal"
    | "needs_full_alignment"
    | "blocked";
  target: DaemonServiceTargetSpec;
  reasonCodes: DaemonServiceAnomalyCode[];
};

export function buildDaemonServiceTargetSpec(input: {
  daemonVersion: string;
  distribution?: OpenMeldDistribution;
  environmentTarget?: OpenMeldEnvironmentTarget;
  gatewayUrl?: string;
}): DaemonServiceTargetSpec {
  const distribution = input.distribution ?? resolveOpenMeldDistribution();
  return {
    daemonVersion: input.daemonVersion,
    bundleFormat: distribution === "binary" ? "binary_v1" : "self_contained_v1",
    environmentTarget:
      input.environmentTarget ??
      resolveOpenMeldEnvironmentTargetFromEnv({ gatewayUrl: input.gatewayUrl }),
  };
}

export function resolveDaemonServiceAlignmentDecision(input: {
  inventory: DaemonServiceInventory;
  target: DaemonServiceTargetSpec;
}): DaemonServiceAlignmentDecision {
  if (
    !input.inventory.installStatus.installed &&
    input.inventory.legacySharedService?.present
  ) {
    return {
      status: "needs_full_alignment",
      target: input.target,
      reasonCodes: ["legacy_shared_service_present"],
    };
  }
  if (!input.inventory.installStatus.installed) {
    return {
      status: "not_installed",
      target: input.target,
      reasonCodes: ["not_installed"],
    };
  }

  const blockedReasonCodes = collectReasonCodes({
    inventory: input.inventory,
    predicate: (code) => BLOCKED_ALIGNMENT_ANOMALIES.has(code),
  });
  const versionDecision = resolveVersionDecision(input);
  if (
    versionDecision === "blocked" &&
    !blockedReasonCodes.includes("downgrade_blocked")
  ) {
    blockedReasonCodes.push("downgrade_blocked");
  }
  if (blockedReasonCodes.length > 0) {
    return {
      status: "blocked",
      target: input.target,
      reasonCodes: blockedReasonCodes,
    };
  }

  const fullAlignmentReasonCodes = collectFullAlignmentReasonCodes({
    ...input,
    versionDecision,
  });
  if (
    versionDecision === "needs_full_alignment" &&
    !fullAlignmentReasonCodes.includes("version_outdated")
  ) {
    fullAlignmentReasonCodes.push("version_outdated");
  }
  if (fullAlignmentReasonCodes.length > 0) {
    return {
      status: "needs_full_alignment",
      target: input.target,
      reasonCodes: fullAlignmentReasonCodes,
    };
  }

  const autoHealReasonCodes = collectReasonCodes({
    inventory: input.inventory,
    predicate: (code) => DAEMON_SERVICE_AUTO_HEAL_ANOMALIES.has(code),
  });
  if (autoHealReasonCodes.length > 0) {
    return {
      status: "needs_auto_heal",
      target: input.target,
      reasonCodes: autoHealReasonCodes,
    };
  }

  return {
    status: "already_aligned",
    target: input.target,
    reasonCodes: [],
  };
}

function collectFullAlignmentReasonCodes(input: {
  inventory: DaemonServiceInventory;
  target: DaemonServiceTargetSpec;
  versionDecision: "already_aligned" | "needs_full_alignment" | "blocked";
}): DaemonServiceAnomalyCode[] {
  const reasonCodes = collectReasonCodes({
    inventory: input.inventory,
    predicate: (code) => DAEMON_SERVICE_FULL_ALIGNMENT_ANOMALIES.has(code),
  });

  if (
    input.versionDecision === "already_aligned" &&
    input.inventory.activeBundle &&
    input.inventory.activeBundle.daemonVersion !==
      resolveExpectedArtifactVersion(input.inventory) &&
    !reasonCodes.includes("bundle_version_drift")
  ) {
    reasonCodes.push("bundle_version_drift");
  }

  if (
    input.inventory.activeBundle &&
    input.inventory.activeBundle.bundleFormat !== input.target.bundleFormat &&
    !reasonCodes.includes("bundle_strategy_legacy")
  ) {
    reasonCodes.push("bundle_strategy_legacy");
  }

  if (
    hasServiceManagerEnvironmentDrift(input) &&
    !reasonCodes.includes("service_manager_environment_drift")
  ) {
    reasonCodes.push("service_manager_environment_drift");
  }

  return reasonCodes;
}

function hasServiceManagerEnvironmentDrift(input: {
  inventory: DaemonServiceInventory;
  target: DaemonServiceTargetSpec;
}): boolean {
  const status = input.inventory.serviceManagerStatus;
  if (!(status?.installed && status.environmentTarget !== undefined)) {
    return false;
  }
  const observed = status.environmentTarget;
  const expected = input.target.environmentTarget;
  return (
    observed === null ||
    observed.preset !== expected.preset ||
    observed.gatewayUrl !== expected.gatewayUrl ||
    observed.authBaseUrl !== expected.authBaseUrl ||
    observed.userFacingCommand !== expected.userFacingCommand
  );
}

function resolveVersionDecision(input: {
  inventory: DaemonServiceInventory;
  target: DaemonServiceTargetSpec;
}): "already_aligned" | "needs_full_alignment" | "blocked" {
  const configuredVersion = resolveExpectedArtifactVersion(input.inventory);
  if (!configuredVersion) {
    return "already_aligned";
  }
  const versionDirection = resolveVersionChangeDirection({
    fromVersion: configuredVersion,
    toVersion: input.target.daemonVersion,
  });
  if (versionDirection === "upgrade") {
    return "needs_full_alignment";
  }
  if (versionDirection === "downgrade") {
    return "blocked";
  }
  return "already_aligned";
}

function resolveExpectedArtifactVersion(
  inventory: DaemonServiceInventory
): string | null {
  return (
    inventory.serviceContract?.daemonVersion ??
    inventory.installStatus.state?.daemonVersion ??
    null
  );
}

function collectReasonCodes(input: {
  inventory: DaemonServiceInventory;
  predicate: (code: DaemonServiceAnomalyCode) => boolean;
}): DaemonServiceAnomalyCode[] {
  const reasonCodes: DaemonServiceAnomalyCode[] = [];
  for (const anomaly of input.inventory.anomalies) {
    if (input.predicate(anomaly.code) && !reasonCodes.includes(anomaly.code)) {
      reasonCodes.push(anomaly.code);
    }
  }
  return reasonCodes;
}
