import { toErrorMessage } from "@openmeld/utils";
import { getDaemonStatus } from "../config/daemon-state";
import type { OpenMeldLockMeta } from "../config/lock";
import {
  captureDaemonServiceEvidenceBestEffort,
  type DaemonServiceFailureStage,
  formatDaemonFailureContextText,
} from "../local-service/lifecycle/daemon-service-evidence";
import { getDaemonSystemServiceLogPath } from "../local-service/lifecycle/daemon-service-manager";
import { isVersionDowngrade } from "../local-service/lifecycle/version-change-direction";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
  formatOpenMeldCliCommands,
} from "../runtime/cli-entry-command";
import { emitCliJsonEnvelope } from "../runtime/cli-json-output";
import type { RuntimeContext } from "../runtime/context";
import type { createPresenter, Presenter } from "../runtime/presenter/index";
import {
  formatDaemonDowngradeBlockedNextStep,
  formatDaemonServiceDowngradeBlockedRecommendation,
  getDaemonDowngradeBlockedTitle,
} from "../system/local-service-install-attention";
import { sanitizeSystemServiceErrorMessage } from "./service-error-text";
import { renderServiceActionCard } from "./service-output";
import type {
  DaemonRunFailureReason,
  DaemonRunReason,
} from "./service-run-result";
import type { SystemServiceStartupFailureVerdict } from "./service-start-failure";

export type DaemonServiceMaintenanceAction = "repair" | "update";

export type DaemonReinstallStartBlockedReason = Extract<
  DaemonRunFailureReason,
  | "cleanup_required"
  | "authentication_required"
  | "authentication_environment_mismatch"
  | "service_dependencies_unavailable"
>;

export class DaemonReinstallUnexpectedStartError extends Error {
  override readonly cause: unknown;
  readonly diagnosticDetail: string | null;
  readonly outcome: Extract<DaemonReinstallOutcome, { result: "start_failed" }>;

  constructor(input: {
    cause: unknown;
    desiredState: "background" | "stopped";
    diagnosticDetail: string | null;
    forceUsed: boolean;
  }) {
    super(toErrorMessage(input.cause));
    this.name = "DaemonReinstallUnexpectedStartError";
    this.cause = input.cause;
    this.diagnosticDetail = input.diagnosticDetail;
    this.outcome = createDaemonReinstallStartFailedOutcome({
      backupDataPath: null,
      desiredState: input.desiredState,
      failureStage: "reinstall-install",
      forceUsed: input.forceUsed,
    });
  }
}

export class DaemonReinstallFailureError extends Error {
  override readonly cause: unknown;
  readonly backupDataPath: string | null;
  readonly errorCode: string | null;
  readonly evidencePath: string | null;
  readonly failureStage: DaemonServiceFailureStage | null;

  constructor(input: {
    backupDataPath: string | null;
    cause: unknown;
    errorCode: string | null;
    evidencePath?: string | null;
    failureStage?: DaemonServiceFailureStage | null;
  }) {
    super(toErrorMessage(input.cause));
    this.name = "DaemonReinstallFailureError";
    this.backupDataPath = input.backupDataPath;
    this.cause = input.cause;
    this.errorCode = input.errorCode;
    this.evidencePath = input.evidencePath ?? null;
    this.failureStage = input.failureStage ?? null;
  }
}

export type DaemonReinstallTimeoutPolicy = "abort" | "prompt_force" | "force";

export type DaemonReinstallDrainTimeoutResult = {
  ok: false;
  result: "drain_timeout";
  forceRequired: true;
  waitMs: number;
};

export type DaemonReinstallServiceState = "running" | "stopped";

export type DaemonReinstallCompletedOutcome = {
  ok: true;
  result: "completed";
  backupDataPath: string | null;
  desiredState: "background" | "stopped";
  evidencePath?: string | null;
  forceUsed: boolean;
  serviceState: DaemonReinstallServiceState;
};

export type DaemonReinstallAlreadyHealthyOutcome = {
  ok: true;
  result: "already_healthy";
  desiredState: "background" | "stopped";
  serviceState: DaemonReinstallServiceState;
};

export type DaemonReinstallStoppedSafeOutcome = {
  ok: true;
  result: "stopped_safe";
  desiredState: "background" | "stopped";
  backupDataPath: null;
  evidencePath?: string | null;
  failureStage?: DaemonServiceFailureStage | null;
  forceUsed: boolean;
  reasonCodes: string[];
  serviceState: "stopped";
  errorMessage: string;
};

export type DaemonReinstallOutcome =
  | {
      ok: false;
      result: "cancelled";
    }
  | {
      ok: false;
      result: "in_progress";
      heldBy: string | null;
      retryCommand: string;
      startedAt: string | null;
    }
  | DaemonReinstallDrainTimeoutResult
  | {
      ok: false;
      result: "start_blocked";
      blockReason: DaemonReinstallStartBlockedReason;
      desiredState: "background" | "stopped";
      forceUsed: boolean;
      backupDataPath: string | null;
      startFailureVerdict?: SystemServiceStartupFailureVerdict | null;
    }
  | {
      ok: false;
      result: "start_failed";
      desiredState: "background" | "stopped";
      forceUsed: boolean;
      backupDataPath: string | null;
      failureStage?: DaemonServiceFailureStage | null;
      evidencePath?: string | null;
      startFailureVerdict?: SystemServiceStartupFailureVerdict | null;
    }
  | {
      ok: false;
      result: "downgrade_blocked";
      installedVersion: string;
      requestedVersion: string;
      upgradeCommand: string;
    }
  | DaemonReinstallStoppedSafeOutcome
  | DaemonReinstallAlreadyHealthyOutcome
  | DaemonReinstallCompletedOutcome;

export function formatDaemonReinstallLockHolder(
  lockMeta: OpenMeldLockMeta | null | undefined
): string | null {
  if (!lockMeta) {
    return null;
  }

  const pid = typeof lockMeta.pid === "number" ? lockMeta.pid : null;
  const sessionId =
    typeof lockMeta.sessionId === "string" ? lockMeta.sessionId.trim() : null;

  if (pid !== null && sessionId) {
    return `OpenMeld process pid ${String(pid)} (${sessionId})`;
  }
  if (pid !== null) {
    return `OpenMeld process pid ${String(pid)}`;
  }
  if (sessionId) {
    return `OpenMeld session ${sessionId}`;
  }
  return null;
}

export function formatDaemonReinstallLockStartedAt(
  lockMeta: OpenMeldLockMeta | null | undefined
): string | null {
  if (!lockMeta) {
    return null;
  }
  const startedAt =
    typeof lockMeta.at === "string" ? lockMeta.at.trim() : undefined;
  return startedAt && startedAt.length > 0 ? startedAt : null;
}

export function createDaemonReinstallInProgressOutcome(
  lockMeta?: OpenMeldLockMeta | null,
  action: DaemonServiceMaintenanceAction = "repair"
): Extract<DaemonReinstallOutcome, { result: "in_progress" }> {
  return {
    ok: false,
    result: "in_progress",
    heldBy: formatDaemonReinstallLockHolder(lockMeta),
    retryCommand: formatDaemonServiceMaintenanceCommand(action),
    startedAt: formatDaemonReinstallLockStartedAt(lockMeta),
  };
}

export function createDaemonReinstallDowngradeBlockedOutcome(input: {
  installedVersion: string;
  requestedVersion: string;
}): Extract<DaemonReinstallOutcome, { result: "downgrade_blocked" }> {
  return {
    ok: false,
    result: "downgrade_blocked",
    installedVersion: input.installedVersion,
    requestedVersion: input.requestedVersion,
    upgradeCommand: "openmeld upgrade",
  };
}

export function normalizeDaemonServiceMaintenanceAction(
  action: DaemonServiceMaintenanceAction | undefined
): DaemonServiceMaintenanceAction {
  return action === "update" ? "update" : "repair";
}

export function formatDaemonServiceMaintenanceCommand(
  action: DaemonServiceMaintenanceAction,
  suffix = ""
): string {
  return `openmeld service ${action}${suffix}`;
}

export function formatDaemonServiceMaintenanceActionLabel(
  action: DaemonServiceMaintenanceAction
): "repair" | "update" {
  return action;
}

export function formatDaemonServiceMaintenanceActionTitle(
  action: DaemonServiceMaintenanceAction
): "Repair" | "Update" {
  return action === "update" ? "Update" : "Repair";
}

export function formatDaemonServiceMaintenanceActionPast(
  action: DaemonServiceMaintenanceAction
): "repaired" | "updated" {
  return action === "update" ? "updated" : "repaired";
}

export function formatDaemonServiceMaintenanceActionPastTitle(
  action: DaemonServiceMaintenanceAction
): "Repaired" | "Updated" {
  return action === "update" ? "Updated" : "Repaired";
}

export function formatDaemonServiceMaintenanceActionGerund(
  action: DaemonServiceMaintenanceAction
): "repairing" | "updating" {
  return action === "update" ? "updating" : "repairing";
}

export function createDaemonReinstallCompletedOutcome(input: {
  backupDataPath: string | null;
  desiredState: "background" | "stopped";
  evidencePath?: string | null;
  forceUsed: boolean;
  serviceState: DaemonReinstallServiceState;
}): DaemonReinstallCompletedOutcome {
  return {
    ok: true,
    result: "completed",
    backupDataPath: input.backupDataPath,
    desiredState: input.desiredState,
    ...(input.evidencePath ? { evidencePath: input.evidencePath } : {}),
    forceUsed: input.forceUsed,
    serviceState: input.serviceState,
  };
}

export function createDaemonReinstallAlreadyHealthyOutcome(input: {
  desiredState: "background" | "stopped";
  serviceState: DaemonReinstallServiceState;
}): DaemonReinstallAlreadyHealthyOutcome {
  return {
    ok: true,
    result: "already_healthy",
    desiredState: input.desiredState,
    serviceState: input.serviceState,
  };
}

export function createDaemonReinstallStoppedSafeOutcome(input: {
  desiredState: "background" | "stopped";
  evidencePath?: string | null;
  failureStage?: DaemonServiceFailureStage | null;
  forceUsed: boolean;
  errorMessage: string;
  reasonCodes: string[];
}): DaemonReinstallStoppedSafeOutcome {
  return {
    ok: true,
    result: "stopped_safe",
    desiredState: input.desiredState,
    backupDataPath: null,
    ...(input.evidencePath ? { evidencePath: input.evidencePath } : {}),
    ...(input.failureStage ? { failureStage: input.failureStage } : {}),
    forceUsed: input.forceUsed,
    reasonCodes: input.reasonCodes,
    serviceState: "stopped",
    errorMessage: input.errorMessage,
  };
}

export function createDaemonReinstallStartFailedOutcome(input: {
  backupDataPath: string | null;
  desiredState: "background" | "stopped";
  evidencePath?: string | null;
  failureStage?: DaemonServiceFailureStage | null;
  forceUsed: boolean;
  startFailureVerdict?: SystemServiceStartupFailureVerdict | null;
}): Extract<DaemonReinstallOutcome, { result: "start_failed" }> {
  return {
    ok: false,
    result: "start_failed",
    desiredState: input.desiredState,
    forceUsed: input.forceUsed,
    backupDataPath: input.backupDataPath,
    ...(input.failureStage ? { failureStage: input.failureStage } : {}),
    ...(input.evidencePath ? { evidencePath: input.evidencePath } : {}),
    ...(input.startFailureVerdict
      ? { startFailureVerdict: input.startFailureVerdict }
      : {}),
  };
}

export function createDaemonReinstallStartBlockedOutcome(input: {
  backupDataPath: string | null;
  blockReason: DaemonReinstallStartBlockedReason;
  desiredState: "background" | "stopped";
  forceUsed: boolean;
  startFailureVerdict?: SystemServiceStartupFailureVerdict | null;
}): Extract<DaemonReinstallOutcome, { result: "start_blocked" }> {
  return {
    ok: false,
    result: "start_blocked",
    blockReason: input.blockReason,
    desiredState: input.desiredState,
    forceUsed: input.forceUsed,
    backupDataPath: input.backupDataPath,
    ...(input.startFailureVerdict
      ? { startFailureVerdict: input.startFailureVerdict }
      : {}),
  };
}

export async function attachDaemonReinstallEvidence(input: {
  outcome: DaemonReinstallOutcome;
  runtime: RuntimeContext;
}): Promise<DaemonReinstallOutcome> {
  if (input.outcome.result !== "start_failed" || input.outcome.evidencePath) {
    return input.outcome;
  }
  const evidencePath = await captureDaemonServiceEvidenceBestEffort({
    runtime: input.runtime,
  });
  if (!evidencePath) {
    return input.outcome;
  }
  return {
    ...input.outcome,
    evidencePath,
  };
}

export function buildDaemonReinstallFailureMessage(input: {
  action: DaemonServiceMaintenanceAction;
  backupDataPath: string | null;
  errorCode: string | null;
  errorMessage: string;
  failureStage?: DaemonServiceFailureStage | null;
  evidencePath: string | null;
  includeDiagnosticDetails?: boolean;
  resolvedView: RuntimeContext["resolvedView"];
}): string {
  const actionLabel = formatDaemonServiceMaintenanceActionLabel(input.action);
  const actionCommand = formatDaemonServiceMaintenanceCommand(input.action);
  const controlEndpointMissing =
    input.failureStage === "stop_or_drain" &&
    input.errorCode === "daemon.control.endpoint_missing";
  if (
    input.resolvedView === "human" &&
    input.includeDiagnosticDetails !== true
  ) {
    if (controlEndpointMissing) {
      return formatInlineOpenMeldCliCommands(
        [
          `OpenMeld Service ${actionLabel} could not safely stop the existing Service because its control connection is missing.`,
          "Run `openmeld service status` to check for local Agent work.",
          `If none is running, run \`${actionCommand} --force\`.`,
          "The force option stops the old Service process.",
        ].join(" ")
      );
    }
    if (input.errorMessage.includes("test fixture identity")) {
      return formatInlineOpenMeldCliCommands(
        [
          `OpenMeld Service ${actionLabel} failed because this production lane contains old test setup identity that cannot be reused.`,
          "Rerun the setup command from OpenMeld Web so OpenMeld can write a fresh production service contract.",
          "For diagnostics, run `openmeld service status --view agent`.",
        ].join(" ")
      );
    }
    return formatInlineOpenMeldCliCommands(
      `OpenMeld Service ${actionLabel} failed. Run \`${actionCommand}\`. For diagnostics, run \`openmeld service status --view agent\`.`
    );
  }

  const failureContext = formatDaemonFailureContextText({
    backupDataPath: input.backupDataPath,
    evidencePath: input.evidencePath,
    failureStage: input.failureStage ?? null,
  });
  const diagnosticDetails = [
    `OpenMeld Service ${actionLabel} failed: ${input.errorMessage}.`,
    ...(input.errorCode ? [`Error code: ${input.errorCode}.`] : []),
    ...(controlEndpointMissing
      ? [
          "Recovery: run `openmeld service status --view agent`.",
          `Only if no local Agent work is running, run \`${actionCommand} --force --view agent\`.`,
          "The force option stops the old Service process.",
        ]
      : []),
    ...(failureContext.length > 0 ? [failureContext] : []),
  ];
  return diagnosticDetails.join(" ");
}

export function isDaemonReinstallHealthyAndRunning(
  outcome: DaemonReinstallOutcome
): outcome is (
  | DaemonReinstallCompletedOutcome
  | DaemonReinstallAlreadyHealthyOutcome
) & { serviceState: "running" } {
  return (
    outcome.ok &&
    (outcome.result === "completed" || outcome.result === "already_healthy") &&
    outcome.serviceState === "running"
  );
}

export function isDaemonReinstallCompletedAndStopped(
  outcome: DaemonReinstallOutcome
): outcome is DaemonReinstallCompletedOutcome & { serviceState: "stopped" } {
  return (
    outcome.ok &&
    outcome.result === "completed" &&
    outcome.serviceState === "stopped"
  );
}

export function resolveDaemonReinstallStartBlockedReason(
  reason: DaemonRunReason
): DaemonReinstallStartBlockedReason | null {
  switch (reason) {
    case "cleanup_required":
    case "authentication_required":
    case "authentication_environment_mismatch":
    case "service_dependencies_unavailable":
      return reason;
    default:
      return null;
  }
}

export function buildDaemonReinstallResultTitle(
  outcome: DaemonReinstallOutcome,
  action: DaemonServiceMaintenanceAction
): string {
  const actionTitle = formatDaemonServiceMaintenanceActionTitle(action);
  const actionPastTitle = formatDaemonServiceMaintenanceActionPastTitle(action);
  switch (outcome.result) {
    case "already_healthy":
      return "✅ OpenMeld Service Is Already Healthy";
    case "completed":
      return outcome.serviceState === "running"
        ? `✅ OpenMeld Service ${actionPastTitle}`
        : `⚠️ OpenMeld Service ${actionPastTitle} But Not Running`;
    case "stopped_safe":
      return "✅ OpenMeld Service Safely Stopped";
    case "in_progress":
      return `⏳ OpenMeld Service ${actionTitle} In Progress`;
    case "downgrade_blocked":
      return `⛔ OpenMeld Service ${actionTitle} Blocked`;
    case "drain_timeout":
      return `⏸️ OpenMeld Service ${actionTitle} Paused`;
    case "start_blocked":
      return `⚠️ OpenMeld Service ${actionPastTitle} But Start Is Blocked`;
    case "start_failed":
      return `⚠️ OpenMeld Service ${actionPastTitle} But Not Running`;
    case "cancelled":
      return `OpenMeld Service ${actionTitle} Cancelled`;
    default: {
      const unexpectedOutcome: never = outcome;
      throw new Error(
        `Unexpected daemon reinstall outcome: ${String(unexpectedOutcome)}`
      );
    }
  }
}

export function buildDaemonReinstallWhyText(
  outcome: Exclude<DaemonReinstallOutcome, { result: "cancelled" }>,
  action: DaemonServiceMaintenanceAction
): string {
  const forcedSuffix =
    "forceUsed" in outcome && outcome.forceUsed
      ? " Force continue was used after graceful drain timed out."
      : "";
  const actionPast = formatDaemonServiceMaintenanceActionPast(action);
  const actionGerund = formatDaemonServiceMaintenanceActionGerund(action);
  switch (outcome.result) {
    case "already_healthy":
      return "OpenMeld checked the installed bundle, service registration, runtime contract, and running state. They already match, so nothing was stopped, reinstalled, or restarted.";
    case "completed":
      return outcome.serviceState === "running"
        ? `OpenMeld ${actionPast} OpenMeld Service and restored background service for this lane.${forcedSuffix}`
        : `${buildDaemonReinstallStoppedServiceMessage(action)}${forcedSuffix}`;
    case "stopped_safe":
      return `OpenMeld ${actionPast} OpenMeld Service, but it could not safely restore the previous running state. OpenMeld kept the current version installed and stopped instead of rolling back to older local service state.${forcedSuffix}`;
    case "in_progress":
      return `Another OpenMeld process is already ${actionGerund} OpenMeld Service on this device.`;
    case "downgrade_blocked":
      return "The installed OpenMeld Service version is newer than this CLI version.";
    case "drain_timeout":
      return `Graceful drain did not finish within ${String(outcome.waitMs)}ms, so OpenMeld did not force the existing service to stop.`;
    case "start_blocked":
      return buildDaemonReinstallStartBlockedWhyText(outcome, action);
    case "start_failed":
      return `OpenMeld ${actionPast} OpenMeld Service, but background startup did not reach a healthy running state for this lane.${forcedSuffix}`;
    default: {
      const unexpectedOutcome: never = outcome;
      throw new Error(
        `Unexpected daemon reinstall outcome while building why text: ${String(
          unexpectedOutcome
        )}`
      );
    }
  }
}

export function buildDaemonReinstallCurrentStateText(
  outcome: Exclude<DaemonReinstallOutcome, { result: "cancelled" }>,
  action: DaemonServiceMaintenanceAction
): string {
  const actionGerund = formatDaemonServiceMaintenanceActionGerund(action);
  switch (outcome.result) {
    case "already_healthy":
      return outcome.serviceState === "running"
        ? "OpenMeld Service is running in the background for this lane."
        : "OpenMeld Service is healthy and remains stopped because that is the saved state for this lane.";
    case "completed":
      return outcome.serviceState === "running"
        ? "OpenMeld Service is running in the background for this lane."
        : "OpenMeld Service is installed, but it is not running on this computer.";
    case "stopped_safe":
      return formatInlineOpenMeldCliCommands(
        "OpenMeld Service is installed at the current version and safely stopped for this lane. For diagnostics, run `openmeld service status --view agent`."
      );
    case "in_progress": {
      const details = [outcome.heldBy, outcome.startedAt].filter(Boolean);
      return details.length > 0
        ? details.join(" • ")
        : `Another OpenMeld process is currently ${actionGerund} OpenMeld Service on this device.`;
    }
    case "downgrade_blocked":
      return `Installed OpenMeld Service: v${outcome.installedVersion}. This CLI requested: v${outcome.requestedVersion}.`;
    case "drain_timeout":
      return `The existing OpenMeld Service was left in place, and ${formatDaemonServiceMaintenanceActionLabel(
        action
      )} did not continue.`;
    case "start_blocked":
      return buildDaemonReinstallStartBlockedCurrentStateText(outcome);
    case "start_failed":
      return formatInlineOpenMeldCliCommands(
        "OpenMeld Service is installed, but it is not running for this lane. For diagnostics, run `openmeld service status --view agent`."
      );
    default: {
      const unexpectedOutcome: never = outcome;
      throw new Error(
        `Unexpected daemon reinstall outcome while building current state: ${String(
          unexpectedOutcome
        )}`
      );
    }
  }
}

export function buildDaemonReinstallNextStepText(
  outcome: Exclude<DaemonReinstallOutcome, { result: "cancelled" }>,
  action: DaemonServiceMaintenanceAction
): string {
  switch (outcome.result) {
    case "already_healthy":
      return "No action is required.";
    case "completed":
      return outcome.serviceState === "running"
        ? "No action is required."
        : formatInlineOpenMeldCliCommands(
            `Run \`${formatOpenMeldCliCommand(
              "openmeld service start"
            )}\` to keep OpenMeld Service running in the background. If you need live logs, run \`${formatOpenMeldCliCommand(
              "openmeld service start --mode foreground"
            )}\`.`
          );
    case "stopped_safe":
      return formatInlineOpenMeldCliCommands(
        `Run \`${formatOpenMeldCliCommand(
          "openmeld service start --mode foreground"
        )}\` to inspect startup live, or \`${formatOpenMeldCliCommand(
          "openmeld service start"
        )}\` to retry background startup from the current version.`
      );
    case "in_progress":
      return formatInlineOpenMeldCliCommands(
        `Wait a moment. If OpenMeld Service is still not connected, run \`${formatOpenMeldCliCommand(
          outcome.retryCommand
        )}\` again.`
      );
    case "downgrade_blocked":
      return `${formatDaemonServiceDowngradeBlockedRecommendation({
        installedVersion: outcome.installedVersion,
        expectedVersion: outcome.requestedVersion,
      })} ${formatDaemonDowngradeBlockedNextStep()}`;
    case "drain_timeout":
      return formatInlineOpenMeldCliCommands(
        `Re-run \`${formatOpenMeldCliCommand(
          formatDaemonServiceMaintenanceCommand(action, " --force")
        )}\` to continue.`
      );
    case "start_blocked":
      return buildDaemonReinstallStartBlockedNextStep(outcome, action);
    case "start_failed":
      return buildDaemonReinstallStartFailureNextStep(action);
    default: {
      const unexpectedOutcome: never = outcome;
      throw new Error(
        `Unexpected daemon reinstall outcome while building next step: ${String(
          unexpectedOutcome
        )}`
      );
    }
  }
}

export function buildDaemonReinstallHeadlineText(
  outcome: Exclude<DaemonReinstallOutcome, { result: "cancelled" }>,
  action: DaemonServiceMaintenanceAction
): string {
  const actionPast = formatDaemonServiceMaintenanceActionPast(action);
  const actionLabel = formatDaemonServiceMaintenanceActionLabel(action);
  switch (outcome.result) {
    case "already_healthy":
      return "OpenMeld Service is already healthy. Nothing was changed.";
    case "completed":
      return outcome.serviceState === "running"
        ? `OpenMeld Service was ${actionPast} and is now running.`
        : buildDaemonReinstallStoppedServiceMessage(action);
    case "stopped_safe":
      return `OpenMeld Service was ${actionPast} and left safely stopped on the current version.`;
    case "in_progress":
      return `OpenMeld Service ${actionLabel} is already running.`;
    case "downgrade_blocked":
      return `OpenMeld Service ${actionLabel} is blocked.`;
    case "drain_timeout":
      return `OpenMeld Service ${actionLabel} paused before it could continue.`;
    case "start_blocked":
      return `OpenMeld Service was ${actionPast}, but OpenMeld blocked background startup before it could begin.`;
    case "start_failed":
      return `OpenMeld Service was ${actionPast}, but OpenMeld could not finish starting it.`;
    default: {
      const unexpectedOutcome: never = outcome;
      throw new Error(
        `Unexpected daemon reinstall outcome while building headline text: ${String(
          unexpectedOutcome
        )}`
      );
    }
  }
}

export function buildDaemonReinstallStoppedServiceMessage(
  action: DaemonServiceMaintenanceAction
): string {
  return `Service files were ${formatDaemonServiceMaintenanceActionPast(
    action
  )}, but OpenMeld Service is still stopped. Local Wake work will keep waiting until OpenMeld Service starts.`;
}

export function emitDaemonReinstallResult(input: {
  outcome: DaemonReinstallOutcome;
  presenter: Presenter;
  resolvedView: RuntimeContext["resolvedView"];
  action: DaemonServiceMaintenanceAction;
}): void {
  if (input.resolvedView !== "agent") {
    return;
  }
  input.presenter.data({
    code: "daemon.reinstall.result",
    payload: buildDaemonReinstallAgentPayload({
      action: input.action,
      outcome: input.outcome,
    }),
  });
}

export function buildDaemonReinstallAgentPayload(input: {
  action: DaemonServiceMaintenanceAction;
  outcome: DaemonReinstallOutcome;
}):
  | DaemonReinstallOutcome
  | (DaemonReinstallOutcome & Record<string, unknown>) {
  if (
    input.outcome.ok &&
    input.outcome.result === "completed" &&
    input.outcome.serviceState === "stopped"
  ) {
    return {
      ...input.outcome,
      message: buildDaemonReinstallStoppedServiceMessage(input.action),
      nextSteps: formatOpenMeldCliCommands([
        "openmeld service start --view agent",
      ]),
      operationalState: "not_running",
      requiresStart: true,
    };
  }
  return input.outcome;
}

export function renderDaemonReinstallCard(input: {
  action: DaemonServiceMaintenanceAction;
  outcome: DaemonReinstallOutcome;
  presenter: Presenter;
  resolvedView: RuntimeContext["resolvedView"];
}): void {
  if (input.resolvedView === "agent") {
    return;
  }
  if (input.outcome.result === "cancelled") {
    return;
  }
  renderServiceActionCard({
    presenter: input.presenter,
    codePrefix: `daemon.reinstall.${input.outcome.result}`,
    title: buildDaemonReinstallResultTitle(input.outcome, input.action),
    rows: [
      {
        label: "✅ Result",
        value: buildDaemonReinstallHeadlineText(input.outcome, input.action),
      },
      {
        label: "ℹ️ Why",
        value: buildDaemonReinstallWhyText(input.outcome, input.action),
      },
      {
        label: "🧩 Current State",
        value: buildDaemonReinstallCurrentStateText(
          input.outcome,
          input.action
        ),
      },
      {
        label: "🔧 Next",
        value: buildDaemonReinstallNextStepText(input.outcome, input.action),
      },
    ],
  });
}

export function renderDaemonReinstallOutcome(input: {
  action: DaemonServiceMaintenanceAction;
  outcome: DaemonReinstallOutcome;
  presenter: Presenter;
  resolvedView: RuntimeContext["resolvedView"];
  suppressHumanResultCard?: boolean;
  json?: boolean;
}): void {
  if (input.json === true) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "daemon.reinstall",
      ...buildDaemonReinstallAgentPayload({
        action: input.action,
        outcome: input.outcome,
      }),
    });
    return;
  }
  emitDaemonReinstallResult(input);
  if (input.suppressHumanResultCard === true) {
    return;
  }
  renderDaemonReinstallCard(input);
}

export type DaemonDowngradeBlock = {
  installedVersion: string;
  requestedVersion: string;
};

export async function resolveDaemonDowngradeBlock(input: {
  requestedVersion: string;
  readDaemonStatus?: typeof getDaemonStatus;
}): Promise<DaemonDowngradeBlock | null> {
  const readDaemonStatus = input.readDaemonStatus ?? getDaemonStatus;
  const daemonStatus = await readDaemonStatus();
  if (!daemonStatus.installed) {
    return null;
  }

  if (
    !isVersionDowngrade({
      fromVersion: daemonStatus.state.daemonVersion,
      toVersion: input.requestedVersion,
    })
  ) {
    return null;
  }

  return {
    installedVersion: daemonStatus.state.daemonVersion,
    requestedVersion: input.requestedVersion,
  };
}

export function emitDaemonDowngradeBlocked(input: {
  presenter: ReturnType<typeof createPresenter>;
  installedVersion: string;
  requestedVersion: string;
  codePrefix: "daemon.install.blocked" | "daemon.reinstall.blocked";
}): void {
  renderServiceActionCard({
    presenter: input.presenter,
    codePrefix: input.codePrefix,
    title: getDaemonDowngradeBlockedTitle(),
    rows: [
      {
        label: "🏷️ Installed",
        value: `v${input.installedVersion}`,
      },
      {
        label: "💻 This CLI",
        value: `v${input.requestedVersion}`,
      },
      {
        label: "💡 What to do",
        value: formatDaemonServiceDowngradeBlockedRecommendation({
          installedVersion: input.installedVersion,
          expectedVersion: input.requestedVersion,
        }),
      },
      {
        label: "🔍 Next",
        value: formatDaemonDowngradeBlockedNextStep(),
      },
    ],
  });
}

export function emitDaemonInstallDowngradeBlocked(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: string;
  json: boolean;
  downgradeBlock: { installedVersion: string; requestedVersion: string };
}): void {
  const { downgradeBlock } = input;
  if (input.json) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "daemon.install",
      status: "downgrade_blocked",
      installedVersion: downgradeBlock.installedVersion,
      requestedVersion: downgradeBlock.requestedVersion,
      upgradeCommand: "openmeld upgrade",
    });
    return;
  }
  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: "daemon.install.result",
      payload: {
        status: "downgrade_blocked",
        installedVersion: downgradeBlock.installedVersion,
        requestedVersion: downgradeBlock.requestedVersion,
        upgradeCommand: "openmeld upgrade",
      },
    });
    return;
  }
  emitDaemonDowngradeBlocked({
    presenter: input.presenter,
    installedVersion: downgradeBlock.installedVersion,
    requestedVersion: downgradeBlock.requestedVersion,
    codePrefix: "daemon.install.blocked",
  });
}

export function summarizeDaemonReinstallJournalResult(
  outcome: DaemonReinstallOutcome
): {
  metadata?: Record<string, unknown>;
  result: string;
} {
  return {
    result: outcome.ok ? outcome.result : outcome.result,
    metadata: {
      ok: outcome.ok,
      ...("failureStage" in outcome && outcome.failureStage
        ? { failureStage: outcome.failureStage }
        : {}),
      ...("errorMessage" in outcome
        ? { errorMessage: outcome.errorMessage }
        : {}),
      ...("reasonCodes" in outcome && outcome.reasonCodes.length > 0
        ? { reasonCodes: outcome.reasonCodes }
        : {}),
    },
  };
}

export function buildDaemonReinstallUnexpectedStartSummary(
  error: unknown,
  action: DaemonServiceMaintenanceAction = "repair"
): string {
  const actionLabel = formatDaemonServiceMaintenanceActionLabel(action);
  const detail = sanitizeSystemServiceErrorMessage(toErrorMessage(error));
  if (!detail) {
    return `OpenMeld hit a local start error right after service ${actionLabel}.`;
  }
  return `OpenMeld hit a local start error right after service ${actionLabel}: ${detail}`;
}

export function buildDaemonReinstallUnexpectedStartNextStep(
  action: DaemonServiceMaintenanceAction = "repair"
): string {
  return formatInlineOpenMeldCliCommands(
    `Run \`openmeld service start --mode foreground\` to see the live error. The latest local service log is at \`${getDaemonSystemServiceLogPath()}\`. If it still fails, run \`${formatDaemonServiceMaintenanceCommand(
      action
    )}\` again.`
  );
}

export function buildDaemonReinstallStartBlockedWhyText(
  outcome: Extract<DaemonReinstallOutcome, { result: "start_blocked" }>,
  action: DaemonServiceMaintenanceAction
): string {
  const forcedSuffix = outcome.forceUsed
    ? " Force continue was used after graceful drain timed out."
    : "";
  const actionPast = formatDaemonServiceMaintenanceActionPast(action);
  switch (outcome.blockReason) {
    case "authentication_required":
      return `OpenMeld ${actionPast} OpenMeld Service, but background startup is blocked until this lane signs in to OpenMeld.${forcedSuffix}`;
    case "authentication_environment_mismatch":
      return `OpenMeld ${actionPast} OpenMeld Service, but background startup is blocked because this lane is signed in to a different OpenMeld environment.${forcedSuffix}`;
    case "service_dependencies_unavailable":
      return `OpenMeld ${actionPast} OpenMeld Service, but background startup is blocked because required OpenMeld dependencies are unavailable.${forcedSuffix}`;
    case "cleanup_required":
      return `OpenMeld ${actionPast} OpenMeld Service, but background startup is blocked because OpenMeld still detected conflicting local service state.${forcedSuffix}`;
    default: {
      const unexpectedBlockReason: never = outcome.blockReason;
      throw new Error(
        `Unexpected daemon reinstall start block reason: ${String(unexpectedBlockReason)}`
      );
    }
  }
}

export function buildDaemonReinstallStartBlockedCurrentStateText(
  outcome: Extract<DaemonReinstallOutcome, { result: "start_blocked" }>
): string {
  switch (outcome.blockReason) {
    case "authentication_required":
      return "OpenMeld Service is installed, but it is not running because this lane is not signed in.";
    case "authentication_environment_mismatch":
      return "OpenMeld Service is installed, but it is not running because this lane is signed in to a different OpenMeld environment.";
    case "service_dependencies_unavailable":
      return "OpenMeld Service is installed, but it is not running because required OpenMeld dependencies are unavailable.";
    case "cleanup_required":
      return "OpenMeld Service is installed, but it is not running because OpenMeld still detected conflicting local service state.";
    default: {
      const unexpectedBlockReason: never = outcome.blockReason;
      throw new Error(
        `Unexpected daemon reinstall start block current-state reason: ${String(unexpectedBlockReason)}`
      );
    }
  }
}

export function buildDaemonReinstallStartBlockedNextStep(
  outcome: Extract<DaemonReinstallOutcome, { result: "start_blocked" }>,
  action: DaemonServiceMaintenanceAction
): string {
  switch (outcome.blockReason) {
    case "authentication_required":
      return formatInlineOpenMeldCliCommands(
        `Run \`${formatOpenMeldCliCommand("openmeld login")}\` first, then \`${formatOpenMeldCliCommand("openmeld service start")}\` to start OpenMeld Service in the background.`
      );
    case "authentication_environment_mismatch":
      return formatInlineOpenMeldCliCommands(
        `Run \`${formatOpenMeldCliCommand("openmeld login")}\` for the correct OpenMeld environment, then \`${formatOpenMeldCliCommand("openmeld service start")}\` again.`
      );
    case "service_dependencies_unavailable":
      return formatInlineOpenMeldCliCommands(
        `Start the required OpenMeld dependencies, then run \`${formatOpenMeldCliCommand("openmeld service start")}\` again. If you need live detail, run \`${formatOpenMeldCliCommand("openmeld service start --mode foreground")}\`.`
      );
    case "cleanup_required":
      return formatInlineOpenMeldCliCommands(
        `Run \`${formatOpenMeldCliCommand("openmeld service status")}\` to inspect the current cleanup guidance. If OpenMeld still reports a conflict, run \`${formatOpenMeldCliCommand(formatDaemonServiceMaintenanceCommand(action))}\` again.`
      );
    default: {
      const unexpectedBlockReason: never = outcome.blockReason;
      throw new Error(
        `Unexpected daemon reinstall start block next-step reason: ${String(unexpectedBlockReason)}`
      );
    }
  }
}

export function buildDaemonReinstallStartFailureNextStep(
  action: DaemonServiceMaintenanceAction
): string {
  return buildDaemonReinstallUnexpectedStartNextStep(action);
}

export function createDaemonReinstallDrainTimeoutResult(
  waitMs: number
): DaemonReinstallDrainTimeoutResult {
  return {
    ok: false,
    result: "drain_timeout",
    forceRequired: true,
    waitMs,
  };
}
