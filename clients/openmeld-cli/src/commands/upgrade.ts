import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { cancel, confirm, isCancel } from "@clack/prompts";
import type { OpenMeldToolsUpdateOperation } from "@openmeld/schemas/types";
import { resolveServiceUpdateUrgency } from "../command-entry-checks/service-update-urgency";
import { hasIndependentMaintenanceRegistration } from "../config/daemon-service-update-worker-registration";
import {
  buildNextVersionState,
  type CliBinaryReleaseInfo,
  fetchLatestCliBinaryRelease,
  fetchLatestPackageInfo,
  type OpenMeldVersionStateV1,
  readVersionState,
  writeVersionState,
} from "../config/version-state";
import {
  buildDaemonServiceTargetSpec,
  resolveDaemonServiceAlignmentDecision,
} from "../local-service/lifecycle/daemon-service-alignment-target";
import {
  type DaemonServiceFailureStage,
  formatDaemonFailureContextText,
} from "../local-service/lifecycle/daemon-service-evidence";
import { inspectDaemonServiceInventory } from "../local-service/lifecycle/daemon-service-inventory";
import { scheduleDaemonServiceUpdate } from "../local-service/lifecycle/daemon-service-update-coordinator";
import { resolveVersionChangeDirection } from "../local-service/lifecycle/version-change-direction";
import { readOpenMeldToolsUpdateContextFromEnv } from "../local-service/maintenance/openmeld-tools-update-context";
import { createOpenMeldToolsUpdateCoordinator } from "../local-service/maintenance/openmeld-tools-update-coordinator";
import { resolveExternalOpenMeldToolsUpdate } from "../local-service/maintenance/openmeld-tools-update-join";
import {
  type CliBinaryUpdatePlan,
  downloadCliBinaryUpdateArtifact,
  resolveCliBinaryUpdatePlan,
  verifyCliBinaryCodeSignature,
} from "../runtime/cli-binary-update-artifact";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliTextBlock,
} from "../runtime/cli-entry-command";
import { type RuntimeContext, resolveRuntimeContext } from "../runtime/context";
import {
  type NpmCommandSpec,
  resolveCurrentNpmCommandSpec,
  resolveCurrentNpmGlobalPackageInstall,
} from "../runtime/current-npm-global-install";
import { isBinaryDistribution } from "../runtime/distribution";
import { createUpgradeConfirmationGuideError } from "../runtime/dual-view-guide-catalog";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { buildManualOpenMeldUpgradeCommand } from "../runtime/manual-upgrade";
import {
  diagnoseNpmPackageAcquisitionFailure,
  formatNpmPackageAcquisitionFailureDiagnosis,
} from "../runtime/npm-package-acquisition-diagnostics";
import { createPresenter } from "../runtime/presenter/index";
import { OPENMELD_VERSION } from "../runtime/version";
import {
  formatDaemonServiceDowngradeBlockedRecommendation,
  formatDaemonServiceMissingRecommendation,
} from "../system/local-service-install-attention";
import { formatElapsedTime, resolveElapsedTimeMs } from "../ui/elapsed-time";
import { emitTopLevelAgentOverview } from "./top-level-agent-overview";

const OPENMELD_PACKAGE_NAME = "openmeld";
const CLI_BINARY_DOWNLOAD_TIMEOUT_MS = 60_000;
const BINARY_MANUAL_OPENMELD_UPGRADE_COMMAND =
  "curl -fsSL 'https://openmeld.ai/setup?dist=binary' | sh";
const STAGING_BINARY_MANIFEST_URL =
  "https://staging.openmeld.ai/cli/manifest.json";
const STAGING_BINARY_SETUP_COMMAND =
  "curl -fsSL 'https://staging.openmeld.ai/setup?lane=canary&dist=binary' | sh";
const INSTALL_SELF_JSON_LINE_SPLIT_RE = /\r?\n/u;
const SERVICE_CHECK_STARTED_TEXT = "Checking OpenMeld Service";
const SERVICE_CHECK_COMPLETED_TEXT = "OpenMeld Service check finished.";
export const UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG = "--internal-align-service";

class UpgradeOutputHandledError extends Error {
  readonly code = "openmeld.upgrade.output_handled";

  constructor(message: string) {
    super(message);
    this.name = "UpgradeOutputHandledError";
  }
}

export function isUpgradeOutputHandledError(
  error: unknown
): error is UpgradeOutputHandledError {
  return (
    error instanceof UpgradeOutputHandledError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "openmeld.upgrade.output_handled")
  );
}

type UpgradeDistribution = "npm" | "binary";

type ResolvedUpgradeStatusBase = {
  distribution: UpgradeDistribution;
  currentVersion: string;
  latestVersion: string;
  requiredFloor: string | null;
  checkedAt: string;
  binaryRelease?: CliBinaryReleaseInfo;
};

type InstallableUpgradeStatus = ResolvedUpgradeStatusBase & {
  status: "outdated";
};

type TerminalUpgradeStatus = ResolvedUpgradeStatusBase & {
  status: "up_to_date" | "downgrade_blocked";
};

type UpgradeStatus =
  | InstallableUpgradeStatus
  | TerminalUpgradeStatus
  | {
      status: "check_failed";
      distribution: UpgradeDistribution;
      currentVersion: string;
      checkedAt: string;
      error: string;
    };

type CurrentGlobalInstall = Awaited<
  ReturnType<typeof resolveCurrentNpmGlobalPackageInstall>
>;

export async function runUpgrade(input: {
  view?: string;
  yes?: boolean;
  check?: boolean;
  internalAlignService?: boolean;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  await runUpgradeWithRuntime(input, runtime);
}

export async function runMaintenanceUpgrade(
  internalAlignService = false
): Promise<void> {
  if (!readOpenMeldToolsUpdateContextFromEnv()) {
    throw new Error("OpenMeld maintenance requires a saved update operation.");
  }
  await runUpgradeWithRuntime(
    { yes: true, internalAlignService },
    {
      viewMode: "agent",
      resolvedView: "agent",
      interactive: false,
    }
  );
}

async function runUpgradeWithRuntime(
  input: {
    yes?: boolean;
    check?: boolean;
    internalAlignService?: boolean;
  },
  runtime: RuntimeContext
): Promise<void> {
  const presenter = createPresenter(runtime);
  if (runtime.resolvedView === "agent") {
    emitTopLevelAgentOverview({
      presenter,
      command: "upgrade",
    });
  }

  const currentUpdate = readOpenMeldToolsUpdateContextFromEnv();
  if (!input.check) {
    const existingUpdate = await resolveExternalOpenMeldToolsUpdate({
      currentOperationId: currentUpdate?.operationId,
    });
    if (existingUpdate) {
      emitUpgradeAlreadyRunning({
        operation: existingUpdate,
        presenter,
        resolvedView: runtime.resolvedView,
      });
      return;
    }
  }

  if (input.internalAlignService) {
    await runInternalUpgradeServiceAlignment({
      presenter,
      resolvedView: runtime.resolvedView,
      daemonVersion: OPENMELD_VERSION,
      ...(process.argv[1] && !isBinaryDistribution()
        ? { cliScriptPath: process.argv[1] }
        : {}),
    });
    return;
  }

  const allowPrompt = canUseInteractivePrompts(runtime);
  const currentVersion = OPENMELD_VERSION;
  const { currentGlobalInstall, manualUpgradeCommand } =
    await resolveUpgradeInstallContext();
  const previousVersionState = await readVersionState();
  if (!previousVersionState) {
    handleMissingVersionMetadata({
      presenter,
      resolvedView: runtime.resolvedView,
      manualUpgradeCommand,
    });
  }

  const checkedAt = new Date().toISOString();
  const checkingStage = startUpgradeStage({
    presenter,
    resolvedView: runtime.resolvedView,
    code: "upgrade.checking",
    startedText: "Checking for OpenMeld updates",
  });
  const upgradeStatus = await resolveUpgradeStatus({
    currentVersion,
    checkedAt,
  });
  if (upgradeStatus.status === "check_failed") {
    checkingStage.fail("Could not check for OpenMeld updates.");
  } else {
    checkingStage.complete("Update check finished.");
  }
  if (upgradeStatus.status !== "check_failed") {
    await writeVersionState(
      buildNextVersionState({
        previous: previousVersionState,
        currentVersion,
        latestVersion: upgradeStatus.latestVersion,
        requiredFloor: upgradeStatus.requiredFloor,
        checkedAt,
      })
    );
  }

  if (input.check) {
    emitUpgradeCheckStatus({
      presenter,
      resolvedView: runtime.resolvedView,
      upgradeStatus,
    });
    return;
  }

  if (
    emitTerminalUpgradeStatus({
      presenter,
      resolvedView: runtime.resolvedView,
      upgradeStatus,
    })
  ) {
    await alignServiceWithCurrentCli({
      presenter,
      resolvedView: runtime.resolvedView,
    });
    return;
  }

  if (
    upgradeStatus.status === "outdated" &&
    !(await resolveUpgradeConfirmation({
      allowPrompt,
      yes: Boolean(input.yes),
      message: `Upgrade OpenMeld CLI from ${upgradeStatus.currentVersion} to ${upgradeStatus.latestVersion}?`,
      nonInteractiveError:
        "openmeld upgrade requires --yes in non-interactive mode when upgrade is available",
      resolvedView: runtime.resolvedView,
      scenario: "outdated",
    }))
  ) {
    return;
  }

  if (upgradeStatus.status === "check_failed") {
    handleUpgradeCheckFailure({
      presenter,
      resolvedView: runtime.resolvedView,
      upgradeStatus,
      manualUpgradeCommand,
    });
  }

  const installableUpgradeStatus =
    requireInstallableUpgradeStatus(upgradeStatus);
  if (!currentUpdate && (await hasIndependentMaintenanceRegistration())) {
    await requestMaintainedUpgrade({
      presenter,
      resolvedView: runtime.resolvedView,
    });
    return;
  }
  if (installableUpgradeStatus.distribution === "binary") {
    await installAndReconcileBinaryUpgrade({
      upgradeStatus: installableUpgradeStatus,
      previousVersionState,
      manualUpgradeCommand,
      resolvedView: runtime.resolvedView,
      currentVersion,
      presenter,
    });
    return;
  }

  await installAndReconcileNpmUpgrade({
    upgradeStatus: installableUpgradeStatus,
    previousVersionState,
    currentGlobalInstall,
    manualUpgradeCommand,
    resolvedView: runtime.resolvedView,
    currentVersion,
    presenter,
  });
}

async function alignServiceWithCurrentCli(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): Promise<void> {
  if (
    !readOpenMeldToolsUpdateContextFromEnv() &&
    (await hasIndependentMaintenanceRegistration())
  ) {
    await requestMaintainedUpgrade(input);
    return;
  }
  await runInternalUpgradeServiceAlignment({
    ...input,
    daemonVersion: OPENMELD_VERSION,
    ...(process.argv[1] && !isBinaryDistribution()
      ? { cliScriptPath: process.argv[1] }
      : {}),
  });
}

async function requestMaintainedUpgrade(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): Promise<void> {
  const coordinator = createOpenMeldToolsUpdateCoordinator(
    {},
    { executeUpdates: false }
  );
  const result = await coordinator.requestUpdate({ requestSource: "cli" });
  if (result.status === "already_running") {
    emitUpgradeAlreadyRunning({ ...input, operation: result.operation });
    return;
  }
  if (result.status !== "started" && result.status !== "current") {
    throw new Error(
      "OpenMeld could not start the update. Try again when the update channel is available."
    );
  }
  if (input.resolvedView === "agent") {
    input.presenter.data({ code: "upgrade.maintenance", payload: result });
    return;
  }
  input.presenter.line({
    code: "upgrade.maintenance",
    text:
      result.status === "current"
        ? "OpenMeld is up to date."
        : "OpenMeld is updating in the background. You can close this Terminal.",
  });
}

function emitUpgradeAlreadyRunning(input: {
  operation: OpenMeldToolsUpdateOperation;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): void {
  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: "upgrade.already_running",
      payload: {
        status: "already_running",
        operation: input.operation,
      },
    });
    return;
  }
  input.presenter.line({
    code: "upgrade.already_running",
    text: "An OpenMeld update is already in progress. OpenMeld will keep working in the background, so this command did not start another update. You can close this Terminal.",
    data: {
      operationId: input.operation.operationId,
      phase: input.operation.phase,
      targetVersion: input.operation.targetVersion,
    },
  });
}

function emitUpgradeCheckStatus(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  upgradeStatus: UpgradeStatus;
}): void {
  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: "upgrade.check",
      payload: input.upgradeStatus,
    });
    return;
  }

  switch (input.upgradeStatus.status) {
    case "up_to_date":
    case "downgrade_blocked":
      emitTerminalUpgradeStatus(input);
      return;
    case "outdated":
      input.presenter.line({
        code: "upgrade.update_available",
        text: formatInlineOpenMeldCliCommands(
          `OpenMeld CLI ${input.upgradeStatus.latestVersion} is available (current ${input.upgradeStatus.currentVersion}). Run \`openmeld upgrade\` to install it.`
        ),
      });
      return;
    case "check_failed":
      input.presenter.line({
        code: "upgrade.check_failed",
        text: formatInlineOpenMeldCliCommands(
          "OpenMeld couldn't check for CLI updates. Check your internet connection, then run `openmeld upgrade --check` again."
        ),
      });
      return;
    default: {
      const exhaustiveStatus: never = input.upgradeStatus;
      throw new Error(
        `unsupported upgrade status: ${String(exhaustiveStatus)}`
      );
    }
  }
}

function emitTerminalUpgradeStatus(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  upgradeStatus: UpgradeStatus;
}): boolean {
  if (input.upgradeStatus.status === "up_to_date") {
    if (input.resolvedView === "agent") {
      input.presenter.data({
        code: "upgrade.up_to_date",
        payload: input.upgradeStatus,
      });
    } else {
      input.presenter.line({
        code: "upgrade.up_to_date",
        text: `OpenMeld CLI is already up to date (${input.upgradeStatus.currentVersion}).`,
      });
    }
    return true;
  }

  if (input.upgradeStatus.status === "downgrade_blocked") {
    if (input.resolvedView === "agent") {
      input.presenter.data({
        code: "upgrade.downgrade_blocked",
        payload: input.upgradeStatus,
      });
    } else {
      input.presenter.line({
        code: "upgrade.downgrade_blocked",
        text: `OpenMeld CLI is already newer than ${formatUpgradeLatestSource(
          input.upgradeStatus.distribution
        )} (current v${input.upgradeStatus.currentVersion}, latest v${input.upgradeStatus.latestVersion}). Downgrade is blocked.`,
      });
    }
    return true;
  }

  return false;
}

function requireInstallableUpgradeStatus(
  upgradeStatus: UpgradeStatus
): InstallableUpgradeStatus {
  if (upgradeStatus.status !== "outdated") {
    throw new Error(
      `internal upgrade error: ${upgradeStatus.status} status reached install`
    );
  }
  return upgradeStatus;
}

async function installAndReconcileBinaryUpgrade(input: {
  upgradeStatus: InstallableUpgradeStatus;
  previousVersionState: OpenMeldVersionStateV1 | null;
  manualUpgradeCommand: string;
  resolvedView: "human" | "agent";
  currentVersion: string;
  presenter: ReturnType<typeof createPresenter>;
}): Promise<void> {
  if (!input.upgradeStatus.binaryRelease) {
    throw new Error(
      "Binary upgrade failed before install: missing binary release metadata."
    );
  }
  const binaryRelease = input.upgradeStatus.binaryRelease;
  const updatePlan = await resolveCliBinaryUpdatePlan({
    baseBinaryPath: resolveBinaryUpgradeBasePath(),
    currentVersion: input.currentVersion,
    onDeltaFallback: (error) => {
      process.stderr.write(
        `Small update could not inspect the current CLI; downloading the full update instead. (${error.message})\n`
      );
    },
    release: binaryRelease,
  });
  const binaryInstall = await runUpgradeStage({
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    code: "upgrade.installing",
    startedCode: "upgrade.installing",
    startedText: `Downloading and installing OpenMeld CLI (about ${bytesToRoundedMb(updatePlan.downloadSizeBytes)} MB)`,
    completedText: `OpenMeld CLI ${input.upgradeStatus.latestVersion} installed.`,
    data: {
      command: input.manualUpgradeCommand,
      downloadSizeBytes: updatePlan.downloadSizeBytes,
      distribution: input.upgradeStatus.distribution,
      preferredTransport: updatePlan.transport,
    },
    run: async () =>
      await installLatestCliBinary({
        release: binaryRelease,
        manualUpgradeCommand: input.manualUpgradeCommand,
        updatePlan,
      }),
  });
  const latestVersion = binaryInstall.version;
  await writeVersionState(
    buildNextVersionState({
      previous: input.previousVersionState,
      currentVersion: latestVersion,
      latestVersion,
      requiredFloor: input.upgradeStatus.requiredFloor,
      checkedAt: new Date().toISOString(),
    })
  );

  await runUpgradeStage({
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    code: "upgrade.service_alignment",
    startedText: SERVICE_CHECK_STARTED_TEXT,
    completedText: SERVICE_CHECK_COMPLETED_TEXT,
    run: async () =>
      await handoffUpgradeServiceAlignmentToLatestBinary({
        resolvedView: input.resolvedView,
        command: binaryInstall.managedBinaryPath,
        argsPrefix: [],
      }),
  });

  emitUpgradeCompleted({
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    previousVersion: input.currentVersion,
    currentVersion: latestVersion,
  });
}

function bytesToRoundedMb(sizeBytes: number): number {
  return Math.max(1, Math.round(sizeBytes / (1024 * 1024)));
}

async function installAndReconcileNpmUpgrade(input: {
  upgradeStatus: InstallableUpgradeStatus;
  previousVersionState: OpenMeldVersionStateV1 | null;
  currentGlobalInstall: CurrentGlobalInstall | null;
  manualUpgradeCommand: string;
  resolvedView: "human" | "agent";
  currentVersion: string;
  presenter: ReturnType<typeof createPresenter>;
}): Promise<void> {
  const npmCommandSpec = await resolveCurrentNpmCommandSpec();
  await runUpgradeStage({
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    code: "upgrade.installing",
    startedCode: "upgrade.installing",
    startedText: "Downloading and installing OpenMeld CLI with npm",
    completedText: `OpenMeld CLI ${input.upgradeStatus.latestVersion} installed.`,
    data: {
      command: input.manualUpgradeCommand,
      distribution: input.upgradeStatus.distribution,
    },
    run: async () =>
      await installLatestPackage({
        npmCommandSpec,
        currentGlobalInstall: input.currentGlobalInstall,
        manualUpgradeCommand: input.manualUpgradeCommand,
      }),
  });

  const latestVersion = input.upgradeStatus.latestVersion;
  await writeVersionState(
    buildNextVersionState({
      previous: input.previousVersionState,
      currentVersion: latestVersion,
      latestVersion,
      requiredFloor: input.upgradeStatus.requiredFloor,
      checkedAt: new Date().toISOString(),
    })
  );

  await runUpgradeStage({
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    code: "upgrade.service_alignment",
    startedText: SERVICE_CHECK_STARTED_TEXT,
    completedText: SERVICE_CHECK_COMPLETED_TEXT,
    run: async () =>
      await handoffUpgradeServiceAlignmentToLatestBinary({
        resolvedView: input.resolvedView,
        command: process.execPath,
        argsPrefix: [
          input.currentGlobalInstall?.cliScriptPath ??
            (await resolveLatestInstalledCliScriptPath({
              npmCommandSpec,
            })),
        ],
      }),
  });

  emitUpgradeCompleted({
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    previousVersion: input.currentVersion,
    currentVersion: latestVersion,
  });
}

async function resolveUpgradeInstallContext(): Promise<{
  currentGlobalInstall: Awaited<
    ReturnType<typeof resolveCurrentNpmGlobalPackageInstall>
  > | null;
  manualUpgradeCommand: string;
}> {
  if (isBinaryDistribution()) {
    return {
      currentGlobalInstall: null,
      manualUpgradeCommand: resolveBinaryManualOpenMeldUpgradeCommand(),
    };
  }
  const currentGlobalInstall = await resolveCurrentNpmGlobalPackageInstall({
    packageName: OPENMELD_PACKAGE_NAME,
    ...(readOpenMeldToolsUpdateContextFromEnv() &&
    process.env.OPENMELD_INTERNAL_NPM_INSTALL_ENTRY
      ? { cliScriptPath: process.env.OPENMELD_INTERNAL_NPM_INSTALL_ENTRY }
      : {}),
  });
  if (
    process.env.OPENMELD_INTERNAL_MAINTENANCE_WORKER === "1" &&
    !currentGlobalInstall
  ) {
    throw new Error(
      "OpenMeld could not identify the original npm installation. Automatic update stopped to preserve the current installation."
    );
  }
  return {
    currentGlobalInstall,
    manualUpgradeCommand: buildManualOpenMeldUpgradeCommand({
      globalPrefixPath: currentGlobalInstall?.globalPrefixPath ?? null,
    }),
  };
}

export function resolveBinaryManualOpenMeldUpgradeCommand(
  env: NodeJS.ProcessEnv = process.env
): string {
  return env.OPENMELD_ENV_PRESET === "canary" &&
    env.OPENMELD_CLI_BINARY_MANIFEST_URL === STAGING_BINARY_MANIFEST_URL
    ? STAGING_BINARY_SETUP_COMMAND
    : BINARY_MANUAL_OPENMELD_UPGRADE_COMMAND;
}

function handleMissingVersionMetadata(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  manualUpgradeCommand: string;
}): never {
  const errorMessage = formatOpenMeldCliTextBlock(
    `OpenMeld version metadata is missing, so automatic upgrade cannot continue.\nManual fallback: \`${input.manualUpgradeCommand}\`\nIf you want to repair local OpenMeld state first, run \`openmeld reset --yes\` before \`openmeld upgrade\`.`
  );
  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: "upgrade.metadata.missing",
      payload: {
        summary:
          "Local OpenMeld version metadata is missing, so automatic upgrade cannot verify downgrade safety.",
        nextSteps: [
          input.manualUpgradeCommand,
          "openmeld-dev reset --yes --view agent",
          "openmeld-dev start",
          "openmeld-dev upgrade --check --view agent",
        ],
        humanActionRequired: false,
      },
    });
    throw new UpgradeOutputHandledError(errorMessage);
  }
  throw new Error(errorMessage);
}

function handleUpgradeCheckFailure(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  upgradeStatus: Extract<UpgradeStatus, { status: "check_failed" }>;
  manualUpgradeCommand: string;
}): never {
  const errorMessage = formatOpenMeldCliTextBlock(
    `Version check failed (${input.upgradeStatus.error}). Upgrade stopped because downgrade protection requires confirming that ${formatUpgradeLatestSource(
      input.upgradeStatus.distribution
    )} is newer than the current CLI.\nManual fallback: \`${input.manualUpgradeCommand}\``
  );
  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: "upgrade.check_failed",
      payload: {
        ...input.upgradeStatus,
        nextSteps: [
          input.manualUpgradeCommand,
          "openmeld-dev upgrade --check --view agent",
          "openmeld-dev upgrade --yes --view agent",
        ],
        humanActionRequired: false,
      },
    });
    throw new UpgradeOutputHandledError(errorMessage);
  }
  throw new Error(errorMessage);
}

async function resolveUpgradeStatus(input: {
  currentVersion: string;
  checkedAt: string;
}): Promise<UpgradeStatus> {
  const distribution = resolveCurrentUpgradeDistribution();
  try {
    if (distribution === "binary") {
      const latestInfo = await fetchLatestCliBinaryRelease();
      const latestVersion = latestInfo.version;
      return {
        status: resolveUpgradeStatusKind(
          resolveVersionChangeDirection({
            fromVersion: input.currentVersion,
            toVersion: latestVersion,
          })
        ),
        distribution,
        currentVersion: input.currentVersion,
        latestVersion,
        requiredFloor: latestInfo.minRequiredCliVersion,
        checkedAt: input.checkedAt,
        binaryRelease: latestInfo,
      };
    }

    const latestInfo = await fetchLatestPackageInfo(OPENMELD_PACKAGE_NAME);
    const latestVersion = latestInfo.version;
    return {
      status: resolveUpgradeStatusKind(
        resolveVersionChangeDirection({
          fromVersion: input.currentVersion,
          toVersion: latestVersion,
        })
      ),
      distribution,
      currentVersion: input.currentVersion,
      latestVersion,
      requiredFloor: latestInfo.minRequiredCliVersion,
      checkedAt: input.checkedAt,
    };
  } catch (error) {
    return {
      status: "check_failed",
      distribution,
      currentVersion: input.currentVersion,
      checkedAt: input.checkedAt,
      error: toErrorMessage(error),
    };
  }
}

function resolveUpgradeStatusKind(
  direction: ReturnType<typeof resolveVersionChangeDirection>
): "up_to_date" | "outdated" | "downgrade_blocked" {
  if (direction === "upgrade") {
    return "outdated";
  }
  if (direction === "downgrade") {
    return "downgrade_blocked";
  }
  return "up_to_date";
}

function resolveCurrentUpgradeDistribution(): UpgradeDistribution {
  return isBinaryDistribution() ? "binary" : "npm";
}

function formatUpgradeLatestSource(distribution: UpgradeDistribution): string {
  return distribution === "binary" ? "published binary latest" : "npm latest";
}

async function resolveUpgradeConfirmation(input: {
  allowPrompt: boolean;
  yes: boolean;
  message: string;
  nonInteractiveError: string;
  resolvedView: "human" | "agent";
  scenario: "outdated" | "check_failed";
}): Promise<boolean> {
  if (input.yes) {
    return true;
  }
  if (!input.allowPrompt) {
    if (input.resolvedView === "agent") {
      throw createUpgradeConfirmationGuideError(input.scenario);
    }
    throw new Error(
      formatOpenMeldCliTextBlock(
        `${input.nonInteractiveError}\nexample: \`openmeld upgrade --yes\``
      )
    );
  }

  const choice = await confirm({
    message: input.message,
    initialValue: true,
  });
  if (isCancel(choice) || !choice) {
    cancel("Cancelled.");
    return false;
  }
  return true;
}

async function installLatestCliBinary(input: {
  release: CliBinaryReleaseInfo;
  manualUpgradeCommand: string;
  updatePlan: CliBinaryUpdatePlan;
}): Promise<{
  version: string;
  managedBinaryPath: string;
}> {
  const tmpDir = await mkdtemp(join(tmpdir(), "openmeld-cli-upgrade-"));
  try {
    const artifactBytes = await downloadCliBinaryUpdateArtifact({
      downloadTimeoutMs: CLI_BINARY_DOWNLOAD_TIMEOUT_MS,
      fetchImpl: fetch,
      onDeltaFallback: (error) => {
        process.stderr.write(
          `Small update could not be used; downloading the full update instead. (${error.message})\n`
        );
      },
      plan: input.updatePlan,
      release: input.release,
    });
    const artifactPath = join(
      tmpDir,
      resolveCliBinaryArtifactName(input.release)
    );
    await writeFile(artifactPath, artifactBytes);
    await chmod(artifactPath, 0o755);
    await verifyCliBinaryCodeSignature({
      artifactPath,
      release: input.release,
      runCommand,
    });

    const installResult = await runCommand(artifactPath, [
      "install-self",
      "--force",
      "--json",
    ]);
    if (installResult.code !== 0) {
      const details =
        installResult.stderr.trim() || installResult.stdout.trim();
      throw new Error(
        formatOpenMeldCliTextBlock(
          `binary install-self failed (exit ${installResult.code})${
            details ? `: ${details}` : ""
          }\nManual fallback: \`${input.manualUpgradeCommand}\``
        )
      );
    }

    const installed = parseInstallSelfJsonOutput(installResult.stdout);
    if (installed.version !== input.release.version) {
      throw new Error(
        `binary install-self returned version ${installed.version}, expected ${input.release.version}`
      );
    }
    return installed;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function resolveBinaryUpgradeBasePath(): string {
  return (
    process.env.OPENMELD_INTERNAL_UPGRADE_BASE_BINARY_PATH?.trim() ||
    process.execPath
  );
}

function resolveCliBinaryArtifactName(release: CliBinaryReleaseInfo): string {
  const pathName = new URL(release.url).pathname;
  return (
    basename(pathName) || `openmeld-cli-${release.platform}-${release.version}`
  );
}

function parseInstallSelfJsonOutput(output: string): {
  version: string;
  managedBinaryPath: string;
} {
  const jsonLine = output
    .split(INSTALL_SELF_JSON_LINE_SPLIT_RE)
    .map((line) => line.trim())
    .find((line) => line.startsWith("{"));
  if (!jsonLine) {
    throw new Error("binary install-self did not emit JSON output");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonLine);
  } catch (error) {
    throw new Error(
      `binary install-self emitted invalid JSON: ${toErrorMessage(error)}`
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("binary install-self emitted an invalid JSON payload");
  }
  const record = parsed as Record<string, unknown>;
  if (record.type !== "cli.install_self") {
    throw new Error("binary install-self emitted an unexpected payload type");
  }
  const version =
    typeof record.version === "string" ? record.version.trim() : "";
  const managedBinaryPath =
    typeof record.managedBinaryPath === "string"
      ? record.managedBinaryPath.trim()
      : "";
  if (!(version && managedBinaryPath)) {
    throw new Error("binary install-self emitted an incomplete JSON payload");
  }
  return { version, managedBinaryPath };
}

async function installLatestPackage(input: {
  npmCommandSpec: NpmCommandSpec;
  currentGlobalInstall: Awaited<
    ReturnType<typeof resolveCurrentNpmGlobalPackageInstall>
  >;
  manualUpgradeCommand: string;
}): Promise<void> {
  const args = input.currentGlobalInstall
    ? [
        "install",
        "-g",
        "--prefix",
        input.currentGlobalInstall.globalPrefixPath,
        `${OPENMELD_PACKAGE_NAME}@latest`,
      ]
    : ["install", "-g", `${OPENMELD_PACKAGE_NAME}@latest`];
  const result = await runCommandSpec(input.npmCommandSpec, args);

  if (result.code !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const details = stderr || stdout;
    const diagnosis = diagnoseNpmPackageAcquisitionFailure({
      packageName: OPENMELD_PACKAGE_NAME,
      text: [stderr, stdout].filter(Boolean).join("\n"),
    });
    const diagnosisText = diagnosis
      ? `\n${formatNpmPackageAcquisitionFailureDiagnosis(diagnosis)}`
      : "";
    throw new Error(
      formatOpenMeldCliTextBlock(
        `upgrade failed (exit ${result.code})${details ? `: ${details}` : ""}${diagnosisText}\nManual fallback: \`${input.manualUpgradeCommand}\``
      )
    );
  }
}

async function runInternalUpgradeServiceAlignment(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  daemonVersion: string;
  cliScriptPath?: string;
}): Promise<void> {
  const inventory = await inspectDaemonServiceInventory({
    expectedVersion: input.daemonVersion,
    intendedMode: "background",
    intent: "upgrade_reconcile",
  });
  const target = buildDaemonServiceTargetSpec({
    daemonVersion: input.daemonVersion,
  });
  const decision = resolveDaemonServiceAlignmentDecision({
    inventory,
    target,
  });

  if (decision.status === "already_aligned") {
    emitUpgradeReconcileAlreadyCurrent({
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      expectedVersion: input.daemonVersion,
    });
    return;
  }

  if (decision.status === "not_installed") {
    emitUpgradeReconcileSkipped({
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      reason: "not_installed",
    });
    return;
  }

  if (decision.status === "blocked") {
    const errorMessage = buildUpgradeAlignmentBlockedMessage(
      decision.reasonCodes
    );
    emitUpgradeReconcileFailure({
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      message: errorMessage,
      errorMessage,
      backupDataPath: null,
      failureStage: null,
      evidencePath: null,
    });
    throw new UpgradeOutputHandledError(errorMessage);
  }

  const scheduled = await scheduleDaemonServiceUpdate({
    targetVersion: input.daemonVersion,
    urgency: await resolveServiceUpdateUrgency(),
    ...(readOpenMeldToolsUpdateContextFromEnv() ?? {}),
    ...(input.cliScriptPath ? { cliScriptPath: input.cliScriptPath } : {}),
  });
  if (input.resolvedView === "human") {
    input.presenter.line({
      code: "upgrade.reconcile.scheduled",
      text: "OpenMeld will finish updating the Service in the background. You can close this Terminal.",
    });
    return;
  }
  input.presenter.data({
    code: "upgrade.reconcile.scheduled",
    payload: {
      status: scheduled.status,
      jobId: scheduled.job.jobId,
      targetVersion: scheduled.job.targetVersion,
    },
  });
}

async function handoffUpgradeServiceAlignmentToLatestBinary(input: {
  resolvedView: "human" | "agent";
  command: string;
  argsPrefix: string[];
}): Promise<void> {
  const useInheritedOutput =
    input.resolvedView === "human" &&
    process.stdout.isTTY === true &&
    process.stderr.isTTY === true;
  const handoffResult = await runStreamingCommand(
    input.command,
    process.env.OPENMELD_INTERNAL_MAINTENANCE_WORKER === "1"
      ? [...input.argsPrefix, "maintenance-align-service"]
      : [
          ...input.argsPrefix,
          "--view",
          input.resolvedView,
          "upgrade",
          UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG,
        ],
    {
      OPENMELD_INTERNAL_SKIP_STARTUP_UPGRADE: "1",
    },
    useInheritedOutput
  );
  if (handoffResult.code !== 0) {
    if (useInheritedOutput) {
      throw new Error(
        formatUpgradeReconcileFailureMessage({
          errorMessage: `latest CLI handoff exited with status ${String(
            handoffResult.code
          )}`,
          backupDataPath: null,
          failureStage: null,
          evidencePath: null,
        })
      );
    }
    const hasForwardedOutput =
      handoffResult.stderr.trim().length > 0 ||
      handoffResult.stdout.trim().length > 0;
    if (hasForwardedOutput) {
      throw new UpgradeOutputHandledError(
        "Latest OpenMeld CLI handoff reported a service alignment failure."
      );
    }
    throw new Error(
      formatUpgradeReconcileFailureMessage({
        errorMessage: `latest CLI handoff exited with status ${String(handoffResult.code)}`,
        backupDataPath: null,
        failureStage: null,
        evidencePath: null,
      })
    );
  }
}

async function resolveLatestInstalledCliScriptPath(input: {
  npmCommandSpec: NpmCommandSpec;
}): Promise<string> {
  const npmRootResult = await runCommandSpec(input.npmCommandSpec, [
    "root",
    "-g",
  ]);
  if (npmRootResult.code !== 0) {
    throw new Error(
      npmRootResult.stderr.trim() ||
        npmRootResult.stdout.trim() ||
        "npm root -g failed"
    );
  }
  const cliScriptPath = join(
    npmRootResult.stdout.trim(),
    OPENMELD_PACKAGE_NAME,
    "dist",
    "openmeld.js"
  );
  await stat(cliScriptPath);
  return cliScriptPath;
}

async function runCommand(
  command: string,
  args: string[]
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return await runSpawnedCommand({
    command,
    args,
    forwardOutput: false,
  });
}

async function runCommandSpec(
  commandSpec: NpmCommandSpec,
  args: string[]
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return await runCommand(commandSpec.command, [
    ...commandSpec.argsPrefix,
    ...args,
  ]);
}

async function runStreamingCommand(
  command: string,
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {},
  useInheritedOutput = false
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return await runSpawnedCommand({
    command,
    args,
    forwardOutput: true,
    envOverrides,
    useInheritedOutput,
  });
}

async function runSpawnedCommand(input: {
  command: string;
  args: string[];
  forwardOutput: boolean;
  envOverrides?: NodeJS.ProcessEnv;
  useInheritedOutput?: boolean;
}): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      stdio:
        input.forwardOutput && input.useInheritedOutput
          ? ["ignore", "inherit", "inherit"]
          : ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(input.envOverrides ?? {}),
      },
    });
    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        if (input.forwardOutput) {
          process.stdout.write(text);
        }
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        if (input.forwardOutput) {
          process.stderr.write(text);
        }
      });
    }
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      resolve({
        code: Number(code ?? 1),
        stdout,
        stderr,
      });
    });
  });
}

function formatUpgradeReconcileFailureMessage(input: {
  errorMessage: string;
  backupDataPath: string | null;
  failureStage?: DaemonServiceFailureStage | null;
  evidencePath: string | null;
}): string {
  const failureContext = formatDaemonFailureContextText({
    backupDataPath: input.backupDataPath,
    evidencePath: input.evidencePath,
    failureStage: input.failureStage ?? null,
  });
  return formatInlineOpenMeldCliCommands(
    `Service reconcile failed: ${input.errorMessage}. Please run \`openmeld service repair\` manually.${
      failureContext.length > 0 ? ` ${failureContext}` : ""
    }`
  );
}

function buildUpgradeAlignmentBlockedMessage(
  reasonCodes: readonly string[]
): string {
  if (reasonCodes.includes("downgrade_blocked")) {
    return formatDaemonServiceDowngradeBlockedRecommendation({
      expectedVersion: OPENMELD_VERSION,
    });
  }
  const reasonText =
    reasonCodes.length > 0 ? reasonCodes.join(", ") : "unknown";
  return formatInlineOpenMeldCliCommands(
    `Service alignment is blocked (${reasonText}). Please run \`openmeld service status\` or \`openmeld service repair\` manually.`
  );
}

function emitUpgradeReconcileAlreadyCurrent(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  expectedVersion: string;
}): void {
  if (input.resolvedView === "human") {
    input.presenter.line({
      code: "upgrade.reconcile.already_current",
      text: `OpenMeld Service is already current (v${input.expectedVersion}).`,
    });
    return;
  }

  input.presenter.data({
    code: "upgrade.reconcile.already_current",
    payload: {
      status: "already_current",
      expectedVersion: input.expectedVersion,
    },
  });
}

function emitUpgradeReconcileFailure(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  message: string;
  errorMessage: string;
  backupDataPath: string | null;
  failureStage?: string | null;
  evidencePath: string | null;
}): void {
  if (input.resolvedView === "human") {
    input.presenter.line({
      code: "upgrade.reconcile.failed",
      text: input.message,
    });
    return;
  }

  input.presenter.data({
    code: "upgrade.reconcile.failed",
    payload: {
      ok: false,
      message: input.message,
      errorMessage: input.errorMessage,
      ...(input.backupDataPath ? { backupDataPath: input.backupDataPath } : {}),
      ...(input.failureStage ? { failureStage: input.failureStage } : {}),
      ...(input.evidencePath ? { evidencePath: input.evidencePath } : {}),
      command: "openmeld service repair",
    },
  });
}

function resolveUpgradeReconcileSkipMessage(reason: string): {
  text: string;
  command: string;
} {
  if (reason === "not_installed") {
    return {
      text: formatDaemonServiceMissingRecommendation(),
      command: "openmeld service install",
    };
  }
  if (reason === "downgrade_blocked") {
    return {
      text: formatDaemonServiceDowngradeBlockedRecommendation({
        expectedVersion: OPENMELD_VERSION,
      }),
      command: "openmeld upgrade",
    };
  }
  return {
    text: formatInlineOpenMeldCliCommands(
      "Skipped service reconcile. You can run `openmeld service update` later."
    ),
    command: "openmeld service update",
  };
}

function emitUpgradeReconcileSkipped(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  reason: string;
}): void {
  const { text, command } = resolveUpgradeReconcileSkipMessage(input.reason);
  if (input.resolvedView === "human") {
    input.presenter.line({
      code: "upgrade.reconcile.skipped",
      text,
    });
    return;
  }

  input.presenter.data({
    code: "upgrade.reconcile.skipped",
    payload: {
      skipped: true,
      reason: input.reason,
      command,
    },
  });
}

type UpgradeStageHandle = {
  complete: (text: string) => void;
  fail: (text: string) => void;
};

function startUpgradeStage(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  code: string;
  startedCode?: string;
  startedText: string;
  data?: Record<string, unknown>;
}): UpgradeStageHandle {
  const startedAtMs = Date.now();
  const startedCode = input.startedCode ?? `${input.code}.started`;
  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: startedCode,
      payload: {
        ...(input.data ?? {}),
        message: `${input.startedText}...`,
        state: "started",
      },
    });
  } else {
    input.presenter.line({
      code: startedCode,
      text: `• ${input.startedText}...`,
    });
  }

  const finish = (state: "completed" | "failed", text: string): void => {
    const durationMs = resolveElapsedTimeMs(startedAtMs);
    if (input.resolvedView === "agent") {
      input.presenter.data({
        code: `${input.code}.${state}`,
        payload: {
          ...(input.data ?? {}),
          durationMs,
          message: text,
          state,
        },
      });
      return;
    }
    input.presenter.line({
      code: `${input.code}.${state}`,
      text: `${state === "completed" ? "✓" : "!"} ${text} · ${formatElapsedTime(durationMs)}`,
    });
  };

  return {
    complete: (text) => finish("completed", text),
    fail: (text) => finish("failed", text),
  };
}

async function runUpgradeStage<T>(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  code: string;
  startedCode?: string;
  startedText: string;
  completedText: string;
  failedText?: string;
  data?: Record<string, unknown>;
  run: () => Promise<T>;
}): Promise<T> {
  const stage = startUpgradeStage(input);
  try {
    const result = await input.run();
    stage.complete(input.completedText);
    return result;
  } catch (error) {
    stage.fail(input.failedText ?? `${input.startedText} failed.`);
    throw error;
  }
}

function emitUpgradeCompleted(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  previousVersion: string;
  currentVersion: string;
}): void {
  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: "upgrade.completed",
      payload: {
        previousVersion: input.previousVersion,
        currentVersion: input.currentVersion,
      },
    });
    return;
  }
  input.presenter.line({
    code: "upgrade.completed",
    text: "OpenMeld CLI upgrade completed.",
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
