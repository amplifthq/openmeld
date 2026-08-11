import type { DaemonRouteObservationSummary } from "@openmeld/schemas/types";

export type DaemonRouteObservationPresentation = {
  detail: string | null;
  statusLabel: "Online" | "Offline" | "Unavailable";
};

export function buildDaemonRouteObservationPresentation(
  observation: DaemonRouteObservationSummary
): DaemonRouteObservationPresentation {
  if (observation.status === "online") {
    return {
      detail: "OpenMeld server can see an active reply route for this profile.",
      statusLabel: "Online",
    };
  }

  if (observation.status === "offline") {
    return {
      detail:
        "OpenMeld server can't currently see an active reply route for this profile.",
      statusLabel: "Offline",
    };
  }

  switch (observation.reasonCode) {
    case "server_unsupported":
      return {
        detail: "This OpenMeld server can't report route status yet.",
        statusLabel: "Unavailable",
      };
    case "profile_not_agent":
      return {
        detail: "Only agent profiles have a reply route.",
        statusLabel: "Unavailable",
      };
    case "profile_not_selected":
      return {
        detail: "Choose an Agent Profile to check reply route status.",
        statusLabel: "Unavailable",
      };
    case "not_requested":
      return {
        detail: "OpenMeld did not ask for reply route status.",
        statusLabel: "Unavailable",
      };
    default:
      return {
        detail: "OpenMeld couldn't confirm reply route status yet.",
        statusLabel: "Unavailable",
      };
  }
}
