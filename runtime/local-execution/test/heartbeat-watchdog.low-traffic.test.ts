import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_POLICY_DEFAULTS,
  heartbeatSentCountPerMinute,
  isHealthReasonCodeConsistent,
  mapRuntimeHealthToExternalHealth,
  resolveHealthReasonCode,
  suspectTransitionRatePerMinute,
} from "../src/heartbeat-policy";

describe("heartbeat/watchdog low-traffic guardrails", () => {
  it("keeps idle heartbeat at or below 1 per minute by default", () => {
    const perMinute = heartbeatSentCountPerMinute(
      HEARTBEAT_POLICY_DEFAULTS.heartbeatIdleIntervalMs
    );
    expect(perMinute).toBeLessThanOrEqual(1);
  });

  it("maps runtime health to external health contract", () => {
    expect(mapRuntimeHealthToExternalHealth("healthy")).toBe("ok");
    expect(mapRuntimeHealthToExternalHealth("idle")).toBe("ok");
    expect(mapRuntimeHealthToExternalHealth("suspect")).toBe("degraded");
    expect(mapRuntimeHealthToExternalHealth("down")).toBe("down");
  });

  it("keeps reasonCode consistent with runtime/external state mapping", () => {
    const runtimeState = "suspect";
    const externalState = mapRuntimeHealthToExternalHealth(runtimeState);
    const reasonCode = resolveHealthReasonCode(runtimeState);
    expect(
      isHealthReasonCodeConsistent({
        runtimeState,
        externalState,
        reasonCode,
      })
    ).toBe(true);

    expect(
      isHealthReasonCodeConsistent({
        runtimeState,
        externalState,
        reasonCode: "health.ok",
      })
    ).toBe(false);
  });

  it("keeps suspect transition rate under low-traffic threshold", () => {
    const rate = suspectTransitionRatePerMinute(1, 900);
    expect(rate).toBeLessThanOrEqual(0.1);
  });
});
