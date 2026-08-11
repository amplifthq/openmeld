import { buildDaemonRouteObservationPresentation as buildSharedDaemonRouteObservationPresentation } from "@openmeld/start";
import type { DaemonRouteObservation } from "../../system/current-reply-readiness-snapshot";

type DaemonRouteObservationPresentation = {
  detail: string | null;
  statusLabel: "Online" | "Offline" | "Unavailable";
};

export function formatDaemonRouteObservationLabel(
  observation: DaemonRouteObservation,
  input: {
    includeOnlineDetail?: boolean;
  } = {}
): string {
  const presentation = buildDaemonRouteObservationPresentation(observation);
  if (
    presentation.statusLabel === "Online" &&
    input.includeOnlineDetail !== true
  ) {
    return presentation.statusLabel;
  }
  return presentation.detail
    ? `${presentation.statusLabel} — ${presentation.detail}`
    : presentation.statusLabel;
}

export function formatDaemonRouteObservationEmojiLabel(
  observation: DaemonRouteObservation,
  input: {
    includeOnlineDetail?: boolean;
  } = {}
): string {
  const presentation = buildDaemonRouteObservationPresentation(observation);
  let prefix = "⚪";
  if (presentation.statusLabel === "Online") {
    prefix = "🟢";
  } else if (presentation.statusLabel === "Offline") {
    prefix = "🔴";
  }
  const label = formatDaemonRouteObservationLabel(observation, input);
  return `${prefix} ${label}`;
}

function buildDaemonRouteObservationPresentation(
  observation: DaemonRouteObservation
): DaemonRouteObservationPresentation {
  const presentation =
    buildSharedDaemonRouteObservationPresentation(observation);
  return {
    detail: presentation.detail,
    statusLabel: presentation.statusLabel,
  };
}
