import { describe, expect, it, vi } from "vitest";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const mocks = vi.hoisted(() => ({
  createAgentProfileBindingApi: vi.fn(),
  listOpenMeldProfiles: vi.fn(),
  readExpectedRoutes: vi.fn(),
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
    read: () => mocks.readExpectedRoutes(),
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
  it("preserves the current catalog when a v3 compatibility binding read fails transiently", async () => {
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
    mocks.readExpectedRoutes.mockResolvedValue({
      contractVersion: "v3",
      response: {
        excludedProfiles: [],
        expectedRoutes: [
          {
            agentControllerCollaborationMode: null,
            agentControllerPermissionMode: null,
            agentProfileId: "agt-binding-lookup",
            bindingId: "binding-current",
            bindingState: "enabled_primary",
            configurationRevision: 7,
            executionTarget: {
              agentControllerConversationId: null,
              agentControllerRef: "builtin:codex",
              openMeldServiceRuntimeId: "runtime-current",
            },
            profileName: "Binding Lookup Agent",
            reasonCodes: [],
            routable: true,
          },
        ],
        generatedAt: "2026-09-04T00:00:00.000Z",
        openMeldServiceRuntimeId: "runtime-current",
        runtimeResolution: "resolved",
      },
      status: "resolved",
    });
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

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toBe("load_failed");
      expect(result.errorMessage).toContain("Core binding lookup unavailable");
    }
    expect(getPrimaryBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: "agt-binding-lookup",
      })
    );
    expect(registerCatalog).not.toHaveBeenCalled();
    expect(catalogState.profileIds).toEqual(["agt-existing"]);
    expect(catalogState.routeByProfileId.has("agt-existing")).toBe(true);
    expect(catalogState.skippedProfiles).toEqual([]);
    expect(leasesByProfileId.get("agt-existing")).toBe(3);
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
    mocks.readExpectedRoutes.mockResolvedValue({
      status: "legacy_endpoint_unavailable",
    });
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
