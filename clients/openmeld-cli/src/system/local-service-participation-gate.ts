import type { LocalMachineIssue } from "@openmeld/schemas";
import {
  type DaemonServiceProgressReporter,
  runDaemonBackgroundStartForDecision,
  runDaemonInstall,
  runDaemonReinstall,
} from "../commands/service";
import {
  buildSystemServiceStartupFailureReportFromVerdict,
  type SystemServiceStartupFailureVerdict,
} from "../commands/service-start-failure";
import { normalizeGatewayBaseUrlOrNull } from "../config/base-url";
import { readDaemonServiceContract } from "../config/daemon-service-contract";
import type { DaemonServiceRuntimeStatus } from "../config/daemon-state";
import { toErrorMessage } from "../local-service/core/logger";
import { resolveCurrentDaemonExpectedVersion } from "../local-service/lifecycle/current-daemon-version";
import {
  classifyDaemonServiceRunStartability,
  classifyDaemonServiceWakeability,
  DAEMON_SERVICE_WAKEABILITY_ADVISORY_ANOMALIES,
} from "../local-service/lifecycle/daemon-service-anomaly-groups";
import {
  type DaemonServiceAnomalyCode,
  inspectDaemonServiceInventory,
} from "../local-service/lifecycle/daemon-service-inventory";
import type { LocalServiceDemand } from "../local-service/lifecycle/local-service-demand";
import type { Presenter } from "../runtime/presenter/types";
import {
  formatDaemonInstallFailedMessage,
  runDaemonInstallDecisionPrompt,
} from "../system/local-service-install-attention";
import {
  buildDaemonStartDeferredCard,
  buildDaemonStartNeedsAttentionCard,
  runDaemonStartDecisionPrompt,
} from "../system/local-service-start-decision";
import { renderInfoCard } from "../ui/info-card";

export type DaemonServiceParticipationIntent =
  | "start"
  | "space_join"
  | "space_create_join"
  | "space_add_members";

export type DaemonServiceParticipationStatus =
  | {
      kind: "ready";
      expectedVersion: string;
      installedVersion: string | null;
      runtimeStatus: DaemonServiceRuntimeStatus["status"];
      advisoryAnomalyCodes?: DaemonServiceAnomalyCode[];
    }
  | {
      kind: "missing";
      expectedVersion: string;
    }
  | {
      kind: "outdated";
      expectedVersion: string;
      installedVersion: string;
    }
  | {
      kind: "not_running";
      expectedVersion: string;
      installedVersion: string | null;
      runtimeStatus: DaemonServiceRuntimeStatus["status"] | null;
    }
  | {
      kind: "needs_repair";
      expectedVersion: string;
      installedVersion: string | null;
      runtimeStatus: DaemonServiceRuntimeStatus["status"] | null;
      detail: string;
      anomalyCodes: string[];
    };

export type DaemonServiceParticipationGateResult = {
  errorMessage?: string;
  localMachineIssue?: LocalMachineIssue;
  status: "aligned" | "declined" | "cancelled" | "needs_attention";
};

type DaemonServiceAccountAlignmentIssue = {
  reasonCode: string;
  summary: string;
};

export function shouldRequireDaemonServiceParticipation(
  localDemand?: LocalServiceDemand | null
): boolean {
  return localDemand?.decision === "keep_running";
}

export async function resolveDaemonServiceParticipationStatus(input?: {
  expectedVersion?: string;
}): Promise<DaemonServiceParticipationStatus> {
  const expectedVersion =
    input?.expectedVersion ?? resolveCurrentDaemonExpectedVersion();
  const inventory = await inspectDaemonServiceInventory({
    expectedVersion,
  });

  if (!(inventory.installStatus.installed && inventory.installStatus.state)) {
    return {
      kind: "missing",
      expectedVersion,
    };
  }

  const installedVersion = inventory.installStatus.state.daemonVersion;
  const wakeability = classifyDaemonServiceWakeability({
    inventory,
  });
  const blockingServiceDriftCodes = wakeability.blockingCodes;
  const runBlockingServiceDriftCodes = classifyDaemonServiceRunStartability({
    inventory,
  }).blockingCodes;
  const repairAnomalies = inventory.anomalies.filter((anomaly) =>
    [...blockingServiceDriftCodes, ...runBlockingServiceDriftCodes].includes(
      anomaly.code
    )
  );
  if (repairAnomalies.length > 0) {
    return {
      kind: "needs_repair",
      expectedVersion,
      installedVersion,
      runtimeStatus: inventory.runtimeStatus.status,
      detail:
        repairAnomalies[0]?.message ??
        "OpenMeld found conflicting local service state on this device.",
      anomalyCodes: inventory.anomalies.map((anomaly) => anomaly.code),
    };
  }

  if (inventory.runtimeStatus.status !== "running") {
    return {
      kind: "not_running",
      expectedVersion,
      installedVersion,
      runtimeStatus: inventory.runtimeStatus.status,
    };
  }

  return {
    kind: "ready",
    expectedVersion,
    installedVersion,
    runtimeStatus: inventory.runtimeStatus.status,
    advisoryAnomalyCodes: wakeability.advisoryCodes,
  };
}

export async function runDaemonServiceParticipationGate(input: {
  intent: DaemonServiceParticipationIntent;
  presenter: Presenter;
  resolvedView: "human" | "agent";
  allowPrompt: boolean;
  openMeldProfileId?: string;
  autoRepair?: boolean;
  expectedOwnerUserId?: string;
  gatewayUrl?: string;
  localDemand?: LocalServiceDemand | null;
  forcePrompt?: boolean;
  forceRefresh?: boolean;
  serviceProgress?: DaemonServiceProgressReporter;
  suppressRefreshHumanResultCard?: boolean;
  suppressStartSpinner?: boolean;
  view?: string;
}): Promise<DaemonServiceParticipationGateResult> {
  // A newer auth session alone is not a mismatch: re-logging into the same
  // account must not reinstall a healthy service. Account drift is detected
  // by the explicit alignment check below (owner/profile/gateway expectations
  // from the caller), never by comparing timestamps.
  const forceRefresh = input.forceRefresh === true;
  const gateInput = {
    ...input,
    forceRefresh,
  };

  if (!shouldRunDaemonServiceParticipationGate(gateInput)) {
    return { status: "aligned" };
  }

  const initialStatus = await resolveDaemonServiceParticipationStatus();
  if (isReadyAdvisoryServiceDrift(initialStatus)) {
    const codePrefix = resolveDaemonServiceParticipationCodePrefix(
      input.intent
    );
    if (input.autoRepair === true) {
      return await runDaemonServiceParticipationRefresh({
        input,
        codePrefix,
        expectedVersion: initialStatus.expectedVersion,
      });
    }
  }
  if (isRunningAdvisoryOnlyServiceDrift(initialStatus)) {
    const accountIssue = await resolveDaemonServiceAccountAlignmentIssue(input);
    if (!accountIssue) {
      return { status: "aligned" };
    }
    const codePrefix = resolveDaemonServiceParticipationCodePrefix(
      input.intent
    );
    if (input.autoRepair === true) {
      return await runDaemonServiceParticipationRefresh({
        input,
        codePrefix,
        expectedVersion: initialStatus.expectedVersion,
        accountIssue,
      });
    }
    renderDaemonStartNeedsAttention({
      presenter: input.presenter,
      codePrefix,
      summary: accountIssue.summary,
    });
    input.presenter.line({
      code: `${codePrefix}.account_alignment_failed`,
      text: accountIssue.summary,
      data: { reasonCode: accountIssue.reasonCode },
    });
    return { status: "needs_attention" };
  }
  if (forceRefresh && initialStatus.kind === "ready") {
    return await runDaemonServiceParticipationRefresh({
      input,
      codePrefix: resolveDaemonServiceParticipationCodePrefix(input.intent),
      expectedVersion: initialStatus.expectedVersion,
    });
  }
  if (initialStatus.kind === "ready") {
    const accountIssue = await resolveDaemonServiceAccountAlignmentIssue(input);
    if (!accountIssue) {
      return { status: "aligned" };
    }
    const codePrefix = resolveDaemonServiceParticipationCodePrefix(
      input.intent
    );
    if (input.autoRepair === true) {
      return await runDaemonServiceParticipationRefresh({
        input,
        codePrefix,
        expectedVersion: initialStatus.expectedVersion,
        accountIssue,
      });
    }
    renderDaemonStartNeedsAttention({
      presenter: input.presenter,
      codePrefix,
      summary: accountIssue.summary,
    });
    input.presenter.line({
      code: `${codePrefix}.account_alignment_failed`,
      text: accountIssue.summary,
      data: { reasonCode: accountIssue.reasonCode },
    });
    return { status: "needs_attention" };
  }
  const codePrefix = resolveDaemonServiceParticipationCodePrefix(input.intent);
  const installStageResult = await runDaemonServiceParticipationInstallStage({
    input,
    codePrefix,
    status: initialStatus,
  });
  if (installStageResult.result) {
    return installStageResult.result;
  }

  return await runDaemonServiceParticipationActionStage({
    input,
    codePrefix,
    status: installStageResult.status,
  });
}

function isRunningAdvisoryOnlyServiceDrift(
  status: DaemonServiceParticipationStatus
): status is Extract<
  DaemonServiceParticipationStatus,
  { kind: "needs_repair" }
> {
  return (
    status.kind === "needs_repair" &&
    status.runtimeStatus === "running" &&
    status.anomalyCodes.length > 0 &&
    status.anomalyCodes.every((code) =>
      DAEMON_SERVICE_WAKEABILITY_ADVISORY_ANOMALIES.has(
        code as DaemonServiceAnomalyCode
      )
    )
  );
}

function isReadyAdvisoryServiceDrift(
  status: DaemonServiceParticipationStatus
): status is Extract<DaemonServiceParticipationStatus, { kind: "ready" }> {
  return (
    status.kind === "ready" &&
    Array.isArray(status.advisoryAnomalyCodes) &&
    status.advisoryAnomalyCodes.length > 0
  );
}

function shouldRunDaemonServiceParticipationGate(input: {
  resolvedView: "human" | "agent";
  allowPrompt: boolean;
  autoRepair?: boolean;
  forceRefresh?: boolean;
  localDemand?: LocalServiceDemand | null;
  forcePrompt?: boolean;
}): boolean {
  const canActWithoutPrompt =
    input.autoRepair === true &&
    (input.resolvedView === "human" ||
      (input.resolvedView === "agent" &&
        (input.forcePrompt === true || input.forceRefresh === true)));
  const canPrompt =
    input.resolvedView === "human" &&
    (input.allowPrompt || input.autoRepair === true);
  return (
    (canPrompt || canActWithoutPrompt) &&
    (input.forcePrompt === true ||
      input.forceRefresh === true ||
      shouldRequireDaemonServiceParticipation(input.localDemand))
  );
}

async function runDaemonServiceParticipationInstallStage(input: {
  input: {
    openMeldProfileId?: string;
    expectedOwnerUserId?: string;
    gatewayUrl?: string;
    intent: DaemonServiceParticipationIntent;
    autoRepair?: boolean;
    presenter: Presenter;
    serviceProgress?: DaemonServiceProgressReporter;
    suppressRefreshHumanResultCard?: boolean;
    suppressStartSpinner?: boolean;
    view?: string;
  };
  codePrefix: string;
  status: DaemonServiceParticipationStatus;
}): Promise<{
  status: DaemonServiceParticipationStatus;
  result?: DaemonServiceParticipationGateResult;
}> {
  if (input.status.kind !== "missing" && input.status.kind !== "outdated") {
    return {
      status: input.status,
    };
  }
  const installableStatus = input.status;

  if (input.input.autoRepair === true) {
    try {
      await runDaemonServiceParticipationInstallAction({
        input: input.input,
        status: installableStatus,
      });
    } catch {
      renderDaemonStartNeedsAttention({
        presenter: input.input.presenter,
        codePrefix: input.codePrefix,
        summary: formatDaemonInstallFailedMessage(installableStatus.kind),
      });
      return {
        status: installableStatus,
        result: { status: "needs_attention" },
      };
    }

    return await resolveDaemonServiceParticipationStatusAfterInstall(input);
  }

  const installResult = await runDaemonInstallDecisionPrompt({
    kind: installableStatus.kind,
    ...(installableStatus.kind === "outdated"
      ? {
          installedVersion: installableStatus.installedVersion,
        }
      : {}),
    expectedVersion: installableStatus.expectedVersion,
    emitLine: (text) => {
      input.input.presenter.line({
        code: `${input.codePrefix}.install`,
        text,
      });
    },
    installService: async () => {
      await runDaemonServiceParticipationInstallAction({
        input: input.input,
        status: installableStatus,
      });
    },
  });

  if (installResult === "cancelled") {
    return {
      status: installableStatus,
      result: { status: "cancelled" },
    };
  }
  if (installResult === "failed") {
    return {
      status: installableStatus,
      result: { status: "needs_attention" },
    };
  }
  if (
    installResult === "not_now" ||
    !shouldStartAfterDaemonInstall(input.input.intent)
  ) {
    return {
      status: installableStatus,
      result: { status: "declined" },
    };
  }

  return await resolveDaemonServiceParticipationStatusAfterInstall(input);
}

async function runDaemonServiceParticipationInstallAction(input: {
  input: {
    openMeldProfileId?: string;
    gatewayUrl?: string;
    intent: DaemonServiceParticipationIntent;
    serviceProgress?: DaemonServiceProgressReporter;
    suppressRefreshHumanResultCard?: boolean;
    view?: string;
  };
  status: Extract<
    DaemonServiceParticipationStatus,
    { kind: "missing" | "outdated" }
  >;
}): Promise<void> {
  if (input.status.kind === "outdated") {
    input.input.serviceProgress?.detail({
      code: "daemon.participation.refresh.updating",
      text: "Updating OpenMeld Service...",
    });
    await runDaemonServiceSafeRefresh({
      openMeldProfileId: input.input.openMeldProfileId,
      gatewayUrl: input.input.gatewayUrl,
      suppressHumanResultCard: input.input.suppressRefreshHumanResultCard,
      view: input.input.view,
    });
    return;
  }

  await runDaemonInstall(
    {
      ...(input.input.gatewayUrl ? { gatewayUrl: input.input.gatewayUrl } : {}),
      ...(input.input.openMeldProfileId
        ? { profile: input.input.openMeldProfileId }
        : {}),
      view: input.input.view,
    },
    {
      suppressHumanOutput: shouldSuppressHumanInstallOutput(input.input.intent),
      ...(input.input.serviceProgress
        ? { serviceProgress: input.input.serviceProgress }
        : {}),
    }
  );
}

async function resolveDaemonServiceParticipationStatusAfterInstall(input: {
  input: {
    presenter: Presenter;
  };
  codePrefix: string;
  status: DaemonServiceParticipationStatus;
}): Promise<{
  status: DaemonServiceParticipationStatus;
  result?: DaemonServiceParticipationGateResult;
}> {
  const refreshedStatus = await resolveDaemonServiceParticipationStatus();
  if (refreshedStatus.kind === "ready") {
    return {
      status: refreshedStatus,
      result: { status: "aligned" },
    };
  }
  if (
    refreshedStatus.kind === "missing" ||
    refreshedStatus.kind === "outdated"
  ) {
    renderDaemonStartNeedsAttention({
      presenter: input.input.presenter,
      codePrefix: input.codePrefix,
      summary:
        refreshedStatus.kind === "missing"
          ? formatDaemonInstallFailedMessage("missing")
          : formatDaemonInstallFailedMessage("outdated"),
    });
    return {
      status: refreshedStatus,
      result: { status: "needs_attention" },
    };
  }

  return {
    status: refreshedStatus,
  };
}

async function runDaemonServiceSafeRefresh(input: {
  openMeldProfileId?: string;
  gatewayUrl?: string;
  suppressHumanResultCard?: boolean;
  view?: string;
  forceReinstall?: boolean;
}): Promise<Awaited<ReturnType<typeof runDaemonReinstall>>> {
  return await runDaemonReinstall(
    {
      agentOverviewHandled: true,
      ...(input.gatewayUrl ? { gatewayUrl: input.gatewayUrl } : {}),
      ...(input.openMeldProfileId ? { profile: input.openMeldProfileId } : {}),
      view: input.view,
    },
    {
      skipConfirm: true,
      startAfterInstallMode: "always",
      suppressAgentOverview: true,
      ...(input.suppressHumanResultCard !== undefined
        ? { suppressHumanResultCard: input.suppressHumanResultCard }
        : {}),
      suppressInstallOutput: true,
      ...(input.forceReinstall === true ? { forceReinstall: true } : {}),
    }
  );
}

async function runDaemonBackgroundStartForParticipation(input: {
  openMeldProfileId?: string | undefined;
  gatewayUrl?: string | undefined;
  serviceProgress?: DaemonServiceProgressReporter | undefined;
  suppressStartSpinner?: boolean | undefined;
  view?: string | undefined;
}): Promise<Awaited<ReturnType<typeof runDaemonBackgroundStartForDecision>>> {
  return await runDaemonBackgroundStartForDecision({
    gatewayUrl: input.gatewayUrl,
    ...(input.openMeldProfileId ? { profile: input.openMeldProfileId } : {}),
    ...(input.serviceProgress
      ? { serviceProgress: input.serviceProgress }
      : {}),
    ...(input.suppressStartSpinner === true
      ? { suppressStartSpinner: true }
      : {}),
    view: input.view,
  });
}

async function runDaemonServiceParticipationActionStage(input: {
  input: {
    openMeldProfileId?: string;
    expectedOwnerUserId?: string;
    autoRepair?: boolean;
    presenter: Presenter;
    gatewayUrl?: string;
    serviceProgress?: DaemonServiceProgressReporter;
    suppressRefreshHumanResultCard?: boolean;
    suppressStartSpinner?: boolean;
    view?: string;
    forceRefresh?: boolean;
  };
  codePrefix: string;
  status: DaemonServiceParticipationStatus;
}): Promise<DaemonServiceParticipationGateResult> {
  if (input.status.kind === "needs_repair") {
    return await runDaemonServiceParticipationRefresh({
      input: input.input,
      codePrefix: input.codePrefix,
      expectedVersion: input.status.expectedVersion,
    });
  }
  if (input.status.kind !== "not_running") {
    return { status: "aligned" };
  }

  if (input.input.autoRepair === true) {
    const startResult = await runDaemonBackgroundStartForParticipation({
      openMeldProfileId: input.input.openMeldProfileId,
      gatewayUrl: input.input.gatewayUrl,
      serviceProgress: input.input.serviceProgress,
      suppressStartSpinner: input.input.suppressStartSpinner,
      view: input.input.view,
    });
    return await mapDaemonBackgroundStartResult(startResult, {
      expectedVersion: input.status.expectedVersion,
      presenter: input.input.presenter,
      codePrefix: input.codePrefix,
    });
  }

  const startResult = await runDaemonStartDecisionPrompt({
    startService: async () =>
      await runDaemonBackgroundStartForParticipation({
        openMeldProfileId: input.input.openMeldProfileId,
        gatewayUrl: input.input.gatewayUrl,
        serviceProgress: input.input.serviceProgress,
        suppressStartSpinner: input.input.suppressStartSpinner,
        view: input.input.view,
      }),
  });

  return await mapDaemonBackgroundStartResult(startResult, {
    expectedVersion: input.status.expectedVersion,
    presenter: input.input.presenter,
    codePrefix: input.codePrefix,
  });
}

async function runDaemonServiceParticipationRefresh(input: {
  input: {
    openMeldProfileId?: string;
    expectedOwnerUserId?: string;
    gatewayUrl?: string;
    presenter: Presenter;
    forceRefresh?: boolean;
    serviceProgress?: DaemonServiceProgressReporter;
    suppressRefreshHumanResultCard?: boolean;
    suppressStartSpinner?: boolean;
    view?: string;
  };
  accountIssue?: DaemonServiceAccountAlignmentIssue;
  codePrefix: string;
  expectedVersion: string;
}): Promise<DaemonServiceParticipationGateResult> {
  if (input.accountIssue) {
    input.input.presenter.line({
      code: `${input.codePrefix}.account_alignment_refresh`,
      text: input.accountIssue.summary,
      data: { reasonCode: input.accountIssue.reasonCode },
    });
  }
  try {
    input.input.serviceProgress?.detail({
      code: "daemon.participation.refresh.updating",
      text: "Updating OpenMeld Service...",
    });
    const refreshOutcome = await runDaemonServiceSafeRefresh({
      openMeldProfileId: input.input.openMeldProfileId,
      gatewayUrl: input.input.gatewayUrl,
      suppressHumanResultCard: input.input.suppressRefreshHumanResultCard,
      view: input.input.view,
      forceReinstall: shouldForceDaemonServiceReinstall({
        accountIssue: input.accountIssue,
        forceRefresh: input.input.forceRefresh,
      }),
    });
    if (isCancelledDaemonServiceRefresh(refreshOutcome)) {
      return { status: "cancelled" };
    }
    if (isStoppedDaemonServiceRefresh(refreshOutcome)) {
      const startResult = await runDaemonBackgroundStartForParticipation({
        openMeldProfileId: input.input.openMeldProfileId,
        gatewayUrl: input.input.gatewayUrl,
        serviceProgress: input.input.serviceProgress,
        suppressStartSpinner: input.input.suppressStartSpinner,
        view: input.input.view,
      });
      const startMapped = await mapDaemonBackgroundStartResult(startResult, {
        expectedVersion: input.expectedVersion,
        presenter: input.input.presenter,
        codePrefix: input.codePrefix,
      });
      if (startMapped.status !== "aligned") {
        return startMapped;
      }
      const accountIssueAfterStart =
        await resolveDaemonServiceAccountAlignmentIssue(input.input);
      if (accountIssueAfterStart) {
        renderDaemonStartNeedsAttention({
          presenter: input.input.presenter,
          codePrefix: input.codePrefix,
          summary: accountIssueAfterStart.summary,
        });
        input.input.presenter.line({
          code: `${input.codePrefix}.account_alignment_failed`,
          text: accountIssueAfterStart.summary,
          data: { reasonCode: accountIssueAfterStart.reasonCode },
        });
        return { status: "needs_attention" };
      }
      return startMapped;
    }
    // The reinstall started the service in silent output mode, so its detailed
    // startup-failure card was discarded. If the failure carried a launchd
    // job-state verdict (never-spawned / crash-loop), surface that detailed card
    // here instead of the generic "was repaired, but not running yet" summary.
    // Presentation-only: the verdict never re-enters the alignment decision.
    if (
      !refreshOutcome.ok &&
      (refreshOutcome.result === "start_failed" ||
        refreshOutcome.result === "start_blocked") &&
      (refreshOutcome.startFailureVerdict?.jobDiagnostics ||
        refreshOutcome.startFailureVerdict?.localMachineIssue)
    ) {
      return renderRefreshStartFailure({
        codePrefix: input.codePrefix,
        presenter: input.input.presenter,
        verdict: refreshOutcome.startFailureVerdict,
      });
    }
    if (
      !(
        refreshOutcome.ok &&
        (refreshOutcome.result === "already_healthy" ||
          refreshOutcome.result === "completed") &&
        refreshOutcome.serviceState === "running"
      )
    ) {
      throw new Error(
        `OpenMeld Service refresh did not complete: ${refreshOutcome.result}`
      );
    }
  } catch (error) {
    const summary =
      "OpenMeld Service was repaired, but it is not running yet. " +
      "Local Wake work will keep waiting until OpenMeld Service starts. " +
      "Run `openmeld service start`.";
    renderRefreshFailureIfVisible({
      codePrefix: input.codePrefix,
      presenter: input.input.presenter,
      summary,
      suppressed: input.input.suppressRefreshHumanResultCard === true,
    });
    return {
      errorMessage: toErrorMessage(error),
      status: "needs_attention",
    };
  }

  const refreshedStatus = await resolveDaemonServiceParticipationStatus({
    expectedVersion: input.expectedVersion,
  });
  const accountIssue = await resolveDaemonServiceAccountAlignmentIssue(
    input.input
  );
  if (refreshedStatus.kind === "ready" && !accountIssue) {
    return { status: "aligned" };
  }
  renderDaemonStartNeedsAttention({
    presenter: input.input.presenter,
    codePrefix: input.codePrefix,
    summary:
      accountIssue?.summary ??
      summarizeDaemonServiceParticipationStatus(refreshedStatus),
  });
  if (accountIssue) {
    input.input.presenter.line({
      code: `${input.codePrefix}.account_alignment_failed`,
      text: accountIssue.summary,
      data: { reasonCode: accountIssue.reasonCode },
    });
  }
  return { status: "needs_attention" };
}

function renderRefreshFailureIfVisible(input: {
  codePrefix: string;
  presenter: Presenter;
  summary: string;
  suppressed: boolean;
}): void {
  if (input.suppressed) {
    return;
  }
  renderDaemonStartNeedsAttention({
    autoRepairAttempted: true,
    codePrefix: input.codePrefix,
    presenter: input.presenter,
    summary: input.summary,
  });
}

function shouldForceDaemonServiceReinstall(input: {
  accountIssue?: DaemonServiceAccountAlignmentIssue;
  forceRefresh?: boolean;
}): boolean {
  return input.accountIssue !== undefined || input.forceRefresh === true;
}

function renderRefreshStartFailure(input: {
  codePrefix: string;
  presenter: Presenter;
  verdict: SystemServiceStartupFailureVerdict;
}): DaemonServiceParticipationGateResult {
  const report = buildSystemServiceStartupFailureReportFromVerdict(
    input.verdict,
    { autoRepairAttempted: true }
  );
  renderInfoCard({
    presenter: input.presenter,
    title: report.title,
    codePrefix: `${input.codePrefix}.failed`,
    rows: report.rows,
  });
  if (input.verdict.localMachineIssue) {
    return {
      errorMessage: report.summary,
      localMachineIssue: input.verdict.localMachineIssue,
      status: "needs_attention",
    };
  }
  return {
    errorMessage: report.summary,
    status: "needs_attention",
  };
}

async function resolveDaemonServiceAccountAlignmentIssue(input: {
  openMeldProfileId?: string;
  expectedOwnerUserId?: string;
  gatewayUrl?: string;
}): Promise<DaemonServiceAccountAlignmentIssue | null> {
  const expectedProfileId = normalizeOptionalText(input.openMeldProfileId);
  const expectedOwnerUserId = normalizeOptionalText(input.expectedOwnerUserId);
  const expectedGatewayUrl = normalizeGatewayBaseUrlOrNull(input.gatewayUrl);
  if (!(expectedProfileId || expectedOwnerUserId || expectedGatewayUrl)) {
    return null;
  }

  const contract = await readDaemonServiceContract().catch(() => null);
  if (!contract) {
    return {
      reasonCode: "service_contract.missing",
      summary:
        "OpenMeld Service is running, but this setup could not verify the service account contract for this computer.",
    };
  }

  const contractOwnerUserId = normalizeOptionalText(contract.ownerUserId);
  if (
    expectedOwnerUserId &&
    contractOwnerUserId &&
    contractOwnerUserId !== expectedOwnerUserId
  ) {
    return {
      reasonCode: "service_contract.owner_mismatch",
      summary:
        "OpenMeld Service is running for a different OpenMeld account. This setup will reconnect OpenMeld Service to the current Web account.",
    };
  }

  if (
    expectedProfileId &&
    contract.profileId &&
    contract.profileId !== expectedProfileId
  ) {
    return {
      reasonCode: "service_contract.profile_mismatch",
      summary:
        "OpenMeld Service is running for a different OpenMeld account. This setup will reconnect OpenMeld Service to the current Web account.",
    };
  }

  if (
    expectedOwnerUserId &&
    expectedProfileId &&
    !(contractOwnerUserId || contract.profileId)
  ) {
    return {
      reasonCode: "service_contract.owner_unverified",
      summary:
        "OpenMeld Service is running, but this setup could not verify that OpenMeld Service belongs to the current Web account. This setup will reconnect OpenMeld Service to the current Web account.",
    };
  }

  const contractGatewayUrl = normalizeGatewayBaseUrlOrNull(contract.gatewayUrl);
  if (
    expectedGatewayUrl &&
    contractGatewayUrl &&
    contractGatewayUrl !== expectedGatewayUrl
  ) {
    return {
      reasonCode: "service_contract.gateway_mismatch",
      summary:
        "OpenMeld Service is running for a different OpenMeld gateway. This setup will reconnect OpenMeld Service to the current Web account.",
    };
  }

  return null;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveDaemonServiceParticipationCodePrefix(
  intent: DaemonServiceParticipationIntent
): string {
  switch (intent) {
    case "start":
      return "start.service";
    case "space_create_join":
      return "space.create_join.service";
    case "space_join":
      return "space.join.service";
    case "space_add_members":
      return "space.add_members.service";
    default:
      throw new Error(`Unknown local service participation intent: ${intent}`);
  }
}

function isCancelledDaemonServiceRefresh(
  outcome: Awaited<ReturnType<typeof runDaemonServiceSafeRefresh>>
): boolean {
  return !outcome.ok && outcome.result === "cancelled";
}

function isStoppedDaemonServiceRefresh(
  outcome: Awaited<ReturnType<typeof runDaemonServiceSafeRefresh>>
): outcome is Extract<
  Awaited<ReturnType<typeof runDaemonServiceSafeRefresh>>,
  { ok: true; serviceState: "stopped" }
> {
  return (
    outcome.ok &&
    (outcome.result === "already_healthy" ||
      outcome.result === "completed" ||
      outcome.result === "stopped_safe") &&
    outcome.serviceState === "stopped"
  );
}

function shouldStartAfterDaemonInstall(
  _intent: DaemonServiceParticipationIntent
): boolean {
  return true;
}

function shouldSuppressHumanInstallOutput(
  intent: DaemonServiceParticipationIntent
): boolean {
  return intent !== "start";
}

async function mapDaemonBackgroundStartResult(
  result:
    | "started"
    | "not_now"
    | "cancelled"
    | "failed"
    | "failed_with_card"
    | "deferred_with_card",
  input: {
    expectedVersion: string;
    presenter: Presenter;
    codePrefix: string;
  }
): Promise<DaemonServiceParticipationGateResult> {
  if (result === "started") {
    const refreshedStatus = await resolveDaemonServiceParticipationStatus({
      expectedVersion: input.expectedVersion,
    });
    if (refreshedStatus.kind === "ready") {
      return { status: "aligned" };
    }

    renderDaemonStartNeedsAttention({
      presenter: input.presenter,
      codePrefix: input.codePrefix,
      summary: summarizeDaemonServiceParticipationStatus(refreshedStatus),
    });
    return { status: "needs_attention" };
  }
  if (result === "deferred_with_card") {
    return { status: "declined" };
  }
  if (result === "cancelled") {
    return { status: "cancelled" };
  }
  if (result === "not_now") {
    renderDaemonStartDeferred({
      presenter: input.presenter,
      codePrefix: input.codePrefix,
    });
    return { status: "declined" };
  }
  if (result === "failed") {
    renderDaemonStartNeedsAttention({
      presenter: input.presenter,
      codePrefix: input.codePrefix,
      summary: "OpenMeld could not finish starting OpenMeld Service.",
    });
    return { status: "needs_attention" };
  }
  return { status: "needs_attention" };
}

function summarizeDaemonServiceParticipationStatus(
  status: DaemonServiceParticipationStatus
): string {
  switch (status.kind) {
    case "missing":
      return formatDaemonInstallFailedMessage("missing");
    case "outdated":
      return formatDaemonInstallFailedMessage("outdated");
    case "needs_repair":
      return status.detail;
    case "not_running":
      return "OpenMeld could not finish starting OpenMeld Service.";
    case "ready":
      return "OpenMeld Service is running.";
    default:
      return "OpenMeld Service still needs attention on this device.";
  }
}

function renderDaemonStartDeferred(input: {
  presenter: Presenter;
  codePrefix: string;
}): void {
  const card = buildDaemonStartDeferredCard();
  renderInfoCard({
    presenter: input.presenter,
    title: card.title,
    codePrefix: `${input.codePrefix}.deferred`,
    rows: card.rows,
  });
}

function renderDaemonStartNeedsAttention(input: {
  presenter: Presenter;
  codePrefix: string;
  summary: string;
  nextStep?: string;
  detail?: string;
  autoRepairAttempted?: boolean;
}): void {
  const card = buildDaemonStartNeedsAttentionCard({
    summary: input.summary,
    ...(input.nextStep ? { nextStep: input.nextStep } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.autoRepairAttempted
      ? { autoRepairAttempted: input.autoRepairAttempted }
      : {}),
  });
  renderInfoCard({
    presenter: input.presenter,
    title: card.title,
    codePrefix: `${input.codePrefix}.failed`,
    rows: card.rows,
  });
}
