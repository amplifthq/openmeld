import { formatOpenMeldCliCommands } from "../../runtime/cli-entry-command";

export type DaemonServiceRepairGuidance = {
  nextSteps: [string];
  summary: string;
};

export type DaemonServiceRefreshBlockedReason =
  | "foreground_service_active"
  | "lifecycle_action_in_progress";

const DAEMON_SERVICE_SETUP_COMMAND = "openmeld setup";
const DAEMON_SERVICE_REFRESH_SUMMARY = "OpenMeld Service needs repair.";
const DAEMON_SERVICE_REFRESH_RELIABILITY_MESSAGE =
  "Reconnect OpenMeld Service before this computer can receive local Wake work.";
const DAEMON_SERVICE_UPDATE_REQUIRED_RUNNING_MESSAGE =
  "OpenMeld Service is running, but this version is not safe for new Wake work. Update OpenMeld Service.";
const DAEMON_SERVICE_UPDATE_REQUIRED_STOPPED_MESSAGE =
  "OpenMeld Service must be updated before it can start safely.";

export function formatDaemonServiceRefreshSummary(): string {
  return DAEMON_SERVICE_REFRESH_SUMMARY;
}

export function formatDaemonServiceRefreshReliabilityMessage(): string {
  return DAEMON_SERVICE_REFRESH_RELIABILITY_MESSAGE;
}

export function formatDaemonServiceUpdateRequiredMessage(input: {
  serviceIsRunning: boolean;
}): string {
  return input.serviceIsRunning
    ? DAEMON_SERVICE_UPDATE_REQUIRED_RUNNING_MESSAGE
    : DAEMON_SERVICE_UPDATE_REQUIRED_STOPPED_MESSAGE;
}

export function buildDaemonServiceUpdateRequiredNextStep(input: {
  serviceIsRunning: boolean;
}): string {
  const command = formatDaemonServiceUpdateCommand();
  return input.serviceIsRunning
    ? `Update OpenMeld Service with \`${command}\`.`
    : `Update OpenMeld Service with \`${command}\`.`;
}

export function buildDaemonServiceRefreshReadinessDetail(): string {
  return `${DAEMON_SERVICE_REFRESH_SUMMARY} This computer may still be running an older local OpenMeld Service build, so local Wake work may not be received reliably until it is repaired.`;
}

export function buildDaemonServiceRefreshPromptMessage(): string {
  return "Reconnect OpenMeld Service before this computer can receive local Wake work. OpenMeld can reconnect it for you now.";
}

export function buildDaemonServiceRefreshHandoffMessage(): string {
  return `${DAEMON_SERVICE_REFRESH_SUMMARY} Run \`${formatDaemonServiceRefreshCommand()}\` in human view, then return to OpenMeld Web.`;
}

export function buildDaemonServiceRefreshNextStep(): string {
  return `Run \`${formatDaemonServiceRefreshCommand()}\` to repair OpenMeld Service.`;
}

export function buildDaemonServiceRefreshRetryNextStep(): string {
  return `${DAEMON_SERVICE_REFRESH_SUMMARY} Run \`${formatDaemonServiceRefreshCommand()}\`, then retry.`;
}

export function buildDaemonServiceStatusReadOnlyDetail(): string {
  return "Status is read-only. It does not change OpenMeld Service.";
}

export function buildDaemonServiceTaskRetryNextStep(): string {
  return "Try again after the current OpenMeld Service task finishes.";
}

export function buildDaemonServiceRefreshBlockedMessage(input: {
  reason: DaemonServiceRefreshBlockedReason;
}): string {
  return `${DAEMON_SERVICE_REFRESH_RELIABILITY_MESSAGE} ${buildDaemonServiceRefreshBlockedNextStep(input)}`;
}

export function buildDaemonServiceRefreshBlockedNextStep(input: {
  reason: DaemonServiceRefreshBlockedReason;
}): string {
  if (input.reason === "lifecycle_action_in_progress") {
    return buildDaemonServiceTaskRetryNextStep();
  }
  return `${formatDaemonServiceRefreshBlockedAction(input)}.`;
}

function formatDaemonServiceRefreshBlockedAction(input: {
  reason: DaemonServiceRefreshBlockedReason;
}): string {
  const unblock =
    input.reason === "foreground_service_active"
      ? "Stop the foreground service first"
      : "Wait for the current OpenMeld Service task to finish";
  return `${unblock}, then run \`${formatDaemonServiceRefreshCommand()}\``;
}

export function buildDaemonServiceRepairGuidance(): DaemonServiceRepairGuidance {
  return {
    nextSteps: [formatDaemonServiceRefreshCommand()],
    summary: buildDaemonServiceRefreshNextStep(),
  };
}

function formatDaemonServiceRefreshCommand(): string {
  const [reinstallCommand] = formatOpenMeldCliCommands([
    DAEMON_SERVICE_SETUP_COMMAND,
  ]) as [string];
  return reinstallCommand;
}

function formatDaemonServiceUpdateCommand(): string {
  const [updateCommand] = formatOpenMeldCliCommands([
    DAEMON_SERVICE_SETUP_COMMAND,
  ]) as [string];
  return updateCommand;
}
