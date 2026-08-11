import { afterEach, describe, expect, it, vi } from "vitest";

describe("local service route observation presenter wiring", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doUnmock("@openmeld/start");
  });

  it("uses the generic shared local service route presenter", async () => {
    const buildDaemonRouteObservationPresentationMock = vi.fn(() => ({
      detail: "generic daemon presenter",
      statusLabel: "Unavailable" as const,
    }));

    vi.doMock("@openmeld/start", async () => {
      const actual =
        await vi.importActual<typeof import("@openmeld/start")>(
          "@openmeld/start"
        );
      return {
        ...actual,
        buildDaemonRouteObservationPresentation:
          buildDaemonRouteObservationPresentationMock,
      };
    });

    const { formatDaemonRouteObservationLabel } = await import(
      "../src/local-service/status/daemon-route-observation-presentation"
    );

    const label = formatDaemonRouteObservationLabel({
      detail: "raw lookup detail",
      observedAt: "2026-04-14T13:00:00.000Z",
      profileId: "agt_demo",
      reasonCode: "lookup_failed",
      route: null,
      status: "unavailable",
    });

    expect(label).toBe("Unavailable — generic daemon presenter");
    expect(buildDaemonRouteObservationPresentationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        observedAt: "2026-04-14T13:00:00.000Z",
        reasonCode: "lookup_failed",
        status: "unavailable",
      })
    );
  });
});
