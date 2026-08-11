import { describe, expect, it } from "vitest";
import {
  daemonServiceContractSchema,
  daemonServiceControllerSchema,
  daemonServiceDesiredStateSchema,
  daemonServiceLaneSchema,
} from "../../src/index";

describe("daemon service contract schema", () => {
  it("accepts a valid service contract", () => {
    const result = daemonServiceContractSchema.safeParse({
      schema: "openmeld-daemon-service-contract-v1",
      v: 1,
      lane: "dev-local",
      daemonVersion: "0.2.6",
      bundleId: "service-bundle-abc",
      desiredState: "background",
      serviceController: "launchd",
      autoStart: true,
      gatewayUrl: "http://localhost:8080",
      ownerUserId: "user_felix",
      profileId: "hum_felix",
      deviceId: "device_123",
      heartbeatMs: 5000,
      generation: 1,
      updatedAt: "2026-03-14T00:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("rejects extra keys and invalid desired state", () => {
    const result = daemonServiceContractSchema.safeParse({
      schema: "openmeld-daemon-service-contract-v1",
      v: 1,
      lane: "dev-local",
      daemonVersion: "0.2.6",
      bundleId: "service-bundle-abc",
      desiredState: "foreground",
      serviceController: "launchd",
      autoStart: true,
      gatewayUrl: "http://localhost:8080",
      profileId: "hum_felix",
      deviceId: "device_123",
      heartbeatMs: 5000,
      generation: 1,
      updatedAt: "2026-03-14T00:00:00.000Z",
      unexpected: true,
    });

    expect(result.success).toBe(false);
  });

  it("enforces controller, lane, and generation boundaries", () => {
    expect(daemonServiceControllerSchema.safeParse("launchd").success).toBe(
      true
    );
    expect(daemonServiceControllerSchema.safeParse("pm2").success).toBe(false);
    expect(daemonServiceLaneSchema.safeParse("canary").success).toBe(true);
    expect(daemonServiceLaneSchema.safeParse("openmeld-dev").success).toBe(
      false
    );
    expect(daemonServiceDesiredStateSchema.safeParse("stopped").success).toBe(
      true
    );

    const result = daemonServiceContractSchema.safeParse({
      schema: "openmeld-daemon-service-contract-v1",
      v: 1,
      lane: "prod",
      daemonVersion: "0.2.6",
      bundleId: "service-bundle-abc",
      desiredState: "stopped",
      serviceController: "legacy-detached",
      autoStart: false,
      gatewayUrl: "https://gateway.openmeld.invalid",
      profileId: "hum_felix",
      deviceId: "device_123",
      heartbeatMs: 0,
      generation: 0,
      updatedAt: "2026-03-14T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});
