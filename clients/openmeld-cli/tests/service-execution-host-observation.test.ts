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
  it("keeps a healthy socket open through catalog refresh, but closes admission if applying it fails", async () => {
    const snapshot = {
      pid: 41_001,
      admission: "open" as const,
      activeCount: 0,
      pendingCount: 0,
      localQuiescent: true,
      unacknowledgedResultCount: 0,
      startupReplayPending: false,
      adapterIds: [],
    };
    const pending = Promise.withResolvers<typeof snapshot>();
    const changed = vi.fn();
    const host = {
      available: () => true,
      call: vi
        .fn()
        .mockResolvedValueOnce(snapshot)
        .mockReturnValueOnce(pending.promise),
      onEvent: () => () => undefined,
      onAvailabilityChanged: () => () => undefined,
    } as unknown as Parameters<typeof createExecutionHostSocketLink>[0]["host"];
    const link = createExecutionHostSocketLink({
      host,
      socket: { send: () => undefined },
      onAdmissionChanged: changed,
      onInvalidation: vi.fn(),
      onAuthenticationFailure: vi.fn(),
      onError: vi.fn(),
    });
    const initial = {
      executionAdmissionConfirmation: true,
      connectionGeneration: 1,
      catalogRevision: 1,
      leases: [],
    };
    await link.configure(initial);
    expect(link.canAccept()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);

    const refresh = link.configure({ ...initial, catalogRevision: 2 });
    await vi.waitFor(() => expect(host.call).toHaveBeenCalledTimes(2));
    expect(link.canAccept()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    pending.resolve(snapshot);
    await refresh;
    expect(link.canAccept()).toBe(true);

    vi.mocked(host.call).mockRejectedValueOnce(new Error("catalog rejected"));
    await expect(
      link.configure({ ...initial, catalogRevision: 3 })
    ).rejects.toThrow("catalog rejected");
    expect(link.canAccept()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("does not let an old catalog response reopen a replacement connection", async () => {
    const snapshot = {
      pid: 41_001,
      admission: "open" as const,
      activeCount: 0,
      pendingCount: 0,
      localQuiescent: true,
      unacknowledgedResultCount: 0,
      startupReplayPending: false,
      adapterIds: [],
    };
    const stale = Promise.withResolvers<typeof snapshot>();
    const replacement = Promise.withResolvers<typeof snapshot>();
    const host = {
      available: () => true,
      call: vi
        .fn()
        .mockResolvedValueOnce(snapshot)
        .mockReturnValueOnce(stale.promise)
        .mockReturnValueOnce(replacement.promise),
      onEvent: () => () => undefined,
      onAvailabilityChanged: () => () => undefined,
    } as unknown as Parameters<typeof createExecutionHostSocketLink>[0]["host"];
    const link = createExecutionHostSocketLink({
      host,
      socket: { send: () => undefined },
      onAdmissionChanged: vi.fn(),
      onInvalidation: vi.fn(),
      onAuthenticationFailure: vi.fn(),
      onError: vi.fn(),
    });
    const first = {
      executionAdmissionConfirmation: true,
      connectionGeneration: 1,
      catalogRevision: 1,
      leases: [],
    };
    await link.configure(first);
    const refresh = link.configure({ ...first, catalogRevision: 2 });
    await vi.waitFor(() => expect(host.call).toHaveBeenCalledTimes(2));
    const rebind = link.configure({
      ...first,
      connectionGeneration: 2,
      catalogRevision: 3,
    });
    expect(link.canAccept()).toBe(false);
    stale.resolve(snapshot);
    await refresh;
    await vi.waitFor(() => expect(host.call).toHaveBeenCalledTimes(3));
    expect(link.canAccept()).toBe(false);
    replacement.resolve(snapshot);
    await rebind;
    expect(link.canAccept()).toBe(true);
  });

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
