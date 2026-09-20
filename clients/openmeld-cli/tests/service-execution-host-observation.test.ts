import { describe, expect, it, vi } from "vitest";
import { launchExecutionHost } from "../src/local-service/execution-host/launch";
import { createExecutionHostSocketLink } from "../src/local-service/execution-host/socket-link";

// Boundary test only: the live localhost smoke separately pauses a real Host.
const fixture = vi.hoisted(() => ({
  call: vi.fn(),
  child: { pid: 41_001, once: vi.fn() },
}));
vi.mock("node:child_process", () => ({ spawn: () => fixture.child }));
vi.mock("../src/runtime/distribution", () => ({
  isBinaryDistribution: () => true,
}));
vi.mock("../src/local-service/execution-host/process-channel", () => ({
  childExecutionHostChannel: () => ({}),
}));
vi.mock(
  "../src/local-service/execution-host/channel",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/local-service/execution-host/channel")
    >()),
    createExecutionHostClient: () => ({ call: fixture.call, dispose: vi.fn() }),
  })
);

describe("Host responsiveness observations", () => {
  it("withdraws responsiveness after a heartbeat timeout without losing historical work or restarting it", async () => {
    const snapshot = {
      pid: fixture.child.pid,
      admission: "open",
      activeCount: 1,
      pendingCount: 1,
      localQuiescent: false,
      unacknowledgedResultCount: 1,
      startupReplayPending: false,
      adapterIds: [],
    };
    fixture.call.mockResolvedValueOnce(snapshot);
    const failure = vi.fn();
    const host = launchExecutionHost({
      identity: {
        ownerUserId: "test-owner",
        deviceId: "test-device",
        lane: "dev-local",
        daemonSessionId: "test-session",
        serviceContractGeneration: 1,
        sessionIdentity: "test-identity",
        stateRoot: "/unused-boundary-fixture",
        authBaseUrl: "http://localhost:1",
        gatewayBaseUrl: "http://localhost:1",
        parentPid: 41_000,
        parentProcessStartedAt: "test-start",
      },
      onFailure: failure,
    });
    await host.initialized;
    const link = createExecutionHostSocketLink({
      host,
      socket: { send: () => undefined },
      onAdmissionChanged: vi.fn(),
      onInvalidation: vi.fn(),
      onAuthenticationFailure: vi.fn(),
      onError: vi.fn(),
    });
    fixture.call.mockResolvedValueOnce(snapshot);
    await link.configure({
      executionAdmissionConfirmation: true,
      connectionGeneration: 1,
      catalogRevision: 1,
      leases: [],
    });
    expect(link.canAccept()).toBe(true);
    const previous = host.observation?.();
    expect(previous?.responsive).toBe(true);
    fixture.call.mockRejectedValueOnce(
      new Error("heartbeat observation timeout")
    );
    await expect(
      host.call("heartbeat", { connectionGeneration: 1, staleProfileIds: [] })
    ).rejects.toThrow("heartbeat observation timeout");
    expect(host.available()).toBe(false);
    expect(link.canAccept()).toBe(false);
    expect(link.snapshot()).toBeNull();
    expect(host.observation?.()).toEqual({ ...previous, responsive: false });
    expect(failure).not.toHaveBeenCalled();
    expect(fixture.call.mock.calls.map(([method]) => method)).toEqual([
      "initialize",
      "configureConnection",
      "heartbeat",
    ]);
    fixture.call.mockResolvedValueOnce(snapshot);
    await host.call("health", {});
    expect(host.available()).toBe(true);
    // A fresh process observation alone cannot reopen the socket's admission;
    // the socket owner must also obtain a current execution snapshot.
    expect(link.canAccept()).toBe(false);
    fixture.call.mockResolvedValueOnce(snapshot);
    await link.observe();
    expect(link.canAccept()).toBe(true);
    expect(host.observation?.()).toMatchObject({
      hostInstanceId: previous?.hostInstanceId,
      responsive: true,
      activeCount: 1,
      pendingCount: 1,
      unacknowledgedResultCount: 1,
    });
    fixture.call.mockResolvedValueOnce({});
    await link.detach();
  });
});
