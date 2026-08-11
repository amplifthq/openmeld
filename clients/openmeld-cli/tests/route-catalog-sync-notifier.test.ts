import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestLocalSyncRouteCatalogMock, touchDaemonCatalogSyncSignalMock } =
  vi.hoisted(() => ({
    requestLocalSyncRouteCatalogMock: vi.fn(),
    touchDaemonCatalogSyncSignalMock: vi.fn(),
  }));

vi.mock("../src/local-service/control-plane/client", () => ({
  requestLocalSyncRouteCatalog: (...args: unknown[]) =>
    requestLocalSyncRouteCatalogMock(...args),
}));

vi.mock("../src/local-service/state/catalog-sync-signal", () => ({
  touchDaemonCatalogSyncSignal: (...args: unknown[]) =>
    touchDaemonCatalogSyncSignalMock(...args),
}));

import { notifyDaemonRouteCatalogChanged } from "../src/local-service/state/route-catalog-sync-notifier";

describe("route catalog sync notifier", () => {
  beforeEach(() => {
    requestLocalSyncRouteCatalogMock.mockReset();
    touchDaemonCatalogSyncSignalMock.mockReset().mockResolvedValue(undefined);
  });

  it("prefers immediate local control-plane sync when the daemon accepts it", async () => {
    requestLocalSyncRouteCatalogMock.mockResolvedValue({
      accepted: true,
      profileIds: ["agt-1"],
      syncStatus: "changed",
    });

    await expect(
      notifyDaemonRouteCatalogChanged({
        reason: "profile_created",
      })
    ).resolves.toEqual({
      delivery: "control_plane",
      syncStatus: "changed",
    });

    expect(requestLocalSyncRouteCatalogMock).toHaveBeenCalledWith({
      payload: {
        reason: "profile_created",
      },
    });
    expect(touchDaemonCatalogSyncSignalMock).not.toHaveBeenCalled();
  });

  it("treats unchanged catalog re-registration as accepted control-plane delivery", async () => {
    requestLocalSyncRouteCatalogMock.mockResolvedValue({
      accepted: true,
      profileIds: ["agt-1"],
      syncStatus: "registered",
    });

    await expect(
      notifyDaemonRouteCatalogChanged({
        reason: "profile_created",
      })
    ).resolves.toEqual({
      delivery: "control_plane",
      syncStatus: "registered",
    });

    expect(touchDaemonCatalogSyncSignalMock).not.toHaveBeenCalled();
  });

  it("falls back to the signal file when the daemon defers local sync", async () => {
    requestLocalSyncRouteCatalogMock.mockResolvedValue({
      accepted: false,
      note: "daemon_stream_not_connected",
      profileIds: [],
      syncStatus: "deferred",
    });

    await expect(
      notifyDaemonRouteCatalogChanged({
        reason: "profile_created",
      })
    ).resolves.toEqual({
      delivery: "signal",
      fallbackReason: "control_plane_rejected",
    });

    expect(touchDaemonCatalogSyncSignalMock).toHaveBeenCalledWith({
      reason: "profile_created",
    });
  });

  it("keeps a concrete failed sync distinct from a rejected sync", async () => {
    requestLocalSyncRouteCatalogMock.mockResolvedValue({
      accepted: false,
      errorMessage: "route catalog sync failed",
      note: "catalog_sync_failed",
      profileIds: [],
      syncStatus: "failed",
    });

    await expect(
      notifyDaemonRouteCatalogChanged({
        reason: "profile_created",
      })
    ).resolves.toEqual({
      delivery: "signal",
      fallbackReason: "control_plane_failed",
    });

    expect(touchDaemonCatalogSyncSignalMock).toHaveBeenCalledWith({
      reason: "profile_created",
    });
  });

  it("falls back to the signal file when the local control-plane is unavailable", async () => {
    requestLocalSyncRouteCatalogMock.mockRejectedValue(
      new Error("daemon.control.endpoint_missing")
    );

    await expect(
      notifyDaemonRouteCatalogChanged({
        reason: "profile_updated",
      })
    ).resolves.toEqual({
      delivery: "signal",
      fallbackReason: "control_plane_unavailable",
    });

    expect(touchDaemonCatalogSyncSignalMock).toHaveBeenCalledWith({
      reason: "profile_updated",
    });
  });
});
