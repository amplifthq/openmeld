import { describe, expect, it } from "vitest";
import { buildDaemonRouteObservationPresentation } from "../src";

describe("daemon route observation presentation", () => {
  it("formats offline reply route as Offline with a stable explanation", () => {
    const presentation = buildDaemonRouteObservationPresentation({
      status: "offline",
      reasonCode: "route.not_registered",
      observedAt: "2026-04-07T10:10:00.000Z",
    });

    expect(presentation).toEqual({
      detail:
        "OpenMeld server can't currently see an active reply route for this profile.",
      statusLabel: "Offline",
    });
  });

  it("explains server_unsupported as an unavailable reply route", () => {
    expect(
      buildDaemonRouteObservationPresentation({
        status: "unavailable",
        reasonCode: "server_unsupported",
        observedAt: "2026-04-07T10:10:00.000Z",
      })
    ).toEqual({
      detail: "This OpenMeld server can't report route status yet.",
      statusLabel: "Unavailable",
    });
  });

  it("uses Agent Profile copy when route status has no selected profile", () => {
    expect(
      buildDaemonRouteObservationPresentation({
        status: "unavailable",
        reasonCode: "profile_not_selected",
        observedAt: "2026-04-07T10:10:00.000Z",
      })
    ).toEqual({
      detail: "Choose an Agent Profile to check reply route status.",
      statusLabel: "Unavailable",
    });
  });
});
