import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  formatLocalComponentsSummaryDescription,
  formatLocalComponentsSummaryLabel,
  formatLocalSetupActionDescription,
  formatLocalSetupActionLabel,
  installedLocalComponentsSnapshotSchema,
  LOCAL_COMPONENTS_SCHEMA_VERSION,
  type LocalComponentStatus,
  type LocalComponentsManifest,
  type LocalComponentsStatus,
  type LocalSetupAction,
} from "@openmeld/schemas";
import type { InstalledLocalComponentsSnapshot } from "@openmeld/schemas/types";
import { openMeldRootDir } from "../config/paths";
import { compareSemver } from "../config/version-state";
import { resolveCurrentDaemonExpectedVersion } from "../local-service/lifecycle/current-daemon-version";
import { readDaemonActiveBundleState } from "../local-service/lifecycle/daemon-service-bundle";
import {
  type DaemonServiceAnomalyCode,
  inspectDaemonServiceInventory,
} from "../local-service/lifecycle/daemon-service-inventory";
import { resolveOpenMeldToolsMaintenanceProjection } from "../local-service/maintenance/openmeld-tools-maintenance-policy";
import { resolveOpenMeldToolsUpdateOperationProjection } from "../local-service/maintenance/openmeld-tools-update-operation";
import { resolveDaemonServiceParticipationStatus } from "../local-service/status/service-participation-status";
import { isBinaryDistribution } from "../runtime/distribution";
import { OPENMELD_VERSION } from "../runtime/version";
import { hashBundledSkillAssets } from "../skills/bundled-assets";
import { computeDirectoryContentHash } from "../skills/content-hash";
import { collectSkillsReadinessSnapshot } from "../skills/installation-inventory";
import { loadSelectedSkillAssets } from "../skills/official-release";
import { resolveLocalComponentsInstallationSource } from "./installation-source";
import { readManagedCliInstallation } from "./managed-install";

export const OPENMELD_CLI_COMMAND_CONTRACT_VERSION =
  "openmeld-cli-command-contract-2026-10-conversation-read-proof-v1";
export const OPENMELD_SKILLS_CONTRACT_VERSION =
  "openmeld-skills-contract-2026-09-explicit-space-recipients-v1";
export const OPENMELD_SERVICE_CONTRACT_VERSION =
  "openmeld-service-contract-2026-10-conversation-read-proof-v1";

const LOCAL_COMPONENTS_SNAPSHOT_FILE = "local-components.json";
const SERVICE_COMPONENT_UPDATE_CODES = new Set<DaemonServiceAnomalyCode>([
  "version_outdated",
  "downgrade_blocked",
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
]);

type CliUpdateInput = {
  latestPackageVersion?: string | null;
  requiredCommandContractVersion?: string | null;
};

type ServiceComponentState = {
  installedBundleHash: string | null;
  installedBundleVersion: string | null;
  kind:
    | "ok"
    | "missing"
    | "not_running"
    | "update_required"
    | "inspection_failed";
  reasonCodes: string[];
  status: LocalComponentStatus;
};

type SkillsComponentState = {
  installedBundleHash: string | null;
  reasonCodes: string[];
  status: LocalComponentStatus;
  targetCount: number;
};

export function localComponentsSnapshotPath(): string {
  return join(openMeldRootDir(), LOCAL_COMPONENTS_SNAPSHOT_FILE);
}

export async function buildExpectedLocalComponentsManifest(): Promise<LocalComponentsManifest> {
  const skills = await resolveExpectedSkillsManifest();
  return {
    schemaVersion: LOCAL_COMPONENTS_SCHEMA_VERSION,
    openMeldReleaseVersion: OPENMELD_VERSION,
    cli: {
      packageVersion: OPENMELD_VERSION,
      commandContractVersion: OPENMELD_CLI_COMMAND_CONTRACT_VERSION,
    },
    service: {
      // Expected manifests do not know which daemon bundle is active at runtime.
      // The installed service hash reported to Core comes from active-bundle.json.
      bundleHash: null,
      bundleVersion: await resolveCurrentDaemonExpectedVersion(),
      runtimeContractEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      serviceContractVersion: OPENMELD_SERVICE_CONTRACT_VERSION,
    },
    skills,
  };
}

export async function readInstalledLocalComponentsSnapshot(): Promise<InstalledLocalComponentsSnapshot | null> {
  const raw = await readFile(localComponentsSnapshotPath(), "utf8").catch(
    () => null
  );
  if (!raw) {
    return null;
  }
  const parsed = JSON.parse(raw) as unknown;
  const result = installedLocalComponentsSnapshotSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export async function writeInstalledLocalComponentsSnapshot(input: {
  source: InstalledLocalComponentsSnapshot["source"];
}): Promise<InstalledLocalComponentsSnapshot> {
  const snapshot: InstalledLocalComponentsSnapshot = {
    schemaVersion: LOCAL_COMPONENTS_SCHEMA_VERSION,
    installedAt: new Date().toISOString(),
    source: input.source,
    manifest: await buildExpectedLocalComponentsManifest(),
  };
  const installed = isBinaryDistribution()
    ? await readManagedCliInstallation()
    : null;
  if (installed && installed.version !== OPENMELD_VERSION) {
    const previous = await readInstalledLocalComponentsSnapshot();
    if (previous?.manifest.cli.packageVersion === installed.version) {
      snapshot.manifest.cli = previous.manifest.cli;
    }
  }
  const snapshotPath = localComponentsSnapshotPath();
  await mkdir(dirname(snapshotPath), { recursive: true });
  const temporaryPath = `${snapshotPath}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    await rename(temporaryPath, snapshotPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return snapshot;
}

export async function resolveLocalComponentsStatus(
  input: CliUpdateInput = {}
): Promise<LocalComponentsStatus> {
  const [expectedManifest, service, skills, maintenance, updateProjection] =
    await Promise.all([
      buildExpectedLocalComponentsManifest(),
      resolveServiceComponentState(),
      resolveSkillsComponentState(),
      resolveOpenMeldToolsMaintenanceProjection(),
      resolveOpenMeldToolsUpdateOperationProjection(),
    ]);
  const resolvedCli = await resolveCliComponentStatus(input);
  const installationSource = await resolveLocalComponentsInstallationSource({
    expectedVersion: resolvedCli.packageVersion,
  });
  const cli = updateProjection?.failureCode
    ? {
        ...resolvedCli,
        reasonCodes: Array.from(
          new Set([...resolvedCli.reasonCodes, updateProjection.failureCode])
        ),
      }
    : resolvedCli;
  const selectedSkill = await loadSelectedSkillAssets();
  const setupAction = resolveLocalComponentsSetupAction({
    cliStatus: cli.status,
    serviceKind: service.kind,
    serviceStatus: service.status,
    skillsStatus: skills.status,
  });

  return {
    schemaVersion: LOCAL_COMPONENTS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    entrypoint: "setup",
    ...(installationSource ? { installationSource } : {}),
    summaryLabel: formatLocalComponentsSummaryLabel({
      cliStatus: cli.status,
      setupAction,
    }),
    summaryDescription: formatLocalComponentsSummaryDescription({
      cliStatus: cli.status,
      setupAction,
    }),
    setupAction,
    setupActionLabel: formatLocalSetupActionLabel(setupAction),
    setupActionDescription: formatLocalSetupActionDescription(setupAction),
    maintenance,
    ...(updateProjection
      ? { updateOperation: updateProjection.operation }
      : {}),
    cli,
    service: {
      expectedBundleHash: expectedManifest.service.bundleHash,
      expectedBundleVersion: expectedManifest.service.bundleVersion,
      installedBundleHash: service.installedBundleHash,
      installedBundleVersion: service.installedBundleVersion,
      reasonCodes: service.reasonCodes,
      runtimeContractEpoch: expectedManifest.service.runtimeContractEpoch,
      serviceContractVersion: expectedManifest.service.serviceContractVersion,
      status: service.status,
    },
    skills: {
      ...(selectedSkill.contentRelease
        ? { contentRelease: selectedSkill.contentRelease }
        : {}),
      expectedBundleHash: expectedManifest.skills.bundleHash,
      installedBundleHash: skills.installedBundleHash,
      reasonCodes: skills.reasonCodes,
      skillContractVersion: expectedManifest.skills.skillContractVersion,
      status: skills.status,
      targetCount: skills.targetCount,
    },
  };
}

export function resolveLocalComponentsSetupAction(input: {
  cliStatus: LocalComponentStatus;
  serviceKind: ServiceComponentState["kind"];
  serviceStatus: LocalComponentStatus;
  skillsStatus: LocalComponentStatus;
}): LocalSetupAction {
  if (input.cliStatus === "update_required") {
    return "update_cli";
  }
  if (input.serviceStatus === "update_required") {
    return "update_service";
  }
  if (input.skillsStatus === "update_required") {
    return "update_skills";
  }
  if (input.serviceKind === "missing") {
    return "connect_service";
  }
  if (
    input.serviceKind === "not_running" ||
    input.serviceKind === "inspection_failed"
  ) {
    return "reconnect_service";
  }
  return "none";
}

async function resolveCliComponentStatus(
  input: CliUpdateInput
): Promise<LocalComponentsStatus["cli"]> {
  const installed = isBinaryDistribution()
    ? await readManagedCliInstallation()
    : null;
  const packageVersion = installed?.version ?? OPENMELD_VERSION;
  const snapshot =
    installed && installed.version !== OPENMELD_VERSION
      ? await readInstalledLocalComponentsSnapshot()
      : null;
  let commandContractVersion = OPENMELD_CLI_COMMAND_CONTRACT_VERSION;
  if (packageVersion !== OPENMELD_VERSION) {
    commandContractVersion =
      snapshot?.manifest.cli.packageVersion === packageVersion
        ? snapshot.manifest.cli.commandContractVersion
        : "unknown";
  }
  const latestPackageVersion = normalizeOptionalString(
    input.latestPackageVersion
  );
  const requiredCommandContractVersion = normalizeOptionalString(
    input.requiredCommandContractVersion
  );
  const reasonCodes: string[] = [];
  let status: LocalComponentStatus = "ok";
  if (
    commandContractVersion === "unknown" ||
    (requiredCommandContractVersion &&
      requiredCommandContractVersion !== commandContractVersion)
  ) {
    status = "update_required";
    reasonCodes.push("cli.command_contract_mismatch");
  } else if (
    latestPackageVersion &&
    compareSemver(packageVersion, latestPackageVersion) < 0
  ) {
    status = "update_available";
    reasonCodes.push("cli.package_update_available");
  }
  return {
    commandContractVersion,
    latestPackageVersion,
    packageVersion,
    reasonCodes,
    requiredCommandContractVersion,
    status,
  };
}

async function resolveServiceComponentState(): Promise<ServiceComponentState> {
  const expectedVersion = await resolveCurrentDaemonExpectedVersion();
  try {
    const [participation, inventory, activeBundle] = await Promise.all([
      resolveDaemonServiceParticipationStatus({ expectedVersion }),
      inspectDaemonServiceInventory({ expectedVersion }),
      readDaemonActiveBundleState().catch(() => null),
    ]);
    const installedBundleVersion =
      resolveInstalledServiceVersion(participation);
    const serviceUpdateReasonCodes = collectServiceUpdateReasonCodes({
      anomalyCodes: inventory.anomalies.map((anomaly) => anomaly.code),
      participation,
    });
    if (serviceUpdateReasonCodes.length > 0) {
      return {
        installedBundleHash: resolveInstalledServiceBundleHash(activeBundle),
        installedBundleVersion,
        kind: "update_required",
        reasonCodes: serviceUpdateReasonCodes,
        status: "update_required",
      };
    }
    if (participation.kind === "missing") {
      return {
        installedBundleHash: null,
        installedBundleVersion: null,
        kind: "missing",
        reasonCodes: ["service.not_installed"],
        status: "ok",
      };
    }
    if (participation.kind === "not_running") {
      return {
        installedBundleHash: resolveInstalledServiceBundleHash(activeBundle),
        installedBundleVersion,
        kind: "not_running",
        reasonCodes: ["service.not_running"],
        status: "ok",
      };
    }
    return {
      installedBundleHash: resolveInstalledServiceBundleHash(activeBundle),
      installedBundleVersion,
      kind: "ok",
      reasonCodes: [],
      status: "ok",
    };
  } catch (error) {
    return {
      installedBundleHash: null,
      installedBundleVersion: null,
      kind: "inspection_failed",
      reasonCodes: [
        `service.inspection_failed:${error instanceof Error ? error.message : "unknown"}`,
      ],
      status: "ok",
    };
  }
}

function resolveInstalledServiceBundleHash(
  activeBundle: Awaited<ReturnType<typeof readDaemonActiveBundleState>>
): string | null {
  if (activeBundle?.bundleFormat === "binary_v1") {
    return null;
  }
  return activeBundle?.sourceDistFingerprint ?? null;
}

async function resolveSkillsComponentState(): Promise<SkillsComponentState> {
  const [installed, snapshot] = await Promise.all([
    resolveInstalledSkillsManifest(),
    collectSkillsReadinessSnapshot().catch(() => null),
  ]);
  if (!snapshot) {
    return {
      installedBundleHash: installed?.bundleHash ?? null,
      reasonCodes: ["skills.status_unavailable"],
      status: "update_required",
      targetCount: 0,
    };
  }
  if (!installed) {
    return {
      installedBundleHash: null,
      reasonCodes: ["skills.bundle_hash_unavailable"],
      status: "update_required",
      targetCount: snapshot.targetCount,
    };
  }
  if (snapshot.status === "action_required") {
    return {
      installedBundleHash: installed.bundleHash,
      reasonCodes: ["skills.update_required"],
      status: "update_required",
      targetCount: snapshot.targetCount,
    };
  }
  return {
    installedBundleHash: installed.bundleHash,
    reasonCodes: snapshot.status === "no_targets" ? ["skills.no_targets"] : [],
    status: "ok",
    targetCount: snapshot.targetCount,
  };
}

async function resolveExpectedSkillsManifest(): Promise<
  LocalComponentsManifest["skills"]
> {
  return (
    (await resolveBundledSkillsManifest()) ?? buildUnavailableSkillsManifest()
  );
}

async function resolveInstalledSkillsManifest(): Promise<
  LocalComponentsManifest["skills"] | null
> {
  const bundled = await resolveBundledSkillsManifest();
  if (bundled) {
    return bundled;
  }

  const activeBundleSource = await resolveActiveBundleSourceSkillsManifest();
  if (activeBundleSource) {
    return activeBundleSource;
  }

  const snapshot = await readInstalledLocalComponentsSnapshot();
  return snapshot?.manifest.skills ?? null;
}

async function resolveBundledSkillsManifest(): Promise<
  LocalComponentsManifest["skills"] | null
> {
  const assets = await loadSelectedSkillAssets()
    .then((selected) => selected.assets)
    .catch(() => null);
  if (!assets || assets.length === 0) {
    return null;
  }
  return {
    bundleHash: hashBundledSkillAssets(assets),
    skillContractVersion: OPENMELD_SKILLS_CONTRACT_VERSION,
    skillIds: ["openmeld-cli"],
  };
}

async function resolveActiveBundleSourceSkillsManifest(): Promise<
  LocalComponentsManifest["skills"] | null
> {
  const activeBundle = await readDaemonActiveBundleState().catch(() => null);
  const sourcePackageRootPath = normalizeOptionalString(
    activeBundle?.sourcePackageRootPath
  );
  if (!sourcePackageRootPath) {
    return null;
  }
  const skillsRootDir = join(sourcePackageRootPath, "skills");
  if (!(await pathExists(skillsRootDir))) {
    return null;
  }
  return await buildSkillsManifestFromRoot(skillsRootDir);
}

async function buildSkillsManifestFromRoot(
  skillsRootDir: string
): Promise<LocalComponentsManifest["skills"]> {
  const bundleHash = await computeDirectoryContentHash({
    rootDir: skillsRootDir,
    ignoredNames: [".openmeld-skill.json"],
  }).catch(() => null);
  return {
    bundleHash,
    skillContractVersion: OPENMELD_SKILLS_CONTRACT_VERSION,
    skillIds: ["openmeld-cli"],
  };
}

function buildUnavailableSkillsManifest(): LocalComponentsManifest["skills"] {
  return {
    bundleHash: null,
    skillContractVersion: OPENMELD_SKILLS_CONTRACT_VERSION,
    skillIds: [],
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function collectServiceUpdateReasonCodes(input: {
  anomalyCodes: readonly DaemonServiceAnomalyCode[];
  participation: Awaited<
    ReturnType<typeof resolveDaemonServiceParticipationStatus>
  >;
}): string[] {
  const reasonCodes: string[] = input.anomalyCodes.filter((code) =>
    SERVICE_COMPONENT_UPDATE_CODES.has(code)
  );
  if (input.participation.kind === "outdated") {
    reasonCodes.push("version_outdated");
  }
  if (input.participation.kind === "needs_repair") {
    reasonCodes.push(
      ...input.participation.anomalyCodes.filter((code) =>
        SERVICE_COMPONENT_UPDATE_CODES.has(code as DaemonServiceAnomalyCode)
      )
    );
  }
  return [...new Set(reasonCodes.map((code) => `service.${code}`))];
}

function resolveInstalledServiceVersion(
  participation: Awaited<
    ReturnType<typeof resolveDaemonServiceParticipationStatus>
  >
): string | null {
  switch (participation.kind) {
    case "ready":
    case "not_running":
    case "needs_repair":
    case "outdated":
      return participation.installedVersion;
    default:
      return null;
  }
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
