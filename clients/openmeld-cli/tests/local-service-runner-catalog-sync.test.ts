import { describe, expect, it, vi } from "vitest";
import {
  createMutableRouteCatalogState,
  syncDaemonRouteCatalogState,
} from "../src/local-service/carrier/service-runner";

const createRouteCatalog = (profileIds: string[]) => {
  const routeByProfileId = new Map(
    profileIds.map((profileId) => [
      profileId,
      {
        contextIdMappingSpec: {
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
          mappingVersion: 1,
        },
        agentControllerRef: "builtin:codex",
        profileId,
        streamingMode: "final" as const,
        transportMode: "local-cli" as const,
      },
    ])
  );

  return {
    profileIds: [...profileIds],
    routeByProfileId,
    skippedProfiles: [],
  };
};

describe("local service route catalog sync", () => {
  it("keeps running with empty catalog and treats it as unchanged", async () => {
    const initialCatalog = createRouteCatalog([]);
    const catalogState = createMutableRouteCatalogState(initialCatalog);
    const leasesByProfileId = new Map<string, number>();
    const registerCatalog = vi.fn(async () => ({
      ok: true,
      connectionGeneration: 1,
      acceptedLeases: [],
      rejectedProfiles: [],
    }));

    const result = await syncDaemonRouteCatalogState({
      catalogState,
      leasesByProfileId,
      loadCatalog: async () => createRouteCatalog([]),
      registerCatalog,
    });

    expect(result).toEqual({
      skippedProfiles: [],
      status: "unchanged",
    });
    expect(registerCatalog).not.toHaveBeenCalled();
    expect(catalogState.profileIds).toEqual([]);
    expect(leasesByProfileId.size).toBe(0);
  });

  it("registers added profiles and updates in-memory route state", async () => {
    const catalogState = createMutableRouteCatalogState(createRouteCatalog([]));
    const leasesByProfileId = new Map<string, number>();
    const registerCatalog = vi.fn(async () => ({
      ok: true,
      connectionGeneration: 1,
      acceptedLeases: [
        {
          profileId: "agt-a",
          leaseEpoch: 1,
        },
      ],
      rejectedProfiles: [],
    }));

    const result = await syncDaemonRouteCatalogState({
      catalogState,
      leasesByProfileId,
      loadCatalog: async () => createRouteCatalog(["agt-a"]),
      registerCatalog,
    });

    expect(result.status).toBe("changed");
    if (result.status === "changed") {
      expect(result.diff.addedProfileIds).toEqual(["agt-a"]);
      expect(result.diff.removedProfileIds).toEqual([]);
      expect(result.diff.keptProfileIds).toEqual([]);
    }
    expect(registerCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ profileIds: ["agt-a"] })
    );
    expect(catalogState.profileIds).toEqual(["agt-a"]);
    expect(catalogState.routeByProfileId.has("agt-a")).toBe(true);
    expect(leasesByProfileId.get("agt-a")).toBe(1);
  });

  it("re-registers an unchanged catalog when the active route lease must be refreshed", async () => {
    const catalogState = createMutableRouteCatalogState(
      createRouteCatalog(["agt-a"])
    );
    const leasesByProfileId = new Map<string, number>([["agt-a", 1]]);
    const registerCatalog = vi.fn(async () => ({
      ok: true,
      connectionGeneration: 1,
      acceptedLeases: [
        {
          profileId: "agt-a",
          leaseEpoch: 2,
        },
      ],
      rejectedProfiles: [],
    }));

    const result = await syncDaemonRouteCatalogState({
      catalogState,
      forceRegister: true,
      leasesByProfileId,
      loadCatalog: async () => createRouteCatalog(["agt-a"]),
      registerCatalog,
    });

    expect(result.status).toBe("registered");
    if (result.status === "registered") {
      expect(result.registerResponse.acceptedLeases).toEqual([
        {
          profileId: "agt-a",
          leaseEpoch: 2,
        },
      ]);
    }
    expect(registerCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ profileIds: ["agt-a"] })
    );
    expect(catalogState.profileIds).toEqual(["agt-a"]);
    expect(catalogState.routeByProfileId.has("agt-a")).toBe(true);
    expect(leasesByProfileId.get("agt-a")).toBe(2);
  });

  it("re-registers an unchanged catalog when the local lease was lost", async () => {
    const catalogState = createMutableRouteCatalogState(
      createRouteCatalog(["agt-a"])
    );
    const leasesByProfileId = new Map<string, number>();
    const registerCatalog = vi.fn(async () => ({
      ok: true,
      connectionGeneration: 1,
      acceptedLeases: [
        {
          profileId: "agt-a",
          leaseEpoch: 3,
        },
      ],
      rejectedProfiles: [],
    }));

    const result = await syncDaemonRouteCatalogState({
      catalogState,
      leasesByProfileId,
      loadCatalog: async () => createRouteCatalog(["agt-a"]),
      registerCatalog,
    });

    expect(result.status).toBe("registered");
    expect(registerCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ profileIds: ["agt-a"] })
    );
    expect(catalogState.profileIds).toEqual(["agt-a"]);
    expect(leasesByProfileId.get("agt-a")).toBe(3);
  });

  it("registers removed profiles diff and prunes leases to accepted set", async () => {
    const catalogState = createMutableRouteCatalogState(
      createRouteCatalog(["agt-a", "agt-b"])
    );
    const leasesByProfileId = new Map<string, number>([
      ["agt-a", 1],
      ["agt-b", 1],
    ]);

    const registerCatalog = vi.fn(async () => ({
      ok: true,
      connectionGeneration: 1,
      acceptedLeases: [
        {
          profileId: "agt-b",
          leaseEpoch: 1,
        },
      ],
      rejectedProfiles: [],
    }));

    const result = await syncDaemonRouteCatalogState({
      catalogState,
      leasesByProfileId,
      loadCatalog: async () => createRouteCatalog(["agt-b"]),
      registerCatalog,
    });

    expect(result.status).toBe("changed");
    if (result.status === "changed") {
      expect(result.diff.addedProfileIds).toEqual([]);
      expect(result.diff.removedProfileIds).toEqual(["agt-a"]);
      expect(result.diff.keptProfileIds).toEqual(["agt-b"]);
    }
    expect(catalogState.profileIds).toEqual(["agt-b"]);
    expect(catalogState.routeByProfileId.has("agt-a")).toBe(false);
    expect(catalogState.routeByProfileId.has("agt-b")).toBe(true);
    expect(leasesByProfileId.has("agt-a")).toBe(false);
    expect(leasesByProfileId.get("agt-b")).toBe(1);
  });

  it("keeps old state when catalog reload fails", async () => {
    const catalogState = createMutableRouteCatalogState(
      createRouteCatalog(["agt-a"])
    );
    const leasesByProfileId = new Map<string, number>([["agt-a", 2]]);
    const registerCatalog = vi.fn(async () => ({
      ok: true,
      connectionGeneration: 1,
      acceptedLeases: [],
      rejectedProfiles: [],
    }));

    const result = await syncDaemonRouteCatalogState({
      catalogState,
      leasesByProfileId,
      loadCatalog: () => Promise.reject(new Error("boom")),
      registerCatalog,
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toBe("load_failed");
      expect(result.errorMessage).toContain("boom");
    }
    expect(registerCatalog).not.toHaveBeenCalled();
    expect(catalogState.profileIds).toEqual(["agt-a"]);
    expect(leasesByProfileId.get("agt-a")).toBe(2);
  });

  it("keeps skipped profile diagnostics in route state", async () => {
    const catalogState = createMutableRouteCatalogState(createRouteCatalog([]));
    const leasesByProfileId = new Map<string, number>();
    const registerCatalog = vi.fn(async () => ({
      ok: true,
      connectionGeneration: 1,
      acceptedLeases: [],
      rejectedProfiles: [],
    }));

    const nextCatalog = {
      ...createRouteCatalog([]),
      skippedProfiles: [
        {
          profileId: "agt-skipped",
          profileName: "Skipped Agent",
          skipReason: "projection.missing" as const,
        },
      ],
    };

    const result = await syncDaemonRouteCatalogState({
      catalogState,
      leasesByProfileId,
      loadCatalog: async () => nextCatalog,
      registerCatalog,
    });

    expect(result.status).toBe("changed");
    expect(catalogState.skippedProfiles).toEqual(nextCatalog.skippedProfiles);
    expect(registerCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        profileIds: [],
        skippedProfiles: nextCatalog.skippedProfiles,
      })
    );
  });

  it("keeps old state when register request fails", async () => {
    const catalogState = createMutableRouteCatalogState(
      createRouteCatalog(["agt-a"])
    );
    const leasesByProfileId = new Map<string, number>([["agt-a", 2]]);
    const registerCatalog = vi.fn(() =>
      Promise.reject(new Error("register boom"))
    );

    const result = await syncDaemonRouteCatalogState({
      catalogState,
      leasesByProfileId,
      loadCatalog: async () => createRouteCatalog(["agt-a", "agt-b"]),
      registerCatalog,
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toBe("register_failed");
      expect(result.errorMessage).toContain("register boom");
    }
    expect(catalogState.profileIds).toEqual(["agt-a"]);
    expect(catalogState.routeByProfileId.has("agt-b")).toBe(false);
    expect(leasesByProfileId.get("agt-a")).toBe(2);
  });
});
