import { buildDaemonRouteObservationPresentation } from "@openmeld/start";
import { describe, expect, it } from "vitest";
import {
  formatDaemonRouteObservationEmojiLabel,
  formatDaemonRouteObservationLabel,
} from "../src/local-service/status/daemon-route-observation-presentation";

describe("local service route observation presentation", () => {
  it("uses the shared offline copy instead of leaking backend route detail", () => {
    const observation = {
      detail:
        "Server can't currently see an active reply route for this agent profile (server reported daemon.profile.offline).",
      observedAt: "2026-04-14T12:00:00.000Z",
      profileId: "agt-demo",
      reasonCode: "route.not_registered" as const,
      route: {
        online: false as const,
        reasonCode: "daemon.profile.offline" as const,
      },
      status: "offline" as const,
    };

    const shared = buildDaemonRouteObservationPresentation({
      observedAt: observation.observedAt,
      reasonCode: observation.reasonCode,
      status: observation.status,
    });

    expect(formatDaemonRouteObservationLabel(observation)).toBe(
      `${shared.statusLabel} — ${shared.detail}`
    );
    expect(formatDaemonRouteObservationLabel(observation)).not.toContain(
      "daemon.profile.offline"
    );
    expect(formatDaemonRouteObservationEmojiLabel(observation)).toBe(
      `🔴 ${shared.statusLabel} — ${shared.detail}`
    );
  });

  it("explains server_unsupported as a server capability gap", () => {
    const observation = {
      detail:
        "Server route observation is not supported by this OpenMeld server yet.",
      observedAt: "2026-04-14T12:00:00.000Z",
      profileId: "agt-demo",
      reasonCode: "server_unsupported" as const,
      route: null,
      status: "unavailable" as const,
    };

    expect(formatDaemonRouteObservationLabel(observation)).toBe(
      "Unavailable — This OpenMeld server can't report route status yet."
    );
    expect(formatDaemonRouteObservationEmojiLabel(observation)).toBe(
      "⚪ Unavailable — This OpenMeld server can't report route status yet."
    );
  });
});
