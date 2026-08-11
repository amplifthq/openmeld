import { describe, expect, it, vi } from "vitest";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const mocks = vi.hoisted(() => ({
  createAgentProfileBindingApi: vi.fn(),
  listOpenMeldProfiles: vi.fn(),
  readLocalEnabledControllers: vi.fn(),
  resolveBaseUrl: vi.fn(),
}));

vi.mock("@openmeld/api-client", async () => {
  const actual = await vi.importActual<typeof import("@openmeld/api-client")>(
    "@openmeld/api-client"
  );
  return {
    ...actual,
    createAgentProfileBindingApi: mocks.createAgentProfileBindingApi,
  };
});

vi.mock("../src/config/openmeld-profiles-api", () => ({
  listOpenMeldProfiles: mocks.listOpenMeldProfiles,
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: mocks.resolveBaseUrl,
}));

vi.mock("../src/system/expected-routes-read-session", () => ({
  createExpectedRoutesReadSession: () => ({
    read: () =>
      Promise.resolve({
        status: "legacy_endpoint_unavailable",
      }),
  }),
}));

vi.mock("../src/local-service/routing/resolve-controller-support", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/routing/resolve-controller-support")
  >("../src/local-service/routing/resolve-controller-support");
  return {
    ...actual,
    readLocalEnabledControllers: mocks.readLocalEnabledControllers,
  };
});

import type { RouteCatalog } from "../src/local-service/core/types";
import {
  createMutableRouteCatalogState,
  loadDaemonRouteCatalog,
  syncDaemonRouteCatalogState,
} from "../src/local-service/routing/route-catalog";

const createRouteCatalog = (profileIds: string[]): RouteCatalog => ({
  profileIds,
  routeByProfileId: new Map(
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
  ),
  skippedProfiles: [],
});

describe("local service route catalog Core primary binding lookup", () => {
  it("skips the profile and registers the catalog when binding lookup is unavailable", async () => {
    const profile = createTestOpenMeldProfile({
      openMeldProfileId: "agt-binding-lookup",
      ownerUserId: "owner-1",
      profileName: "Binding Lookup Agent",
    });
    const getPrimaryBinding = vi
      .fn()
      .mockRejectedValue(new Error("Core binding lookup unavailable"));
    mocks.createAgentProfileBindingApi.mockReturnValue({ getPrimaryBinding });
    mocks.listOpenMeldProfiles.mockResolvedValue([profile]);
    mocks.readLocalEnabledControllers.mockResolvedValue(new Map());
    mocks.resolveBaseUrl.mockResolvedValue("http://127.0.0.1:8080");

    const catalogState = createMutableRouteCatalogState(
      createRouteCatalog(["agt-existing"])
    );
    const leasesByProfileId = new Map<string, number>([["agt-existing", 3]]);
    const registerCatalog = vi.fn(async () => ({
      ok: true,
      connectionGeneration: 1,
      acceptedLeases: [],
      rejectedProfiles: [],
    }));

    const result = await syncDaemonRouteCatalogState({
      catalogState,
      leasesByProfileId,
      loadCatalog: () =>
        loadDaemonRouteCatalog({
          localAdapterContainer: {} as never,
          ownerUserId: "owner-1",
          presenter: {} as never,
          quiet: true,
        }),
      registerCatalog,
    });

    expect(result.status).toBe("changed");
    if (result.status === "changed") {
      expect(result.diff).toEqual({
        addedProfileIds: [],
        keptProfileIds: [],
        removedProfileIds: ["agt-existing"],
      });
      expect(result.skippedProfiles).toEqual([
        {
          profileId: "agt-binding-lookup",
          profileName: "Binding Lookup Agent",
          skipReason: "profile.binding.read_unavailable",
        },
      ]);
    }
    expect(getPrimaryBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: "agt-binding-lookup",
      })
    );
    expect(registerCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        profileIds: [],
        skippedProfiles: [
          {
            profileId: "agt-binding-lookup",
            profileName: "Binding Lookup Agent",
            skipReason: "profile.binding.read_unavailable",
          },
        ],
      })
    );
    expect(catalogState.profileIds).toEqual([]);
    expect(catalogState.routeByProfileId.has("agt-existing")).toBe(false);
    expect(catalogState.skippedProfiles).toEqual([
      {
        profileId: "agt-binding-lookup",
        profileName: "Binding Lookup Agent",
        skipReason: "profile.binding.read_unavailable",
      },
    ]);
    expect(leasesByProfileId.has("agt-existing")).toBe(false);
  });

  it("treats unavailable Core primary binding reads as skipped profile diagnostics, not unbound profiles", async () => {
    const profile = createTestOpenMeldProfile({
      openMeldProfileId: "agt-owner-unavailable",
      ownerUserId: "owner-1",
      profileName: "Owner Unavailable Agent",
    });
    const getPrimaryBinding = vi.fn().mockResolvedValue({
      binding: {
        agentProfileId: "agt-owner-unavailable",
        authoritySource: "none",
        bindingState: "missing",
        dispatchEligibility: {
          reasonCodes: ["agent_profile_binding.profile_owner_unavailable"],
          routable: false,
          status: "not_routable",
        },
        grantsClaimSuccess: false,
        reasonCodes: ["agent_profile_binding.profile_owner_unavailable"],
        resolutionSource: "missing_projection",
        routable: false,
        executionTarget: null,
      },
      grantsClaimSuccess: false,
      status: "unavailable",
    });
    mocks.createAgentProfileBindingApi.mockReturnValue({ getPrimaryBinding });
    mocks.listOpenMeldProfiles.mockResolvedValue([profile]);
    mocks.readLocalEnabledControllers.mockResolvedValue(new Map());
    mocks.resolveBaseUrl.mockResolvedValue("http://127.0.0.1:8080");

    const catalogState = createMutableRouteCatalogState(
      createRouteCatalog(["agt-existing"])
    );
    const leasesByProfileId = new Map<string, number>([["agt-existing", 3]]);
    const registerCatalog = vi.fn(async () => ({
      ok: true,
      connectionGeneration: 1,
      acceptedLeases: [],
      rejectedProfiles: [],
    }));

    const result = await syncDaemonRouteCatalogState({
      catalogState,
      leasesByProfileId,
      loadCatalog: () =>
        loadDaemonRouteCatalog({
          localAdapterContainer: {} as never,
          ownerUserId: "owner-1",
          presenter: {} as never,
          quiet: true,
        }),
      registerCatalog,
    });

    expect(result.status).toBe("changed");
    if (result.status === "changed") {
      expect(result.diff).toEqual({
        addedProfileIds: [],
        keptProfileIds: [],
        removedProfileIds: ["agt-existing"],
      });
      expect(result.skippedProfiles).toEqual([
        {
          profileId: "agt-owner-unavailable",
          profileName: "Owner Unavailable Agent",
          skipReason: "profile.binding.read_unavailable",
        },
      ]);
    }
    expect(registerCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        profileIds: [],
        skippedProfiles: [
          {
            profileId: "agt-owner-unavailable",
            profileName: "Owner Unavailable Agent",
            skipReason: "profile.binding.read_unavailable",
          },
        ],
      })
    );
    expect(catalogState.profileIds).toEqual([]);
    expect(catalogState.skippedProfiles).toEqual([
      {
        profileId: "agt-owner-unavailable",
        profileName: "Owner Unavailable Agent",
        skipReason: "profile.binding.read_unavailable",
      },
    ]);
    expect(leasesByProfileId.has("agt-existing")).toBe(false);
  });
});
