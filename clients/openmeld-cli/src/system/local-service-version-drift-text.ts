import {
  formatDaemonServiceDowngradeBlockedRecommendation,
  formatDaemonServiceOutdatedRecommendation,
  formatDaemonServiceOutdatedStatus,
} from "./local-service-install-attention";

type DaemonVersionDriftTextInput = {
  installedVersion: string;
  expectedVersion: string;
};

export function formatDaemonVersionMismatchRecommendation(
  input: DaemonVersionDriftTextInput
): string {
  return formatDaemonServiceOutdatedRecommendation(input);
}

export function formatDaemonVersionMismatchStatus(
  input: DaemonVersionDriftTextInput
): string {
  return formatDaemonServiceOutdatedStatus(input);
}

export function formatDaemonDowngradeBlockedRecommendation(
  input: DaemonVersionDriftTextInput
): string {
  return formatDaemonServiceDowngradeBlockedRecommendation(input);
}
