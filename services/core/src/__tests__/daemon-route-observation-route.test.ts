import { daemonRouteObservationResponseSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { toPublicDaemonRouteObservationRoute } from "../routes/daemon";

describe("daemon route observation route", () => {
  it("serializes online routes with an explicit public field allowlist", () => {
    const route = toPublicDaemonRouteObservationRoute({
      online: true,
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      connectionGeneration: 2,
      leaseEpoch: 4,
      lastHeartbeatMs: 1234,
      capabilities: {},
      executionCompatibility: {
        expectedEpoch:
          "daemon-runtime-epoch-2026-05-runtime-coordinator-execution-token",
        observedEpoch:
          "daemon-runtime-epoch-2026-05-runtime-coordinator-execution-token",
        reasonCode: "daemon.runtime_contract.compatible",
        status: "compatible",
      },
      internalOnly: "future-field",
    } as Parameters<typeof toPublicDaemonRouteObservationRoute>[0] & {
      internalOnly: string;
    });

    expect(route).not.toHaveProperty("internalOnly");
    expect(
      daemonRouteObservationResponseSchema.safeParse({
        observedAt: "2026-03-26T00:00:00.000Z",
        profileId: "agt-public-route",
        route,
      }).success
    ).toBe(true);
  });

  it("serializes offline routes with an explicit public field allowlist", () => {
    const internalDeliveryState = ["re", "connecting"].join("");
    const route = toPublicDaemonRouteObservationRoute({
      online: false,
      reasonCode: "daemon.profile.offline",
      lastHeartbeatMs: 1234,
      deliveryState: internalDeliveryState,
      internalOnly: "future-field",
    } as unknown as Parameters<
      typeof toPublicDaemonRouteObservationRoute
    >[0] & {
      deliveryState: string;
      internalOnly: string;
    });

    expect(route).toEqual({
      online: false,
      reasonCode: "daemon.profile.offline",
      lastHeartbeatMs: 1234,
    });
    expect(route).not.toHaveProperty("deliveryState");
    expect(route).not.toHaveProperty("internalOnly");
    expect(
      daemonRouteObservationResponseSchema.safeParse({
        observedAt: "2026-03-26T00:00:00.000Z",
        profileId: "agt-public-route",
        route,
      }).success
    ).toBe(true);
  });
});
