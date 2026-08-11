import { describe, expect, it } from "vitest";
import {
  createDaemonRouteObservationSummary,
  daemonRouteObservationSummarySchema,
} from "../../src/index";

describe("daemon route observation summary schema", () => {
  it("accepts canonical online and unavailable summaries", () => {
    expect(
      daemonRouteObservationSummarySchema.safeParse({
        observedAt: "2026-04-14T00:00:00.000Z",
        reasonCode: "online",
        status: "online",
      }).success
    ).toBe(true);

    expect(
      daemonRouteObservationSummarySchema.safeParse({
        observedAt: "2026-04-14T00:00:00.000Z",
        reasonCode: "server_unsupported",
        status: "unavailable",
      }).success
    ).toBe(true);
  });

  it("rejects offline summaries that drift away from route.not_registered", () => {
    const result = daemonRouteObservationSummarySchema.safeParse({
      observedAt: "2026-04-14T00:00:00.000Z",
      reasonCode: "lookup_failed",
      status: "offline",
    });

    expect(result.success).toBe(false);
  });

  it("rejects unavailable summaries that pretend to be online", () => {
    const result = daemonRouteObservationSummarySchema.safeParse({
      observedAt: "2026-04-14T00:00:00.000Z",
      reasonCode: "online",
      status: "unavailable",
    });

    expect(result.success).toBe(false);
  });

  it("builds canonical summaries from status input", () => {
    expect(
      createDaemonRouteObservationSummary({
        observedAt: "2026-04-14T00:00:00.000Z",
        status: "offline",
      })
    ).toEqual({
      observedAt: "2026-04-14T00:00:00.000Z",
      reasonCode: "route.not_registered",
      status: "offline",
    });

    expect(
      createDaemonRouteObservationSummary({
        observedAt: "2026-04-14T00:00:00.000Z",
        reasonCode: "server_unsupported",
        status: "unavailable",
      })
    ).toEqual({
      observedAt: "2026-04-14T00:00:00.000Z",
      reasonCode: "server_unsupported",
      status: "unavailable",
    });
  });

  it("falls back to lookup_failed for invalid unavailable reason codes", () => {
    expect(
      createDaemonRouteObservationSummary({
        observedAt: "2026-04-14T00:00:00.000Z",
        reasonCode: "online",
        status: "unavailable",
      })
    ).toEqual({
      observedAt: "2026-04-14T00:00:00.000Z",
      reasonCode: "lookup_failed",
      status: "unavailable",
    });
  });
});
