import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForDaemonStartupReconcileSettlement } from "../src/local-service/lifecycle/daemon-startup-reconcile-settle";

describe("local service startup reconcile settle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits briefly and settles silently when another process finishes the update", async () => {
    vi.useFakeTimers();

    const readDaemonStatus = vi
      .fn()
      .mockResolvedValueOnce({
        installed: true,
        state: {
          v: 1,
          schema: "openmeld-daemon-install-v1",
          daemonVersion: "0.1.8",
          installSource: "daemon.command.install",
          installedAt: "2026-03-06T00:00:00.000Z",
          updatedAt: "2026-03-06T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        installed: true,
        state: {
          v: 1,
          schema: "openmeld-daemon-install-v1",
          daemonVersion: "0.1.9",
          installSource: "daemon.command.install",
          installedAt: "2026-03-06T00:00:00.000Z",
          updatedAt: "2026-03-06T00:00:01.000Z",
        },
      });

    const resultPromise = waitForDaemonStartupReconcileSettlement({
      expectedVersion: "0.1.9",
      timeoutMs: 3000,
      pollMs: 150,
      readDaemonStatus,
    });

    await vi.advanceTimersByTimeAsync(150);
    const result = await resultPromise;

    expect(result).toEqual({
      status: "aligned",
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.1.9",
        installSource: "daemon.command.install",
        installedAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:01.000Z",
      },
    });
    expect(readDaemonStatus).toHaveBeenCalledTimes(2);
  });

  it("returns outdated when the update still does not finish after the short wait", async () => {
    vi.useFakeTimers();

    const readDaemonStatus = vi.fn().mockResolvedValue({
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.1.8",
        installSource: "daemon.command.install",
        installedAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
      },
    });

    const resultPromise = waitForDaemonStartupReconcileSettlement({
      expectedVersion: "0.1.9",
      timeoutMs: 300,
      pollMs: 150,
      readDaemonStatus,
    });

    await vi.advanceTimersByTimeAsync(300);
    const result = await resultPromise;

    expect(result).toEqual({
      status: "still_outdated",
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.1.8",
        installSource: "daemon.command.install",
        installedAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
      },
    });
  });

  it("returns downgrade blocked when another process leaves a newer service version behind", async () => {
    vi.useFakeTimers();

    const readDaemonStatus = vi.fn().mockResolvedValue({
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.2.0",
        installSource: "daemon.command.install",
        installedAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
      },
    });

    const result = await waitForDaemonStartupReconcileSettlement({
      expectedVersion: "0.1.9",
      timeoutMs: 3000,
      pollMs: 150,
      readDaemonStatus,
    });

    expect(result).toEqual({
      status: "downgrade_blocked",
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.2.0",
        installSource: "daemon.command.install",
        installedAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
      },
    });
    expect(readDaemonStatus).toHaveBeenCalledTimes(1);
  });
});
