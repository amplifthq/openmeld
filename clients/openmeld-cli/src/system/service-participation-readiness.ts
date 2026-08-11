import type { DaemonServiceRuntimeStatus } from "../config/daemon-state";
import type { DaemonServiceInventory } from "../local-service/lifecycle/daemon-service-inventory";
import type { DeviceReplyReadinessStatus } from "./reply-readiness";
import {
  resolveServiceReadiness,
  type ServiceReadinessState,
  type ServiceRuntimeHeadline,
} from "./service-readiness-resolver";

export type ServiceParticipationReadiness =
  | "ready"
  | "needs_repair"
  | "not_running"
  | "not_installed"
  | "unknown";

export type ServiceParticipationReadinessSummary = {
  serviceReadiness: ServiceParticipationReadiness;
  serviceReadinessState: ServiceReadinessState;
  summaryText: string;
  detailText: string;
  nextStepSummary: string | null;
  nextSteps: string[];
  runtimeHeadline: ServiceRuntimeHeadline;
};

export function resolveServiceParticipationReadiness(input: {
  deviceReplyReadiness: DeviceReplyReadinessStatus;
  inventory?: DaemonServiceInventory | null;
  runtimeStatus?: DaemonServiceRuntimeStatus | null;
}): ServiceParticipationReadinessSummary {
  const readiness = resolveServiceReadiness(input);
  return {
    serviceReadiness: toParticipationReadiness(readiness.state),
    serviceReadinessState: readiness.state,
    summaryText: readiness.summaryText,
    detailText: readiness.detailText,
    nextStepSummary: readiness.nextStepSummary,
    nextSteps: readiness.nextSteps,
    runtimeHeadline: readiness.runtimeHeadline,
  };
}

export function formatServiceParticipationReadinessLabel(
  input: ServiceParticipationReadinessSummary
): string {
  if (input.serviceReadinessState === "update_available") {
    return `ℹ️ ${input.summaryText} — ${input.detailText}`;
  }
  switch (input.serviceReadiness) {
    case "ready":
      return `✅ ${input.summaryText} — ${input.detailText}`;
    case "needs_repair":
      return `⚠️ ${input.summaryText} — ${input.detailText}`;
    case "not_running":
    case "not_installed":
      return `⛔ ${input.summaryText} — ${input.detailText}`;
    default:
      return `ℹ️ ${input.summaryText} — ${input.detailText}`;
  }
}

export function formatServiceRuntimeHeadline(
  runtimeHeadline: ServiceRuntimeHeadline
): string {
  switch (runtimeHeadline) {
    case "running":
      return "🟢 Running";
    case "stale":
      return "🟠 Reconnecting";
    case "not running":
      return "🔴 Stopped";
    default:
      return "⚪ Unknown";
  }
}

function toParticipationReadiness(
  state: ReturnType<typeof resolveServiceReadiness>["state"]
): ServiceParticipationReadiness {
  switch (state) {
    case "ready":
    case "update_available":
      return "ready";
    case "not_installed":
      return "not_installed";
    case "not_running":
      return "not_running";
    case "refresh_needed":
    case "refresh_blocked":
    case "local_repair_needed":
      return "needs_repair";
    default:
      return "unknown";
  }
}
