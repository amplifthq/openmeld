import {
  formatLocalSetupActionDescription,
  formatLocalSetupActionLabel,
  LOCAL_COMPONENTS_SCHEMA_VERSION,
  localComponentsReleaseManifestSchema,
} from "@openmeld/schemas";
import type {
  LocalCliComponentUpdateProjection,
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
import releaseManifestJson from "../../../../release/local-components.json";

// The receiver-first release lane temporarily compiles the current published
// manifest into new Core code. The final CLI publication deploy removes this
// build-time override and compiles the checked-in manifest as usual.
declare const OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON:
  | string
  | undefined;

const HUMAN_SETUP_COMMAND = "npm install -g openmeld@latest && openmeld setup";
const AGENT_SETUP_COMMAND =
  "npm install -g openmeld@latest && openmeld setup --view agent";
const SEMVER_RE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const NUMERIC_SEMVER_IDENTIFIER_RE = /^\d+$/u;
// OpenMeld Service 0.3.126 is the first supported recovery baseline. Earlier
// Services do not carry the complete startup recovery, managed-update, and
// active Permission/Wake behavior required by the current workstation runtime.
// Core owns this monotonic compatibility floor separately from the latest
// release's advisory policy, so a later optional release can never make an
// older unsafe Service eligible for new Wake work again.
const MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION = "0.3.138";

type ServiceUpdateDecision = {
  reasonCodes: string[];
  status: LocalComponentUpdateStatus;
  wakeBlocked: boolean;
};

export function resolveLocalComponentUpdateProjection(input: {
  generatedAt: string;
  localComponentsStatus?: LocalComponentsStatus | null;
  releaseManifest?: LocalComponentsReleaseManifest | null;
  serviceConnected: boolean;
  serviceVersion: string | null;
}): LocalComponentUpdateProjection {
  const manifest = resolveRequestedReleaseManifest(input.releaseManifest);
  const maintenance = input.localComponentsStatus?.maintenance ?? null;
  const updateOperation = input.localComponentsStatus?.updateOperation ?? null;
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
    const cli = buildCliUpdateProjection({
      commandContractVersion:
        input.localComponentsStatus?.cli.commandContractVersion ?? null,
      installedPackageVersion:
        input.localComponentsStatus?.cli.packageVersion ?? null,
      latestPackageVersion: null,
      reasonCodes: ["local_components.release_manifest_invalid"],
      requiredCommandContractVersion: null,
      status: "unknown",
      updatePolicy: "required",
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
      cli,
      generatedAt: input.generatedAt,
      service,
      skills,
      maintenance,
      updateOperation,
    });
  }

  const servicePolicy = manifest.components.service;
  const cliPolicy = manifest.components.cli;
  const skillsPolicy = manifest.components.skills;
  const cli = resolveCliUpdateProjection({
    policy: cliPolicy,
    status: input.localComponentsStatus?.cli ?? null,
  });
  const skills = resolveSkillsUpdateProjection({
    policy: skillsPolicy,
    status: input.localComponentsStatus?.skills ?? null,
  });
  if (!input.serviceConnected) {
    const service = buildServiceUpdateProjection({
      installedVersion: null,
      latestVersion: servicePolicy.bundleVersion,
      reasonCodes: ["service.not_connected"],
      requiredVersion:
        servicePolicy.updatePolicy === "required"
          ? servicePolicy.bundleVersion
          : null,
      serviceStatus: "unknown",
      updatePolicy: servicePolicy.updatePolicy,
      wakeBlocked: false,
    });
    return buildProjection({
      cli,
      generatedAt: input.generatedAt,
      service,
      skills,
      maintenance,
      updateOperation,
    });
  }

  const installedServiceVersion =
    input.serviceVersion ??
    input.localComponentsStatus?.service.installedBundleVersion ??
    null;
  const minimumSupportedVersionComparison =
    installedServiceVersion === null
      ? null
      : compareSemver(
          installedServiceVersion,
          MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION
        );
  const minimumSupportedVersionBreached =
    minimumSupportedVersionComparison === null ||
    minimumSupportedVersionComparison < 0;
  const minimumRecoveryTargetVersion = minimumSupportedVersionBreached
    ? maxServiceVersion(
        MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION,
        servicePolicy.bundleVersion
      )
    : null;
  const requiredVersion = maxServiceVersion(
    servicePolicy.updatePolicy === "required"
      ? servicePolicy.bundleVersion
      : null,
    minimumRecoveryTargetVersion
  );
  const effectiveServicePolicy =
    requiredVersion === null ? servicePolicy.updatePolicy : "required";
  const decision = resolveServiceUpdateDecision({
    installedBundleHash:
      input.localComponentsStatus?.service.installedBundleHash ?? null,
    installedVersion: installedServiceVersion,
    latestBundleHash: servicePolicy.bundleHash,
    policy: effectiveServicePolicy,
    requiredVersion,
    latestVersion: servicePolicy.bundleVersion,
  });

  const service = buildServiceUpdateProjection({
    installedVersion: installedServiceVersion,
    latestVersion: servicePolicy.bundleVersion,
    reasonCodes: decision.reasonCodes,
    requiredVersion,
    serviceStatus: decision.status,
    updatePolicy: effectiveServicePolicy,
    wakeBlocked: decision.wakeBlocked,
  });
  return buildProjection({
    cli,
    generatedAt: input.generatedAt,
    service,
    skills,
    maintenance,
    updateOperation,
  });
}

function resolveRequestedReleaseManifest(
  releaseManifest: LocalComponentsReleaseManifest | null | undefined
): LocalComponentsReleaseManifest | null {
  return releaseManifest === undefined
    ? resolveReleaseManifest()
    : releaseManifest;
}

function resolveReleaseManifest(): LocalComponentsReleaseManifest | null {
  let source: unknown = releaseManifestJson;
  if (typeof OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON === "string") {
    try {
      source = JSON.parse(
        OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON
      ) as unknown;
    } catch {
      return null;
    }
  }
  const parsed = localComponentsReleaseManifestSchema.safeParse(source);
  return parsed.success ? parsed.data : null;
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

function resolveSkillsUpdateProjection(input: {
  policy: LocalComponentsReleaseManifest["components"]["skills"];
  status: LocalComponentsStatus["skills"] | null;
}): LocalSkillsComponentUpdateProjection {
  const expectedBundleHash = input.policy.bundleHash;
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
  if (
    input.status.skillContractVersion !== input.policy.skillContractVersion &&
    !reasonCodes.includes("skills.skill_contract_mismatch")
  ) {
    updateNeeded = true;
    reasonCodes.push("skills.skill_contract_mismatch");
  }
  if (
    expectedBundleHash !== null &&
    input.status.installedBundleHash !== expectedBundleHash &&
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
  cli: LocalCliComponentUpdateProjection;
  generatedAt: string;
  maintenance: OpenMeldToolsMaintenanceProjection | null;
  service: LocalServiceComponentUpdateProjection;
  skills: LocalSkillsComponentUpdateProjection;
  updateOperation: OpenMeldToolsUpdateOperation | null;
}): LocalComponentUpdateProjection {
  const setupAction = resolveProjectionSetupAction(input);
  const updateOperation = resolveVisibleUpdateOperation(input);
  return {
    schemaVersion: LOCAL_COMPONENTS_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    setupAction,
    setupActionLabel: formatLocalSetupActionLabel(setupAction),
    setupActionDescription: formatLocalSetupActionDescription(setupAction),
    humanSetupCommand: HUMAN_SETUP_COMMAND,
    agentSetupCommand: AGENT_SETUP_COMMAND,
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
