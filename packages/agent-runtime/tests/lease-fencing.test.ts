import { describe, expect, it } from "vitest";
import { isLeaseMatch, resolveLeaseArbitration } from "../src/index";

describe("agent-runtime lease fencing", () => {
  it("accepts first session as new lease", () => {
    const decision = resolveLeaseArbitration({
      current: null,
      candidate: {
        daemonSessionId: "session-1",
        deviceId: "device-1",
        lane: "dev-local",
      },
    });

    expect(decision).toEqual({
      accepted: true,
      nextLeaseEpoch: 1,
      reason: "new_session",
    });
  });

  it("accepts same-device reconnect with incremented epoch", () => {
    const decision = resolveLeaseArbitration({
      current: {
        daemonSessionId: "session-1",
        deviceId: "device-1",
        lane: "dev-local",
        leaseEpoch: 2,
      },
      candidate: {
        daemonSessionId: "session-2",
        deviceId: "device-1",
        lane: "dev-local",
      },
    });

    expect(decision).toEqual({
      accepted: true,
      nextLeaseEpoch: 3,
      reason: "same_device_reconnect",
    });
  });

  it("rejects cross-device conflict by default", () => {
    const decision = resolveLeaseArbitration({
      current: {
        daemonSessionId: "session-1",
        deviceId: "device-1",
        lane: "dev-local",
        leaseEpoch: 2,
      },
      candidate: {
        daemonSessionId: "session-2",
        deviceId: "device-2",
        lane: "dev-local",
      },
    });

    expect(decision).toEqual({
      accepted: false,
      reason: "conflict",
    });
  });

  it("rejects same-device different-lane reconnect by default", () => {
    const decision = resolveLeaseArbitration({
      current: {
        daemonSessionId: "session-1",
        deviceId: "device-1",
        lane: "dev-local",
        leaseEpoch: 2,
      },
      candidate: {
        daemonSessionId: "session-2",
        deviceId: "device-1",
        lane: "canary",
      },
    });

    expect(decision).toEqual({
      accepted: false,
      reason: "conflict",
    });
  });

  it("detects lease match and stale lease", () => {
    expect(
      isLeaseMatch({
        expectedDaemonSessionId: "session-1",
        expectedLeaseEpoch: 4,
        actualDaemonSessionId: "session-1",
        actualLeaseEpoch: 4,
      })
    ).toBe(true);

    expect(
      isLeaseMatch({
        expectedDaemonSessionId: "session-1",
        expectedLeaseEpoch: 4,
        actualDaemonSessionId: "session-1",
        actualLeaseEpoch: 3,
      })
    ).toBe(false);
  });
});
