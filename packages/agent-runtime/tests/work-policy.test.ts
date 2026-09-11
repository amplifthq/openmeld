import { describe, expect, it } from "vitest";
import {
  AGENT_PROFILE_WORK_CONCURRENCY_LIMIT,
  AGENT_PROFILE_WORK_MAX_WAITING,
  DEFAULT_AGENT_PROFILE_WORK_CAPACITY_POLICY,
  isAgentProfileWorkCapacityPolicy,
} from "../src/work-policy";

describe("work-policy", () => {
  it("publishes the shared Agent Profile work bounds", () => {
    expect(AGENT_PROFILE_WORK_CONCURRENCY_LIMIT).toBe(3);
    expect(AGENT_PROFILE_WORK_MAX_WAITING).toBe(50);
  });

  it("exposes a frozen default capacity policy built from the constants", () => {
    expect(DEFAULT_AGENT_PROFILE_WORK_CAPACITY_POLICY).toEqual({
      concurrencyLimit: 3,
      maxWaiting: 50,
    });
    expect(Object.isFrozen(DEFAULT_AGENT_PROFILE_WORK_CAPACITY_POLICY)).toBe(
      true
    );
    expect(
      isAgentProfileWorkCapacityPolicy(
        DEFAULT_AGENT_PROFILE_WORK_CAPACITY_POLICY
      )
    ).toBe(true);
  });

  it("rejects malformed capacity policy objects", () => {
    expect(isAgentProfileWorkCapacityPolicy(null)).toBe(false);
    expect(
      isAgentProfileWorkCapacityPolicy({ concurrencyLimit: 0, maxWaiting: 50 })
    ).toBe(false);
    expect(
      isAgentProfileWorkCapacityPolicy({ concurrencyLimit: 3, maxWaiting: -1 })
    ).toBe(false);
    expect(
      isAgentProfileWorkCapacityPolicy({
        concurrencyLimit: 1.5,
        maxWaiting: 50,
      })
    ).toBe(false);
  });
});
