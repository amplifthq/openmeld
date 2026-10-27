import { peopleComputerCliCommand } from "@openmeld/agent-runtime";
import {
  findOpenMeldToolsUpdateFailureCode,
  formatLocalSetupActionDescription,
  formatLocalSetupActionLabel,
  LOCAL_COMPONENTS_SCHEMA_VERSION,
} from "@openmeld/schemas";
import type {
  DaemonServiceLane,
  LocalCliComponentUpdateProjection,
  LocalComponentsAvailabilityCatalog,
  LocalComponentsReleaseManifest,
  LocalComponentsStatus,
  LocalComponentUpdateProjection,
  LocalComponentUpdateStatus,
  LocalServiceComponentUpdateProjection,
  LocalSetupAction,
  LocalSkillsComponentUpdateProjection,
  OpenMeldToolsMaintenanceProjection,
  OpenMeldToolsUpdateOperation,
} from "@openmeld/schemas/types";
import type { CoreLocalComponentsRelease } from "./release-source";

// The installed CLI owns distribution-aware upgrades (managed binary or npm).
// Cloud status cannot assume Node/npm exists on the selected computer.
const SEMVER_RE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const NUMERIC_SEMVER_IDENTIFIER_RE = /^\d+$/u;
// OpenMeld Service 0.3.168 adds credential recovery, setup/update coordination,
// and task-scoped reply publication without unrelated CLI initialization.
// Earlier Services can remain stuck during recovery or fail to publish a reply
// after the local Agent has finished its work.
// Core owns this monotonic compatibility floor separately from the latest
// release's advisory policy, so a later optional release can never make an
// older unsafe Service eligible for new Wake work again.
// Execution Context 5 and saved-workspace reads require Service 0.3.251 for new
// work once that release is available on the stable channel.
const AUTH_FRESHNESS_MINIMUM_OPENMELD_SERVICE_VERSION = "0.3.264";
const MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION = "0.3.273";
const EXECUTION_CONTEXT_MINIMUM_OPENMELD_SERVICE_VERSION = "0.3.251";
// Preserve the Project-aware runtime and shared-folder capability v4 floor
// while receivers still project the published 0.3.250 release.
const PROJECT_RUNTIME_MINIMUM_OPENMELD_SERVICE_VERSION = "0.3.249";
const LAUNCH_CONTRACT_MINIMUM_OPENMELD_SERVICE_VERSION = "0.3.226";
// Keep the last published floor active while its replacement is not yet on the
// stable channel. These historical floors also preserve recovery when a Core
// projection uses an earlier published manifest.
const PREVIOUS_MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION = "0.3.224";
const LEGACY_MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION = "0.3.218";
const EARLIEST_MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION = "0.3.217";

type ServiceUpdateDecision = {
  reasonCodes: string[];
  status: LocalComponentUpdateStatus;
  wakeBlocked: boolean;
};

export function resolveLocalComponentUpdateProjection(input: {
  generatedAt: string;
  runtimeLane?: DaemonServiceLane;
  localComponentsStatus?: LocalComponentsStatus | null;
  // The published release read by readCoreLocalComponentsRelease().
  release: CoreLocalComponentsRelease;
  serviceConnected: boolean;
  serviceVersion: string | null;
}): LocalComponentUpdateProjection {
  const manifest = input.release.manifest;
  const maintenance = input.localComponentsStatus?.maintenance ?? null;
  const updateOperation = input.localComponentsStatus?.updateOperation ?? null;
  const serviceCliReasonCodes =
    input.localComponentsStatus?.cli.reasonCodes ?? [];
  if (!manifest) {
    const service = buildServiceUpdateProjection({
      installedVersion: input.serviceVersion,
      latestVersion: null,
      reasonCodes: ["local_components.release_manifest_invalid"],
      requiredVersion: null,
      serviceStatus: "unknown",
      updatePolicy: "required",
      wakeBlocked: true,
    });
    const cli = mergeOpenMeldToolsUpdateFailureReasonCode({
      projection: buildCliUpdateProjection({
        commandContractVersion:
          input.localComponentsStatus?.cli.commandContractVersion ?? null,
        installedPackageVersion:
          input.localComponentsStatus?.cli.packageVersion ?? null,
        latestPackageVersion: null,
        reasonCodes: ["local_components.release_manifest_invalid"],
        requiredCommandContractVersion: null,
        status: "unknown",
        updatePolicy: "required",
      }),
      serviceReasonCodes: serviceCliReasonCodes,
      updateOperation,
    });
    const skills = buildSkillsUpdateProjection({
      expectedBundleHash: null,
      expectedTargetCount: 0,
      installedBundleHash:
        input.localComponentsStatus?.skills.installedBundleHash ?? null,
      reasonCodes: ["local_components.release_manifest_invalid"],
      skillContractVersion: null,
      status: "unknown",
      targetCount: input.localComponentsStatus?.skills.targetCount ?? null,
      updatePolicy: "required",
    });
    return buildProjection({
      runtimeLane: input.runtimeLane,
      cli,
      generatedAt: input.generatedAt,
      service,
      skills,
      maintenance,
      updateOperation,
    });
  }

  const selectedPolicy = resolveInstallableComponentPolicy({
    manifest,
    source: input.localComponentsStatus?.installationSource,
    catalog: input.release.availabilityCatalog,
  });
  const skillsPolicy = manifest.components.skills;
  const cli = mergeOpenMeldToolsUpdateFailureReasonCode({
    projection: resolveSourceAwareCliProjection({
      globalPolicy: manifest.components.cli,
      selectedPolicy: selectedPolicy?.cli ?? null,
      status: input.localComponentsStatus?.cli ?? null,
    }),
    serviceReasonCodes: serviceCliReasonCodes,
    updateOperation,
  });
  const skills = resolveSkillsUpdateProjection({
    cliVersion: input.localComponentsStatus?.cli.packageVersion ?? null,
    policy: skillsPolicy,
    status: input.localComponentsStatus?.skills ?? null,
  });
  const service = resolveSourceAwareServiceProjection({
    globalPolicy: manifest.components.service,
    selectedPolicy: selectedPolicy?.service ?? null,
    connected: input.serviceConnected,
    installedVersion:
      input.serviceVersion ??
      input.localComponentsStatus?.service.installedBundleVersion ??
      null,
    installedBundleHash:
      input.localComponentsStatus?.service.installedBundleHash ?? null,
  });
  return buildProjection({
    runtimeLane: input.runtimeLane,
    cli,
    generatedAt: input.generatedAt,
    service,
    skills,
    maintenance,
    updateOperation,
  });
}

function resolveSourceAwareCliProjection(input: {
  globalPolicy: LocalComponentsReleaseManifest["components"]["cli"];
  selectedPolicy: LocalComponentsReleaseManifest["components"]["cli"] | null;
  status: LocalComponentsStatus["cli"] | null;
}): LocalCliComponentUpdateProjection {
  const globalRequired = input.globalPolicy.updatePolicy === "required";
  const policy =
    globalRequired &&
    (input.selectedPolicy?.commandContractVersion !==
      input.globalPolicy.commandContractVersion ||
      !isLocalComponentVersionAtLeast(
        input.selectedPolicy.packageVersion,
        input.globalPolicy.packageVersion
      ))
      ? null
      : input.selectedPolicy;
  if (policy) {
    return resolveCliUpdateProjection({
      policy: {
        ...policy,
        ...(globalRequired
          ? {
              updatePolicy: "required",
              commandContractVersion: input.globalPolicy.commandContractVersion,
            }
          : {}),
      },
      status: input.status,
    });
  }
  // Required package drift remains a fact even when this channel cannot
  // supply a compatible target. Reuse the owning CLI policy decision.
  const requiredProjection = globalRequired
    ? resolveCliUpdateProjection({
        policy: input.globalPolicy,
        status: input.status,
      })
    : null;
  return buildCliUpdateProjection({
    commandContractVersion: input.status?.commandContractVersion ?? null,
    installedPackageVersion: input.status?.packageVersion ?? null,
    latestPackageVersion: null,
    reasonCodes: [
      ...(requiredProjection?.reasonCodes ??
        (input.status ? [] : ["cli.status_unavailable"])),
      "cli.release_target_unavailable",
    ],
    requiredCommandContractVersion: globalRequired
      ? input.globalPolicy.commandContractVersion
      : null,
    status:
      requiredProjection?.status === "update_required"
        ? "update_required"
        : "unknown",
    updatePolicy: input.globalPolicy.updatePolicy,
  });
}

function resolveSourceAwareServiceProjection(input: {
  globalPolicy: LocalComponentsReleaseManifest["components"]["service"];
  selectedPolicy:
    | LocalComponentsReleaseManifest["components"]["service"]
    | null;
  connected: boolean;
  installedVersion: string | null;
  installedBundleHash: string | null;
}): LocalServiceComponentUpdateProjection {
  // Screen targets against the active floor independently of installed state.
  const threshold = maxServiceVersion(
    input.globalPolicy.updatePolicy === "required"
      ? input.globalPolicy.bundleVersion
      : null,
    resolveMinimumRecoveryTargetVersion({
      installedVersion: null,
      publishedVersion: input.globalPolicy.bundleVersion,
    })
  );
  const policy =
    input.selectedPolicy &&
    (!threshold ||
      isLocalComponentVersionAtLeast(
        input.selectedPolicy.bundleVersion,
        threshold
      ))
      ? input.selectedPolicy
      : null;
  const safetyBlocked =
    input.connected &&
    threshold !== null &&
    !(
      input.installedVersion &&
      isLocalComponentVersionAtLeast(input.installedVersion, threshold)
    );
  const updatePolicy = safetyBlocked
    ? "required"
    : (policy?.updatePolicy ?? input.globalPolicy.updatePolicy);
  if (!input.connected) {
    return buildDisconnectedServiceProjection({ policy, updatePolicy });
  }
  if (!policy) {
    return buildUnavailableServiceProjection({
      version: input.installedVersion,
      safetyBlocked,
      updatePolicy,
    });
  }
  const requiredVersion =
    safetyBlocked || policy.updatePolicy === "required"
      ? policy.bundleVersion
      : null;
  const decision = resolveServiceUpdateDecision({
    installedBundleHash: input.installedBundleHash,
    installedVersion: input.installedVersion,
    latestBundleHash: policy.bundleHash,
    policy: updatePolicy,
    requiredVersion,
    latestVersion: policy.bundleVersion,
  });
  return buildServiceUpdateProjection({
    installedVersion: input.installedVersion,
    latestVersion: policy.bundleVersion,
    reasonCodes: decision.reasonCodes,
    requiredVersion,
    serviceStatus: decision.status,
    updatePolicy,
    wakeBlocked: decision.wakeBlocked,
  });
}

function buildDisconnectedServiceProjection(input: {
  policy: LocalComponentsReleaseManifest["components"]["service"] | null;
  updatePolicy: LocalServiceComponentUpdateProjection["updatePolicy"];
}): LocalServiceComponentUpdateProjection {
  return buildServiceUpdateProjection({
    installedVersion: null,
    latestVersion: input.policy?.bundleVersion ?? null,
    reasonCodes: ["service.not_connected"],
    requiredVersion:
      input.policy?.updatePolicy === "required"
        ? input.policy.bundleVersion
        : null,
    serviceStatus: "unknown",
    updatePolicy: input.updatePolicy,
    wakeBlocked: false,
  });
}

function buildUnavailableServiceProjection(input: {
  version: string | null;
  safetyBlocked: boolean;
  updatePolicy: LocalServiceComponentUpdateProjection["updatePolicy"];
}): LocalServiceComponentUpdateProjection {
  return buildServiceUpdateProjection({
    installedVersion: input.version,
    latestVersion: null,
    reasonCodes: input.safetyBlocked
      ? [
          resolveUnavailableServiceVersionReason(input.version),
          "service.release_target_unavailable",
        ]
      : ["service.release_target_unavailable"],
    requiredVersion: null,
    serviceStatus: input.safetyBlocked ? "update_required" : "unknown",
    updatePolicy: input.updatePolicy,
    wakeBlocked: input.safetyBlocked,
  });
}

function resolveUnavailableServiceVersionReason(
  version: string | null
): string {
  if (!version) {
    return "service.version_not_reported";
  }
  return parseSemver(version) === null
    ? "service.version_invalid"
    : "service.version_outdated";
}

function resolveInstallableComponentPolicy(input: {
  manifest: LocalComponentsReleaseManifest;
  source: LocalComponentsStatus["installationSource"];
  catalog: LocalComponentsAvailabilityCatalog | null;
}): Pick<
  LocalComponentsReleaseManifest["components"],
  "cli" | "service"
> | null {
  if (!input.source) {
    return null;
  }
  if (
    input.source.distribution === "npm" &&
    input.source.channel === "stable"
  ) {
    return {
      cli: input.manifest.components.cli,
      service: input.manifest.components.service,
    };
  }
  return (
    input.catalog?.entries.find(
      (entry) =>
        entry.channel === input.source?.channel &&
        entry.platform === input.source?.platform
    )?.policy ?? null
  );
}

function resolveMinimumRecoveryTargetVersion(input: {
  installedVersion: string | null;
  publishedVersion: string;
}): string | null {
  const activeMinimumVersion = [
    MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION,
    EXECUTION_CONTEXT_MINIMUM_OPENMELD_SERVICE_VERSION,
    PROJECT_RUNTIME_MINIMUM_OPENMELD_SERVICE_VERSION,
    LAUNCH_CONTRACT_MINIMUM_OPENMELD_SERVICE_VERSION,
    PREVIOUS_MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION,
    LEGACY_MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION,
    EARLIEST_MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION,
  ].find((floor) => {
    const comparison = compareSemver(input.publishedVersion, floor);
    return comparison !== null && comparison >= 0;
  });
  if (!activeMinimumVersion) {
    return null;
  }
  const installedVersionComparison = input.installedVersion
    ? compareSemver(input.installedVersion, activeMinimumVersion)
    : null;
  if (installedVersionComparison !== null && installedVersionComparison >= 0) {
    return null;
  }
  // The source floor can land before its carrier is published. Production
  // Core supplies the stable channel's immutable release manifest, so only
  // activate the floor once that manifest proves the recovery target exists.
  const publishedVersionComparison = compareSemver(
    input.publishedVersion,
    activeMinimumVersion
  );
  if (publishedVersionComparison === null || publishedVersionComparison < 0) {
    return null;
  }
  return activeMinimumVersion;
}

// Activate the shorter native-auth lifetime only once the published manifest
// proves the matching Service is available for recovery.
export function isServiceAuthFreshnessRequired(
  manifest: LocalComponentsReleaseManifest | null
): boolean {
  return (
    manifest !== null &&
    isLocalComponentVersionAtLeast(
      manifest.components.service.bundleVersion,
      AUTH_FRESHNESS_MINIMUM_OPENMELD_SERVICE_VERSION
    )
  );
}

function resolveServiceUpdateDecision(input: {
  installedBundleHash: string | null;
  installedVersion: string | null;
  latestBundleHash: string | null;
  latestVersion: string;
  policy: "ok" | "available" | "required";
  requiredVersion: string | null;
}): ServiceUpdateDecision {
  if (!input.installedVersion) {
    return {
      reasonCodes: ["service.version_not_reported"],
      status: input.policy === "required" ? "update_required" : "unknown",
      wakeBlocked: input.policy === "required",
    };
  }
  if (parseSemver(input.installedVersion) === null) {
    return {
      reasonCodes: ["service.version_invalid"],
      status: input.policy === "required" ? "update_required" : "unknown",
      wakeBlocked: input.policy === "required",
    };
  }
  const requiredVersionDecision = resolveRequiredServiceVersionDecision({
    installedVersion: input.installedVersion,
    requiredVersion: input.requiredVersion,
  });
  if (requiredVersionDecision !== null) {
    return requiredVersionDecision;
  }
  return resolveLatestServiceVersionDecision({
    installedBundleHash: input.installedBundleHash,
    installedVersion: input.installedVersion,
    latestBundleHash: input.latestBundleHash,
    latestVersion: input.latestVersion,
    policy: input.policy,
  });
}

function resolveRequiredServiceVersionDecision(input: {
  installedVersion: string;
  requiredVersion: string | null;
}): ServiceUpdateDecision | null {
  if (input.requiredVersion === null) {
    return null;
  }
  const comparison = compareSemver(
    input.installedVersion,
    input.requiredVersion
  );
  if (comparison === null) {
    return {
      reasonCodes: ["service.version_invalid"],
      status: "update_required",
      wakeBlocked: true,
    };
  }
  if (comparison < 0) {
    return {
      reasonCodes: ["service.version_outdated"],
      status: "update_required",
      wakeBlocked: true,
    };
  }
  return null;
}

function resolveLatestServiceVersionDecision(input: {
  installedBundleHash: string | null;
  installedVersion: string;
  latestBundleHash: string | null;
  latestVersion: string;
  policy: "ok" | "available" | "required";
}): ServiceUpdateDecision {
  const comparison = compareSemver(input.installedVersion, input.latestVersion);
  if (comparison === null) {
    return {
      reasonCodes: ["service.version_invalid"],
      status: input.policy === "required" ? "update_required" : "unknown",
      wakeBlocked: input.policy === "required",
    };
  }
  if (comparison < 0) {
    return {
      reasonCodes: ["service.version_outdated"],
      status:
        input.policy === "required" ? "update_required" : "update_available",
      wakeBlocked: input.policy === "required",
    };
  }
  if (
    comparison === 0 &&
    input.latestBundleHash !== null &&
    input.installedBundleHash !== null &&
    input.installedBundleHash !== input.latestBundleHash
  ) {
    return {
      reasonCodes: ["service.bundle_mismatch"],
      status:
        input.policy === "required" ? "update_required" : "update_available",
      wakeBlocked: input.policy === "required",
    };
  }
  if (
    comparison === 0 &&
    input.latestBundleHash !== null &&
    input.installedBundleHash === null
  ) {
    return {
      reasonCodes: ["service.bundle_hash_not_reported"],
      status: "current",
      wakeBlocked: false,
    };
  }
  return {
    reasonCodes: [],
    status: "current",
    wakeBlocked: false,
  };
}

function resolveCliUpdateProjection(input: {
  policy: LocalComponentsReleaseManifest["components"]["cli"];
  status: LocalComponentsStatus["cli"] | null;
}): LocalCliComponentUpdateProjection {
  const latestPackageVersion = input.policy.packageVersion;
  const requiredCommandContractVersion =
    input.policy.updatePolicy === "required"
      ? input.policy.commandContractVersion
      : null;
  if (!input.status) {
    return buildCliUpdateProjection({
      commandContractVersion: null,
      installedPackageVersion: null,
      latestPackageVersion,
      reasonCodes: ["cli.status_unavailable"],
      requiredCommandContractVersion,
      status:
        input.policy.updatePolicy === "required"
          ? "update_required"
          : "unknown",
      updatePolicy: input.policy.updatePolicy,
    });
  }

  const installedPackageVersion = input.status.packageVersion;
  const commandContractVersion = input.status.commandContractVersion;
  const reasonCodes: string[] = [];
  let updateNeeded = false;
  if (commandContractVersion !== input.policy.commandContractVersion) {
    updateNeeded = true;
    reasonCodes.push("cli.command_contract_mismatch");
  } else if (
    (compareSemver(installedPackageVersion, latestPackageVersion) ?? -1) < 0
  ) {
    updateNeeded = true;
    reasonCodes.push("cli.package_update_available");
  }
  return buildCliUpdateProjection({
    commandContractVersion,
    installedPackageVersion,
    latestPackageVersion,
    reasonCodes,
    requiredCommandContractVersion,
    status: resolvePolicyStatus({
      updateNeeded,
      updatePolicy: input.policy.updatePolicy,
    }),
    updatePolicy: input.policy.updatePolicy,
  });
}

function mergeOpenMeldToolsUpdateFailureReasonCode(input: {
  projection: LocalCliComponentUpdateProjection;
  serviceReasonCodes: readonly string[];
  updateOperation: OpenMeldToolsUpdateOperation | null;
}): LocalCliComponentUpdateProjection {
  if (
    input.updateOperation?.phase !== "restored" &&
    input.updateOperation?.phase !== "needs_help"
  ) {
    return input.projection;
  }
  const failureCode = findOpenMeldToolsUpdateFailureCode(
    input.serviceReasonCodes
  );
  if (!failureCode || input.projection.reasonCodes.includes(failureCode)) {
    return input.projection;
  }
  return {
    ...input.projection,
    reasonCodes: [...input.projection.reasonCodes, failureCode],
  };
}

function resolveSkillsUpdateProjection(input: {
  cliVersion: string | null;
  policy: LocalComponentsReleaseManifest["components"]["skills"];
  status: LocalComponentsStatus["skills"] | null;
}): LocalSkillsComponentUpdateProjection {
  const compatibleContentRelease =
    input.status?.contentRelease &&
    input.cliVersion !== null &&
    isLocalComponentVersionAtLeast(
      input.cliVersion,
      input.status.contentRelease.minimumCliVersion
    ) &&
    input.status.skillContractVersion === input.policy.skillContractVersion;
  const expectedBundleHash = compatibleContentRelease
    ? (input.status?.expectedBundleHash ?? null)
    : input.policy.bundleHash;
  const expectedTargetCount = input.policy.skillIds.length;
  if (!input.status) {
    return buildSkillsUpdateProjection({
      expectedBundleHash,
      expectedTargetCount,
      installedBundleHash: null,
      reasonCodes: ["skills.status_unavailable"],
      skillContractVersion: input.policy.skillContractVersion,
      status:
        input.policy.updatePolicy === "required"
          ? "update_required"
          : "unknown",
      targetCount: null,
      updatePolicy: input.policy.updatePolicy,
    });
  }

  const reasonCodes = [...input.status.reasonCodes];
  let updateNeeded = input.status.status === "update_required";
  if (input.status.contentRelease && !compatibleContentRelease) {
    updateNeeded = true;
    reasonCodes.push("skills.content_release_incompatible");
  }
  if (
    input.status.skillContractVersion !== input.policy.skillContractVersion &&
    !reasonCodes.includes("skills.skill_contract_mismatch")
  ) {
    updateNeeded = true;
    reasonCodes.push("skills.skill_contract_mismatch");
  }
  if (
    ((compatibleContentRelease && expectedBundleHash === null) ||
      (expectedBundleHash !== null &&
        input.status.installedBundleHash !== expectedBundleHash)) &&
    !reasonCodes.includes("skills.bundle_mismatch")
  ) {
    updateNeeded = true;
    reasonCodes.push("skills.bundle_mismatch");
  }

  return buildSkillsUpdateProjection({
    expectedBundleHash,
    expectedTargetCount,
    installedBundleHash: input.status.installedBundleHash,
    reasonCodes,
    skillContractVersion: input.policy.skillContractVersion,
    status: resolvePolicyStatus({
      updateNeeded,
      updatePolicy: input.policy.updatePolicy,
    }),
    targetCount: input.status.targetCount,
    updatePolicy: input.policy.updatePolicy,
  });
}

function resolvePolicyStatus(input: {
  updateNeeded: boolean;
  updatePolicy: "ok" | "available" | "required";
}): LocalComponentUpdateStatus {
  if (!input.updateNeeded || input.updatePolicy === "ok") {
    return "current";
  }
  return input.updatePolicy === "required"
    ? "update_required"
    : "update_available";
}

function buildServiceUpdateProjection(input: {
  installedVersion: string | null;
  latestVersion: string | null;
  reasonCodes: string[];
  requiredVersion: string | null;
  serviceStatus: LocalComponentUpdateStatus;
  updatePolicy: "ok" | "available" | "required";
  wakeBlocked: boolean;
}): LocalServiceComponentUpdateProjection {
  return {
    installedVersion: input.installedVersion,
    latestVersion: input.latestVersion,
    reasonCodes: input.reasonCodes,
    requiredVersion: input.requiredVersion,
    status: input.serviceStatus,
    updatePolicy: input.updatePolicy,
    wakeBlocked: input.wakeBlocked,
  };
}

function buildCliUpdateProjection(input: {
  commandContractVersion: string | null;
  installedPackageVersion: string | null;
  latestPackageVersion: string | null;
  reasonCodes: string[];
  requiredCommandContractVersion: string | null;
  status: LocalComponentUpdateStatus;
  updatePolicy: "ok" | "available" | "required";
}): LocalCliComponentUpdateProjection {
  return {
    commandContractVersion: input.commandContractVersion,
    installedPackageVersion: input.installedPackageVersion,
    latestPackageVersion: input.latestPackageVersion,
    reasonCodes: input.reasonCodes,
    requiredCommandContractVersion: input.requiredCommandContractVersion,
    status: input.status,
    updatePolicy: input.updatePolicy,
    wakeBlocked: false,
  };
}

function buildSkillsUpdateProjection(input: {
  expectedBundleHash: string | null;
  expectedTargetCount: number;
  installedBundleHash: string | null;
  reasonCodes: string[];
  skillContractVersion: string | null;
  status: LocalComponentUpdateStatus;
  targetCount: number | null;
  updatePolicy: "ok" | "available" | "required";
}): LocalSkillsComponentUpdateProjection {
  return {
    expectedBundleHash: input.expectedBundleHash,
    expectedTargetCount: input.expectedTargetCount,
    installedBundleHash: input.installedBundleHash,
    reasonCodes: input.reasonCodes,
    skillContractVersion: input.skillContractVersion,
    status: input.status,
    targetCount: input.targetCount,
    updatePolicy: input.updatePolicy,
    wakeBlocked: false,
  };
}

function buildProjection(input: {
  runtimeLane?: DaemonServiceLane;
  cli: LocalCliComponentUpdateProjection;
  generatedAt: string;
  maintenance: OpenMeldToolsMaintenanceProjection | null;
  service: LocalServiceComponentUpdateProjection;
  skills: LocalSkillsComponentUpdateProjection;
  updateOperation: OpenMeldToolsUpdateOperation | null;
}): LocalComponentUpdateProjection {
  const setupAction = resolveProjectionSetupAction(input);
  const command = peopleComputerCliCommand(input.runtimeLane ?? "prod");
  const updateOperation = resolveVisibleUpdateOperation(input);
  const unknown = [input.cli, input.service, input.skills].some(
    (component) => component.status === "unknown"
  );
  const updateAvailable = [input.cli, input.service, input.skills].some(
    (component) => component.status === "update_available"
  );
  let setupActionLabel = formatLocalSetupActionLabel(setupAction);
  let setupActionDescription = formatLocalSetupActionDescription(setupAction);
  if (setupAction === "none" && unknown) {
    setupActionLabel = "Update status unavailable";
    setupActionDescription =
      "OpenMeld could not confirm the installed versions. Check this computer's status before updating.";
  } else if (setupAction === "none" && updateAvailable) {
    setupActionLabel = "Update available";
    setupActionDescription =
      "An update is available. The current version can continue working.";
  }
  return {
    schemaVersion: LOCAL_COMPONENTS_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    setupAction,
    setupActionLabel,
    setupActionDescription,
    humanSetupCommand: `${command} upgrade && ${command} setup`,
    agentSetupCommand: `${command} upgrade --view agent && ${command} setup --view agent`,
    ...(input.maintenance ? { maintenance: input.maintenance } : {}),
    ...(updateOperation ? { updateOperation } : {}),
    cli: input.cli,
    service: input.service,
    skills: input.skills,
  };
}

function resolveVisibleUpdateOperation(input: {
  cli: LocalCliComponentUpdateProjection;
  service: LocalServiceComponentUpdateProjection;
  skills: LocalSkillsComponentUpdateProjection;
  updateOperation: OpenMeldToolsUpdateOperation | null;
}): OpenMeldToolsUpdateOperation | null {
  if (input.updateOperation?.phase !== "updated") {
    return input.updateOperation;
  }
  const newerUpdateIsActionable = [input.cli, input.service, input.skills].some(
    (component) =>
      component.status === "update_available" ||
      component.status === "update_required"
  );
  return newerUpdateIsActionable ? null : input.updateOperation;
}

function resolveProjectionSetupAction(input: {
  cli: LocalCliComponentUpdateProjection;
  service: LocalServiceComponentUpdateProjection;
  skills: LocalSkillsComponentUpdateProjection;
}): LocalSetupAction {
  if (input.service.wakeBlocked || input.service.status === "update_required") {
    return "update_service";
  }
  if (input.cli.status === "update_required") {
    return "update_cli";
  }
  if (input.skills.status === "update_required") {
    return "update_skills";
  }
  return "none";
}

function compareSemver(left: string, right: string): number | null {
  const leftVersion = parseSemver(left);
  const rightVersion = parseSemver(right);
  if (!(leftVersion && rightVersion)) {
    return null;
  }

  for (const key of ["major", "minor", "patch"] as const) {
    if (leftVersion[key] !== rightVersion[key]) {
      return leftVersion[key] > rightVersion[key] ? 1 : -1;
    }
  }
  return comparePrereleaseIdentifiers(
    leftVersion.prerelease,
    rightVersion.prerelease
  );
}

export function isLocalComponentVersionAtLeast(
  currentVersion: string,
  targetVersion: string
): boolean {
  const comparison = compareSemver(currentVersion, targetVersion);
  return comparison !== null && comparison >= 0;
}

function maxServiceVersion(
  left: string | null,
  right: string | null
): string | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  const comparison = compareSemver(left, right);
  return comparison !== null && comparison >= 0 ? left : right;
}

function parseSemver(value: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[] | null;
} | null {
  const match = value.trim().match(SEMVER_RE);
  if (!match) {
    return null;
  }
  const prerelease = match[4]?.split(".") ?? null;
  if (
    prerelease?.some(
      (identifier) =>
        NUMERIC_SEMVER_IDENTIFIER_RE.test(identifier) &&
        identifier.length > 1 &&
        identifier.startsWith("0")
    )
  ) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

function comparePrereleaseIdentifiers(
  left: readonly string[] | null,
  right: readonly string[] | null
): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }

  const identifierCount = Math.max(left.length, right.length);
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];
    if (leftIdentifier === undefined) {
      return -1;
    }
    if (rightIdentifier === undefined) {
      return 1;
    }
    const comparison = comparePrereleaseIdentifier(
      leftIdentifier,
      rightIdentifier
    );
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  const leftIsNumeric = NUMERIC_SEMVER_IDENTIFIER_RE.test(left);
  const rightIsNumeric = NUMERIC_SEMVER_IDENTIFIER_RE.test(right);
  if (leftIsNumeric && rightIsNumeric) {
    return Number(left) > Number(right) ? 1 : -1;
  }
  if (leftIsNumeric) {
    return -1;
  }
  if (rightIsNumeric) {
    return 1;
  }
  return left > right ? 1 : -1;
}
