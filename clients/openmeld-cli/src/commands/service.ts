import { type ChildProcess, spawn } from "node:child_process";
import { cancel, confirm, isCancel, select } from "@clack/prompts";
import { sleep, toErrorMessage } from "@openmeld/utils";
import {
  type AuthenticationGuidance,
  buildHumanAuthenticationCard,
  resolveAuthenticationGuidance,
} from "../auth/auth-guidance";
import { ensureCommandAuthenticationOrCancel } from "../auth/command-auth";
import {
  assessCliUpdate,
  type CliUpdateAssessment,
} from "../command-entry-checks/cli-update-assessment";
import { getCurrentCommandCheckState } from "../command-entry-checks/current-command-check-state";
import { assessServerRequiredVersion } from "../command-entry-checks/server-required-version-assessment";
import { resolveServiceUpdateUrgency } from "../command-entry-checks/service-update-urgency";
import { getAuthSessionState } from "../config/auth-session";
import {
  normalizeGatewayBaseUrl,
  normalizeGatewayBaseUrlOrNull,
  resolveBaseUrlOrNull,
  resolveExplicitGatewayUrlOrThrow,
} from "../config/base-url";
import {
  clearDaemonServiceContract,
  isDaemonServiceContractIdentityReusable,
  readDaemonServiceContract,
  upsertDaemonServiceContract,
} from "../config/daemon-service-contract";
import {
  acquireDaemonServiceLifecycleLock,
  clearDaemonServiceRuntimeState,
  DAEMON_SERVICE_RUNTIME_DETACHED_ENV,
  DAEMON_SERVICE_RUNTIME_MODE_ENV,
  DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV,
  type DaemonRunMode,
  type DaemonServiceRuntimeState,
  type DaemonServiceRuntimeStatus,
  getDaemonStatus,
  installDaemon,
  isDaemonServiceRuntimeHeartbeatStale,
  readDaemonServiceRuntimeSnapshot,
  releaseDaemonServiceLifecycleLock,
  uninstallDaemon,
  withDaemonServiceReconcileLock,
  withDaemonServiceRegistrationMutationLock,
  withDaemonServiceRunLock,
  withDaemonServiceStopLock,
} from "../config/daemon-state";
import { isOpenMeldLockError } from "../config/lock";
import { resolveOpenMeldEnvironmentTarget } from "../config/openmeld-environment-target";
import { resolveOpenMeldEnvPreset } from "../config/paths";
import { canAttachAuthTokenToRequest } from "../config/request-headers";
import { resolveOpenMeldProfileOrNull } from "../config/resolve-openmeld-profile";
import { runDaemonServiceLoop } from "../local-service/carrier/service-runner";
import {
  normalizeOptionalText,
  warnDaemonEvent,
} from "../local-service/core/logger";
import {
  emitDaemonLifecycleEvent,
  runDaemonServiceManagerAction,
  runWithDaemonLifecycleCommandJournal,
} from "../local-service/lifecycle/daemon-lifecycle-journal";
import { installDaemonProcessCrashGuard } from "../local-service/lifecycle/daemon-process-crash-guard";
import {
  buildDaemonServiceTargetSpec,
  resolveDaemonServiceAlignmentDecision,
} from "../local-service/lifecycle/daemon-service-alignment-target";
import { classifyDaemonServiceRunStartability } from "../local-service/lifecycle/daemon-service-anomaly-groups";
import {
  cleanupInactiveDaemonServiceBundles,
  prepareDaemonServiceBundle,
  readDaemonActiveBundleState,
  resolveAlignedDaemonActiveBundleEntryPath,
} from "../local-service/lifecycle/daemon-service-bundle";
import {
  extractDaemonCommandEntryPath,
  resolveDaemonBundleIdFromEntryPath,
} from "../local-service/lifecycle/daemon-service-command-path";
import {
  buildDaemonSystemServiceCommandSpec,
  ensureDaemonSystemServiceCommandFiles,
} from "../local-service/lifecycle/daemon-service-command-spec";
import { writeDaemonServiceContract } from "../local-service/lifecycle/daemon-service-contract-writer";
import {
  buildDaemonServiceDependencyDetails,
  buildDaemonServiceDependencyMeaning,
  buildDaemonServiceDependencyNextStep,
  buildDaemonServiceDependencySummary,
  buildDaemonServiceDependencyTitle,
  type DaemonServiceDependencyIssue,
  resolveDaemonServiceDependencyDiagnostics,
} from "../local-service/lifecycle/daemon-service-dependency-diagnostics";
import {
  captureDaemonServiceEvidence,
  captureDaemonServiceEvidenceBestEffort,
} from "../local-service/lifecycle/daemon-service-evidence";
import { buildDaemonServiceCleanupPlan } from "../local-service/lifecycle/daemon-service-hygiene";
import {
  type DaemonServiceInventory,
  inspectDaemonServiceInventory,
} from "../local-service/lifecycle/daemon-service-inventory";
import { assertDaemonServiceLaunchScope } from "../local-service/lifecycle/daemon-service-launch-scope";
import { cleanupLegacySharedDaemonServiceState } from "../local-service/lifecycle/daemon-service-legacy-shared";
import {
  DaemonServiceLifecycleDrainTimeoutError,
  runDaemonServiceLifecycle,
} from "../local-service/lifecycle/daemon-service-lifecycle";
import {
  type DaemonServiceManager,
  isDaemonServiceJobSpawnPending,
  resolveDaemonServiceManager,
} from "../local-service/lifecycle/daemon-service-manager";
import {
  type DaemonOwnerSnapshot,
  readCurrentDaemonOwnerSnapshot,
  resolveStoppedContractWriteBlockedReason,
  summarizeDaemonOwnerSnapshot,
} from "../local-service/lifecycle/daemon-service-owner-snapshot";
import { listDaemonOwnedProcesses } from "../local-service/lifecycle/daemon-service-process-inventory";
import { clearDaemonServiceRegistrationRepairPending } from "../local-service/lifecycle/daemon-service-registration-repair-state";
import {
  buildDaemonServiceRefreshNextStep,
  buildDaemonServiceUpdateRequiredNextStep,
  formatDaemonServiceRefreshReliabilityMessage,
  formatDaemonServiceUpdateRequiredMessage,
} from "../local-service/lifecycle/daemon-service-repair-guidance";
import {
  clearDaemonRuntimeStateIfDefinitelyStopped,
  getEffectiveDaemonRuntimeStatus,
  readCurrentDaemonRuntimeContext,
  readCurrentObservedDaemonRuntimeStatus,
  resolveDaemonRuntimeState,
  resolveDaemonServiceManagerForRuntimeState,
  waitForDaemonSystemServiceToStop as waitForSystemServiceToStop,
} from "../local-service/lifecycle/daemon-service-runtime";
import { startDaemonSystemServiceWithAutoRepair } from "../local-service/lifecycle/daemon-service-start-recovery";
import { resolveDaemonServiceStartupRecoveryDecision } from "../local-service/lifecycle/daemon-service-startup-recovery";
import {
  isSystemServiceStartupTimeoutError,
  resolveSystemServiceStartupWaitMs,
} from "../local-service/lifecycle/daemon-service-startup-wait";
import { scheduleDaemonServiceUpdate } from "../local-service/lifecycle/daemon-service-update-coordinator";
import {
  ensureDaemonServiceMaintenanceInstalled,
  uninstallDaemonServiceUpdateWorker,
} from "../local-service/lifecycle/daemon-service-update-worker-manager";
import {
  captureDaemonStartFailureLogCursor,
  isDaemonStartFailureLikelyDependencyRequestFailure,
  readDaemonStartFailureLogDiagnostic,
  selectRelevantDaemonStartFailureLogLine,
  summarizeDaemonStartFailureLogLine,
} from "../local-service/lifecycle/daemon-start-failure-log";
import { runDaemonStartupPreflight } from "../local-service/lifecycle/daemon-startup-preflight";
import {
  type LocalServiceDemand,
  resolveLocalServiceDemand,
} from "../local-service/lifecycle/local-service-demand";
import {
  ensureDaemonRuntimePaths,
  resolveDaemonDeviceId,
  resolvePreferredDaemonDeviceId,
} from "../local-service/state/daemon-device-id";
import {
  clearDaemonStartFailureState,
  type DaemonStartFailureState,
  writeDaemonStartFailureState,
} from "../local-service/state/daemon-start-failure-state";
import { resolveDaemonLocalStatusSnapshot } from "../local-service/status/daemon-local-status-snapshot";
import { resolveDaemonStatusSnapshot } from "../local-service/status/daemon-status-snapshot";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
  formatOpenMeldCliCommands,
  formatOpenMeldCliTextBlock,
} from "../runtime/cli-entry-command";
import { emitCliJsonEnvelope } from "../runtime/cli-json-output";
import { type RuntimeContext, resolveRuntimeContext } from "../runtime/context";
import { isBinaryDistribution } from "../runtime/distribution";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { createPresenter } from "../runtime/presenter/index";
import { OPENMELD_VERSION } from "../runtime/version";
import {
  formatDaemonServiceMissingMeaning,
  formatDaemonServiceMissingRunStepOne,
  formatDaemonServiceMissingRunStepTwo,
  formatDaemonServiceMissingStatus,
} from "../system/local-service-install-attention";
import {
  buildDaemonStartNeedsAttentionCard,
  formatDaemonStartAutoRepairResolvedMessage,
  formatDaemonStartStartedManage,
  formatDaemonStartStartedMeaning,
  formatDaemonStartStartedNextStep,
  formatDaemonStartStartedStatus,
  getDaemonStartStartedTitle,
  promptForDaemonRepairDecision,
  runDaemonStartDecisionPrompt,
  shouldOfferDaemonStartDecision,
} from "../system/local-service-start-decision";
import { runDaemonControlCommand } from "./service-control-command";
import type { DaemonBaseInput, DaemonControlInput } from "./service-inputs";
import {
  createDaemonStartSpinner,
  createQuietPresenter,
  createSilentPresenter,
  emitDaemonOverviewIfAgent,
  formatDaemonDisplayRows,
  normalizeText,
  renderDaemonStartDeferredCard,
  renderDaemonStartNeedsAttentionCard,
  renderServiceActionCard,
} from "./service-output";
import {
  attachDaemonReinstallEvidence,
  buildDaemonReinstallAgentPayload,
  buildDaemonReinstallFailureMessage,
  buildDaemonReinstallUnexpectedStartNextStep,
  buildDaemonReinstallUnexpectedStartSummary,
  createDaemonReinstallAlreadyHealthyOutcome,
  createDaemonReinstallCompletedOutcome,
  createDaemonReinstallDowngradeBlockedOutcome,
  createDaemonReinstallDrainTimeoutResult,
  createDaemonReinstallInProgressOutcome,
  createDaemonReinstallStartBlockedOutcome,
  createDaemonReinstallStartFailedOutcome,
  createDaemonReinstallStoppedSafeOutcome,
  DaemonReinstallFailureError,
  type DaemonReinstallOutcome,
  type DaemonReinstallServiceState,
  type DaemonReinstallTimeoutPolicy,
  DaemonReinstallUnexpectedStartError,
  type DaemonServiceMaintenanceAction,
  emitDaemonInstallDowngradeBlocked,
  emitDaemonReinstallResult,
  formatDaemonServiceMaintenanceActionLabel,
  formatDaemonServiceMaintenanceActionTitle,
  formatDaemonServiceMaintenanceCommand,
  isDaemonReinstallCompletedAndStopped,
  isDaemonReinstallHealthyAndRunning,
  normalizeDaemonServiceMaintenanceAction,
  renderDaemonReinstallOutcome,
  resolveDaemonDowngradeBlock,
  resolveDaemonReinstallStartBlockedReason,
  summarizeDaemonReinstallJournalResult,
} from "./service-reinstall-view";
import {
  createDaemonAlreadyRunningResult,
  type DaemonRunResult,
  isDaemonRunAlreadyRunningReason,
  LEGACY_DAEMON_RUN_ALREADY_RUNNING_REASON,
  normalizeDaemonRunReason,
} from "./service-run-result";
import {
  buildDaemonBackgroundStartFailure,
  buildSystemServiceStartupFailureDiagnostics,
  buildSystemServiceStartupFailureMessage,
  buildSystemServiceStartupFailureReport,
  type DaemonBackgroundStartFailure,
  resolveSystemServiceStartupFailureVerdict,
  type SystemServiceStartupFailureVerdict,
  type SystemServiceStartupRecoveryOutcome,
  type SystemServiceStartupRecoveryReport,
  waitForSystemServiceStartup,
} from "./service-start-failure";
import {
  buildDaemonStatusJsonPayload,
  describeDaemonRuntimeStatus,
  emitDaemonAgentLocalStatus,
  emitDaemonAgentStatus,
  emitDaemonStatusForView,
  emitRuntimeProjectionLine,
  formatDaemonInstallNextStep,
  normalizeRuntimeState,
  renderVersionReconciliationCard,
} from "./service-status-view";
import {
  buildDaemonStopSuccessText,
  buildDaemonStopWarningText,
  emitDaemonStopCancelled,
  handleDaemonNotRunningStopStatus,
  isPidAlive,
  type SharedDaemonStopResult,
  stopCurrentLaneDaemonService,
  stopDaemonProcess,
  summarizeDaemonStopJournalResult,
} from "./service-stop-command";
import {
  type DaemonTeardownStrictDependencies,
  type DaemonTeardownStrictInput,
  type DaemonTeardownStrictResult,
  ensureRuntimeCleanAfterStrictTeardown,
  ensureRuntimeStoppedAfterStrictTeardownStop,
  resolveDaemonStrictTeardownContext,
  stopDaemonForStrictTeardown,
  uninstallSystemServiceForStrictTeardown,
  verifySystemServiceRemovedAfterStrictTeardown,
} from "./service-teardown";

export type {
  DaemonRunFailureReason,
  DaemonRunResult,
} from "./service-run-result";

import { syncDeviceRuntimeStateProjection } from "../local-service/reporting/device-runtime-state-sync";
import { formatElapsedTime, resolveElapsedTimeMs } from "../ui/elapsed-time";
import { renderInfoCard } from "../ui/info-card";

type DaemonStatusInput = DaemonBaseInput & {
  json?: boolean;
};

const DAEMON_RUN_MODE_CHOICES = {
  background: "background",
  foreground: "foreground",
  back: "back",
} as const;

const DEFAULT_DAEMON_RUN_MODE = DAEMON_RUN_MODE_CHOICES.background;
const SERVICE_STARTUP_CHECK_MS = 5000;
const SERVICE_STARTUP_POLL_MS = 120;
const REINSTALL_DRAIN_WAIT_MS = 20_000;
const REINSTALL_VERIFY_WAIT_MS = 20_000;
const REINSTALL_VERIFY_POLL_MS = 200;
const REINSTALL_START_RETRY_ATTEMPTS = 2;
const REINSTALL_START_RETRY_DELAY_MS = 600;
const DAEMON_STARTUP_POLL_INTERVAL_MS = 80;
const DAEMON_DETACHED_STARTUP_OUTPUT_LIMIT = 4096;

const DAEMON_MENU_CHOICE = {
  run: "run",
  autostartEnable: "autostart_enable",
  autostartDisable: "autostart_disable",
  status: "status",
  stop: "stop",
  install: "install",
  reinstall: "reinstall",
  update: "update",
  uninstall: "uninstall",
  exit: "exit",
} as const;

const DAEMON_MENU_COMMANDS = [
  "openmeld service start",
  "openmeld service stop",
  "openmeld service autostart enable",
  "openmeld service autostart disable",
  "openmeld service status",
  "openmeld service snapshot",
  "openmeld service install",
  "openmeld service repair",
  "openmeld service update",
  "openmeld service uninstall",
] as const;

type DaemonRunInput = DaemonBaseInput & {
  deviceId?: string;
  heartbeatMs?: number;
  profile?: string;
  gatewayUrl?: string;
  mode?: string;
  entryChecksHandled?: boolean;
  allowModeBack?: boolean;
  outputMode?: "normal" | "silent";
  suppressModeCancelOutput?: boolean;
  suppressStartSpinner?: boolean;
  serviceProgress?: DaemonServiceProgressReporter;
};

export type DaemonRunAfterEntryChecksInput = Omit<
  DaemonRunInput,
  "entryChecksHandled"
>;

export type DaemonServiceProgressReporter = {
  detail: (input: { code: string; text: string }) => void;
};

function emitDaemonServiceProgress(input: {
  code: string;
  progress: DaemonServiceProgressReporter | undefined;
  progressText?: string;
  spinner: ReturnType<typeof createDaemonStartSpinner>;
  text: string;
}): void {
  input.progress?.detail({
    code: input.code,
    text: input.progressText ?? input.text,
  });
  input.spinner?.message(input.text);
}

type DaemonRunInternalOptions = {
  systemServiceStartupWaitMs?: number;
  systemServiceStartupPollMs?: number;
};

type DaemonStopInput = DaemonBaseInput & {
  force?: boolean;
  profile?: string;
};

type DaemonAutostartInput = DaemonBaseInput & {
  action: "enable" | "disable";
  json?: boolean;
};

type DaemonAutostartInternalOptions = {
  clearRegistrationRepairPending?: typeof clearDaemonServiceRegistrationRepairPending;
  resolveServiceManager?: typeof resolveDaemonServiceManager;
  withRegistrationMutationLock?: typeof withDaemonServiceRegistrationMutationLock;
};

type PersistedDaemonServiceContract = NonNullable<
  Awaited<ReturnType<typeof readDaemonServiceContract>>
>;

type DaemonReinstallInput = DaemonBaseInput & {
  displayAction?: DaemonServiceMaintenanceAction;
  force?: boolean;
};

type DaemonInstallInternalOptions = {
  daemonVersion?: string;
  cliScriptPath?: string;
  suppressAgentOverview?: boolean;
  suppressHumanOutput?: boolean;
  serviceProgress?: DaemonServiceProgressReporter;
};

type DaemonUninstallInternalOptions = {
  suppressAgentOverview?: boolean;
  teardown?: (
    input: DaemonTeardownStrictInput
  ) => Promise<DaemonTeardownStrictResult>;
};

export type DaemonReinstallInternalOptions = {
  teardown?: typeof runDaemonTeardownStrict;
  runInstall?: typeof runDaemonInstall;
  runRun?: typeof runDaemonRun;
  readDaemonStatus?: typeof getDaemonStatus;
  withReconcileLock?: typeof withDaemonServiceReconcileLock;
  timeoutPolicy?: DaemonReinstallTimeoutPolicy;
  skipConfirm?: boolean;
  verifyWaitMs?: number;
  drainWaitMs?: number;
  startRetryDelayMs?: number;
  daemonVersion?: string;
  cliScriptPath?: string;
  startAfterInstallMode?: "default" | "always" | "never";
  forceReinstall?: boolean;
  suppressAgentOverview?: boolean;
  suppressHumanResultCard?: boolean;
  suppressInstallOutput?: boolean;
  resolveUpdateUrgency?: typeof resolveServiceUpdateUrgency;
  scheduleServiceUpdate?: typeof scheduleDaemonServiceUpdate;
};

type DaemonInteractiveCommandResult = "completed" | "cancelled";

const isDetachedDaemonServiceRun = (): boolean =>
  process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] === "1";

export const isManagedSystemServiceBootstrapRun = (): boolean =>
  isDetachedDaemonServiceRun() &&
  process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV] === "1";

type DaemonRunAuthReadiness =
  | {
      ready: true;
    }
  | {
      ready: false;
      reason: "authentication_required" | "authentication_environment_mismatch";
      guidance: AuthenticationGuidance;
      nextSteps: string[];
    };

type DaemonRunServiceDependencyDiagnostics = Extract<
  Awaited<ReturnType<typeof resolveDaemonServiceDependencyDiagnostics>>,
  { applicable: true; ready: false }
>;

export async function runDaemon(input: DaemonBaseInput): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  const payload = buildDaemonMenuPayload();
  emitDaemonOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "menu",
    handled: input.agentOverviewHandled,
  });

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "daemon.menu.result",
      payload,
    });
    return;
  }

  if (canUseInteractivePrompts(runtime)) {
    await runInteractiveDaemonMenu({
      gatewayUrl: input.gatewayUrl,
      view: runtime.resolvedView,
    });
    return;
  }

  presenter.line({
    code: "daemon.menu.header",
    text: "OpenMeld Service commands:",
  });
  for (const command of payload.commands) {
    presenter.line({
      code: "daemon.menu.command",
      text: `- ${formatOpenMeldCliCommand(command)}`,
    });
  }
  for (const note of payload.notes) {
    presenter.line({
      code: "daemon.menu.note",
      text: `- ${formatOpenMeldCliTextBlock(note)}`,
    });
  }
}

export async function runDaemonInstall(
  input: DaemonBaseInput,
  options: DaemonInstallInternalOptions = {}
): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  emitDaemonOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "install",
    handled: input.agentOverviewHandled || options.suppressAgentOverview,
  });
  options.serviceProgress?.detail({
    code: "daemon.install.installing",
    text: "Installing OpenMeld Service...",
  });
  const requestedVersion = options.daemonVersion ?? OPENMELD_VERSION;
  const downgradeBlock = await resolveDaemonDowngradeBlock({
    requestedVersion,
  });
  if (downgradeBlock) {
    emitDaemonInstallDowngradeBlocked({
      presenter,
      resolvedView: runtime.resolvedView,
      json: input.json === true,
      downgradeBlock,
    });
    return;
  }

  const preparedBundle = await prepareDaemonServiceBundle({
    daemonVersion: requestedVersion,
    ...(options.cliScriptPath ? { cliScriptPath: options.cliScriptPath } : {}),
  });
  const result = await installDaemon({
    daemonVersion: requestedVersion,
    source: "daemon.command.install",
  });
  await clearDaemonStartFailureStateSafely();
  const serviceManager = await resolveDaemonServiceManager().catch(() => null);
  const existingContract = await readDaemonServiceContract().catch(() => null);
  await alignStoppedDaemonInstallContract({
    existingContract,
    bundleId: preparedBundle.bundleId,
    daemonVersion: result.state.daemonVersion,
  });
  if (!(result.status === "already_installed" && existingContract)) {
    const runtimeStatus =
      result.status === "already_installed"
        ? await readCurrentObservedDaemonRuntimeStatus().catch(() => null)
        : null;
    const desiredState =
      runtimeStatus?.status === "running" && runtimeStatus.mode === "background"
        ? "background"
        : "stopped";
    await maybeWriteDaemonServiceContract({
      runtime,
      daemonVersion: result.state.daemonVersion,
      bundleId: preparedBundle.bundleId,
      desiredState,
      serviceController: serviceManager?.controller,
      runtimeStatus,
      autoStart: desiredState === "background" && runtimeStatus !== null,
      openMeldProfileId: input.profile,
      contractProfileId: input.profile,
      allowDetachedFallback: serviceManager === null,
    });
  }
  const runtimeProjection = await syncDeviceRuntimeStateProjection({
    mode: "repair",
  }).catch(() => null);

  if (input.json === true) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "daemon.install",
      status: result.status,
      state: result.state,
      ...(runtimeProjection ? { runtimeProjection } : {}),
    });
    return;
  }

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "daemon.install.result",
      payload: {
        status: result.status,
        state: result.state,
        ...(runtimeProjection ? { runtimeProjection } : {}),
      },
    });
    return;
  }

  if (options.suppressHumanOutput) {
    return;
  }

  if (result.status === "already_installed") {
    renderServiceActionCard({
      presenter,
      codePrefix: "daemon.install.already",
      title: "✅ OpenMeld Service Already Installed",
      rows: [
        {
          label: "🧩 Status",
          value: "already installed",
        },
        {
          label: "🏷️ Version",
          value: result.state.daemonVersion,
        },
        {
          label: "🚀 Next Step",
          value: formatDaemonInstallNextStep(runtimeProjection),
        },
      ],
    });
    return;
  }

  renderServiceActionCard({
    presenter,
    codePrefix: "daemon.install.completed",
    title: "🎉 OpenMeld Service Installed",
    rows: [
      {
        label: "🧩 Status",
        value: "installed",
      },
      {
        label: "🏷️ Version",
        value: result.state.daemonVersion,
      },
      {
        label: "🚀 Action",
        value: formatDaemonInstallNextStep(runtimeProjection),
      },
    ],
  });
  await emitRuntimeProjectionLine({
    presenter,
    runtimeProjection,
  });
}

async function alignStoppedDaemonInstallContract(input: {
  existingContract: PersistedDaemonServiceContract | null;
  bundleId: string;
  daemonVersion: string;
}): Promise<void> {
  const contract = input.existingContract;
  if (
    contract?.desiredState !== "stopped" ||
    contract.autoStart ||
    contract.bundleId === input.bundleId
  ) {
    return;
  }
  const observed = await readCurrentObservedDaemonRuntimeStatus().catch(
    () => null
  );
  if (observed?.status !== "not_running") {
    return;
  }
  // Install has already activated these files. Keep a stopped contract
  // aligned without changing its account, device, or service registration.
  await upsertDaemonServiceContract({
    ...contract,
    bundleId: input.bundleId,
    daemonVersion: input.daemonVersion,
  });
}

export async function runDaemonUninstall(
  input: DaemonBaseInput,
  options: DaemonUninstallInternalOptions = {}
): Promise<DaemonInteractiveCommandResult> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  emitDaemonOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "uninstall",
    handled: input.agentOverviewHandled || options.suppressAgentOverview,
  });
  const teardown =
    options.teardown ??
    (async (teardownInput: DaemonTeardownStrictInput) =>
      await runDaemonTeardownStrict(teardownInput));
  if (
    input.json !== true &&
    runtime.resolvedView === "human" &&
    canUseInteractivePrompts(runtime) &&
    !(await confirmCleanDaemonUninstall())
  ) {
    return "cancelled";
  }
  const result = await withDaemonServiceReconcileLock(
    async () =>
      await teardown({
        reason: "service_uninstall",
      }),
    {
      intent: "uninstall",
      command: "openmeld service uninstall",
    }
  );
  await clearDaemonServiceContract();
  await clearDaemonStartFailureStateSafely();

  if (input.json === true) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "daemon.uninstall",
      status: result.removed ? "removed" : "not_installed",
    });
    return "completed";
  }

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "daemon.uninstall.result",
      payload: {
        status: result.removed ? "removed" : "not_installed",
        nextStartup: {
          daemonCheck: "will_run",
          recommendation: "install_strongly_recommended",
          installCommand: "openmeld service install",
          displayInstallCommand: formatOpenMeldCliCommand(
            "openmeld service install"
          ),
        },
      },
    });
    return "completed";
  }

  if (!result.removed) {
    renderServiceActionCard({
      presenter,
      codePrefix: "daemon.uninstall.not_installed",
      title: "ℹ️ OpenMeld Service Not Installed",
      rows: [
        {
          label: "🧩 Status",
          value: "no service installation found",
        },
        {
          label: "🚀 Action",
          value: formatInlineOpenMeldCliCommands(
            "Run `openmeld service install` to set up OpenMeld Service."
          ),
        },
      ],
    });
    return "completed";
  }

  renderServiceActionCard({
    presenter,
    codePrefix: "daemon.uninstall.completed",
    title: "🧹 OpenMeld Service Removed",
    rows: [
      {
        label: "🧩 Status",
        value: "service removed cleanly",
      },
      {
        label: "🧹 Result",
        value:
          "OpenMeld stopped local service processes, removed service files, and cleaned background runtime state.",
      },
      {
        label: "🔁 Action",
        value: formatInlineOpenMeldCliCommands(
          "Run `openmeld service install` when you want it back."
        ),
      },
    ],
  });
  return "completed";
}

async function confirmCleanDaemonUninstall(): Promise<boolean> {
  const confirmed = await confirm({
    message:
      "Do a clea OpenMeld Service uninstall now? OpenMeld will stop local service processes and remove OpenMeld service files from this device.",
    initialValue: true,
  });
  if (isCancel(confirmed) || !confirmed) {
    cancel("Cancelled.");
    return false;
  }
  return true;
}

export async function runDaemonReinstall(
  input: DaemonReinstallInput,
  options: DaemonReinstallInternalOptions = {}
): Promise<DaemonReinstallOutcome> {
  const displayAction = normalizeDaemonServiceMaintenanceAction(
    input.displayAction
  );
  const runtime = await resolveRuntimeContext({
    profile: input.profile,
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  emitDaemonOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "reinstall",
    handled:
      input.agentOverviewHandled ||
      options.suppressAgentOverview ||
      input.json === true,
  });
  return await runWithDaemonLifecycleCommandJournal({
    command: formatDaemonServiceMaintenanceCommand(displayAction),
    intent: "reinstall",
    metadata: {
      displayAction,
      force: input.force ?? false,
    },
    resolveResult: summarizeDaemonReinstallJournalResult,
    run: async () => {
      try {
        let outcome = await performDaemonReinstall({
          force: input.force,
          gatewayUrl: input.gatewayUrl,
          profile: input.profile,
          runtime,
          displayAction,
          resolved: resolveDaemonReinstallOptions(options),
        });
        outcome = await attachDaemonReinstallEvidence({
          outcome,
          runtime,
        });
        renderDaemonReinstallOutcome({
          action: displayAction,
          outcome,
          presenter,
          resolvedView: runtime.resolvedView,
          suppressHumanResultCard: options.suppressHumanResultCard,
          json: input.json,
        });
        return outcome;
      } catch (error) {
        if (error instanceof DaemonReinstallUnexpectedStartError) {
          const outcome = await attachDaemonReinstallEvidence({
            outcome: error.outcome,
            runtime,
          });
          if (input.json === true) {
            emitCliJsonEnvelope({
              schemaVersion: 1,
              type: "daemon.reinstall",
              ...buildDaemonReinstallAgentPayload({
                action: displayAction,
                outcome,
              }),
            });
            return outcome;
          }
          emitDaemonReinstallResult({
            action: displayAction,
            outcome,
            presenter,
            resolvedView: runtime.resolvedView,
          });
          renderDaemonStartNeedsAttentionCard({
            presenter,
            codePrefix: "daemon.reinstall.start_failed",
            summary: buildDaemonReinstallUnexpectedStartSummary(
              error.cause,
              displayAction
            ),
            nextStep:
              buildDaemonReinstallUnexpectedStartNextStep(displayAction),
            detail: error.diagnosticDetail ?? undefined,
          });
          return outcome;
        }
        if (error instanceof DaemonReinstallFailureError) {
          throw new Error(
            buildDaemonReinstallFailureMessage({
              action: displayAction,
              backupDataPath: error.backupDataPath,
              errorCode: error.errorCode,
              errorMessage: toErrorMessage(error.cause),
              failureStage: error.failureStage,
              evidencePath:
                error.evidencePath ??
                (await captureDaemonServiceEvidenceBestEffort({
                  runtime,
                  phase: "after_failure",
                })),
              includeDiagnosticDetails:
                input.json === true || runtime.resolvedView === "agent",
              resolvedView: runtime.resolvedView,
            }),
            {
              cause: error.cause,
            }
          );
        }
        throw error;
      }
    },
  });
}

async function performDaemonReinstall(input: {
  displayAction: DaemonServiceMaintenanceAction;
  force?: boolean;
  gatewayUrl?: string;
  profile?: string;
  runtime: RuntimeContext;
  resolved: ReturnType<typeof resolveDaemonReinstallOptions>;
}): Promise<DaemonReinstallOutcome> {
  const downgradeBlock = await resolveDaemonDowngradeBlock({
    requestedVersion: input.resolved.daemonVersion,
    readDaemonStatus: input.resolved.readDaemonStatus,
  });
  if (downgradeBlock) {
    return createDaemonReinstallDowngradeBlockedOutcome({
      installedVersion: downgradeBlock.installedVersion,
      requestedVersion: downgradeBlock.requestedVersion,
    });
  }

  let forceUsed = Boolean(input.force);
  let reinstallTargetDesiredState: "stopped" | "background" = "stopped";

  try {
    if (!input.resolved.forceReinstall) {
      const alreadyHealthy = await input.resolved.withReconcileLock(
        async () =>
          await resolveAlreadyHealthyDaemonRepair({
            expectedVersion: input.resolved.daemonVersion,
            cliScriptPath: input.resolved.cliScriptPath,
            gatewayUrl: input.gatewayUrl,
          })
      );
      if (alreadyHealthy) {
        return alreadyHealthy;
      }
    }

    const confirmed = input.resolved.skipConfirm
      ? true
      : await confirmDaemonReinstall(
          input.runtime,
          input.force,
          input.displayAction
        );
    if (!confirmed) {
      return {
        ok: false,
        result: "cancelled",
      };
    }

    if (input.displayAction === "update") {
      const urgency = await input.resolved.resolveUpdateUrgency({
        ...(input.gatewayUrl ? { gatewayUrl: input.gatewayUrl } : {}),
      });
      const scheduled = await input.resolved.scheduleServiceUpdate({
        targetVersion: input.resolved.daemonVersion,
        urgency,
        ...(input.resolved.cliScriptPath
          ? { cliScriptPath: input.resolved.cliScriptPath }
          : {}),
      });
      return {
        ok: true,
        result: "scheduled",
        jobId: scheduled.job.jobId,
        targetVersion: scheduled.job.targetVersion,
      };
    }

    const lifecycleResult = await input.resolved.withReconcileLock(async () => {
      reinstallTargetDesiredState =
        await resolveDaemonReinstallTargetDesiredState();
      const runLifecycle = async (forceKillAfterDrainTimeout: boolean) =>
        await runDaemonServiceLifecycle({
          expectedVersion: input.resolved.daemonVersion,
          operation: "reinstall",
          installSource: "daemon.command.install",
          desiredState: "stopped",
          shouldStartAfterLifecycle: false,
          forceReinstall: input.resolved.forceReinstall,
          drainWaitMs: input.resolved.drainWaitMs,
          forceKillAfterDrainTimeout,
          ...(input.gatewayUrl ? { gatewayUrl: input.gatewayUrl } : {}),
          ...(input.profile ? { profile: input.profile } : {}),
          ...(input.resolved.cliScriptPath
            ? { cliScriptPath: input.resolved.cliScriptPath }
            : {}),
        });

      try {
        return await runLifecycle(forceUsed);
      } catch (error) {
        if (
          error instanceof DaemonServiceLifecycleDrainTimeoutError &&
          !forceUsed
        ) {
          const shouldForceContinue =
            await resolveReinstallForceDecisionOnTimeout({
              action: input.displayAction,
              runtime: input.runtime,
              timeoutPolicy: input.resolved.timeoutPolicy,
              drainWaitMs: error.waitMs,
            });
          if (!shouldForceContinue) {
            return createDaemonReinstallDrainTimeoutResult(error.waitMs);
          }
          forceUsed = true;
          return await runLifecycle(true);
        }
        throw error;
      }
    });
    if ("result" in lifecycleResult) {
      return lifecycleResult;
    }

    if (lifecycleResult.status === "failed") {
      throw new DaemonReinstallFailureError({
        backupDataPath: lifecycleResult.backupDataPath,
        cause: new Error(lifecycleResult.errorMessage),
        errorCode: lifecycleResult.errorCode,
        evidencePath: lifecycleResult.evidencePath,
        failureStage: lifecycleResult.failureStage,
      });
    }

    if (lifecycleResult.status === "stopped_safe") {
      return createDaemonReinstallStoppedSafeOutcome({
        desiredState: reinstallTargetDesiredState,
        evidencePath: lifecycleResult.evidencePath,
        failureStage: lifecycleResult.failureStage,
        forceUsed,
        errorMessage: lifecycleResult.errorMessage,
        reasonCodes: lifecycleResult.reasonCodes,
      });
    }

    await applyDaemonReinstallTargetDesiredState({
      runtime: input.runtime,
      desiredState: reinstallTargetDesiredState,
      gatewayUrl: input.gatewayUrl,
      profile: input.profile,
    });
    return await completeDaemonReinstallStart({
      runtime: input.runtime,
      resolved: input.resolved,
      forceUsed,
      targetDesiredState: reinstallTargetDesiredState,
      gatewayUrl: input.gatewayUrl,
      profile: input.profile,
    });
  } catch (error) {
    if (isOpenMeldLockError(error)) {
      if (error.contentionState === "orphaned") {
        throw error;
      }
      return createDaemonReinstallInProgressOutcome(
        error.meta,
        input.displayAction
      );
    }
    throw error;
  }
}

async function completeDaemonReinstallStart(input: {
  runtime: RuntimeContext;
  resolved: ReturnType<typeof resolveDaemonReinstallOptions>;
  forceUsed: boolean;
  targetDesiredState: "stopped" | "background";
  gatewayUrl?: string;
  profile?: string;
}): Promise<DaemonReinstallOutcome> {
  const startAfterInstallMode = resolveDaemonReinstallStartMode({
    targetDesiredState: input.targetDesiredState,
    startAfterInstallMode: input.resolved.startAfterInstallMode,
  });

  if (startAfterInstallMode === "never") {
    const shouldRunNow = await maybePromptToRunDaemonAfterStoppedReinstall({
      runtime: input.runtime,
    });
    if (shouldRunNow) {
      return await autoStartDaemonAfterReinstall({
        ...input,
        desiredState: "background",
      });
    }

    await clearDaemonStartFailureStateSafely();
    return createDaemonReinstallCompletedOutcome({
      backupDataPath: null,
      desiredState: "stopped",
      forceUsed: input.forceUsed,
      serviceState: "stopped",
    });
  }

  return await autoStartDaemonAfterReinstall({
    ...input,
    desiredState: "background",
  });
}

async function maybePromptToRunDaemonAfterStoppedReinstall(input: {
  runtime: RuntimeContext;
}): Promise<boolean> {
  if (
    input.runtime.resolvedView !== "human" ||
    !canUseInteractivePrompts(input.runtime)
  ) {
    return false;
  }

  const selected = await confirm({
    message: "OpenMeld Service is repaired but not running yet. Start it now?",
    initialValue: true,
  });
  return !(isCancel(selected) || !selected);
}

async function autoStartDaemonAfterReinstall(input: {
  runtime: RuntimeContext;
  resolved: ReturnType<typeof resolveDaemonReinstallOptions>;
  desiredState: "background" | "stopped";
  forceUsed: boolean;
  gatewayUrl?: string;
  profile?: string;
}): Promise<DaemonReinstallOutcome> {
  const startOutcome = await runDaemonAfterReinstallStartWithRetry({
    desiredState: input.desiredState,
    forceUsed: input.forceUsed,
    gatewayUrl: input.gatewayUrl,
    profile: input.profile,
    resolved: input.resolved,
    startRetryDelayMs: input.resolved.startRetryDelayMs,
    view: input.runtime.resolvedView,
  });

  if (startOutcome.reason === "cancelled") {
    await clearDaemonStartFailureStateSafely();
    return { ok: false, result: "cancelled" };
  }

  const blockReason = resolveDaemonReinstallStartBlockedReason(
    startOutcome.reason
  );
  if (blockReason) {
    // The blocked verdict can be computed while the freshly installed bundle
    // is still starting (it has not written its runtime lease yet). Re-check
    // the live inventory once before telling the user the start was blocked;
    // a healthy running service means the update actually completed.
    const recheckedInventory = await inspectDaemonServiceInventory({
      expectedVersion: input.resolved.daemonVersion,
      intendedMode: "background",
      intent: "reinstall",
    }).catch(() => null);
    if (
      recheckedInventory &&
      isDaemonInventoryRunningAndAligned(recheckedInventory)
    ) {
      await clearDaemonStartFailureStateSafely();
      return createDaemonReinstallCompletedOutcome({
        backupDataPath: null,
        desiredState: input.desiredState,
        forceUsed: input.forceUsed,
        serviceState: "running",
      });
    }
    return createDaemonReinstallStartBlockedOutcome({
      backupDataPath: null,
      blockReason,
      desiredState: input.desiredState,
      forceUsed: input.forceUsed,
      startFailureVerdict: startOutcome.startFailureVerdict,
    });
  }

  if (startOutcome.reason === "start_failed") {
    return createDaemonReinstallStartFailedOutcome({
      backupDataPath: null,
      desiredState: input.desiredState,
      forceUsed: input.forceUsed,
      startFailureVerdict: startOutcome.startFailureVerdict,
    });
  }

  await waitForDaemonHealthyAfterReinstall({
    expectedVersion: input.resolved.daemonVersion,
    readDaemonStatus: input.resolved.readDaemonStatus,
    verifyWaitMs: input.resolved.verifyWaitMs,
  });

  await clearDaemonStartFailureStateSafely();
  return createDaemonReinstallCompletedOutcome({
    backupDataPath: null,
    desiredState: input.desiredState,
    forceUsed: input.forceUsed,
    serviceState: "running",
  });
}

async function runDaemonAfterReinstallStartWithRetry(input: {
  desiredState: "background" | "stopped";
  forceUsed: boolean;
  gatewayUrl?: string;
  profile?: string;
  resolved: ReturnType<typeof resolveDaemonReinstallOptions>;
  startRetryDelayMs: number;
  view: RuntimeContext["resolvedView"];
}): Promise<{
  reason: DaemonRunResult["reason"];
  startFailureVerdict: SystemServiceStartupFailureVerdict | null;
}> {
  const startFailureLogCursor = await captureDaemonStartFailureLogCursor();
  for (
    let attempt = 1;
    attempt <= REINSTALL_START_RETRY_ATTEMPTS;
    attempt += 1
  ) {
    const previousExitCode = process.exitCode;
    try {
      const result = await runDaemonRunAfterEntryChecks(
        {
          agentOverviewHandled: true,
          gatewayUrl: input.gatewayUrl,
          mode: "background",
          outputMode: "silent",
          profile: input.profile,
          suppressStartSpinner: true,
          view: input.view,
        },
        input.resolved.runRun
      );
      if (
        result.ok ||
        isDaemonRunAlreadyRunningReason(result.reason) ||
        normalizeDaemonRunReason(result.reason) === "cancelled"
      ) {
        process.exitCode = previousExitCode;
      }
      if (
        normalizeDaemonRunReason(result.reason) === "start_failed" &&
        attempt < REINSTALL_START_RETRY_ATTEMPTS &&
        !(
          result.ok === false &&
          (result.startFailureVerdict?.localMachineIssue?.recoveryPolicy ===
            "user_action" ||
            (result.startFailureVerdict?.jobDiagnostics &&
              isDaemonServiceJobSpawnPending(
                result.startFailureVerdict.jobDiagnostics
              )))
        )
      ) {
        process.exitCode = previousExitCode;
        await sleep(input.startRetryDelayMs);
        continue;
      }
      return {
        reason: result.reason,
        startFailureVerdict:
          result.ok === false ? (result.startFailureVerdict ?? null) : null,
      };
    } catch (error) {
      const shouldRetry = attempt < REINSTALL_START_RETRY_ATTEMPTS;
      if (shouldRetry) {
        process.exitCode = previousExitCode;
        await sleep(input.startRetryDelayMs);
        continue;
      }

      const startupDiagnostic = await readDaemonStartFailureLogDiagnostic({
        cursor: startFailureLogCursor,
      });
      throw new DaemonReinstallUnexpectedStartError({
        cause: error,
        desiredState: input.desiredState,
        diagnosticDetail: startupDiagnostic?.detail ?? null,
        forceUsed: input.forceUsed,
      });
    }
  }

  return { reason: "start_failed", startFailureVerdict: null };
}

async function resolveDaemonReinstallTargetDesiredState(): Promise<
  "stopped" | "background"
> {
  const currentContract = await readDaemonServiceContract().catch(() => null);
  if (currentContract) {
    return currentContract.desiredState;
  }

  const runtimeContext = await readCurrentDaemonRuntimeContext().catch(
    () => null
  );
  if (
    runtimeContext?.effectiveRuntimeStatus === "running" &&
    runtimeContext.runtimeStatus.mode === "background"
  ) {
    return "background";
  }

  return "stopped";
}

async function applyDaemonReinstallTargetDesiredState(input: {
  runtime: RuntimeContext;
  desiredState: "stopped" | "background";
  gatewayUrl?: string;
  profile?: string;
}): Promise<void> {
  if (input.desiredState === "stopped") {
    await maybeWriteDaemonStoppedContract({
      runtime: input.runtime,
    });
    return;
  }

  const serviceManager = await resolveDaemonServiceManager().catch(() => null);
  await maybeWriteDaemonServiceContract({
    runtime: input.runtime,
    desiredState: "background",
    serviceController: serviceManager?.controller,
    autoStart: true,
    gatewayUrl: input.gatewayUrl,
    openMeldProfileId: input.profile,
    contractProfileId: input.profile,
    allowDetachedFallback: serviceManager === null,
  });
}

function isDaemonInventoryRunningAndAligned(
  inventory: Awaited<ReturnType<typeof inspectDaemonServiceInventory>>
): boolean {
  const decision = resolveDaemonServiceAlignmentDecision({
    inventory,
    target: buildDaemonServiceTargetSpec({
      daemonVersion: inventory.expectedVersion,
    }),
  });
  if (decision.status !== "already_aligned") {
    return false;
  }
  return (
    getEffectiveDaemonRuntimeStatus({
      runtimeState: inventory.runtimeStatus,
      serviceManagerStatus: inventory.serviceManagerStatus,
    }) === "running" &&
    inventory.runtimeStatus.mode === "background" &&
    inventory.serviceManagerStatus?.running === true
  );
}

function resolveDaemonReinstallOptions(
  options: DaemonReinstallInternalOptions
): {
  drainWaitMs: number;
  daemonVersion: string;
  cliScriptPath?: string;
  runRun: typeof runDaemonRun;
  readDaemonStatus: typeof getDaemonStatus;
  withReconcileLock: typeof withDaemonServiceReconcileLock;
  timeoutPolicy: DaemonReinstallTimeoutPolicy;
  skipConfirm: boolean;
  verifyWaitMs: number;
  startRetryDelayMs: number;
  startAfterInstallMode: "default" | "always" | "never";
  forceReinstall: boolean;
  resolveUpdateUrgency: typeof resolveServiceUpdateUrgency;
  scheduleServiceUpdate: typeof scheduleDaemonServiceUpdate;
} {
  const daemonVersion = options.daemonVersion ?? OPENMELD_VERSION;
  return {
    drainWaitMs: options.drainWaitMs ?? REINSTALL_DRAIN_WAIT_MS,
    daemonVersion,
    runRun: options.runRun ?? runDaemonRun,
    readDaemonStatus: options.readDaemonStatus ?? getDaemonStatus,
    withReconcileLock:
      options.withReconcileLock ??
      (async <T>(callback: () => Promise<T>) =>
        await withDaemonServiceReconcileLock(callback, {
          intent: "reinstall",
          command: "openmeld service repair",
        })),
    timeoutPolicy: options.timeoutPolicy ?? "abort",
    skipConfirm: options.skipConfirm ?? false,
    verifyWaitMs: options.verifyWaitMs ?? REINSTALL_VERIFY_WAIT_MS,
    startRetryDelayMs:
      options.startRetryDelayMs ?? REINSTALL_START_RETRY_DELAY_MS,
    startAfterInstallMode: options.startAfterInstallMode ?? "default",
    forceReinstall: options.forceReinstall ?? false,
    resolveUpdateUrgency:
      options.resolveUpdateUrgency ?? resolveServiceUpdateUrgency,
    scheduleServiceUpdate:
      options.scheduleServiceUpdate ?? scheduleDaemonServiceUpdate,
  };
}

async function resolveAlreadyHealthyDaemonRepair(input: {
  expectedVersion: string;
  cliScriptPath?: string;
  gatewayUrl?: string;
}): Promise<Extract<
  DaemonReinstallOutcome,
  { result: "already_healthy" }
> | null> {
  const inventory = await inspectDaemonServiceInventory({
    expectedVersion: input.expectedVersion,
    intent: "reinstall",
    ...(input.cliScriptPath ? { cliScriptPath: input.cliScriptPath } : {}),
  });
  const decision = resolveDaemonServiceAlignmentDecision({
    inventory,
    target: buildDaemonServiceTargetSpec({
      daemonVersion: input.expectedVersion,
      gatewayUrl: input.gatewayUrl,
    }),
  });
  if (decision.status !== "already_aligned") {
    return null;
  }
  if (!inventory.serviceContract) {
    return null;
  }
  const desiredState = inventory.serviceContract.desiredState;
  const effectiveRuntimeStatus = getEffectiveDaemonRuntimeStatus({
    runtimeState: inventory.runtimeStatus,
    serviceManagerStatus: inventory.serviceManagerStatus,
  });
  let serviceState: DaemonReinstallServiceState | null = null;
  if (effectiveRuntimeStatus === "running") {
    serviceState = "running";
  } else if (effectiveRuntimeStatus === "not_running") {
    serviceState = "stopped";
  }
  if (
    !serviceState ||
    (desiredState === "background" && serviceState !== "running") ||
    (desiredState === "stopped" && serviceState !== "stopped")
  ) {
    return null;
  }
  return createDaemonReinstallAlreadyHealthyOutcome({
    desiredState,
    serviceState,
  });
}

function resolveDaemonReinstallStartMode(input: {
  targetDesiredState: "stopped" | "background";
  startAfterInstallMode: "default" | "always" | "never";
}): "always" | "never" {
  if (input.startAfterInstallMode !== "default") {
    return input.startAfterInstallMode;
  }
  return input.targetDesiredState === "background" ? "always" : "never";
}

async function resolveReinstallForceDecisionOnTimeout(input: {
  action: DaemonServiceMaintenanceAction;
  runtime: RuntimeContext;
  timeoutPolicy: DaemonReinstallTimeoutPolicy;
  drainWaitMs: number;
}): Promise<boolean> {
  if (input.timeoutPolicy === "force") {
    return true;
  }
  if (input.timeoutPolicy === "abort") {
    return false;
  }
  if (!canUseInteractivePrompts(input.runtime)) {
    return false;
  }
  const actionLabel = formatDaemonServiceMaintenanceActionLabel(input.action);
  const selected = await confirm({
    message: `Graceful shutdown timed out after ${String(
      input.drainWaitMs
    )}ms. Force continue ${actionLabel} now? (may terminate in-flight tasks)`,
    initialValue: false,
  });
  return !(isCancel(selected) || !selected);
}

async function waitForDaemonHealthyAfterReinstall(input: {
  expectedVersion: string;
  readDaemonStatus: typeof getDaemonStatus;
  verifyWaitMs: number;
}): Promise<DaemonServiceRuntimeStatus> {
  const deadline = Date.now() + input.verifyWaitMs;
  let lastRuntime: DaemonServiceRuntimeStatus | null = null;
  while (Date.now() < deadline) {
    const inventory = await inspectDaemonServiceInventory({
      expectedVersion: input.expectedVersion,
      intendedMode: "background",
      intent: "reinstall",
      readDaemonStatus: input.readDaemonStatus,
    }).catch(() => null);
    if (inventory && isDaemonInventoryRunningAndAligned(inventory)) {
      return inventory.runtimeStatus;
    }
    lastRuntime =
      inventory?.runtimeStatus ??
      (await readCurrentObservedDaemonRuntimeStatus());
    await sleep(REINSTALL_VERIFY_POLL_MS);
  }

  const statusText = lastRuntime
    ? describeDaemonRuntimeStatus(lastRuntime)
    : "No runtime status available.";
  throw new Error(
    `OpenMeld Service repair verification timed out after ${String(
      input.verifyWaitMs
    )}ms. ${statusText}`
  );
}

async function confirmDaemonReinstall(
  runtime: RuntimeContext,
  force: boolean | undefined,
  action: DaemonServiceMaintenanceAction = "repair"
): Promise<boolean> {
  if (!canUseInteractivePrompts(runtime)) {
    return true;
  }

  const actionTitle = formatDaemonServiceMaintenanceActionTitle(action);
  let message = `${actionTitle} OpenMeld Service now? (graceful drain first; timeout will abort)`;
  if (action === "update") {
    message =
      "Update OpenMeld Service? OpenMeld will finish the update in the background when running work is safe.";
  } else if (force) {
    message = `Force ${formatDaemonServiceMaintenanceActionLabel(
      action
    )} OpenMeld Service now? (may terminate in-flight tasks)`;
  }
  const confirmed = await confirm({
    message,
    initialValue: true,
  });
  if (isCancel(confirmed) || !confirmed) {
    cancel("Cancelled.");
    return false;
  }
  return true;
}

const DAEMON_TEARDOWN_STRICT_DEPS: DaemonTeardownStrictDependencies = {
  readCurrentObservedDaemonRuntimeStatus,
  getDaemonStatus,
  resolveDaemonServiceManagerForRuntimeState,
  clearDaemonServiceRuntimeState,
  cleanupLegacySharedDaemonServiceState,
  listDaemonOwnedProcesses,
  stopDaemonProcess,
  waitForSystemServiceToStop,
  uninstallDaemon,
  uninstallServiceUpdateWorker: uninstallDaemonServiceUpdateWorker,
  withRegistrationMutationLock: withDaemonServiceRegistrationMutationLock,
};

export async function runDaemonTeardownStrict(
  input: DaemonTeardownStrictInput,
  overrides: Partial<DaemonTeardownStrictDependencies> = {}
): Promise<DaemonTeardownStrictResult> {
  const deps: DaemonTeardownStrictDependencies = {
    ...DAEMON_TEARDOWN_STRICT_DEPS,
    ...overrides,
  };
  return await deps.withRegistrationMutationLock(
    async () => await runDaemonTeardownStrictWithLock(input, deps),
    {
      intent: "uninstall",
      command:
        input.reason === "reset"
          ? "openmeld reset"
          : "openmeld service uninstall",
    }
  );
}

async function runDaemonTeardownStrictWithLock(
  input: DaemonTeardownStrictInput,
  deps: DaemonTeardownStrictDependencies
): Promise<DaemonTeardownStrictResult> {
  const context = await resolveDaemonStrictTeardownContext({
    deps,
    reason: input.reason,
  });
  const stopSignal = await stopDaemonForStrictTeardown({
    context,
    deps,
    reason: input.reason,
  });
  await ensureRuntimeStoppedAfterStrictTeardownStop({
    deps,
    reason: input.reason,
  });
  const systemServiceUninstalled =
    await uninstallSystemServiceForStrictTeardown({
      context,
      reason: input.reason,
    });
  await verifySystemServiceRemovedAfterStrictTeardown({
    context,
    reason: input.reason,
  });
  await ensureRuntimeCleanAfterStrictTeardown({
    deps,
    reason: input.reason,
  });
  await deps.uninstallServiceUpdateWorker();
  const legacySharedCleanup = context.legacySharedService?.present
    ? await deps.cleanupLegacySharedDaemonServiceState()
    : { removed: false };
  const uninstallResult =
    input.removeInstallFiles === false
      ? { removed: false }
      : await deps.uninstallDaemon();

  return {
    removed:
      uninstallResult.removed ||
      legacySharedCleanup.removed ||
      systemServiceUninstalled,
    stopSignal,
    systemServiceController: context.serviceManager?.controller ?? null,
    systemServiceUninstalled,
  };
}

export async function runDaemonStatus(input: DaemonStatusInput): Promise<void> {
  const runtime = await resolveRuntimeContext({
    profile: input.profile,
    view: input.view,
  });
  if (input.json === true) {
    const environmentTarget = await resolveOpenMeldEnvironmentTarget({
      gatewayUrl: input.gatewayUrl,
    });
    const localSnapshot = await resolveDaemonLocalStatusSnapshot();
    const snapshot = await resolveDaemonStatusSnapshot({
      localSnapshot,
      runtime,
    });
    const channelAssessment = await assessCliUpdate({ environmentTarget });
    const cliVersion = toDaemonStatusCliVersionPayload(channelAssessment);
    const serverAssessment = await assessServerRequiredVersion({
      gatewayUrl: environmentTarget.gatewayUrl,
    });
    emitCliJsonEnvelope(
      buildDaemonStatusJsonPayload({
        cliVersion,
        environmentTarget,
        localSnapshot,
        serverRequirementAssessment: serverAssessment,
        serverRequirementChannelAssessment: channelAssessment,
        snapshot,
      })
    );
    return;
  }

  const presenter = createPresenter(runtime);
  emitDaemonOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "status",
    handled: input.agentOverviewHandled,
  });
  if (runtime.resolvedView === "agent") {
    const environmentTarget = await resolveOpenMeldEnvironmentTarget({
      gatewayUrl: input.gatewayUrl,
    });
    const localSnapshot = await resolveDaemonLocalStatusSnapshot();
    emitDaemonAgentLocalStatus({
      environmentTarget,
      presenter,
      snapshot: localSnapshot,
    });
    const snapshot = await resolveDaemonStatusSnapshot({
      localSnapshot,
      runtime,
    });
    emitDaemonAgentStatus({
      environmentTarget,
      presenter,
      snapshot,
    });
    return;
  }

  const snapshot = await resolveDaemonStatusSnapshot({
    runtime,
  });

  await emitDaemonStatusForView({
    presenter,
    snapshot,
    view: runtime.resolvedView,
  });

  if (runtime.resolvedView === "human") {
    await emitVersionReconciliationForHumanStatus({
      gatewayUrl: input.gatewayUrl,
      presenter,
      snapshot,
    });
  }
}

// Dual-channel version card for the plain human `openmeld service status`
// view: the release channel (already checked elsewhere) alongside the
// server-required visor (new — W-REL-DOCTOR), with a one-line verdict when
// they disagree. Kept out of the main status card so it never disturbs that
// card's existing row-order assertions.
async function emitVersionReconciliationForHumanStatus(input: {
  gatewayUrl?: string;
  presenter: ReturnType<typeof createPresenter>;
  snapshot: Awaited<ReturnType<typeof resolveDaemonStatusSnapshot>>;
}): Promise<void> {
  const environmentTarget = await resolveOpenMeldEnvironmentTarget({
    gatewayUrl: input.gatewayUrl,
  });
  const channelAssessment = await assessCliUpdate({ environmentTarget });
  const serverAssessment = await assessServerRequiredVersion({
    gatewayUrl: environmentTarget.gatewayUrl,
  });
  const daemonStatus = input.snapshot.currentReplyReadiness.daemonStatus;
  renderVersionReconciliationCard({
    channel: channelAssessment,
    installedServiceVersion:
      daemonStatus.installed && daemonStatus.state
        ? daemonStatus.state.daemonVersion
        : null,
    presenter: input.presenter,
    server: serverAssessment,
  });
}

export async function runDaemonSnapshot(input: DaemonBaseInput): Promise<{
  evidencePath: string;
  manifestPath: string;
}> {
  const runtime = await resolveRuntimeContext({
    profile: input.profile,
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  emitDaemonOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "snapshot",
    handled: input.agentOverviewHandled,
  });
  const result = await captureDaemonServiceEvidence({
    runtime,
  });
  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "daemon.snapshot.result",
      payload: result,
    });
  } else {
    presenter.line({
      code: "daemon.snapshot.saved",
      text: `OpenMeld service evidence snapshot saved at ${result.evidencePath}.`,
    });
  }
  return result;
}

export async function runDaemonInterrupt(
  input: DaemonControlInput
): Promise<void> {
  await runDaemonControlCommand({
    ...input,
    command: "interrupt",
  });
}

export async function runDaemonCancel(
  input: DaemonControlInput
): Promise<void> {
  await runDaemonControlCommand({
    ...input,
    command: "cancel",
  });
}

function toDaemonStatusCliVersionPayload(assessment: CliUpdateAssessment): {
  checked: boolean;
  currentVersion: string;
  latestVersion: string | null;
  requiredVersion: string | null;
  updateAvailable: boolean;
} {
  return {
    checked: assessment.checked,
    currentVersion: assessment.currentVersion,
    latestVersion: assessment.latestVersion,
    requiredVersion: assessment.requiredFloor,
    updateAvailable: assessment.updateAvailable,
  };
}

export async function runDaemonStatusFlow(
  input: DaemonStatusInput
): Promise<DaemonInteractiveCommandResult> {
  await runDaemonStatus(input);
  return "completed";
}

async function resolveDaemonRunAuthReadiness(input: {
  gatewayUrl?: string;
}): Promise<DaemonRunAuthReadiness> {
  const authState = await Promise.resolve(
    getAuthSessionState({
      validateRemote: false,
    })
  ).catch((error: unknown) => {
    console.warn("[openmeld.service.auth_session_read_failed]", {
      error: toErrorMessage(error),
    });
    return null;
  });
  const session = authState?.session ?? null;
  if (authState?.state !== "valid" || !session) {
    console.warn("[openmeld.service.auth_session_not_ready]", {
      error: authState?.errorMessage,
      reasonCode: authState?.reasonCode ?? "session_state_unavailable",
      state: authState?.state ?? "unavailable",
    });
    const guidance = resolveAuthenticationGuidance({
      reason: "required",
      action: "starting OpenMeld Service",
    });
    return {
      ready: false,
      reason: "authentication_required",
      guidance,
      nextSteps: [
        formatInlineOpenMeldCliCommands(
          "Run `openmeld login` in an interactive terminal."
        ),
        formatInlineOpenMeldCliCommands(
          "After sign-in succeeds, run `openmeld service start` again."
        ),
      ],
    };
  }

  const resolvedGatewayUrl = await resolveBaseUrlOrNull(input.gatewayUrl);
  if (
    resolvedGatewayUrl &&
    !canAttachAuthTokenToRequest(session, resolvedGatewayUrl)
  ) {
    const authBaseUrl = String(session.authBaseUrl ?? "").trim();
    const guidance = resolveAuthenticationGuidance({
      reason: "mismatch",
      action: "starting OpenMeld Service",
      authBaseUrl,
      gatewayUrl: resolvedGatewayUrl,
    });
    return {
      ready: false,
      reason: "authentication_environment_mismatch",
      guidance,
      nextSteps: [
        formatInlineOpenMeldCliCommands(
          "Run `openmeld login` in an interactive terminal for this OpenMeld environment."
        ),
        `Gateway: ${resolvedGatewayUrl}`,
        ...(authBaseUrl ? [`Signed in to: ${authBaseUrl}`] : []),
        formatInlineOpenMeldCliCommands(
          "After sign-in succeeds, run `openmeld service start` again."
        ),
      ],
    };
  }

  return {
    ready: true,
  };
}

function emitDaemonRunAuthRequired(input: {
  readiness: Exclude<DaemonRunAuthReadiness, { ready: true }>;
  runtime: RuntimeContext;
  presenter: ReturnType<typeof createPresenter>;
}): void {
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "daemon.run.auth_required",
      payload: {
        ok: false,
        reason: input.readiness.reason,
        message: input.readiness.guidance.agentErrorMessage,
        nextSteps: input.readiness.nextSteps,
        guidanceReason: input.readiness.guidance.reason,
        ...(input.readiness.guidance.authBaseUrl
          ? { authBaseUrl: input.readiness.guidance.authBaseUrl }
          : {}),
        ...(input.readiness.guidance.gatewayUrl
          ? { gatewayUrl: input.readiness.guidance.gatewayUrl }
          : {}),
      },
    });
    return;
  }

  const card = buildHumanAuthenticationCard({
    guidance: input.readiness.guidance,
    mode: "error",
  });
  renderServiceActionCard({
    presenter: input.presenter,
    codePrefix: "daemon.run.auth_required",
    title: card.title,
    rows: card.rows,
  });
}

function emitDaemonRunServiceDependenciesUnavailable(input: {
  presenter: ReturnType<typeof createPresenter>;
  diagnostics: DaemonRunServiceDependencyDiagnostics;
  runtime: RuntimeContext;
}): void {
  const summary = buildDaemonServiceDependencySummary({
    issues: input.diagnostics.issues,
    lane: input.diagnostics.lane,
  });
  const meaning = buildDaemonServiceDependencyMeaning({
    issues: input.diagnostics.issues,
    lane: input.diagnostics.lane,
  });
  const nextStep = buildDaemonServiceDependencyNextStep({
    command: "start",
    issues: input.diagnostics.issues,
    lane: input.diagnostics.lane,
  });

  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "daemon.run.service_dependencies_unavailable",
      payload: {
        ok: false,
        reason: "service_dependencies_unavailable",
        message: `${summary} ${meaning}`,
        nextSteps: [
          buildDaemonServiceDependencyDetails({
            issues: input.diagnostics.issues,
          }),
          nextStep,
        ],
      },
    });
    return;
  }

  renderServiceActionCard({
    presenter: input.presenter,
    codePrefix: "daemon.run.service_dependencies_unavailable",
    title: buildDaemonServiceDependencyTitle({
      issues: input.diagnostics.issues,
      lane: input.diagnostics.lane,
    }),
    rows: [
      {
        label: "❌ Status",
        value: "service dependencies unavailable",
      },
      {
        label: "📝 Found",
        value: `${summary}\n${buildDaemonServiceDependencyDetails({
          issues: input.diagnostics.issues,
        })}`,
      },
      {
        label: "📡 Local Service Link",
        value: meaning,
      },
      {
        label: "🔧 Next",
        value: nextStep,
      },
    ],
  });
}

type ResolvedDaemonStartFailure = {
  reason: DaemonStartFailureState["reason"];
  detail: string;
  rawLogLine: string | null;
  dependencyIssues: DaemonServiceDependencyIssue[];
  dependencyDiagnostics: DaemonRunServiceDependencyDiagnostics | null;
};

async function resolveDaemonStartFailure(input: {
  cursor?: Awaited<
    ReturnType<typeof captureDaemonStartFailureLogCursor>
  > | null;
  fallbackRawLine?: string | null;
  gatewayUrl?: string;
}): Promise<ResolvedDaemonStartFailure | null> {
  const startupDiagnostic = input.cursor
    ? await readDaemonStartFailureLogDiagnostic({
        cursor: input.cursor,
      }).catch(() => null)
    : null;
  const rawLogLine =
    normalizeOptionalText(startupDiagnostic?.rawLine) ??
    normalizeOptionalText(input.fallbackRawLine) ??
    null;
  if (
    rawLogLine &&
    isDaemonStartFailureLikelyDependencyRequestFailure(rawLogLine)
  ) {
    const dependencyDiagnostics =
      await resolveDaemonServiceDependencyDiagnostics({
        gatewayUrl: input.gatewayUrl,
        scopePolicy: "all",
      }).catch(() => null);
    if (dependencyDiagnostics?.applicable && !dependencyDiagnostics.ready) {
      return {
        reason: "service_dependencies_unavailable",
        detail: `${buildDaemonServiceDependencySummary({
          issues: dependencyDiagnostics.issues,
          lane: dependencyDiagnostics.lane,
        })} ${buildDaemonServiceDependencyMeaning({
          issues: dependencyDiagnostics.issues,
          lane: dependencyDiagnostics.lane,
        })}`,
        rawLogLine,
        dependencyIssues: dependencyDiagnostics.issues,
        dependencyDiagnostics,
      };
    }
  }

  const detail =
    normalizeOptionalText(startupDiagnostic?.detail) ??
    (rawLogLine ? summarizeDaemonStartFailureLogLine(rawLogLine) : null);
  if (!detail) {
    return null;
  }

  return {
    reason: "startup_failed",
    detail,
    rawLogLine,
    dependencyIssues: [],
    dependencyDiagnostics: null,
  };
}

async function writeDaemonStartFailureStateSafely(
  failure: ResolvedDaemonStartFailure
): Promise<void> {
  await Promise.resolve(
    writeDaemonStartFailureState({
      detail: failure.detail,
      rawLogLine: failure.rawLogLine,
      reason: failure.reason,
      dependencyIssues: failure.dependencyIssues,
    })
  ).catch(() => undefined);
}

async function clearDaemonStartFailureStateSafely(): Promise<void> {
  await Promise.resolve(clearDaemonStartFailureState()).catch(() => undefined);
}

type DaemonRunStartFailurePayload = {
  codePrefix: string;
  controller?: DaemonServiceManager["controller"];
  error: unknown;
  autoRepairAttempted?: boolean;
  recovery?: SystemServiceStartupRecoveryReport | null;
};

function resolveDaemonRunStartFailureVerdict(input: {
  detail: string | null;
  payload: DaemonRunStartFailurePayload;
}): SystemServiceStartupFailureVerdict | null {
  if (!input.payload.controller) {
    return null;
  }
  return resolveSystemServiceStartupFailureVerdict({
    controller: input.payload.controller,
    error: input.payload.error,
    detail: input.detail,
  });
}

function buildLocalMachineIssuePayload(
  verdict: SystemServiceStartupFailureVerdict | null
):
  | {
      localMachineIssue: NonNullable<
        SystemServiceStartupFailureVerdict["localMachineIssue"]
      >;
    }
  | Record<string, never> {
  if (!verdict?.localMachineIssue) {
    return {};
  }
  return { localMachineIssue: verdict.localMachineIssue };
}

function buildDaemonRunStartFailureResult(
  verdict: SystemServiceStartupFailureVerdict | null
): DaemonRunResult {
  if (!verdict) {
    return { ok: false, reason: "start_failed" };
  }
  return {
    ok: false,
    reason: "start_failed",
    startFailureVerdict: verdict,
  };
}

async function handleDaemonRunStartFailure(input: {
  cursor?: Awaited<
    ReturnType<typeof captureDaemonStartFailureLogCursor>
  > | null;
  fallbackRawLine?: string | null;
  gatewayUrl?: string;
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
  genericErrorPayload: DaemonRunStartFailurePayload;
}): Promise<DaemonRunResult> {
  const failure = await resolveDaemonStartFailure({
    cursor: input.cursor ?? null,
    fallbackRawLine: input.fallbackRawLine,
    gatewayUrl: input.gatewayUrl,
  });
  if (failure) {
    await writeDaemonStartFailureStateSafely(failure);
  }

  if (
    failure?.reason === "service_dependencies_unavailable" &&
    failure.dependencyDiagnostics
  ) {
    emitDaemonRunServiceDependenciesUnavailable({
      presenter: input.presenter,
      diagnostics: failure.dependencyDiagnostics,
      runtime: input.runtime,
    });
    process.exitCode = 1;
    return {
      ok: false,
      reason: "start_failed",
    };
  }

  const startFailureVerdict = resolveDaemonRunStartFailureVerdict({
    detail: failure?.detail ?? null,
    payload: input.genericErrorPayload,
  });

  if (input.runtime.resolvedView === "agent") {
    const message = input.genericErrorPayload.controller
      ? buildSystemServiceStartupFailureMessage({
          controller: input.genericErrorPayload.controller,
          error: input.genericErrorPayload.error,
          autoRepairAttempted: input.genericErrorPayload.autoRepairAttempted,
          detail: failure?.detail ?? null,
        })
      : [
          "OpenMeld could not finish starting OpenMeld Service.",
          ...(failure?.detail ? [`Last local detail: ${failure.detail}`] : []),
          `Next: ${formatInlineOpenMeldCliCommands(
            "Run `openmeld service repair` once. OpenMeld saved the startup evidence for diagnostics."
          )}`,
        ].join("\n");
    input.presenter.data({
      code: "daemon.run.start_failed",
      payload: {
        ok: false,
        reason: "system_service_start_failed",
        message,
        ...buildLocalMachineIssuePayload(startFailureVerdict),
        diagnostics: buildSystemServiceStartupFailureDiagnostics({
          autoRepairAttempted: input.genericErrorPayload.autoRepairAttempted,
          controller: input.genericErrorPayload.controller,
          error: input.genericErrorPayload.error,
          recovery: input.genericErrorPayload.recovery ?? null,
        }),
      },
    });
  } else if (input.genericErrorPayload.controller) {
    const failureReport = buildSystemServiceStartupFailureReport({
      controller: input.genericErrorPayload.controller,
      error: input.genericErrorPayload.error,
      autoRepairAttempted: input.genericErrorPayload.autoRepairAttempted,
      detail: failure?.detail ?? null,
    });
    renderServiceActionCard({
      presenter: input.presenter,
      title: failureReport.title,
      codePrefix: input.genericErrorPayload.codePrefix,
      rows: failureReport.rows,
    });
  } else {
    const card = buildDaemonStartNeedsAttentionCard({
      summary: "OpenMeld could not finish starting OpenMeld Service.",
      detail: failure?.detail ?? undefined,
      nextStep: formatInlineOpenMeldCliCommands(
        "Run `openmeld service repair` once. OpenMeld saved the startup evidence for diagnostics."
      ),
    });
    renderServiceActionCard({
      presenter: input.presenter,
      title: card.title,
      codePrefix: input.genericErrorPayload.codePrefix,
      rows: card.rows,
    });
  }
  process.exitCode = 1;
  // Carry the presentation-only verdict so a suppressed (silent) reinstall start
  // can still surface the detailed BTM/crash card upstream. Omit it entirely
  // when there is no controller context, keeping the bare start_failed result
  // shape unchanged for callers that assert on it exactly.
  return buildDaemonRunStartFailureResult(startFailureVerdict);
}

async function runDirectDaemonServiceLoop(input: {
  gatewayUrl?: string;
  deviceId?: string;
  heartbeatMs?: number;
  mode: DaemonRunMode;
  presenter: ReturnType<typeof createPresenter>;
  openMeldProfileId?: string;
  runtime: RuntimeContext;
}): Promise<DaemonRunResult> {
  await clearDaemonStartFailureStateSafely();
  const crashGuard = installDaemonProcessCrashGuard();
  try {
    await runDaemonServiceLoop({
      baseUrl: input.gatewayUrl,
      deviceId: input.deviceId,
      mode: input.mode,
      heartbeatIntervalMs: input.heartbeatMs,
      presenter: input.presenter,
      profile: input.openMeldProfileId,
    });
    return {
      ok: true,
      reason: "started",
    };
  } catch (error) {
    return await handleDaemonRunStartFailure({
      fallbackRawLine: toErrorMessage(error),
      gatewayUrl: input.gatewayUrl,
      presenter: input.presenter,
      runtime: input.runtime,
      genericErrorPayload: {
        codePrefix: "daemon.run.start_failed",
        error,
      },
    });
  } finally {
    crashGuard.dispose();
  }
}

async function ensureInteractiveDaemonRunAuthenticationOrCancel(input: {
  gatewayUrl?: string;
  runtime: RuntimeContext;
}): Promise<boolean> {
  if (
    input.runtime.resolvedView !== "human" ||
    !canUseInteractivePrompts(input.runtime)
  ) {
    return true;
  }

  const resolvedGatewayUrl = await resolveBaseUrlOrNull(input.gatewayUrl);
  return await ensureCommandAuthenticationOrCancel({
    runtime: input.runtime,
    ...(resolvedGatewayUrl ? { gatewayUrl: resolvedGatewayUrl } : {}),
    promptMessage:
      "Sign in is required before OpenMeld Service can start. What do you want to do?",
    allowPrompt: true,
  });
}

async function runDaemonRunInteractivePreflightBeforeModePrompt(input: {
  daemonVersion: string;
  input: DaemonRunInput;
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
}): Promise<DaemonRunResult | null> {
  const inventory = await inspectDaemonServiceInventory({
    expectedVersion: input.daemonVersion,
  }).catch(() => null);
  if (inventory && shouldBlockDaemonRunFromInventory(inventory)) {
    emitDaemonRunBlockedByInventory({
      inventory,
      presenter: input.presenter,
      runtime: input.runtime,
    });
    process.exitCode = 1;
    return {
      ok: false,
      reason: "cleanup_required",
    };
  }

  const { runtimeStatus, effectiveRuntimeStatus } =
    await readCurrentDaemonRuntimeContext();
  if (effectiveRuntimeStatus === "running") {
    emitDaemonAlreadyRunningState(
      input.runtime,
      input.presenter,
      runtimeStatus
    );
    return createDaemonAlreadyRunningResult();
  }

  const authReadiness = await resolveDaemonRunAuthReadiness({
    gatewayUrl: input.input.gatewayUrl,
  });
  if (!authReadiness.ready) {
    emitDaemonRunAuthRequired({
      readiness: authReadiness,
      presenter: input.presenter,
      runtime: input.runtime,
    });
    process.exitCode = 1;
    return {
      ok: false,
      reason: authReadiness.reason,
    };
  }

  return null;
}

export async function runDaemonStop(
  input: DaemonStopInput
): Promise<SharedDaemonStopResult> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter =
    input.json === true
      ? createQuietPresenter(runtime)
      : createPresenter(runtime);
  emitDaemonOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "stop",
    handled: input.agentOverviewHandled || input.json === true,
  });
  const result = await withDaemonServiceStopLock(
    async () =>
      await runWithDaemonLifecycleCommandJournal({
        command: "openmeld service stop",
        intent: "stop",
        metadata: {
          force: input.force ?? false,
          mode: "interactive",
        },
        resolveResult: (stopResult) =>
          summarizeDaemonStopJournalResult(stopResult),
        run: async () => {
          if (resolveOpenMeldEnvPreset() === "dev-local") {
            await uninstallDaemonServiceUpdateWorker();
          }
          const stopped = await executeDaemonStopCommand({
            force: input.force,
            presenter,
            profile: input.profile,
            runtime,
          });
          if (
            resolveOpenMeldEnvPreset() === "dev-local" &&
            (stopped.status === "stopped" || stopped.status === "not_running")
          ) {
            const manager = await resolveDaemonServiceManager();
            if (manager) {
              await manager.stop();
              await manager.waitUntilStopped();
            }
          }
          return stopped;
        },
      }),
    {
      intent: "stop",
      command: "openmeld service stop",
    }
  );
  if (input.json === true) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "daemon.stop",
      ...result,
    });
  }
  return result;
}

export async function runDaemonAutostart(
  input: DaemonAutostartInput,
  options: DaemonAutostartInternalOptions = {}
): Promise<{
  action: "enable" | "disable";
  controller: DaemonServiceManager["controller"];
  enabled: boolean;
  serviceManagerStatus: Awaited<ReturnType<DaemonServiceManager["status"]>>;
}> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter =
    input.json === true
      ? createQuietPresenter(runtime)
      : createPresenter(runtime);

  const resolveServiceManager =
    options.resolveServiceManager ?? resolveDaemonServiceManager;
  const clearRegistrationRepairPending =
    options.clearRegistrationRepairPending ??
    clearDaemonServiceRegistrationRepairPending;
  const withRegistrationMutationLock =
    options.withRegistrationMutationLock ??
    withDaemonServiceRegistrationMutationLock;
  const result = await withRegistrationMutationLock(
    async () => {
      const serviceManager = await resolveServiceManager();
      if (!serviceManager) {
        throw new Error(
          "OpenMeld Service autostart is unavailable because this device has no supported service manager."
        );
      }

      const before = await serviceManager.status();
      if (!before.installed) {
        throw new Error(
          "OpenMeld Service is not installed. Run `openmeld service install` before changing service autostart."
        );
      }

      if (input.action === "enable") {
        await serviceManager.enableAutostart();
      } else {
        await serviceManager.disableAutostart();
      }

      const serviceManagerStatus = await serviceManager.status();
      const desiredEnabled = input.action === "enable";
      if (serviceManagerStatus.enabled !== desiredEnabled) {
        throw new Error(
          `OpenMeld Service autostart ${input.action} was not confirmed by ${serviceManager.controller}.`
        );
      }
      await clearRegistrationRepairPending();
      return {
        action: input.action,
        controller: serviceManager.controller,
        enabled: serviceManagerStatus.enabled,
        serviceManagerStatus,
      };
    },
    {
      intent: "autostart",
      command: `openmeld service autostart ${input.action}`,
    }
  );

  if (input.json === true) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "daemon.autostart",
      ...result,
    });
    return result;
  }

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "daemon.autostart.result",
      payload: result,
    });
    return result;
  }

  renderServiceActionCard({
    presenter,
    codePrefix: "daemon.autostart.completed",
    title:
      result.enabled === true
        ? "OpenMeld Service Autostart Enabled"
        : "OpenMeld Service Autostart Disabled",
    rows: [
      {
        label: "Status",
        value:
          result.enabled === true
            ? "OpenMeld Service is allowed to start automatically when you sign in."
            : "OpenMeld Service will not start automatically when you sign in.",
      },
      {
        label: "Current process",
        value:
          "Current running or stopped state was left unchanged. Use `openmeld service status` to inspect it.",
      },
    ],
  });

  return result;
}

async function executeDaemonStopCommand(input: {
  force?: boolean;
  presenter: ReturnType<typeof createPresenter>;
  profile?: string;
  runtime: RuntimeContext;
}): Promise<SharedDaemonStopResult> {
  const stopResult = await stopCurrentLaneDaemonService({
    force: input.force,
    mode: "interactive",
    runtime: input.runtime,
  });

  if (stopResult.status === "not_running") {
    await maybeWriteDaemonStoppedContract({
      runtime: input.runtime,
      runtimeStatus: stopResult.runtimeStatus,
    });
    await handleDaemonNotRunningStopStatus(
      input.runtime,
      input.presenter,
      stopResult.runtimeStatus
    );
    return stopResult;
  }

  if (stopResult.status === "cancelled") {
    emitDaemonStopCancelled(input.runtime, input.presenter);
    return stopResult;
  }

  if (stopResult.status === "warning") {
    input.presenter.line({
      code:
        stopResult.reason === "invalid_state"
          ? "daemon.stop.invalid_state"
          : "daemon.stop.timeout",
      text: buildDaemonStopWarningText(stopResult),
    });
    return stopResult;
  }

  await maybeWriteDaemonStoppedContract({
    runtime: input.runtime,
  });
  await clearDaemonStartFailureStateSafely();
  input.presenter.line({
    code: stopResult.forcedAfterTimeout
      ? "daemon.stop.killed"
      : "daemon.stop.success",
    text: buildDaemonStopSuccessText(stopResult),
  });
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "daemon.stop.result",
      payload: {
        ok: true,
        signal: stopResult.signal,
        pid: stopResult.pid,
        ...(stopResult.signal === "system" ? { status: "stopped" } : {}),
      },
    });
  }
  return stopResult;
}

export async function bestEffortStopCurrentLaneDaemonService(input: {
  force?: boolean;
  runtime: RuntimeContext;
}): Promise<SharedDaemonStopResult> {
  try {
    return await withDaemonServiceStopLock(
      async () =>
        await stopCurrentLaneDaemonService({
          force: input.force,
          mode: "best_effort",
          runtime: input.runtime,
        }),
      {
        intent: "stop",
        command: "openmeld auth logout",
      }
    );
  } catch (error) {
    if (!isOpenMeldLockError(error)) {
      throw error;
    }
    let errorMessage = error.message;
    const runtimeStatus = await readCurrentObservedDaemonRuntimeStatus().catch(
      (statusError: unknown) => {
        errorMessage = `${errorMessage}; service status could not be read: ${toErrorMessage(statusError)}`;
        return {
          status: "unknown" as const,
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
          managedBySystemService: false,
          serviceController: "unknown" as const,
          autoStart: false,
          reason: "status_unavailable",
        };
      }
    );
    return {
      status: "warning",
      pid: runtimeStatus.pid,
      reason: "stop_failed",
      runtimeStatus,
      errorMessage,
    };
  }
}

export async function runDaemonRun(
  input: DaemonRunInput,
  options: DaemonRunInternalOptions = {}
): Promise<DaemonRunResult> {
  await assertDaemonServiceLaunchScope();
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter =
    input.outputMode === "silent" || isDetachedDaemonServiceRun()
      ? createSilentPresenter(runtime.resolvedView)
      : createPresenter(runtime);
  emitDaemonOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "run",
    handled: input.agentOverviewHandled,
  });
  const status = await getDaemonStatus();
  if (!status.installed) {
    const message = formatInlineOpenMeldCliCommands(
      "OpenMeld service is not installed yet. Run `openmeld service install` first."
    );
    if (runtime.resolvedView === "agent") {
      presenter.data({
        code: "daemon.run.not_installed",
        payload: {
          ok: false,
          reason: "service_not_installed",
          message,
          nextSteps: formatOpenMeldCliCommands([
            "openmeld service install",
            "openmeld service start",
          ]),
        },
      });
    } else {
      renderServiceActionCard({
        presenter,
        codePrefix: "daemon.run.not_installed",
        title: "⚠️ OpenMeld Service Not Installed",
        rows: [
          {
            label: "🧩 Status",
            value: formatDaemonServiceMissingStatus(),
          },
          {
            label: "📡 Local Service Link",
            value: formatDaemonServiceMissingMeaning(),
          },
          {
            label: "🚀 Step 1",
            value: formatDaemonServiceMissingRunStepOne(),
          },
          {
            label: "▶️ Step 2",
            value: formatDaemonServiceMissingRunStepTwo(),
          },
        ],
      });
    }
    throw new Error(message);
  }

  if (!input.entryChecksHandled) {
    const authReady = await ensureInteractiveDaemonRunAuthenticationOrCancel({
      runtime,
      gatewayUrl: input.gatewayUrl,
    });
    if (!authReady) {
      return {
        ok: false,
        reason: "cancelled",
      };
    }
  }

  if (!input.mode && canUseInteractivePrompts(runtime)) {
    const preflightResult =
      await runDaemonRunInteractivePreflightBeforeModePrompt({
        daemonVersion: OPENMELD_VERSION,
        input,
        presenter,
        runtime,
      });
    if (preflightResult) {
      return preflightResult;
    }
  }

  const mode = await resolveDaemonRunMode({
    rawMode: input.mode,
    canPrompt: canUseInteractivePrompts(runtime),
    allowBack: input.allowModeBack,
  });
  if (mode === DAEMON_RUN_MODE_CHOICES.back) {
    return {
      ok: false,
      reason: "cancelled",
    };
  }
  if (mode === null) {
    if (!input.suppressModeCancelOutput) {
      cancel("Cancelled.");
    }
    return {
      ok: false,
      reason: "cancelled",
    };
  }

  return await executeResolvedDaemonRun({
    daemonVersion: OPENMELD_VERSION,
    input,
    mode,
    options,
    presenter,
    runtime,
  });
}

export async function runDaemonRunAfterEntryChecks(
  input: DaemonRunAfterEntryChecksInput,
  runRun: typeof runDaemonRun = runDaemonRun
): Promise<DaemonRunResult> {
  return await runRun({
    ...input,
    entryChecksHandled: true,
  });
}

async function executeResolvedDaemonRun(input: {
  daemonVersion: string;
  input: DaemonRunInput;
  mode: DaemonRunMode;
  options: DaemonRunInternalOptions;
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
}): Promise<DaemonRunResult> {
  if (isDetachedDaemonServiceRun()) {
    return await executeDaemonRunWithJournal({
      daemonVersion: input.daemonVersion,
      detached: true,
      input: input.input,
      mode: input.mode,
      presenter: input.presenter,
      runtime: input.runtime,
      systemServiceStartupPollMs: input.options.systemServiceStartupPollMs,
      systemServiceStartupWaitMs: input.options.systemServiceStartupWaitMs,
    });
  }

  if (input.mode === "foreground") {
    return await executeForegroundDaemonRunWithStartupLock({
      daemonVersion: input.daemonVersion,
      input: input.input,
      mode: input.mode,
      presenter: input.presenter,
      runtime: input.runtime,
      systemServiceStartupPollMs: input.options.systemServiceStartupPollMs,
      systemServiceStartupWaitMs: input.options.systemServiceStartupWaitMs,
    });
  }

  return await withDaemonServiceRunLock(
    async () =>
      await executeDaemonRunWithJournal({
        daemonVersion: input.daemonVersion,
        detached: false,
        input: input.input,
        mode: input.mode,
        presenter: input.presenter,
        runtime: input.runtime,
        systemServiceStartupPollMs: input.options.systemServiceStartupPollMs,
        systemServiceStartupWaitMs: input.options.systemServiceStartupWaitMs,
      }),
    {
      intent: "run_background",
      command: "openmeld service run",
    }
  );
}

async function executeForegroundDaemonRunWithStartupLock(input: {
  daemonVersion: string;
  input: DaemonRunInput;
  mode: DaemonRunMode;
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
  systemServiceStartupPollMs?: number;
  systemServiceStartupWaitMs?: number;
}): Promise<DaemonRunResult> {
  const lifecycleLock = await acquireDaemonServiceLifecycleLock({
    intent: "run_foreground",
    command: "openmeld service run",
  });
  let lifecycleLockReleased = false;

  const releaseLifecycleLock = async (): Promise<void> => {
    if (lifecycleLockReleased) {
      return;
    }
    lifecycleLockReleased = true;
    await releaseDaemonServiceLifecycleLock(lifecycleLock);
  };

  try {
    return await executeDaemonRunWithJournal({
      daemonVersion: input.daemonVersion,
      detached: false,
      input: input.input,
      mode: input.mode,
      onBeforeForegroundLoop: releaseLifecycleLock,
      presenter: input.presenter,
      runtime: input.runtime,
      systemServiceStartupPollMs: input.systemServiceStartupPollMs,
      systemServiceStartupWaitMs: input.systemServiceStartupWaitMs,
    });
  } finally {
    await releaseLifecycleLock();
  }
}

async function executeDaemonRunWithJournal(input: {
  daemonVersion: string;
  detached: boolean;
  input: DaemonRunInput;
  mode: DaemonRunMode;
  onBeforeForegroundLoop?: (() => Promise<void>) | undefined;
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
  systemServiceStartupPollMs?: number;
  systemServiceStartupWaitMs?: number;
}): Promise<DaemonRunResult> {
  return await runWithDaemonLifecycleCommandJournal({
    command: "openmeld service run",
    intent: input.mode === "foreground" ? "run_foreground" : "run_background",
    // Stamp the daemon-process begin event with its uptime so the ~45s gap
    // between the supervisor's start action and this begin can be split into
    // launchd/BTM spawn-decision latency versus daemon early init.
    includeProcessUptime: true,
    metadata: {
      detached: input.detached,
      mode: input.mode,
    },
    resolveResult: summarizeDaemonRunJournalResult,
    run: async () =>
      await runSystemDaemonCore({
        input: input.input,
        systemServiceStartupPollMs: input.systemServiceStartupPollMs,
        systemServiceStartupWaitMs: input.systemServiceStartupWaitMs,
        runtime: input.runtime,
        presenter: input.presenter,
        mode: input.mode,
        daemonVersion: input.daemonVersion,
        onBeforeForegroundLoop: input.onBeforeForegroundLoop,
      }),
  });
}

function summarizeDaemonRunJournalResult(result: DaemonRunResult): {
  metadata?: Record<string, unknown>;
  result: string;
} {
  return {
    result: result.reason,
    metadata: {
      ok: result.ok,
    },
  };
}

export async function runDaemonBackgroundStartForDecision(input: {
  view?: string;
  gatewayUrl?: string;
  profile?: string;
  serviceProgress?: DaemonServiceProgressReporter;
  suppressStartSpinner?: boolean;
}): Promise<
  "started" | DaemonBackgroundStartFailure | "deferred_with_card" | "cancelled"
> {
  const repairResult =
    await maybeRunDaemonRepairBeforeBackgroundStartDecision(input);
  if (repairResult) {
    return repairResult;
  }

  const previousExitCode = process.exitCode;
  const result = await runDaemonRunAfterEntryChecks({
    agentOverviewHandled: true,
    gatewayUrl: input.gatewayUrl,
    mode: "background",
    profile: input.profile,
    ...(input.serviceProgress
      ? { serviceProgress: input.serviceProgress }
      : {}),
    ...(input.suppressStartSpinner === true
      ? { suppressStartSpinner: true }
      : {}),
    view: input.view,
  });
  if (result.ok || isDaemonRunAlreadyRunningReason(result.reason)) {
    process.exitCode = previousExitCode;
    return "started";
  }
  if (normalizeDaemonRunReason(result.reason) === "cancelled") {
    process.exitCode = previousExitCode;
    return "cancelled";
  }
  return buildDaemonBackgroundStartFailure(
    result.ok ? null : (result.startFailureVerdict ?? null)
  );
}

async function maybeRunDaemonRepairBeforeBackgroundStartDecision(input: {
  view?: string;
}): Promise<
  | "started"
  | DaemonBackgroundStartFailure
  | "deferred_with_card"
  | "cancelled"
  | null
> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  if (runtime.resolvedView !== "human" || !canUseInteractivePrompts(runtime)) {
    return null;
  }

  const status = await getDaemonStatus().catch(() => null);
  if (!status?.installed) {
    return null;
  }

  const inventory = await inspectDaemonServiceInventory({
    expectedVersion: OPENMELD_VERSION,
    intendedMode: "background",
  }).catch(() => null);
  if (!(inventory && shouldBlockDaemonRunFromInventory(inventory))) {
    return null;
  }

  const decision = await promptForDaemonRepairDecision();
  if (decision === "cancelled") {
    return "cancelled";
  }
  if (decision === "not_now") {
    emitDaemonRunBlockedByInventory({
      inventory,
      presenter,
      runtime,
    });
    return "deferred_with_card";
  }

  try {
    const reinstallResult = await runDaemonReinstall(
      {
        agentOverviewHandled: true,
        view: runtime.resolvedView,
      },
      {
        skipConfirm: true,
        startAfterInstallMode: "always",
        suppressInstallOutput: true,
      }
    );
    if (isDaemonReinstallHealthyAndRunning(reinstallResult)) {
      return "started";
    }
    if (reinstallResult.result === "cancelled") {
      return "cancelled";
    }
    return buildDaemonBackgroundStartFailure(
      "startFailureVerdict" in reinstallResult
        ? (reinstallResult.startFailureVerdict ?? null)
        : null
    );
  } catch (error) {
    renderDaemonStartNeedsAttentionCard({
      presenter,
      codePrefix: "daemon.reinstall.start_failed",
      summary: buildDaemonReinstallUnexpectedStartSummary(error),
      nextStep: buildDaemonReinstallUnexpectedStartNextStep(),
    });
    return {
      outcome: "failed_with_card",
      errorMessage: buildDaemonReinstallUnexpectedStartSummary(error),
    };
  }
}

function emitDaemonRuntimeCleanupSkipped(input: {
  cleanupDecision: Awaited<
    ReturnType<typeof clearDaemonRuntimeStateIfDefinitelyStopped>
  >;
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
}): void {
  const { cleanupDecision, presenter, runtime } = input;
  if (cleanupDecision.cleared) {
    return;
  }
  if (cleanupDecision.context.runtimeStatus.status !== "stale") {
    return;
  }
  if (cleanupDecision.context.effectiveRuntimeStatus !== "running") {
    return;
  }

  const payload = {
    cleanupSkipped: true,
    effectiveStatus: cleanupDecision.context.effectiveRuntimeStatus,
    observedStatus: cleanupDecision.context.runtimeStatus.status,
    reason: "service_manager_reports_running",
  } as const;

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "daemon.run.runtime_cleanup_skipped",
      payload,
    });
    return;
  }

  presenter.line({
    code: "daemon.run.runtime_cleanup_skipped",
    text: "OpenMeld kept the local runtime state because the system service still reports the daemon as running.",
  });
}

type DaemonRuntimeTakeoverDecision =
  | {
      takeover: false;
    }
  | {
      takeover: true;
      metadata: Record<string, unknown>;
      reason: string;
    };

function isRecordedDaemonRuntimePidAlive(pid: number | null): boolean {
  if (!Number.isInteger(pid) || pid === null || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function buildDaemonRuntimeTakeoverMetadata(input: {
  activeBundleEntryPath: string | null;
  effectiveRuntimeStatus: DaemonServiceRuntimeStatus["status"];
  observedBundleId?: string | null;
  observedCommand?: string | null;
  reason: string;
  runtimeStatus: DaemonServiceRuntimeStatus;
  snapshot: DaemonServiceRuntimeState | null;
}): Record<string, unknown> {
  const expectedBundleId = input.activeBundleEntryPath
    ? resolveDaemonBundleIdFromEntryPath(input.activeBundleEntryPath)
    : null;
  return {
    activeBundleEntryPath: input.activeBundleEntryPath,
    autoStart: input.runtimeStatus.autoStart,
    effectiveRuntimeStatus: input.effectiveRuntimeStatus,
    expectedBundleId,
    heartbeatAt: input.snapshot?.heartbeatAt ?? null,
    managedBySystemService: input.runtimeStatus.managedBySystemService,
    observedBundleId: input.observedBundleId ?? null,
    observedCommand: input.observedCommand ?? null,
    pid: input.snapshot?.pid ?? input.runtimeStatus.pid,
    reason: input.reason,
    runtimeReason: input.runtimeStatus.reason ?? null,
    runtimeStatus: input.runtimeStatus.status,
    serviceController: input.runtimeStatus.serviceController,
    stateCommand: input.snapshot?.command ?? null,
    stateUpdatedAt: input.snapshot?.updatedAt ?? input.runtimeStatus.updatedAt,
  };
}

async function resolveDaemonRuntimeCommandTakeover(input: {
  activeBundleEntryPath: string | null;
  effectiveRuntimeStatus: DaemonServiceRuntimeStatus["status"];
  runtimeStatus: DaemonServiceRuntimeStatus;
  snapshot: DaemonServiceRuntimeState;
}): Promise<DaemonRuntimeTakeoverDecision> {
  const ownedProcesses = await listDaemonOwnedProcesses({
    ignoreProcessIds: [process.pid, process.ppid].filter(
      (pid): pid is number => Number.isInteger(pid) && pid > 0
    ),
  }).catch(() => null);
  if (!ownedProcesses) {
    return { takeover: false };
  }
  const observedProcess = ownedProcesses.find(
    (processInfo) => processInfo.pid === input.snapshot.pid
  );
  const observedCommand = observedProcess?.command ?? null;
  if (!observedProcess) {
    return {
      takeover: true,
      reason: "process_command_mismatch",
      metadata: buildDaemonRuntimeTakeoverMetadata({
        activeBundleEntryPath: input.activeBundleEntryPath,
        effectiveRuntimeStatus: input.effectiveRuntimeStatus,
        observedCommand,
        reason: "process_command_mismatch",
        runtimeStatus: input.runtimeStatus,
        snapshot: input.snapshot,
      }),
    };
  }

  const expectedBundleId = input.activeBundleEntryPath
    ? resolveDaemonBundleIdFromEntryPath(input.activeBundleEntryPath)
    : null;
  const observedEntryPath = extractDaemonCommandEntryPath(
    observedProcess.command
  );
  const observedBundleId = observedEntryPath
    ? resolveDaemonBundleIdFromEntryPath(observedEntryPath)
    : null;
  if (
    expectedBundleId &&
    observedBundleId &&
    observedBundleId !== expectedBundleId
  ) {
    return {
      takeover: true,
      reason: "process_command_mismatch",
      metadata: buildDaemonRuntimeTakeoverMetadata({
        activeBundleEntryPath: input.activeBundleEntryPath,
        effectiveRuntimeStatus: input.effectiveRuntimeStatus,
        observedBundleId,
        observedCommand,
        reason: "process_command_mismatch",
        runtimeStatus: input.runtimeStatus,
        snapshot: input.snapshot,
      }),
    };
  }

  return { takeover: false };
}

async function resolveDaemonRuntimeTakeoverBeforeStart(input: {
  activeBundleEntryPath: string | null;
  effectiveRuntimeStatus: DaemonServiceRuntimeStatus["status"];
  runtimeStatus: DaemonServiceRuntimeStatus;
}): Promise<DaemonRuntimeTakeoverDecision> {
  const snapshot = await readDaemonServiceRuntimeSnapshot().catch(() => null);
  if (input.runtimeStatus.status === "stale") {
    const reason = input.runtimeStatus.reason ?? "runtime_state_stale";
    return {
      takeover: true,
      reason,
      metadata: buildDaemonRuntimeTakeoverMetadata({
        activeBundleEntryPath: input.activeBundleEntryPath,
        effectiveRuntimeStatus: input.effectiveRuntimeStatus,
        reason,
        runtimeStatus: input.runtimeStatus,
        snapshot,
      }),
    };
  }

  if (input.effectiveRuntimeStatus !== "running" || !snapshot) {
    return { takeover: false };
  }

  if (!isRecordedDaemonRuntimePidAlive(snapshot.pid)) {
    return {
      takeover: true,
      reason: "process_not_alive",
      metadata: buildDaemonRuntimeTakeoverMetadata({
        activeBundleEntryPath: input.activeBundleEntryPath,
        effectiveRuntimeStatus: input.effectiveRuntimeStatus,
        reason: "process_not_alive",
        runtimeStatus: input.runtimeStatus,
        snapshot,
      }),
    };
  }

  if (isDaemonServiceRuntimeHeartbeatStale(snapshot)) {
    return {
      takeover: true,
      reason: "heartbeat_stale",
      metadata: buildDaemonRuntimeTakeoverMetadata({
        activeBundleEntryPath: input.activeBundleEntryPath,
        effectiveRuntimeStatus: input.effectiveRuntimeStatus,
        reason: "heartbeat_stale",
        runtimeStatus: input.runtimeStatus,
        snapshot,
      }),
    };
  }

  return await resolveDaemonRuntimeCommandTakeover({
    activeBundleEntryPath: input.activeBundleEntryPath,
    effectiveRuntimeStatus: input.effectiveRuntimeStatus,
    runtimeStatus: input.runtimeStatus,
    snapshot,
  });
}

async function recordDaemonRuntimeTakeover(input: {
  decision: Extract<DaemonRuntimeTakeoverDecision, { takeover: true }>;
}): Promise<void> {
  await emitDaemonLifecycleEvent({
    type: "runtime_state.takeover",
    result: "cleared",
    metadata: input.decision.metadata,
  });
  await clearDaemonServiceRuntimeState();
}

async function runSystemDaemonCore(context: {
  input: DaemonRunInput;
  systemServiceStartupPollMs?: number;
  systemServiceStartupWaitMs?: number;
  onBeforeForegroundLoop?: (() => Promise<void>) | undefined;
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
  mode: DaemonRunMode;
  daemonVersion: string;
}): Promise<DaemonRunResult> {
  const {
    input,
    presenter,
    runtime,
    mode,
    daemonVersion,
    onBeforeForegroundLoop,
    systemServiceStartupPollMs,
    systemServiceStartupWaitMs,
  } = context;
  const isSystemServiceBootstrap = isManagedSystemServiceBootstrapRun();
  if (isSystemServiceBootstrap) {
    warnDaemonEvent("[openmeld.daemon.lifecycle_started]", {
      cliVersion: OPENMELD_VERSION,
      event: "cli.daemon.lifecycle_started",
      pid: process.pid,
    });
  }
  const runtimeCleanupDecision =
    await clearDaemonRuntimeStateIfDefinitelyStopped();
  emitDaemonRuntimeCleanupSkipped({
    cleanupDecision: runtimeCleanupDecision,
    presenter,
    runtime,
  });
  let runConfig: Awaited<
    ReturnType<typeof resolveContractFirstDaemonRunConfig>
  >;
  try {
    runConfig = await resolveContractFirstDaemonRunConfig({
      daemonVersion,
      input,
      isSystemServiceBootstrap,
      mode,
      runtime,
    });
  } catch (error) {
    if (!isSystemServiceBootstrap) {
      throw error;
    }
    return await handleDaemonRunStartFailure({
      fallbackRawLine: toErrorMessage(error),
      gatewayUrl: input.gatewayUrl,
      presenter,
      runtime,
      genericErrorPayload: {
        codePrefix: "daemon.run.start_failed",
        error,
      },
    });
  }
  if (isSystemServiceBootstrap && !runConfig.bootstrapContract) {
    presenter.line({
      code: "daemon.run.contract_missing",
      text: "OpenMeld Service bootstrap could not resolve a valid local service contract.",
    });
    process.exitCode = 1;
    return {
      ok: false,
      reason: "start_failed",
    };
  }
  const preflight: Awaited<
    ReturnType<typeof runDaemonStartupPreflight>
  > | null = null;
  const daemonOpenMeldProfileId = runConfig.openMeldProfileId;
  const contractOpenMeldProfileId = runConfig.contractOpenMeldProfileId;
  const inventoryRunResult = await maybeResolveRunResultFromDaemonInventory({
    daemonVersion,
    preflight,
    mode,
    presenter,
    runtime,
    gatewayUrl: runConfig.gatewayUrl,
    openMeldProfileId: daemonOpenMeldProfileId,
    contractOpenMeldProfileId,
    deviceId: runConfig.deviceId,
    heartbeatMs: runConfig.heartbeatMs,
    isSystemServiceBootstrap,
  });
  if (inventoryRunResult) {
    return inventoryRunResult;
  }
  let activeBundleEntryPath = await resolveAlignedDaemonActiveBundleEntryPath({
    expectedVersion: daemonVersion,
  }).catch(() => null);
  if (!activeBundleEntryPath) {
    await prepareDaemonServiceBundle({
      daemonVersion,
    });
    activeBundleEntryPath = await resolveAlignedDaemonActiveBundleEntryPath({
      expectedVersion: daemonVersion,
    }).catch(() => null);
  }

  const { runtimeStatus, effectiveRuntimeStatus } =
    await readCurrentDaemonRuntimeContext();

  const runtimeTakeoverDecision = await resolveDaemonRuntimeTakeoverBeforeStart(
    {
      activeBundleEntryPath,
      effectiveRuntimeStatus,
      runtimeStatus,
    }
  );
  if (runtimeTakeoverDecision.takeover) {
    await recordDaemonRuntimeTakeover({
      decision: runtimeTakeoverDecision,
    });
  } else if (effectiveRuntimeStatus === "running") {
    emitDaemonAlreadyRunningState(runtime, presenter, runtimeStatus);
    return createDaemonAlreadyRunningResult();
  } else if (runtimeStatus.status === "stale") {
    await clearDaemonServiceRuntimeState();
  }

  const authReadiness = await resolveDaemonRunAuthReadiness({
    gatewayUrl: runConfig.gatewayUrl,
  });
  if (!authReadiness.ready) {
    emitDaemonRunAuthRequired({
      readiness: authReadiness,
      presenter,
      runtime,
    });
    process.exitCode = 1;
    return {
      ok: false,
      reason: authReadiness.reason,
    };
  }

  if (isSystemServiceBootstrap) {
    return await runDirectDaemonServiceLoop({
      gatewayUrl: runConfig.gatewayUrl,
      deviceId: runConfig.deviceId,
      heartbeatMs: runConfig.heartbeatMs,
      mode,
      presenter,
      openMeldProfileId: daemonOpenMeldProfileId,
      runtime,
    });
  }

  if (mode === "foreground" || isDetachedDaemonServiceRun()) {
    if (mode === "foreground") {
      await onBeforeForegroundLoop?.();
    }
    return await runDirectDaemonServiceLoop({
      gatewayUrl: runConfig.gatewayUrl,
      deviceId: runConfig.deviceId,
      heartbeatMs: runConfig.heartbeatMs,
      mode,
      presenter,
      openMeldProfileId: daemonOpenMeldProfileId,
      runtime,
    });
  }

  return await runDaemonBackgroundStart({
    daemonVersion,
    systemServiceStartupPollMs,
    systemServiceStartupWaitMs,
    runtime,
    presenter,
    mode,
    gatewayUrl: runConfig.gatewayUrl,
    openMeldProfileId: daemonOpenMeldProfileId,
    contractOpenMeldProfileId,
    deviceId: runConfig.deviceId,
    heartbeatMs: runConfig.heartbeatMs,
    ...(input.serviceProgress
      ? { serviceProgress: input.serviceProgress }
      : {}),
    suppressStartSpinner:
      input.suppressStartSpinner === true || input.outputMode === "silent",
  });
}

async function maybeResolveRunResultFromDaemonInventory(input: {
  daemonVersion: string;
  preflight: Awaited<ReturnType<typeof runDaemonStartupPreflight>> | null;
  mode: DaemonRunMode;
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
  gatewayUrl?: string;
  openMeldProfileId?: string;
  contractOpenMeldProfileId?: string;
  deviceId?: string;
  heartbeatMs?: number;
  isSystemServiceBootstrap: boolean;
}): Promise<DaemonRunResult | null> {
  if (input.isSystemServiceBootstrap) {
    return null;
  }

  const inventory = await inspectDaemonServiceInventory({
    expectedVersion: input.daemonVersion,
    intendedMode: input.mode,
    intent: input.mode === "foreground" ? "run_foreground" : "run_background",
  }).catch(() => null);
  if (!inventory) {
    return null;
  }

  if (
    shouldTreatDaemonRunAsRecoveredStart({
      daemonVersion: input.daemonVersion,
      inventory,
      preflight: input.preflight,
    })
  ) {
    await maybeWriteDaemonServiceContract({
      runtime: input.runtime,
      daemonVersion: input.daemonVersion,
      desiredState: "background",
      serviceController: inventory.serviceManager?.controller,
      runtimeStatus: inventory.runtimeStatus,
      autoStart: inventory.serviceManager !== null,
      gatewayUrl: input.gatewayUrl,
      openMeldProfileId: input.openMeldProfileId,
      contractProfileId: input.contractOpenMeldProfileId,
      deviceId: input.deviceId,
      heartbeatMs: input.heartbeatMs,
    });
    emitDaemonRecoveredStartedState({
      inventory,
      mode: input.mode,
      presenter: input.presenter,
      runtime: input.runtime,
    });
    await clearDaemonStartFailureStateSafely();
    return {
      ok: true,
      reason: "started",
    };
  }

  if (!shouldBlockDaemonRunFromInventory(inventory)) {
    return null;
  }

  emitDaemonRunBlockedByInventory({
    inventory,
    presenter: input.presenter,
    runtime: input.runtime,
  });
  process.exitCode = 1;
  return {
    ok: false,
    reason: "cleanup_required",
  };
}

async function runDaemonBackgroundStart(input: {
  daemonVersion: string;
  systemServiceStartupPollMs?: number;
  systemServiceStartupWaitMs?: number;
  runtime: RuntimeContext;
  presenter: ReturnType<typeof createPresenter>;
  mode: DaemonRunMode;
  gatewayUrl?: string;
  openMeldProfileId?: string;
  contractOpenMeldProfileId?: string;
  deviceId?: string;
  heartbeatMs?: number;
  serviceProgress?: DaemonServiceProgressReporter;
  suppressStartSpinner?: boolean;
}): Promise<DaemonRunResult> {
  const systemManager = await resolveDaemonServiceManager();
  if (!systemManager) {
    const detachedContractSnapshot = await stageDaemonBackgroundServiceContract(
      {
        runtime: input.runtime,
        daemonVersion: input.daemonVersion,
        desiredState: "background",
        serviceController: "legacy-detached",
        autoStart: false,
        gatewayUrl: input.gatewayUrl,
        openMeldProfileId: input.openMeldProfileId,
        contractProfileId: input.contractOpenMeldProfileId,
        deviceId: input.deviceId,
        heartbeatMs: input.heartbeatMs,
      }
    );
    input.presenter.line({
      code: "daemon.run.fallback",
      text: "System service manager is not available on this device; fallback to detached background process.",
    });
    const runResult = await runDaemonServiceDetached({
      gatewayUrl: input.gatewayUrl,
      deviceId: input.deviceId,
      heartbeatMs: input.heartbeatMs,
      openMeldProfileId: input.openMeldProfileId,
      runtime: input.runtime,
      presenter: input.presenter,
      mode: input.mode,
    });
    if (!runResult.ok) {
      await detachedContractSnapshot.rollback();
    }
    return runResult;
  }

  await ensureDaemonServiceMaintenanceInstalled();
  const systemContractSnapshot = await stageDaemonBackgroundServiceContract({
    runtime: input.runtime,
    daemonVersion: input.daemonVersion,
    desiredState: "background",
    serviceController: systemManager.controller,
    autoStart: true,
    gatewayUrl: input.gatewayUrl,
    openMeldProfileId: input.openMeldProfileId,
    contractProfileId: input.contractOpenMeldProfileId,
    deviceId: input.deviceId,
    heartbeatMs: input.heartbeatMs,
  });
  const runResult = await runSystemServiceManager({
    daemonVersion: input.daemonVersion,
    startupPollMs: input.systemServiceStartupPollMs,
    startupWaitMs: input.systemServiceStartupWaitMs,
    runtime: input.runtime,
    presenter: input.presenter,
    mode: input.mode,
    gatewayUrl: input.gatewayUrl,
    openMeldProfileId: input.openMeldProfileId,
    deviceId: input.deviceId,
    heartbeatMs: input.heartbeatMs,
    ...(input.serviceProgress
      ? { serviceProgress: input.serviceProgress }
      : {}),
    systemManager,
    suppressStartSpinner: input.suppressStartSpinner,
  });
  if (!runResult.ok) {
    await systemContractSnapshot.rollback();
  }
  return runResult;
}

function shouldBlockDaemonRunFromInventory(
  inventory: Awaited<ReturnType<typeof inspectDaemonServiceInventory>>
): boolean {
  return classifyDaemonServiceRunStartability({ inventory }).blocksStart;
}

function shouldTreatDaemonRunAsRecoveredStart(input: {
  daemonVersion: string;
  inventory: Awaited<ReturnType<typeof inspectDaemonServiceInventory>>;
  preflight: Awaited<ReturnType<typeof runDaemonStartupPreflight>> | null;
}): boolean {
  if (!input.preflight) {
    return false;
  }
  if (
    input.preflight.status !== "aligned" &&
    input.preflight.status !== "auto_healed"
  ) {
    return false;
  }
  const target = buildDaemonServiceTargetSpec({
    daemonVersion: input.daemonVersion,
  });
  const decision = resolveDaemonServiceAlignmentDecision({
    inventory: input.inventory,
    target,
  });
  if (decision.status !== "already_aligned") {
    return false;
  }
  return (
    getEffectiveDaemonRuntimeStatus({
      runtimeState: input.inventory.runtimeStatus,
      serviceManagerStatus: input.inventory.serviceManagerStatus,
    }) === "running" && input.inventory.runtimeStatus.mode === "background"
  );
}

function emitDaemonRunBlockedByInventory(input: {
  inventory: Awaited<ReturnType<typeof inspectDaemonServiceInventory>>;
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
}): void {
  const runBlockingCodes = classifyDaemonServiceRunStartability({
    inventory: input.inventory,
  }).blockingCodes;
  const primaryAnomaly =
    input.inventory.anomalies.find((anomaly) =>
      runBlockingCodes.includes(anomaly.code)
    ) ?? input.inventory.anomalies[0];
  if (!primaryAnomaly) {
    return;
  }

  if (input.runtime.resolvedView === "agent") {
    const recoveryGuidance = buildDaemonRunCleanupRequiredAgentGuidance({
      primaryAnomaly,
    });
    input.presenter.data({
      code: "daemon.run.cleanup_required",
      payload: {
        ok: false,
        reason: "cleanup_required",
        ...recoveryGuidance,
        inventory: {
          anomalies: input.inventory.anomalies,
          cleanupPlan: buildDaemonServiceCleanupPlan({
            intent: "status_cleanup",
            inventory: input.inventory,
          }),
        },
      },
    });
    return;
  }

  const serviceIsRunning = input.inventory.runtimeStatus.status === "running";
  if (primaryAnomaly.code === "runtime_contract_mismatch") {
    renderServiceActionCard({
      presenter: input.presenter,
      title: "⚠️ OpenMeld Service Update Required",
      codePrefix: "daemon.run.cleanup_required",
      rows: [
        {
          label: "📝 Found",
          value: formatDaemonServiceUpdateRequiredMessage({
            serviceIsRunning,
          }),
        },
        {
          label: "📡 Local Service Link",
          value: serviceIsRunning
            ? "Unavailable for new Wake work - update OpenMeld Service before this computer receives new local Wake work."
            : "Unavailable - update OpenMeld Service before this computer receives local Wake work.",
        },
        {
          label: "🔧 Next",
          value: buildDaemonServiceUpdateRequiredNextStep({
            serviceIsRunning,
          }),
        },
      ],
    });
    return;
  }

  renderServiceActionCard({
    presenter: input.presenter,
    title: "⚠️ OpenMeld Service Needs Repair",
    codePrefix: "daemon.run.cleanup_required",
    rows: [
      {
        label: "📝 Found",
        value: formatDaemonServiceRefreshReliabilityMessage(),
      },
      {
        label: "📡 Local Service Link",
        value:
          "Needs repair — OpenMeld Service must be repaired before this computer can connect for local Wake work.",
      },
      {
        label: "🔧 Next",
        value: buildDaemonServiceRefreshNextStep(),
      },
    ],
  });
}

function buildDaemonRunCleanupRequiredAgentGuidance(input: {
  primaryAnomaly: DaemonServiceInventory["anomalies"][number] | undefined;
}): {
  message: string;
  nextSteps: string[];
  requiresRepair: boolean;
  requiresStartAfterMaintenance: true;
  requiresStartAfterRepair: boolean;
  requiresUpdate: boolean;
} {
  const needsUpdate =
    input.primaryAnomaly?.code === "runtime_contract_mismatch";
  const maintenanceCommand = needsUpdate
    ? "openmeld service update --view agent"
    : "openmeld service repair --view agent";
  const maintenanceAction = needsUpdate ? "updated" : "repaired";
  const followUpPhase =
    maintenanceAction === "updated" ? "the update" : "repair";
  return {
    message:
      `OpenMeld Service must be ${maintenanceAction} before it can start. ` +
      formatOpenMeldCliTextBlock(
        `If OpenMeld Service is still stopped after ${followUpPhase}, run openmeld service start.`
      ),
    nextSteps: formatOpenMeldCliCommands([
      maintenanceCommand,
      "openmeld service start --view agent",
    ]),
    requiresRepair: !needsUpdate,
    requiresStartAfterMaintenance: true,
    requiresStartAfterRepair: !needsUpdate,
    requiresUpdate: needsUpdate,
  };
}

function emitDaemonRecoveredStartedState(input: {
  inventory: Awaited<ReturnType<typeof inspectDaemonServiceInventory>>;
  mode: DaemonRunMode;
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
}): void {
  const controller =
    input.inventory.serviceManager?.controller ??
    (input.inventory.runtimeStatus.serviceController === "unknown"
      ? "launchd"
      : input.inventory.runtimeStatus.serviceController);
  emitSystemServiceBackgroundStarted({
    runtime: input.runtime,
    presenter: input.presenter,
    mode: input.mode,
    controller,
    runtimeStatus: input.inventory.runtimeStatus,
    autoRepairAttempted: true,
  });
}

function resolveDaemonServiceOpenMeldProfileId(input: {
  explicitOpenMeldProfileId?: string;
  runtime: RuntimeContext;
}): string | undefined {
  const explicitOpenMeldProfileId = normalizeOptionalText(
    input.explicitOpenMeldProfileId
  );
  if (explicitOpenMeldProfileId) {
    return explicitOpenMeldProfileId;
  }

  const sessionOpenMeldProfileId = normalizeOptionalText(
    input.runtime.openMeldProfileId
  );
  if (sessionOpenMeldProfileId) {
    return sessionOpenMeldProfileId;
  }

  const selectedOpenMeldProfileId = normalizeOptionalText(
    getCurrentCommandCheckState().selectedProfile?.openMeldProfileId
  );
  if (selectedOpenMeldProfileId) {
    return selectedOpenMeldProfileId;
  }

  return undefined;
}

async function resolveDaemonServiceContractGatewayUrl(input: {
  explicitGatewayUrl?: string;
  contractGatewayUrl?: string | null;
}): Promise<string | null> {
  const explicitGatewayUrl = await resolveExplicitGatewayUrlOrThrow(
    input.explicitGatewayUrl
  );
  if (explicitGatewayUrl) {
    return explicitGatewayUrl;
  }

  const contractGatewayUrl = normalizeGatewayBaseUrlOrNull(
    input.contractGatewayUrl
  );
  if (contractGatewayUrl) {
    return contractGatewayUrl;
  }

  return await resolveBaseUrlOrNull(undefined);
}

async function maybeWriteDaemonServiceContract(input: {
  runtime: RuntimeContext;
  daemonVersion?: string;
  bundleId?: string | null;
  desiredState: "stopped" | "background";
  serviceController?: DaemonServiceRuntimeStatus["serviceController"];
  runtimeStatus?: DaemonServiceRuntimeStatus | null;
  autoStart: boolean;
  gatewayUrl?: string;
  openMeldProfileId?: string;
  contractProfileId?: string;
  deviceId?: string;
  heartbeatMs?: number;
  allowDetachedFallback?: boolean;
}): Promise<PersistedDaemonServiceContract | null> {
  const targetDaemonVersion = input.daemonVersion ?? null;
  const [currentContract, activeBundle, activeBundleEntryPath] =
    await Promise.all([
      readDaemonServiceContract().catch(() => null),
      readDaemonActiveBundleState().catch(() => null),
      Promise.resolve(
        resolveAlignedDaemonActiveBundleEntryPath({
          ...(targetDaemonVersion
            ? { expectedVersion: targetDaemonVersion }
            : {}),
        })
      ).catch(() => null),
    ]);
  const bundleIdFromEntryPath = activeBundleEntryPath
    ? resolveDaemonBundleIdFromEntryPath(activeBundleEntryPath)
    : null;
  const matchingActiveBundle =
    targetDaemonVersion && activeBundle?.daemonVersion !== targetDaemonVersion
      ? null
      : activeBundle;
  const bundleId =
    input.bundleId ??
    bundleIdFromEntryPath ??
    matchingActiveBundle?.bundleId ??
    currentContract?.bundleId ??
    null;
  const serviceController = resolveDaemonContractServiceController({
    preferredController: input.serviceController,
    currentContract,
    runtimeStatus: input.runtimeStatus ?? null,
    allowDetachedFallback: input.allowDetachedFallback ?? false,
  });
  const installedStatus = await getDaemonStatus().catch(() => null);
  const daemonVersion =
    input.daemonVersion ??
    matchingActiveBundle?.daemonVersion ??
    installedStatus?.state?.daemonVersion ??
    currentContract?.daemonVersion ??
    null;
  if (!(bundleId && daemonVersion && serviceController)) {
    return null;
  }
  const reusableCurrentContract = isDaemonServiceContractIdentityReusable(
    currentContract
  )
    ? currentContract
    : null;

  const [resolvedGatewayUrl, runtimePaths] = await Promise.all([
    resolveDaemonServiceContractGatewayUrl({
      explicitGatewayUrl: input.gatewayUrl,
      contractGatewayUrl: currentContract?.gatewayUrl ?? null,
    }),
    ensureDaemonRuntimePaths().catch(() => null),
  ]);
  const resolvedDeviceId = runtimePaths
    ? await resolveDaemonDeviceId({
        deviceId: resolvePreferredDaemonDeviceId({
          explicitDeviceId: input.deviceId,
          contractDeviceId: reusableCurrentContract?.deviceId,
        }),
        deviceIdPath: runtimePaths.deviceIdPath,
      }).catch(() => reusableCurrentContract?.deviceId ?? null)
    : (normalizeOptionalText(input.deviceId) ??
      reusableCurrentContract?.deviceId ??
      null);
  const resolvedProfileId = normalizeOptionalText(input.contractProfileId);
  const resolvedOwnerUserId = await resolveDaemonServiceContractOwnerUserId({
    currentContract,
    openMeldProfileId: resolvedProfileId,
  });
  const writeResult = await writeDaemonServiceContract({
    daemonVersion,
    bundleId,
    desiredState: input.desiredState,
    serviceController,
    autoStart: input.autoStart,
    gatewayUrl: resolvedGatewayUrl,
    ...(resolvedOwnerUserId ? { ownerUserId: resolvedOwnerUserId } : {}),
    ...(resolvedProfileId ? { profileId: resolvedProfileId } : {}),
    deviceId: resolvedDeviceId,
    heartbeatMs: input.heartbeatMs ?? currentContract?.heartbeatMs ?? null,
    ...(reusableCurrentContract ? { lane: reusableCurrentContract.lane } : {}),
  });
  if (writeResult.status === "skipped_missing_fields") {
    return null;
  }
  return writeResult.contract;
}

async function resolveDaemonServiceContractOwnerUserId(input: {
  openMeldProfileId?: string | null;
  currentContract: PersistedDaemonServiceContract | null;
}): Promise<string | undefined> {
  const profileId = normalizeOptionalText(input.openMeldProfileId);
  if (profileId) {
    const selectedProfile = getCurrentCommandCheckState().selectedProfile;
    if (selectedProfile?.openMeldProfileId === profileId) {
      return (
        normalizeOptionalText(selectedProfile.profile.ownerUserId) ?? undefined
      );
    }

    const resolvedProfile = await resolveOpenMeldProfileOrNull({
      openMeldProfileId: profileId,
      allowDefaultFallback: false,
      allowUnauthenticated: true,
      persistSelection: false,
    }).catch(() => null);
    return normalizeOptionalText(resolvedProfile?.ownerUserId) ?? undefined;
  }

  const authState = await Promise.resolve(
    getAuthSessionState({
      validateRemote: false,
    })
  ).catch(() => null);
  const authOwnerUserId = normalizeOptionalText(authState?.session?.user?.id);
  if (authOwnerUserId) {
    return authOwnerUserId;
  }

  return normalizeOptionalText(input.currentContract?.ownerUserId) ?? undefined;
}

async function stageDaemonBackgroundServiceContract(input: {
  runtime: RuntimeContext;
  daemonVersion: string;
  desiredState: "background";
  serviceController: DaemonServiceRuntimeStatus["serviceController"];
  autoStart: boolean;
  gatewayUrl?: string;
  openMeldProfileId?: string;
  contractProfileId?: string;
  deviceId?: string;
  heartbeatMs?: number;
}): Promise<{
  rollback: () => Promise<void>;
}> {
  const previousContract = await readDaemonServiceContract().catch(() => null);
  const stagedContract = await maybeWriteDaemonServiceContract(input);
  if (!stagedContract) {
    return {
      rollback: async () => undefined,
    };
  }
  return {
    rollback: async () => {
      await restoreDaemonServiceContractSnapshot(previousContract);
    },
  };
}

async function maybeWriteDaemonStoppedContract(input: {
  runtime: RuntimeContext;
  runtimeStatus?: DaemonServiceRuntimeStatus | null;
  ownerSnapshot?: DaemonOwnerSnapshot | null;
}): Promise<void> {
  const ownerSnapshot =
    input.ownerSnapshot ??
    (await readCurrentDaemonOwnerSnapshot().catch(() => null));
  const stoppedContractWriteBlockedReason = ownerSnapshot
    ? resolveStoppedContractWriteBlockedReason(ownerSnapshot)
    : null;
  if (ownerSnapshot && stoppedContractWriteBlockedReason) {
    await emitDaemonLifecycleEvent({
      type: "service_contract.write",
      result: "skipped",
      metadata: {
        autoStart: false,
        desiredState: "stopped",
        ownerSnapshot: summarizeDaemonOwnerSnapshot(ownerSnapshot),
        reason: stoppedContractWriteBlockedReason,
      },
    });
    return;
  }

  const serviceManager =
    (await Promise.resolve(resolveDaemonServiceManager()).catch(() => null)) ??
    null;
  const refreshedContract = await maybeWriteDaemonServiceContract({
    runtime: input.runtime,
    desiredState: "stopped",
    serviceController:
      input.runtimeStatus?.serviceController ?? serviceManager?.controller,
    runtimeStatus: input.runtimeStatus ?? null,
    autoStart: false,
    allowDetachedFallback: serviceManager === null,
  });
  if (refreshedContract) {
    return;
  }

  const currentContract = await readDaemonServiceContract().catch(() => null);
  const reusableCurrentContract = isDaemonServiceContractIdentityReusable(
    currentContract
  )
    ? currentContract
    : null;
  if (!reusableCurrentContract) {
    return;
  }
  await upsertDaemonServiceContract({
    daemonVersion: reusableCurrentContract.daemonVersion,
    bundleId: reusableCurrentContract.bundleId,
    desiredState: "stopped",
    serviceController: reusableCurrentContract.serviceController,
    autoStart: false,
    gatewayUrl: reusableCurrentContract.gatewayUrl,
    ...(reusableCurrentContract.ownerUserId
      ? { ownerUserId: reusableCurrentContract.ownerUserId }
      : {}),
    ...(reusableCurrentContract.profileId
      ? { profileId: reusableCurrentContract.profileId }
      : {}),
    deviceId: reusableCurrentContract.deviceId,
    ...(reusableCurrentContract.connectedComputerId
      ? { connectedComputerId: reusableCurrentContract.connectedComputerId }
      : {}),
    heartbeatMs: reusableCurrentContract.heartbeatMs,
    lane: reusableCurrentContract.lane,
  });
  await emitDaemonLifecycleEvent({
    type: "service_contract.write",
    result: "completed",
    metadata: {
      autoStart: false,
      desiredState: "stopped",
      serviceController: reusableCurrentContract.serviceController,
    },
  });
}

async function restoreDaemonServiceContractSnapshot(
  snapshot: PersistedDaemonServiceContract | null
): Promise<void> {
  if (!snapshot) {
    await clearDaemonServiceContract();
    return;
  }
  await upsertDaemonServiceContract({
    daemonVersion: snapshot.daemonVersion,
    bundleId: snapshot.bundleId,
    desiredState: snapshot.desiredState,
    serviceController: snapshot.serviceController,
    autoStart: snapshot.autoStart,
    gatewayUrl: snapshot.gatewayUrl,
    ...(snapshot.ownerUserId ? { ownerUserId: snapshot.ownerUserId } : {}),
    ...(snapshot.profileId ? { profileId: snapshot.profileId } : {}),
    deviceId: snapshot.deviceId,
    ...(snapshot.connectedComputerId
      ? { connectedComputerId: snapshot.connectedComputerId }
      : {}),
    heartbeatMs: snapshot.heartbeatMs,
    lane: snapshot.lane,
  });
}

function resolveDaemonContractServiceController(input: {
  preferredController?: DaemonServiceRuntimeStatus["serviceController"];
  currentContract: PersistedDaemonServiceContract | null;
  runtimeStatus: DaemonServiceRuntimeStatus | null;
  allowDetachedFallback: boolean;
}): DaemonServiceRuntimeStatus["serviceController"] | null {
  const preferredController =
    input.preferredController && input.preferredController !== "unknown"
      ? input.preferredController
      : null;
  if (preferredController) {
    return preferredController;
  }

  const persistedController =
    input.currentContract?.serviceController &&
    input.currentContract.serviceController !== "unknown"
      ? input.currentContract.serviceController
      : null;
  if (persistedController) {
    return persistedController;
  }

  if (input.runtimeStatus?.serviceController === "legacy-detached") {
    return "legacy-detached";
  }

  if (
    input.runtimeStatus?.managedBySystemService &&
    input.runtimeStatus.serviceController !== "unknown"
  ) {
    return input.runtimeStatus.serviceController;
  }

  if (input.allowDetachedFallback) {
    return "legacy-detached";
  }

  return null;
}

function emitDaemonAlreadyRunningState(
  runtime: RuntimeContext,
  presenter: ReturnType<typeof createPresenter>,
  runtimeStatus: DaemonServiceRuntimeStatus
): void {
  const statusCommand = formatOpenMeldCliCommand("openmeld service status");
  const repairCommand = formatOpenMeldCliCommand("openmeld service repair");
  const guidance =
    "OpenMeld Service is already running. If Wake or local setup still looks wrong, `openmeld service start` is not the repair step. " +
    `Run \`${statusCommand}\`; if local participation is unhealthy, run \`${repairCommand}\` or use Reconnect Computer in OpenMeld Web.`;
  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "daemon.run.already_running",
      payload: {
        ok: true,
        guidance,
        lifecycleState: "running",
        nextSteps: [statusCommand],
        reason: LEGACY_DAEMON_RUN_ALREADY_RUNNING_REASON,
        status: runtimeStatus,
      },
    });
    return;
  }

  renderInfoCard({
    presenter,
    title: "⚠️ Service Already Running",
    codePrefix: "daemon.run.already_running",
    rows: formatDaemonDisplayRows([
      {
        label: "🧩 Current Mode",
        value: runtimeStatus.mode ?? "unknown",
      },
      {
        label: "🧬 PID",
        value:
          runtimeStatus.pid === null
            ? "not available"
            : String(runtimeStatus.pid),
      },
      {
        label: "💡 What this means",
        value: "OpenMeld Service is already running.",
      },
      {
        label: "🔧 Next",
        value: guidance,
      },
    ]),
  });
}

async function recoverSystemServiceStartupAfterTimeout(input: {
  daemonVersion: string;
  error: unknown;
  serviceCommandSpec: ReturnType<typeof buildDaemonSystemServiceCommandSpec>;
  startSpinner: ReturnType<typeof createDaemonStartSpinner>;
  startupPollMs?: number;
  systemManager: DaemonServiceManager;
  runtime: RuntimeContext;
}): Promise<SystemServiceStartupRecoveryOutcome> {
  let recovery: SystemServiceStartupRecoveryReport | null = null;
  const recoveryDecision = resolveDaemonServiceStartupRecoveryDecision({
    alreadyAttempted: false,
    anomalyCodes: isSystemServiceStartupTimeoutError(input.error)
      ? (input.error.inventory?.anomalies.map((anomaly) => anomaly.code) ?? [])
      : [],
  });
  if (!recoveryDecision.shouldAttempt) {
    return {
      recovered: false,
      error: input.error,
      recovery,
    };
  }

  recovery = {
    attempted: true,
    reasonCodes: recoveryDecision.reasonCodes,
  };

  try {
    input.startSpinner?.message(
      "OpenMeld is repairing a local service startup issue..."
    );
    const preflight = await runDaemonStartupPreflight({
      expectedVersion: input.daemonVersion,
      ...(process.argv[1] ? { cliScriptPath: process.argv[1] } : {}),
      view: input.runtime.resolvedView,
    });
    recovery = {
      ...recovery,
      preflightStatus: preflight.status,
      ...(preflight.errorMessage
        ? { failureMessage: preflight.errorMessage }
        : {}),
    };
    if (
      preflight.status !== "aligned" &&
      preflight.status !== "auto_healed" &&
      preflight.status !== "already_aligned"
    ) {
      return {
        recovered: false,
        error: input.error,
        recovery,
      };
    }

    input.startSpinner?.message(
      "Restarting OpenMeld Service after local repair..."
    );
    await ensureDaemonSystemServiceCommandFiles({
      controller: input.systemManager.controller,
    });
    await input.systemManager.install(input.serviceCommandSpec);
    const retryStartResult = await startDaemonSystemServiceWithAutoRepair({
      serviceCommandSpec: input.serviceCommandSpec,
      systemManager: input.systemManager,
      onAutoRepairAttempt: () => {
        input.startSpinner?.message(
          "OpenMeld is repairing a local service issue..."
        );
      },
      onAutoRepairRecovered: () => {
        input.startSpinner?.message("Starting OpenMeld Service...");
      },
    });
    recovery = {
      ...recovery,
      retryStarted: true,
    };
    return {
      recovered: true,
      autoRepairAttempted: retryStartResult.autoRepairAttempted,
      recovery,
      startupStatus: await waitForSystemServiceStartup({
        expectedVersion: input.daemonVersion,
        manager: input.systemManager,
        waitMs: SERVICE_STARTUP_CHECK_MS,
        pollMs: input.startupPollMs ?? SERVICE_STARTUP_POLL_MS,
      }),
    };
  } catch (error) {
    return {
      recovered: false,
      error,
      recovery: {
        ...recovery,
        failureMessage: toErrorMessage(error),
      },
    };
  }
}

async function runSystemServiceManager(input: {
  daemonVersion: string;
  startupPollMs?: number;
  startupWaitMs?: number;
  runtime: RuntimeContext;
  presenter: ReturnType<typeof createPresenter>;
  mode: DaemonRunMode;
  gatewayUrl?: string;
  deviceId?: string;
  openMeldProfileId?: string;
  heartbeatMs?: number;
  systemManager: DaemonServiceManager;
  serviceProgress?: DaemonServiceProgressReporter;
  suppressStartSpinner?: boolean;
}): Promise<DaemonRunResult> {
  const startedAtMs = Date.now();
  const serviceCommandSpec = buildDaemonSystemServiceCommandSpec({
    controller: input.systemManager.controller,
    environmentTarget: await resolveOpenMeldEnvironmentTarget({
      gatewayUrl: input.gatewayUrl,
    }),
  });

  let startupError: unknown = null;
  let autoRepairAttempted = false;
  const startFailureLogCursor = await captureDaemonStartFailureLogCursor();
  const startSpinner = createDaemonStartSpinner({
    runtime: input.runtime,
    suppress: input.suppressStartSpinner === true,
  });
  startSpinner?.start("Starting OpenMeld Service...");

  try {
    emitDaemonServiceProgress({
      code: "daemon.service.install",
      progress: input.serviceProgress,
      spinner: startSpinner,
      text: "Installing OpenMeld Service launcher...",
    });
    await ensureDaemonSystemServiceCommandFiles({
      controller: input.systemManager.controller,
    });
    await runDaemonServiceManagerAction({
      action: "install",
      command: "openmeld service run",
      controller: input.systemManager.controller,
      intent: "run_background",
      run: async () => await input.systemManager.install(serviceCommandSpec),
    });
    emitDaemonServiceProgress({
      code: "daemon.service.start",
      progress: input.serviceProgress,
      spinner: startSpinner,
      text: "Starting OpenMeld Service with macOS...",
    });
    const startResult = await runDaemonServiceManagerAction({
      action: "start",
      command: "openmeld service run",
      controller: input.systemManager.controller,
      intent: "run_background",
      run: async () =>
        await startDaemonSystemServiceWithAutoRepair({
          serviceCommandSpec,
          systemManager: input.systemManager,
          onAutoRepairAttempt: () => {
            emitDaemonServiceProgress({
              code: "daemon.service.repair",
              progress: input.serviceProgress,
              spinner: startSpinner,
              text: "Repairing OpenMeld Service registration...",
            });
          },
          onAutoRepairRecovered: () => {
            emitDaemonServiceProgress({
              code: "daemon.service.start",
              progress: input.serviceProgress,
              spinner: startSpinner,
              text: "Starting OpenMeld Service with macOS...",
            });
          },
        }),
    });
    autoRepairAttempted = startResult.autoRepairAttempted;
  } catch (error) {
    startupError = error;
  }

  if (startupError) {
    startSpinner?.clear();
    return await handleDaemonRunStartFailure({
      cursor: startFailureLogCursor,
      gatewayUrl: input.gatewayUrl,
      presenter: input.presenter,
      runtime: input.runtime,
      genericErrorPayload: {
        codePrefix: "daemon.run.start_failed",
        controller: input.systemManager.controller,
        error: startupError,
        autoRepairAttempted,
      },
    });
  }

  try {
    const startupWaitMs =
      input.startupWaitMs ??
      resolveSystemServiceStartupWaitMs(input.systemManager.controller);
    emitDaemonServiceProgress({
      code: "daemon.service.wait_running",
      progress: input.serviceProgress,
      progressText: `Waiting for OpenMeld Service to become ready (up to ${Math.ceil(startupWaitMs / 1000)}s)...`,
      spinner: startSpinner,
      text: "Waiting for OpenMeld Service to report ready...",
    });
    const startupStatus = await runDaemonServiceManagerAction({
      action: "wait_running",
      command: "openmeld service run",
      controller: input.systemManager.controller,
      intent: "run_background",
      resolveErrorMetadata: (error) =>
        isSystemServiceStartupTimeoutError(error) && error.jobDiagnostics
          ? { jobDiagnostics: error.jobDiagnostics }
          : null,
      run: async () =>
        await waitForSystemServiceStartup({
          expectedVersion: input.daemonVersion,
          manager: input.systemManager,
          waitMs: startupWaitMs,
          pollMs: input.startupPollMs ?? SERVICE_STARTUP_POLL_MS,
        }),
    });
    await cleanupInactiveDaemonServiceBundles();
    await clearDaemonStartFailureStateSafely();
    startSpinner?.clear();
    emitSystemServiceBackgroundStarted({
      runtime: input.runtime,
      presenter: input.presenter,
      mode: input.mode,
      controller: input.systemManager.controller,
      runtimeStatus: startupStatus.runtimeStatus,
      autoRepairAttempted,
      durationMs: resolveElapsedTimeMs(startedAtMs),
    });
    return {
      ok: true,
      reason: "started",
    };
  } catch (error) {
    const recoveryOutcome = await recoverSystemServiceStartupAfterTimeout({
      daemonVersion: input.daemonVersion,
      error,
      serviceCommandSpec,
      startSpinner,
      startupPollMs: input.startupPollMs,
      systemManager: input.systemManager,
      runtime: input.runtime,
    });
    if (recoveryOutcome.recovered) {
      autoRepairAttempted =
        autoRepairAttempted || recoveryOutcome.autoRepairAttempted;
      await cleanupInactiveDaemonServiceBundles();
      await clearDaemonStartFailureStateSafely();
      startSpinner?.clear();
      emitSystemServiceBackgroundStarted({
        runtime: input.runtime,
        presenter: input.presenter,
        mode: input.mode,
        controller: input.systemManager.controller,
        runtimeStatus: recoveryOutcome.startupStatus.runtimeStatus,
        autoRepairAttempted: true,
        durationMs: resolveElapsedTimeMs(startedAtMs),
      });
      return {
        ok: true,
        reason: "started",
      };
    }
    startSpinner?.clear();
    return await handleDaemonRunStartFailure({
      cursor: startFailureLogCursor,
      gatewayUrl: input.gatewayUrl,
      presenter: input.presenter,
      runtime: input.runtime,
      genericErrorPayload: {
        codePrefix: "daemon.run.start_failed",
        controller: input.systemManager.controller,
        error: recoveryOutcome.error,
        autoRepairAttempted,
        recovery: recoveryOutcome.recovery,
      },
    });
  }
}

async function resolveContractFirstDaemonRunConfig(input: {
  daemonVersion: string;
  input: DaemonRunInput;
  isSystemServiceBootstrap: boolean;
  mode: DaemonRunMode;
  runtime: RuntimeContext;
}): Promise<{
  gatewayUrl?: string;
  openMeldProfileId?: string;
  contractOpenMeldProfileId?: string;
  deviceId?: string;
  heartbeatMs?: number;
  bootstrapContract: PersistedDaemonServiceContract | null;
}> {
  if (!input.isSystemServiceBootstrap) {
    const currentContract = await readDaemonServiceContract().catch(() => null);
    const reusableCurrentContract = isDaemonServiceContractIdentityReusable(
      currentContract
    )
      ? currentContract
      : null;
    return {
      gatewayUrl: await resolveExplicitGatewayUrlOrThrow(
        input.input.gatewayUrl
      ),
      openMeldProfileId: await resolveDaemonServiceOpenMeldProfileId({
        explicitOpenMeldProfileId: input.input.profile,
        runtime: input.runtime,
      }),
      deviceId: resolvePreferredDaemonDeviceId({
        explicitDeviceId: input.input.deviceId,
        contractDeviceId: reusableCurrentContract?.deviceId,
      }),
      heartbeatMs: input.input.heartbeatMs,
      bootstrapContract: null,
    };
  }

  const bootstrapContract = await resolveSystemBootstrapDaemonContract({
    daemonVersion: input.daemonVersion,
    gatewayUrl: input.input.gatewayUrl,
    openMeldProfileId: input.input.profile,
    deviceId: input.input.deviceId,
    heartbeatMs: input.input.heartbeatMs,
    runtime: input.runtime,
  });

  return {
    gatewayUrl: bootstrapContract?.gatewayUrl,
    openMeldProfileId: bootstrapContract?.profileId,
    ...(bootstrapContract?.profileId
      ? { contractOpenMeldProfileId: bootstrapContract.profileId }
      : {}),
    deviceId: bootstrapContract?.deviceId,
    heartbeatMs: bootstrapContract?.heartbeatMs,
    bootstrapContract,
  };
}

async function resolveSystemBootstrapDaemonContract(input: {
  daemonVersion: string;
  gatewayUrl?: string;
  openMeldProfileId?: string;
  deviceId?: string;
  heartbeatMs?: number;
  runtime: RuntimeContext;
}): Promise<PersistedDaemonServiceContract | null> {
  const currentContract = await readDaemonServiceContract().catch(() => null);
  const explicitGatewayUrl = await resolveExplicitGatewayUrlOrThrow(
    input.gatewayUrl
  );
  const currentContractGatewayUrl =
    currentContract && !explicitGatewayUrl
      ? resolvePersistedDaemonServiceContractGatewayUrl(
          currentContract.gatewayUrl
        )
      : null;
  if (
    currentContract &&
    isDaemonServiceContractIdentityReusable(currentContract) &&
    currentContractGatewayUrl
  ) {
    return currentContract;
  }

  const systemManager = await resolveDaemonServiceManager().catch(() => null);
  return await maybeWriteDaemonServiceContract({
    runtime: input.runtime,
    daemonVersion: input.daemonVersion,
    desiredState: "background",
    serviceController: systemManager?.controller,
    autoStart: systemManager !== null,
    gatewayUrl: explicitGatewayUrl,
    openMeldProfileId: input.openMeldProfileId,
    contractProfileId: input.openMeldProfileId,
    deviceId: input.deviceId,
    heartbeatMs: input.heartbeatMs,
    allowDetachedFallback: systemManager === null,
  });
}

function resolvePersistedDaemonServiceContractGatewayUrl(
  gatewayUrl: string
): string {
  try {
    return normalizeGatewayBaseUrl(gatewayUrl);
  } catch (error) {
    throw new Error(
      `Invalid persisted OpenMeld Service contract gateway URL "${gatewayUrl}": ${toErrorMessage(
        error
      )}`
    );
  }
}

function emitSystemServiceBackgroundStarted(input: {
  runtime: RuntimeContext;
  presenter: ReturnType<typeof createPresenter>;
  mode: DaemonRunMode;
  controller: DaemonServiceManager["controller"];
  runtimeStatus: DaemonServiceRuntimeStatus;
  autoRepairAttempted?: boolean;
  durationMs?: number;
}): void {
  if (input.runtime.resolvedView === "human") {
    renderServiceActionCard({
      presenter: input.presenter,
      codePrefix: "daemon.run.background_started",
      title: getDaemonStartStartedTitle(),
      rows: [
        {
          label: "✅ Status",
          value: formatDaemonStartStartedStatus(),
        },
        ...(input.durationMs === undefined
          ? []
          : [
              {
                label: "⏱️ Ready in",
                value: formatElapsedTime(input.durationMs),
              },
            ]),
        ...(input.autoRepairAttempted
          ? [
              {
                label: "🩹 Automatic Repair",
                value: formatDaemonStartAutoRepairResolvedMessage(),
              },
            ]
          : []),
        {
          label: "📡 Local Service Link",
          value: formatDaemonStartStartedMeaning(),
        },
        {
          label: "🛠️ Manage",
          value: formatDaemonStartStartedManage(),
        },
        {
          label: "🔍 Next",
          value: formatDaemonStartStartedNextStep(),
        },
      ],
    });
    return;
  }

  input.presenter.line({
    code: "daemon.run.background_started",
    text: `OpenMeld Service started as a system service (${input.controller}). ${normalizeRuntimeState(
      input.runtimeStatus.status
    )}; it stays alive even after this terminal closes.`,
  });
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "daemon.run.background_started",
      payload: {
        ok: true,
        mode: input.mode,
        pid: input.runtimeStatus.pid,
        status: input.runtimeStatus.status,
        serviceController: input.controller,
        ...(input.durationMs === undefined
          ? {}
          : { durationMs: input.durationMs }),
      },
    });
  }
}

async function resolveDaemonRunMode(input: {
  rawMode: string | undefined;
  canPrompt: boolean;
  allowBack?: boolean;
}): Promise<DaemonRunMode | typeof DAEMON_RUN_MODE_CHOICES.back | null> {
  if (input.rawMode) {
    return parseDaemonRunMode(input.rawMode);
  }

  if (!input.canPrompt) {
    return DEFAULT_DAEMON_RUN_MODE;
  }

  const choice = await select({
    message: "Start OpenMeld Service in which mode?",
    initialValue: DAEMON_RUN_MODE_CHOICES.background,
    options: [
      {
        value: DAEMON_RUN_MODE_CHOICES.background,
        label: "Background (Recommended)",
        hint: "Keep the service running after you close the current terminal.",
      },
      {
        value: DAEMON_RUN_MODE_CHOICES.foreground,
        label: "Foreground",
        hint: "Run in current terminal and keep it attached to the session.",
      },
      ...(input.allowBack
        ? [
            {
              value: DAEMON_RUN_MODE_CHOICES.back,
              label: "Back",
              hint: "Return to OpenMeld Service menu.",
            },
          ]
        : []),
    ],
  });

  if (isCancel(choice)) {
    return null;
  }

  const normalized = normalizeText(choice);
  if (normalized === DAEMON_RUN_MODE_CHOICES.back) {
    return DAEMON_RUN_MODE_CHOICES.back;
  }
  return parseDaemonRunMode(normalized);
}

type DaemonDetachedLaunchInput = Omit<DaemonRunInput, "profile"> & {
  openMeldProfileId?: string;
  runtime: RuntimeContext;
  presenter: ReturnType<typeof createPresenter>;
  mode: DaemonRunMode;
};

async function runDaemonServiceDetached(
  input: DaemonDetachedLaunchInput
): Promise<DaemonRunResult> {
  const startFailureLogCursor = await captureDaemonStartFailureLogCursor();
  const launchTarget = await resolveDetachedDaemonServiceLaunchTarget();
  const launch = buildDetachedDaemonLaunchSpec(input);
  const child = spawn(
    launchTarget.command,
    [...launchTarget.args, ...launch.args],
    {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        [DAEMON_SERVICE_RUNTIME_MODE_ENV]: input.mode,
        [DAEMON_SERVICE_RUNTIME_DETACHED_ENV]: "1",
      },
      windowsHide: true,
    }
  );
  const startupOutput = createLimitedStartupOutput({
    maxBytes: DAEMON_DETACHED_STARTUP_OUTPUT_LIMIT,
  });
  const startupLifecycle = observeDetachedProcessLifecycle(child);
  const cleanupStartupCapture = attachDetachedProcessStartupOutputCapture(
    child,
    startupOutput
  );

  try {
    if (typeof child.pid !== "number" || child.pid <= 0) {
      throw new Error("Background service process did not expose a pid.");
    }

    await waitForDetachedChildProcessSpawn(child);
    await waitForDetachedBackgroundProcessStartup(
      child,
      SERVICE_STARTUP_CHECK_MS,
      DAEMON_STARTUP_POLL_INTERVAL_MS,
      startupLifecycle,
      startupOutput
    );
    await cleanupInactiveDaemonServiceBundles();
    await clearDaemonStartFailureStateSafely();
    child.unref();
    emitDetachedDaemonStartSuccess({
      commandText: launch.commandText,
      pid: child.pid,
      presenter: input.presenter,
      runtime: input.runtime,
    });
    return {
      ok: true,
      reason: "started",
    };
  } catch (error) {
    if (typeof child.pid === "number" && child.pid > 0) {
      await cleanupDetachedRuntimeStateIfOwnedByPid(child.pid).catch(() => {
        return;
      });
    }
    const startupOutputLine = selectRelevantDaemonStartFailureLogLine(
      startupOutput.summary()
    );
    return await handleDaemonRunStartFailure({
      cursor: startFailureLogCursor,
      fallbackRawLine: startupOutputLine ?? toErrorMessage(error),
      gatewayUrl: input.gatewayUrl,
      presenter: input.presenter,
      runtime: input.runtime,
      genericErrorPayload: {
        codePrefix: "daemon.run.start_failed",
        error: new Error(
          `Failed to start OpenMeld Service process: ${toErrorMessage(error)}`
        ),
      },
    });
  } finally {
    cleanupStartupCapture();
    startupLifecycle.clear();
  }
}

type DetachedDaemonServiceLaunchTarget = {
  command: string;
  args: string[];
};

async function resolveDetachedDaemonServiceLaunchTarget(): Promise<DetachedDaemonServiceLaunchTarget> {
  const entryPath = await resolveAlignedDaemonActiveBundleEntryPath({
    expectedVersion: OPENMELD_VERSION,
  });
  if (entryPath) {
    if (isBinaryDistribution()) {
      return { command: entryPath, args: [] };
    }
    return { command: process.execPath, args: [entryPath] };
  }
  throw new Error(
    "Cannot determine the active OpenMeld Service entry file for startup."
  );
}

function buildDetachedDaemonLaunchSpec(input: DaemonDetachedLaunchInput): {
  args: string[];
  commandText: string;
} {
  const detachedMode = input.mode === "background" ? "foreground" : input.mode;
  const sharedArgs = [
    ...(input.openMeldProfileId ? ["--profile", input.openMeldProfileId] : []),
    ...(input.deviceId ? ["--device-id", input.deviceId] : []),
    ...(typeof input.heartbeatMs === "number"
      ? ["--heartbeat-ms", String(input.heartbeatMs)]
      : []),
    ...(input.gatewayUrl ? ["--gateway-url", input.gatewayUrl] : []),
  ];
  return {
    args: ["service", "run", "--mode", detachedMode, ...sharedArgs],
    commandText: `openmeld ${["service", "run", "--mode", input.mode, ...sharedArgs].join(" ")}`,
  };
}

function emitDetachedDaemonStartSuccess(input: {
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
  pid: number;
  commandText: string;
}): void {
  if (input.runtime.resolvedView === "human") {
    renderServiceActionCard({
      presenter: input.presenter,
      codePrefix: "daemon.run.background_started",
      title: getDaemonStartStartedTitle(),
      rows: [
        {
          label: "✅ Status",
          value: formatDaemonStartStartedStatus(),
        },
        {
          label: "📡 Local Service Link",
          value: formatDaemonStartStartedMeaning(),
        },
        {
          label: "🛠️ Manage",
          value: formatDaemonStartStartedManage(),
        },
        {
          label: "🔍 Next",
          value: formatDaemonStartStartedNextStep(),
        },
      ],
    });
    return;
  }

  input.presenter.line({
    code: "daemon.run.background_started",
    text: `OpenMeld Service started in the background with pid ${String(input.pid)}. Command: ${formatOpenMeldCliCommand(
      input.commandText
    )}`,
  });
  if (input.runtime.resolvedView !== "agent") {
    return;
  }
  input.presenter.data({
    code: "daemon.run.background_started",
    payload: {
      ok: true,
      status: "running",
      pid: input.pid,
      mode: "background",
      command: input.commandText,
    },
  });
}

function waitForDetachedChildProcessSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: unknown): void => {
      cleanup();
      reject(error);
    };

    const cleanup = (): void => {
      child.off("spawn", onSpawn);
      child.off("error", onError);
    };

    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

async function waitForDetachedBackgroundProcessStartup(
  child: ChildProcess,
  startupDelayMs: number,
  startupPollMs: number,
  startupLifecycle: DetachedProcessLifecycle,
  startupOutput: StartupOutputCollector
): Promise<void> {
  if (typeof child.pid !== "number" || child.pid <= 0) {
    throw new Error("Background service process did not expose a pid.");
  }

  const startupDeadlineMs = Date.now() + startupDelayMs;
  while (Date.now() < startupDeadlineMs) {
    if (startupLifecycle.hasExited) {
      throw new Error(
        describeDetachedProcessStartupFailure({
          pid: child.pid,
          reason: startupLifecycle,
          startupOutput: startupOutput.summary(),
        })
      );
    }

    const runtimeStatus = await readCurrentObservedDaemonRuntimeStatus().catch(
      () => null
    );
    if (
      runtimeStatus?.status === "running" &&
      runtimeStatus.pid === child.pid
    ) {
      return;
    }

    if (!isPidAlive(child.pid)) {
      throw new Error(
        describeDetachedProcessStartupFailure({
          pid: child.pid,
          reason: startupLifecycle,
          startupOutput: startupOutput.summary(),
        })
      );
    }

    await sleep(startupPollMs);
  }

  const finalStatus = await readCurrentObservedDaemonRuntimeStatus().catch(
    () => null
  );
  if (finalStatus?.status === "running" && finalStatus.pid === child.pid) {
    return;
  }

  if (!isPidAlive(child.pid)) {
    throw new Error(
      describeDetachedProcessStartupFailure({
        pid: child.pid,
        reason: startupLifecycle,
        startupOutput: startupOutput.summary(),
      })
    );
  }
  throw new Error(
    `Background service did not report running state within startup timeout. ${startupOutput.summary()}`
  );
}

type DetachedProcessLifecycle = {
  hasExited: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
};

function observeDetachedProcessLifecycle(child: ChildProcess): {
  hasExited: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  clear: () => void;
} {
  const state: DetachedProcessLifecycle = {
    hasExited: false,
    exitCode: null,
    exitSignal: null,
  };
  const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    state.hasExited = true;
    state.exitCode = typeof code === "number" ? code : null;
    state.exitSignal = signal;
  };
  child.once("exit", onExit);
  return {
    get hasExited(): boolean {
      return state.hasExited;
    },
    get exitCode(): number | null {
      return state.exitCode;
    },
    get exitSignal(): NodeJS.Signals | null {
      return state.exitSignal;
    },
    clear: () => {
      child.off("exit", onExit);
    },
  };
}

type StartupOutputCollector = {
  append: (stream: "stdout" | "stderr", value: string) => void;
  summary: () => string;
};

function createLimitedStartupOutput(input: {
  maxBytes: number;
}): StartupOutputCollector {
  let output = "";
  let truncated = false;
  return {
    append: (stream, value) => {
      const chunk = value.trim();
      if (!chunk) {
        return;
      }
      const normalized = `[${stream}] ${chunk}`;
      output += `${output.length > 0 ? "\n" : ""}${normalized}`;
      if (output.length > input.maxBytes) {
        output = output.slice(output.length - input.maxBytes);
        truncated = true;
      }
    },
    summary: () => {
      const normalized = output.trim();
      if (!normalized) {
        return "No startup output captured.";
      }
      return truncated ? `...${normalized}` : normalized;
    },
  };
}

function attachDetachedProcessStartupOutputCapture(
  child: ChildProcess,
  output: StartupOutputCollector
): () => void {
  const onStdout = (chunk: Buffer | string): void => {
    output.append("stdout", chunk.toString());
  };
  const onStderr = (chunk: Buffer | string): void => {
    output.append("stderr", chunk.toString());
  };
  child.stdout?.on("data", onStdout);
  child.stderr?.on("data", onStderr);
  return () => {
    child.stdout?.off("data", onStdout);
    child.stderr?.off("data", onStderr);
  };
}

function describeDetachedProcessStartupFailure(input: {
  pid: number;
  reason: DetachedProcessLifecycle;
  startupOutput: string;
}): string {
  const details: string[] = [];
  if (typeof input.reason.exitCode === "number") {
    details.push(`exit code ${String(input.reason.exitCode)}`);
  }
  if (input.reason.exitSignal) {
    details.push(`signal ${input.reason.exitSignal}`);
  }
  const reasonText = details.length > 0 ? ` (${details.join(", ")})` : "";
  return `Background service process exited during startup (pid=${String(
    input.pid
  )})${reasonText}. ${input.startupOutput}`;
}

async function cleanupDetachedRuntimeStateIfOwnedByPid(
  pid: number
): Promise<void> {
  const runtimeStatus = await readCurrentObservedDaemonRuntimeStatus().catch(
    () => null
  );
  if (runtimeStatus?.status !== "running" && runtimeStatus?.pid === pid) {
    await clearDaemonServiceRuntimeState();
  }
}

function buildDaemonMenuPayload(): {
  commands: string[];
  notes: string[];
  actions: Array<{ command: string; description: string }>;
} {
  return {
    commands: [...DAEMON_MENU_COMMANDS],
    notes: [
      "start defaults to background mode; use --mode foreground for local foreground loop",
      "start starts OpenMeld Service in the background and keeps registration, heartbeat, and dispatch results flowing",
      "status reports install state and current runtime status",
      "stop terminates current daemon process (SIGTERM by default)",
      "install writes OpenMeld Service runtime files for this OpenMeld installation",
      "repair safely repairs OpenMeld Service and restarts it when needed (use --force to bypass drain timeout)",
      "update safely updates OpenMeld Service and restarts it when needed",
      "uninstall removes OpenMeld Service runtime files and install metadata",
      "future CLI startup checks service state again and recommends repair when needed",
      "daemon remains available as a legacy alias",
    ],
    actions: [
      {
        command: "openmeld service start",
        description:
          "Start OpenMeld Service in the recommended background mode.",
      },
      {
        command: "openmeld service stop",
        description: "Stop current daemon process.",
      },
      {
        command: "openmeld service autostart enable",
        description:
          "Allow OpenMeld Service to start automatically at sign-in without starting it now.",
      },
      {
        command: "openmeld service autostart disable",
        description:
          "Prevent OpenMeld Service from starting automatically at sign-in without stopping it now.",
      },
      {
        command: "openmeld service status",
        description: "Show install and runtime service status.",
      },
      {
        command: "openmeld service install",
        description: "Install OpenMeld Service runtime files.",
      },
      {
        command: "openmeld service repair",
        description: "Repair and restart OpenMeld Service with graceful drain.",
      },
      {
        command: "openmeld service update",
        description:
          "Update OpenMeld Service when the local service is outdated.",
      },
      {
        command: "openmeld service uninstall",
        description: "Remove OpenMeld Service runtime files.",
      },
    ],
  };
}

async function runInteractiveDaemonMenu(input: {
  gatewayUrl?: string;
  view: "human";
}): Promise<void> {
  for (;;) {
    const choice = await promptInteractiveDaemonMenuChoice();
    if (!choice) {
      cancel("Cancelled.");
      return;
    }

    const shouldContinue = await handleInteractiveDaemonMenuChoice(
      input,
      choice
    );
    if (shouldContinue) {
      continue;
    }
    return;
  }
}

async function promptInteractiveDaemonMenuChoice(): Promise<Exclude<
  (typeof DAEMON_MENU_CHOICE)[keyof typeof DAEMON_MENU_CHOICE],
  typeof DAEMON_MENU_CHOICE.exit
> | null> {
  const choice = await select({
    message: "OpenMeld Service:",
    options: [
      {
        value: DAEMON_MENU_CHOICE.run,
        label: "Start",
        hint: "Start service (background)",
      },
      {
        value: DAEMON_MENU_CHOICE.stop,
        label: "Stop",
        hint: "Stop running service",
      },
      {
        value: DAEMON_MENU_CHOICE.autostartEnable,
        label: "Enable autostart",
        hint: "Allow service launch at sign-in",
      },
      {
        value: DAEMON_MENU_CHOICE.autostartDisable,
        label: "Disable autostart",
        hint: "Keep current process state unchanged",
      },
      {
        value: DAEMON_MENU_CHOICE.status,
        label: "Status",
        hint: "Show install + runtime status",
      },
      {
        value: DAEMON_MENU_CHOICE.install,
        label: "Install",
        hint: "Install runtime assets",
      },
      {
        value: DAEMON_MENU_CHOICE.reinstall,
        label: "Repair",
        hint: "Safe repair + restart",
      },
      {
        value: DAEMON_MENU_CHOICE.update,
        label: "Update",
        hint: "Update service build when needed",
      },
      {
        value: DAEMON_MENU_CHOICE.uninstall,
        label: "Uninstall",
        hint: "Remove runtime assets",
      },
      {
        value: DAEMON_MENU_CHOICE.exit,
        label: "Exit",
      },
    ],
  });
  if (isCancel(choice) || choice === DAEMON_MENU_CHOICE.exit) {
    return null;
  }
  return choice as Exclude<
    (typeof DAEMON_MENU_CHOICE)[keyof typeof DAEMON_MENU_CHOICE],
    typeof DAEMON_MENU_CHOICE.exit
  >;
}

async function handleInteractiveDaemonMenuChoice(
  input: {
    gatewayUrl?: string;
    view: "human";
  },
  choice: Exclude<
    (typeof DAEMON_MENU_CHOICE)[keyof typeof DAEMON_MENU_CHOICE],
    typeof DAEMON_MENU_CHOICE.exit
  >
): Promise<boolean> {
  if (choice === DAEMON_MENU_CHOICE.status) {
    await runDaemonStatusFlow(input);
    return true;
  }
  if (choice === DAEMON_MENU_CHOICE.run) {
    const result = await runDaemonRunAfterEntryChecks({
      ...input,
      allowModeBack: true,
      suppressModeCancelOutput: true,
    });
    return !result.ok && result.reason === "cancelled";
  }
  if (choice === DAEMON_MENU_CHOICE.stop) {
    const result = await runDaemonStop(input);
    return result.status === "cancelled";
  }
  if (
    choice === DAEMON_MENU_CHOICE.autostartEnable ||
    choice === DAEMON_MENU_CHOICE.autostartDisable
  ) {
    await runDaemonAutostart({
      ...input,
      action:
        choice === DAEMON_MENU_CHOICE.autostartEnable ? "enable" : "disable",
    });
    return true;
  }
  if (choice === DAEMON_MENU_CHOICE.install) {
    await runDaemonInstall(input);
    return false;
  }
  if (
    choice === DAEMON_MENU_CHOICE.reinstall ||
    choice === DAEMON_MENU_CHOICE.update
  ) {
    const result = await runDaemonReinstall(
      {
        ...input,
        displayAction:
          choice === DAEMON_MENU_CHOICE.update ? "update" : "repair",
      },
      {
        suppressInstallOutput: true,
      }
    );
    if (isDaemonReinstallCompletedAndStopped(result)) {
      const followUp = await maybeOfferDaemonStartAfterReinstall({
        gatewayUrl: input.gatewayUrl,
        view: input.view,
      });
      return followUp === "cancelled";
    }
    return result.result === "cancelled";
  }
  const result = await runDaemonUninstall(input);
  return result === "cancelled";
}

async function maybeOfferDaemonStartAfterReinstall(input: {
  gatewayUrl?: string;
  view: "human";
  ownerUserId?: string | null;
  localDemand?: LocalServiceDemand | null;
}): Promise<DaemonInteractiveCommandResult> {
  const readiness = await resolveDaemonStartAfterReinstallReadiness({
    ownerUserId: input.ownerUserId,
    localDemand: input.localDemand,
  });
  if (!readiness.offerStartPrompt) {
    return "completed";
  }

  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  const decision = await runDaemonStartDecisionPrompt({
    startService: async () =>
      await runDaemonBackgroundStartForDecision({
        gatewayUrl: input.gatewayUrl,
        view: input.view,
      }),
  });

  if (decision === "cancelled") {
    return "cancelled";
  }
  if (decision === "deferred_with_card") {
    return "completed";
  }
  if (decision === "not_now") {
    renderDaemonStartDeferredCard({
      presenter,
      codePrefix: "daemon.status.start_deferred",
    });
    return "completed";
  }

  if (decision === "failed") {
    renderDaemonStartNeedsAttentionCard({
      presenter,
      codePrefix: "daemon.status.start_failed",
      summary: "OpenMeld could not finish starting OpenMeld Service.",
    });
  }
  return "completed";
}

async function resolveDaemonStartAfterReinstallReadiness(input: {
  ownerUserId?: string | null;
  localDemand?: LocalServiceDemand | null;
}): Promise<{
  offerStartPrompt: boolean;
}> {
  const localDemand =
    input.localDemand ??
    (await resolveLocalServiceDemand({
      ownerUserId: input.ownerUserId,
    }).catch(() => null));
  if (localDemand?.decision !== "keep_running") {
    return {
      offerStartPrompt: false,
    };
  }

  const status = await getDaemonStatus();
  if (!status.installed) {
    return {
      offerStartPrompt: false,
    };
  }

  const runtimeState = await resolveDaemonRuntimeState(status);
  if (!runtimeState) {
    return {
      offerStartPrompt: false,
    };
  }

  const { serviceManagerStatus } =
    await resolveDaemonServiceManagerForRuntimeState({
      status,
      runtimeState,
    });
  const effectiveStatus = getEffectiveDaemonRuntimeStatus({
    runtimeState,
    serviceManagerStatus,
  });

  return {
    offerStartPrompt: shouldOfferDaemonStartDecision(effectiveStatus),
  };
}

function parseDaemonRunMode(rawMode: string | undefined): DaemonRunMode {
  const normalized = normalizeText(rawMode);
  if (normalized === "foreground") {
    return "foreground";
  }
  if (normalized === "background") {
    return "background";
  }
  return DEFAULT_DAEMON_RUN_MODE;
}
