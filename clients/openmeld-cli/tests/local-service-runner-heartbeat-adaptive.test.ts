import { describe, expect, it } from "vitest";
import {
  applyIntervalJitterMs,
  resolveAdaptiveHeartbeatIntervalMs,
  resolveCatalogSyncIntervalMs,
} from "../src/local-service/carrier/service-runner";

describe("local service adaptive heartbeat", () => {
  it("resets heartbeat interval to min when dispatch is active", () => {
    const nextIntervalMs = resolveAdaptiveHeartbeatIntervalMs({
      currentIntervalMs: 60_000,
      hasDispatchActivity: true,
    });

    expect(nextIntervalMs).toBe(5000);
  });

  it("grows heartbeat interval by growth factor and clamps at max", () => {
    const grownIntervalMs = resolveAdaptiveHeartbeatIntervalMs({
      currentIntervalMs: 20_000,
      growthFactor: 1.35,
      hasDispatchActivity: false,
    });
    expect(grownIntervalMs).toBe(27_000);

    const clampedIntervalMs = resolveAdaptiveHeartbeatIntervalMs({
      currentIntervalMs: 58_000,
      growthFactor: 1.35,
      hasDispatchActivity: false,
    });
    expect(clampedIntervalMs).toBe(60_000);
  });

  it("applies jitter with deterministic bounds and clamps", () => {
    const lowJitter = applyIntervalJitterMs({
      baseIntervalMs: 30_000,
      jitterRatio: 0.1,
      maxIntervalMs: 60_000,
      minIntervalMs: 5000,
      randomValue: 0,
    });
    expect(lowJitter).toBe(27_000);

    const highJitter = applyIntervalJitterMs({
      baseIntervalMs: 30_000,
      jitterRatio: 0.1,
      maxIntervalMs: 60_000,
      minIntervalMs: 5000,
      randomValue: 1,
    });
    expect(highJitter).toBe(33_000);
  });

  it("resolves catalog sync cadence from heartbeat interval with clamp", () => {
    const minSyncIntervalMs = resolveCatalogSyncIntervalMs({
      heartbeatIntervalMs: 5000,
    });
    expect(minSyncIntervalMs).toBe(15_000);

    const midSyncIntervalMs = resolveCatalogSyncIntervalMs({
      heartbeatIntervalMs: 25_000,
    });
    expect(midSyncIntervalMs).toBe(45_000);

    const maxSyncIntervalMs = resolveCatalogSyncIntervalMs({
      heartbeatIntervalMs: 60_000,
    });
    expect(maxSyncIntervalMs).toBe(45_000);
  });
});
