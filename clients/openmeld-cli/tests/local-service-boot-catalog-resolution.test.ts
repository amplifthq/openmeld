import { describe, expect, it, vi } from "vitest";
import { resolveBootstrapCatalogSyncPlan } from "../src/local-service/carrier/run-socket-session";
import {
  createMutableRouteCatalogState,
  createRouteCatalogSyncLoader,
  syncDaemonRouteCatalogState,
} from "../src/local-service/carrier/service-runner";
import type { RouteCatalog } from "../src/local-service/core/types";

const createRouteCatalog = (profileIds: string[]): RouteCatalog => ({
  profileIds: [...profileIds],
  routeByProfileId: new Map(
    profileIds.map((profileId) => [
      profileId,
      {
        agentControllerRef: "builtin:codex",
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        profileId,
        streamingMode: "final" as const,
        transportMode: "local-cli" as const,
      },
    ])
  ),
  skippedProfiles: [],
});

describe("route catalog sync loader", () => {
  it("uses the initial loader once and flips to fresh loads after success", async () => {
    const loadInitial = vi.fn(async () => createRouteCatalog(["agt-a"]));
    const loadFresh = vi.fn(async () => createRouteCatalog(["agt-a", "agt-b"]));
    const loader = createRouteCatalogSyncLoader({ loadFresh, loadInitial });

    expect(loader.isResolved()).toBe(false);

    const first = await loader.load();
    expect(first.profileIds).toEqual(["agt-a"]);
    expect(loader.isResolved()).toBe(true);
    expect(loadInitial).toHaveBeenCalledTimes(1);
    expect(loadFresh).not.toHaveBeenCalled();

    const second = await loader.load();
    expect(second.profileIds).toEqual(["agt-a", "agt-b"]);
    expect(loadInitial).toHaveBeenCalledTimes(1);
    expect(loadFresh).toHaveBeenCalledTimes(1);
  });

  it("stays unresolved when the initial load throws and retries the initial loader", async () => {
    const loadInitial = vi
      .fn<() => Promise<RouteCatalog>>()
      .mockRejectedValueOnce(new Error("gateway unreachable"))
      .mockResolvedValueOnce(createRouteCatalog(["agt-a"]));
    const loadFresh = vi.fn(async () => createRouteCatalog([]));
    const loader = createRouteCatalogSyncLoader({ loadFresh, loadInitial });

    await expect(loader.load()).rejects.toThrow("gateway unreachable");
    expect(loader.isResolved()).toBe(false);

    await loader.load();
    expect(loader.isResolved()).toBe(true);
    expect(loadInitial).toHaveBeenCalledTimes(2);
    expect(loadFresh).not.toHaveBeenCalled();
  });
});

describe("bootstrap catalog sync plan", () => {
  it("persists the cache and waits a normal interval for a resolved catalog", () => {
    expect(
      resolveBootstrapCatalogSyncPlan({
        isRouteCatalogResolved: true,
        syncIntervalMs: 45_000,
      })
    ).toEqual({
      nextSyncDelayMs: 45_000,
      persistCache: true,
    });
  });

  it("never persists the unresolved placeholder and resolves immediately", () => {
    expect(
      resolveBootstrapCatalogSyncPlan({
        isRouteCatalogResolved: false,
        syncIntervalMs: 45_000,
      })
    ).toEqual({
      nextSyncDelayMs: 0,
      persistCache: false,
    });
  });
});

describe("register shrink invariant", () => {
  it("never registers when the catalog load fails, keeping the current set", async () => {
    const catalogState = createMutableRouteCatalogState(
      createRouteCatalog(["agt-a"])
    );
    const leasesByProfileId = new Map<string, number>([["agt-a", 1]]);
    const registerCatalog = vi.fn();

    const result = await syncDaemonRouteCatalogState({
      catalogState,
      leasesByProfileId,
      loadCatalog: () => Promise.reject(new Error("binding reads unavailable")),
      registerCatalog,
    });

    expect(result.status).toBe("failed");
    expect(registerCatalog).not.toHaveBeenCalled();
    expect(catalogState.profileIds).toEqual(["agt-a"]);
    expect(leasesByProfileId.get("agt-a")).toBe(1);
  });
});
