import type { DaemonServiceContract } from "@openmeld/schemas/types";
import type { DaemonStatus } from "../../config/daemon-state";
import type { OpenMeldPathResolutionInput } from "../../config/paths";
import {
  type DaemonActiveBundleState,
  isDaemonBundleSourceAllowedForLane,
} from "./daemon-service-bundle";

export type DaemonServiceArtifactDriftReasonCode =
  | "bundle_missing"
  | "bundle_content_drift"
  | "bundle_id_drift"
  | "bundle_version_drift"
  | "bundle_lane_drift"
  | "bundle_strategy_legacy"
  | "bundle_provenance_drift"
  | "bundle_path_invalid";

export type ResolvedDaemonServiceArtifact = {
  expectedVersion: string;
  installVersion: string | null;
  activeBundleVersion: string | null;
  resolvedEntryPath: string | null;
  driftReasonCodes: DaemonServiceArtifactDriftReasonCode[];
  isAligned: boolean;
};

export function resolveDaemonServiceArtifact(input: {
  expectedVersion: string;
  installStatus: DaemonStatus;
  serviceContract?: DaemonServiceContract | null;
  activeBundle: DaemonActiveBundleState | null;
  activeBundleSourceAvailable: boolean | null;
  activeBundleEntryPath: string | null;
  installedBundleFingerprint: string | null;
  pathInput?: OpenMeldPathResolutionInput;
}): ResolvedDaemonServiceArtifact {
  const installVersion = input.installStatus.installed
    ? input.installStatus.state.daemonVersion
    : null;
  const expectedBundleId = input.serviceContract?.bundleId ?? null;
  const expectedDaemonVersion = input.expectedVersion;
  const activeBundleVersion = input.activeBundle?.daemonVersion ?? null;
  const driftReasonCodes = input.activeBundle
    ? collectActiveBundleDriftReasonCodes({
        activeBundle: input.activeBundle,
        activeBundleEntryPath: input.activeBundleEntryPath,
        activeBundleSourceAvailable: input.activeBundleSourceAvailable,
        installedBundleFingerprint: input.installedBundleFingerprint,
        expectedBundleId,
        expectedDaemonVersion,
        pathInput: input.pathInput,
      })
    : (["bundle_missing"] satisfies DaemonServiceArtifactDriftReasonCode[]);

  const isAligned = driftReasonCodes.length === 0;

  return {
    expectedVersion: input.expectedVersion,
    installVersion,
    activeBundleVersion,
    resolvedEntryPath: isAligned ? input.activeBundleEntryPath : null,
    driftReasonCodes,
    isAligned,
  };
}

function collectActiveBundleDriftReasonCodes(input: {
  activeBundle: DaemonActiveBundleState;
  activeBundleEntryPath: string | null;
  activeBundleSourceAvailable: boolean | null;
  installedBundleFingerprint: string | null;
  expectedBundleId: string | null;
  expectedDaemonVersion: string;
  pathInput?: OpenMeldPathResolutionInput;
}): DaemonServiceArtifactDriftReasonCode[] {
  const driftReasonCodes: DaemonServiceArtifactDriftReasonCode[] = [];

  if (hasBundleVersionDrift(input)) {
    driftReasonCodes.push("bundle_version_drift");
  }
  if (hasBundleIdDrift(input)) {
    driftReasonCodes.push("bundle_id_drift");
  }
  if (
    !isDaemonBundleSourceAllowedForLane({
      sourceKind: input.activeBundle.sourceKind,
      pathInput: input.pathInput,
    })
  ) {
    driftReasonCodes.push("bundle_lane_drift");
  }
  if (input.activeBundle.bundleFormat === "legacy_linked_v1") {
    driftReasonCodes.push("bundle_strategy_legacy");
    if (input.activeBundleSourceAvailable === false) {
      driftReasonCodes.push("bundle_provenance_drift");
    }
  } else if (hasBundleContentDrift(input)) {
    driftReasonCodes.push("bundle_content_drift");
  }
  if (!input.activeBundleEntryPath) {
    driftReasonCodes.push("bundle_path_invalid");
  }

  return driftReasonCodes;
}

function hasBundleVersionDrift(input: {
  activeBundle: DaemonActiveBundleState;
  expectedDaemonVersion: string;
}): boolean {
  return input.activeBundle.daemonVersion !== input.expectedDaemonVersion;
}

function hasBundleIdDrift(input: {
  activeBundle: DaemonActiveBundleState;
  expectedBundleId: string | null;
}): boolean {
  return (
    input.expectedBundleId !== null &&
    input.activeBundle.bundleId !== input.expectedBundleId
  );
}

function hasBundleContentDrift(input: {
  activeBundle: DaemonActiveBundleState;
  installedBundleFingerprint: string | null;
}): boolean {
  return (
    input.installedBundleFingerprint !== null &&
    input.activeBundle.sourceDistFingerprint !==
      input.installedBundleFingerprint
  );
}
