import { describe, expect, it } from "vitest";
import type { RouteCatalog } from "../src/local-service/core/types";
import {
  clearDaemonRouteCatalogCache,
  readDaemonRouteCatalogCache,
  writeDaemonRouteCatalogCache,
} from "../src/local-service/state/route-catalog-cache";
import { withTempHome } from "./helpers/fs";

const AGENT_PROFILE_A = "agt_11111111-1111-4111-8111-111111111111";
const AGENT_PROFILE_B = "agt_22222222-2222-4222-8222-222222222222";
const SKIPPED_AGENT_PROFILE = "agt_33333333-3333-4333-8333-333333333333";
const CACHE_IDENTITY = {
  lane: "prod",
  ownerUserId: "usr_owner_a",
  serviceBundleId: "bundle-a",
} as const;

const createRouteCatalog = (profileIds: string[]): RouteCatalog => ({
  profileIds,
  routeByProfileId: new Map(
    profileIds.map((profileId) => [
      profileId,
      {
        agentControllerRef: "builtin:codex",
        bindingId: `binding-${profileId}`,
        configurationRevision: 7,
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        launchContract: {
          kind: "executable" as const,
          commandPath: "/usr/bin/true",
        },
        profileId,
        streamingMode: "final" as const,
        transportMode: "local-cli" as const,
        openMeldServiceRuntimeId: "runtime-1",
      },
    ])
  ),
  skippedProfiles: [
    {
      profileId: SKIPPED_AGENT_PROFILE,
      profileName: "Skipped Agent",
      skipReason: "projection.missing",
    },
  ],
});

describe("daemon route catalog cache", () => {
  it("restores the last catalog only for the matching cache identity", async () => {
    await withTempHome(async () => {
      const catalog = createRouteCatalog([AGENT_PROFILE_A]);
      const route = catalog.routeByProfileId.get(AGENT_PROFILE_A);
      if (!route) {
        throw new Error("test route missing");
      }
      route.workingFolderRuntime = {
        configPath: null,
        configuredWorkspacePath: "/tmp/project",
        defaultProjectBindingGeneration: "generation-1",
        defaultProjectId: "project-1",
        effectiveRuntimeWorkingDirectory: "/tmp/project",
        runtimeContext: {
          providerRuntimeWorkingDirectory: "/tmp/project",
        },
        status: "ready",
        workingFolderFact: {
          defaultProjectId: "project-1",
          localProjectBindingGeneration: "generation-1",
          observedAtMs: 1,
          reasonCode: null,
          source: "default_project",
          status: "ready",
        },
        workingFolderSource: "default_project",
        workspaceMode: null,
      };
      catalog.expectedRoutesContractVersion = "v4";
      catalog.workingFolderExpectedProfileIds = [AGENT_PROFILE_A];
      catalog.workingFolderObservations = [
        {
          ...route.workingFolderRuntime.workingFolderFact,
          bindingId: `binding-${AGENT_PROFILE_A}`,
          configurationRevision: 7,
          profileId: AGENT_PROFILE_A,
        },
      ];
      await writeDaemonRouteCatalogCache({
        ...CACHE_IDENTITY,
        routeCatalog: catalog,
      });

      const restored = await readDaemonRouteCatalogCache({
        ...CACHE_IDENTITY,
      });
      expect(restored?.profileIds).toEqual([AGENT_PROFILE_A]);
      expect(restored?.routeByProfileId.get(AGENT_PROFILE_A)).toMatchObject({
        agentControllerRef: "builtin:codex",
        bindingId: `binding-${AGENT_PROFILE_A}`,
        configurationRevision: 7,
        profileId: AGENT_PROFILE_A,
        streamingMode: "final",
        transportMode: "local-cli",
        openMeldServiceRuntimeId: "runtime-1",
      });
      expect(restored?.skippedProfiles).toEqual([
        {
          profileId: SKIPPED_AGENT_PROFILE,
          profileName: "Skipped Agent",
          skipReason: "projection.missing",
        },
      ]);
      expect(
        restored?.routeByProfileId.get(AGENT_PROFILE_A)?.workingFolderRuntime
      ).toBeUndefined();
      expect(restored?.expectedRoutesContractVersion).toBeUndefined();
      expect(restored?.workingFolderExpectedProfileIds).toBeUndefined();
      expect(restored?.workingFolderObservations).toEqual([]);

      await expect(
        readDaemonRouteCatalogCache({
          ...CACHE_IDENTITY,
          serviceBundleId: "bundle-b",
        })
      ).resolves.toBeNull();
    });
  });

  it("preserves route policy metadata", async () => {
    await withTempHome(async () => {
      const catalog = createRouteCatalog([AGENT_PROFILE_A]);
      const route = catalog.routeByProfileId.get(AGENT_PROFILE_A);
      if (!route) {
        throw new Error("test route missing");
      }
      route.agentControllerCollaborationMode = "codex:plan";
      route.agentControllerPermissionMode = "codex:approveForMe";
      route.conversationPolicy = {
        collaborationMode: "plan",
        fallbackModel: "gpt-5.5",
        model: "gpt-5.4-mini",
        reasoningLevel: "medium",
      };

      await writeDaemonRouteCatalogCache({
        ...CACHE_IDENTITY,
        routeCatalog: catalog,
      });

      const restored = await readDaemonRouteCatalogCache({
        ...CACHE_IDENTITY,
      });
      expect(
        restored?.routeByProfileId.get(AGENT_PROFILE_A)
          ?.agentControllerPermissionMode
      ).toBe("codex:approveForMe");
      expect(
        restored?.routeByProfileId.get(AGENT_PROFILE_A)
          ?.agentControllerCollaborationMode
      ).toBe("codex:plan");
      expect(
        restored?.routeByProfileId.get(AGENT_PROFILE_A)?.conversationPolicy
      ).toEqual({
        collaborationMode: "plan",
        fallbackModel: "gpt-5.5",
        model: "gpt-5.4-mini",
        reasoningLevel: "medium",
      });
    });
  });

  it("does not restore a catalog from another owner with the same bundle", async () => {
    await withTempHome(async () => {
      await writeDaemonRouteCatalogCache({
        ...CACHE_IDENTITY,
        routeCatalog: createRouteCatalog([AGENT_PROFILE_A]),
      });

      await expect(
        readDaemonRouteCatalogCache({
          ...CACHE_IDENTITY,
          ownerUserId: "usr_owner_b",
        })
      ).resolves.toBeNull();
    });
  });

  it("does not restore a catalog from another lane with the same owner and bundle", async () => {
    await withTempHome(async () => {
      await writeDaemonRouteCatalogCache({
        ...CACHE_IDENTITY,
        routeCatalog: createRouteCatalog([AGENT_PROFILE_A]),
      });

      await expect(
        readDaemonRouteCatalogCache({
          ...CACHE_IDENTITY,
          lane: "dev-local",
        })
      ).resolves.toBeNull();
    });
  });

  it("clears the cache when the current catalog is empty", async () => {
    await withTempHome(async () => {
      await writeDaemonRouteCatalogCache({
        ...CACHE_IDENTITY,
        routeCatalog: createRouteCatalog([AGENT_PROFILE_A]),
      });
      await writeDaemonRouteCatalogCache({
        ...CACHE_IDENTITY,
        routeCatalog: createRouteCatalog([]),
      });

      await expect(
        readDaemonRouteCatalogCache({
          ...CACHE_IDENTITY,
        })
      ).resolves.toBeNull();
    });
  });

  it("ignores cache reads when the service bundle is unknown", async () => {
    await withTempHome(async () => {
      await writeDaemonRouteCatalogCache({
        ...CACHE_IDENTITY,
        routeCatalog: createRouteCatalog([AGENT_PROFILE_B]),
      });

      await expect(
        readDaemonRouteCatalogCache({
          ...CACHE_IDENTITY,
          serviceBundleId: null,
        })
      ).resolves.toBeNull();
      await clearDaemonRouteCatalogCache();
      await expect(
        readDaemonRouteCatalogCache({
          ...CACHE_IDENTITY,
        })
      ).resolves.toBeNull();
    });
  });
});
