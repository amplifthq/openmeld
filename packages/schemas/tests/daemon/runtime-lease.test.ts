import { describe, expect, it } from "vitest";
import {
  daemonRuntimeLeaseModeSchema,
  daemonRuntimeLeaseSchema,
} from "../../src/index";

describe("daemon runtime lease schema", () => {
  it("accepts a valid runtime lease", () => {
    const result = daemonRuntimeLeaseSchema.safeParse({
      schema: "openmeld-daemon-runtime-lease-v1",
      v: 1,
      generation: 1,
      bundleId: "service-bundle-abc",
      pid: 12_345,
      mode: "background",
      startedAt: "2026-03-14T00:00:00.000Z",
      updatedAt: "2026-03-14T00:00:05.000Z",
      heartbeatAt: "2026-03-14T00:00:05.000Z",
      serviceController: "launchd",
      managedBySystemService: true,
    });

    expect(result.success).toBe(true);
  });

  it("rejects extra keys and invalid runtime values", () => {
    const result = daemonRuntimeLeaseSchema.safeParse({
      schema: "openmeld-daemon-runtime-lease-v1",
      v: 1,
      generation: -1,
      bundleId: "service-bundle-abc",
      pid: 0,
      mode: "detached",
      startedAt: "2026-03-14T00:00:00.000Z",
      updatedAt: "2026-03-14T00:00:05.000Z",
      heartbeatAt: "2026-03-14T00:00:05.000Z",
      serviceController: "launchd",
      managedBySystemService: true,
      unexpected: true,
    });

    expect(result.success).toBe(false);
  });

  it("allows foreground mode and null heartbeat for first boot boundary", () => {
    expect(daemonRuntimeLeaseModeSchema.safeParse("foreground").success).toBe(
      true
    );
    expect(daemonRuntimeLeaseModeSchema.safeParse("background").success).toBe(
      true
    );
    expect(daemonRuntimeLeaseModeSchema.safeParse("service").success).toBe(
      false
    );

    const result = daemonRuntimeLeaseSchema.safeParse({
      schema: "openmeld-daemon-runtime-lease-v1",
      v: 1,
      generation: 0,
      bundleId: "service-bundle-abc",
      pid: 12_345,
      mode: "foreground",
      startedAt: "2026-03-14T00:00:00.000Z",
      updatedAt: "2026-03-14T00:00:00.000Z",
      heartbeatAt: null,
      serviceController: "legacy-detached",
      managedBySystemService: false,
    });

    expect(result.success).toBe(true);
  });
});
