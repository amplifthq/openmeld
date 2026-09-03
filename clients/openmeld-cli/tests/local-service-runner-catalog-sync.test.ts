import { describe, expect, it, vi } from "vitest";
import {
  createMutableRouteCatalogState,
  syncDaemonRouteCatalogState,
} from "../src/local-service/carrier/service-runner";
import type { RouteCatalog } from "../src/local-service/core/types";

const createRouteCatalog = (
  profileIds: string[],
  projectConnectionGeneration?: string
): RouteCatalog => {
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
        ...(projectConnectionGeneration
          ? {
              workingFolderRuntime: {
                configPath: null,
                configuredWorkspacePath: "/tmp/project",
                defaultProjectBindingGeneration: projectConnectionGeneration,
                defaultProjectId: "project-1",
                effectiveRuntimeWorkingDirectory: "/tmp/project",
                runtimeContext: {
                  providerRuntimeWorkingDirectory: "/tmp/project",
                },
                status: "ready" as const,
                workingFolderFact: {
                  defaultProjectId: "project-1",
                  localProjectBindingGeneration: projectConnectionGeneration,
                  observedAtMs: 1,
                  reasonCode: null,
                  source: "default_project" as const,
                  status: "ready" as const,
                },
                workingFolderSource: "default_project" as const,
                workspaceMode: null,
              },
            }
          : {}),
      },
    ])
  );

  return {
    profileIds: [...profileIds],
    routeByProfileId,
    skippedProfiles: [],
    workingFolderObservations: [],
  };
};

const createProfileWorkspaceRouteCatalog = (workspacePath: string) => {
  const catalog = createRouteCatalog(["agt-a"]);
  const route = catalog.routeByProfileId.get("agt-a");
  if (!route) {
    throw new Error("test route missing");
  }
  route.workingFolderRuntime = {
    configPath: "/tmp/profile-workspace.json",
    configuredWorkspacePath: workspacePath,
    effectiveRuntimeWorkingDirectory: workspacePath,
    runtimeContext: {
      providerRuntimeWorkingDirectory: workspacePath,
    },
    status: "ready",
    workingFolderFact: {
      defaultProjectId: null,
      localProjectBindingGeneration: null,
      observedAtMs: 1,
      reasonCode: null,
      source: "profile_workspace",
      status: "ready",
    },
    workingFolderSource: "profile_workspace",
    workspaceMode: "custom",
  };
  catalog.workingFolderObservations = [
    {
      ...route.workingFolderRuntime.workingFolderFact,
      bindingId: null,
      configurationRevision: null,
      profileId: "agt-a",
    },
  ];
  return catalog;
};

const createV4ProfileWorkspaceRouteCatalog = (
  workspacePath: string,
  observedAtMs: number
) => {
  const catalog = createProfileWorkspaceRouteCatalog(workspacePath);
  const route = catalog.routeByProfileId.get("agt-a");
  if (!(route && catalog.workingFolderObservations?.[0])) {
    throw new Error("test route observation missing");
  }
  route.bindingId = "binding-a";
  route.configurationRevision = 7;
  catalog.expectedRoutesContractVersion = "v4";
  catalog.workingFolderExpectedProfileIds = ["agt-a"];
  catalog.workingFolderObservations[0] = {
    ...catalog.workingFolderObservations[0],
    bindingId: "binding-a",
    configurationRevision: 7,
    observedAtMs,
  };
  return catalog;
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

  it("refreshes unchanged negotiated v4 facts before they can become stale", async () => {
    const catalogState = createMutableRouteCatalogState(
      createV4ProfileWorkspaceRouteCatalog("/tmp/workspace-a", 1000)
    );
    const leasesByProfileId = new Map<string, number>([["agt-a", 1]]);
    const registerCatalog = vi.fn(async () => ({
      ok: true,
      connectionGeneration: 1,
      acceptedLeases: [{ profileId: "agt-a", leaseEpoch: 2 }],
      rejectedProfiles: [],
    }));

    const result = await syncDaemonRouteCatalogState({
      catalogState,
      leasesByProfileId,
      loadCatalog: async () =>
        createV4ProfileWorkspaceRouteCatalog("/tmp/workspace-a", 2000),
      registerCatalog,
    });

    expect(result.status).toBe("registered");
    expect(registerCatalog).toHaveBeenCalledOnce();
    expect(catalogState.workingFolderObservations?.[0]?.observedAtMs).toBe(
      2000
    );
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

  it("re-registers a route when its local Project connection generation changes", async () => {
    const catalogState = createMutableRouteCatalogState(
      createRouteCatalog(["agt-a"], "generation-1")
    );
    const leasesByProfileId = new Map<string, number>([["agt-a", 1]]);
    const registerCatalog = vi.fn(async () => ({
      ok: true,
      connectionGeneration: 2,
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
      leasesByProfileId,
      loadCatalog: async () => createRouteCatalog(["agt-a"], "generation-2"),
      registerCatalog,
    });

    expect(result.status).toBe("changed");
    expect(registerCatalog).toHaveBeenCalledOnce();
    expect(
      catalogState.routeByProfileId.get("agt-a")?.workingFolderRuntime
        ?.workingFolderFact.localProjectBindingGeneration
    ).toBe("generation-2");
    expect(leasesByProfileId.get("agt-a")).toBe(2);
  });

  it("re-registers a route when its profile workspace path changes", async () => {
    const catalogState = createMutableRouteCatalogState(
      createProfileWorkspaceRouteCatalog("/tmp/workspace-a")
    );
    const leasesByProfileId = new Map<string, number>([["agt-a", 1]]);
    const registerCatalog = vi.fn(async () => ({
      ok: true,
      connectionGeneration: 2,
      acceptedLeases: [{ profileId: "agt-a", leaseEpoch: 2 }],
      rejectedProfiles: [],
    }));

    const result = await syncDaemonRouteCatalogState({
      catalogState,
      leasesByProfileId,
      loadCatalog: async () =>
        createProfileWorkspaceRouteCatalog("/tmp/workspace-b"),
      registerCatalog,
    });

    expect(result.status).toBe("changed");
    expect(registerCatalog).toHaveBeenCalledOnce();
    expect(
      catalogState.routeByProfileId.get("agt-a")?.workingFolderRuntime
        ?.effectiveRuntimeWorkingDirectory
    ).toBe("/tmp/workspace-b");
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
