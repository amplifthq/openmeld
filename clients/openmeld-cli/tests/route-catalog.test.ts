import { createAgentProfileBindingApi } from "@openmeld/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDaemonRouteCatalog } from "../src/local-service/routing/route-catalog";

const getPrimaryBinding = vi.fn();
const listOpenMeldProfiles = vi.fn();
const resolveLocalDaemonRouteCandidate = vi.fn();
const resolveCurrentEffectiveProfileWorkingFolderRuntime = vi.fn();

vi.mock("@openmeld/api-client", () => ({
  createAgentProfileBindingApi: vi.fn(),
}));

vi.mock("../src/config/openmeld-profiles-api", () => ({
  listOpenMeldProfiles: () => listOpenMeldProfiles(),
}));

vi.mock("../src/config/account-context", () => ({
  resolveCurrentOpenMeldAccountContext: async () => ({
    key: { hostKey: "gateway.test", userKey: "owner-1" },
  }),
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: async () => "https://gateway.test",
}));

vi.mock("../src/local-service/routing/resolve-controller-support", () => ({
  readLocalEnabledControllers: async () => new Set(["codex"]),
  resolveLocalDaemonRouteCandidate: (
    input: Parameters<typeof resolveLocalDaemonRouteCandidate>[0]
  ) => resolveLocalDaemonRouteCandidate(input),
}));

vi.mock("../src/profile-workspace/effective-runtime-resolution", () => ({
  resolveCurrentEffectiveProfileWorkingFolderRuntime: (
    input: Parameters<
      typeof resolveCurrentEffectiveProfileWorkingFolderRuntime
    >[0]
  ) => resolveCurrentEffectiveProfileWorkingFolderRuntime(input),
}));

vi.mock("../src/system/expected-routes-read-session", () => ({
  createExpectedRoutesReadSession: () => ({
    read: () =>
      Promise.resolve({
        status: "legacy_endpoint_unavailable",
      }),
  }),
}));

vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: () => ({}),
}));

describe("route catalog", () => {
  beforeEach(() => {
    vi.mocked(createAgentProfileBindingApi).mockReturnValue({
      getPrimaryBinding,
    } as never);
    getPrimaryBinding.mockReset();
    listOpenMeldProfiles.mockReset();
    resolveLocalDaemonRouteCandidate.mockReset();
    resolveCurrentEffectiveProfileWorkingFolderRuntime.mockReset();
    resolveCurrentEffectiveProfileWorkingFolderRuntime.mockResolvedValue({
      configPath: null,
      configuredWorkspacePath: "/tmp/default-project",
      defaultProjectBindingGeneration: "project-generation-1",
      defaultProjectId: "project-1",
      effectiveRuntimeWorkingDirectory: "/tmp/default-project",
      runtimeContext: {
        providerRuntimeWorkingDirectory: "/tmp/default-project",
      },
      status: "ready",
      workingFolderFact: {
        defaultProjectId: "project-1",
        localProjectBindingGeneration: "project-generation-1",
        observedAtMs: 1,
        reasonCode: null,
        source: "default_project",
        status: "ready",
      },
      workingFolderSource: "default_project",
      workspaceMode: null,
    });
  });

  it("keeps routable profiles when one profile binding read is unavailable", async () => {
    listOpenMeldProfiles.mockResolvedValue([
      createProfile("agt-ready", "Ready Codex", "project-1"),
      createProfile("agt-binding-down", "Binding API Down"),
    ]);
    getPrimaryBinding.mockImplementation(({ agentProfileId }) => {
      if (agentProfileId === "agt-binding-down") {
        return Promise.reject(new Error("gateway fetch failed"));
      }
      return Promise.resolve({
        binding: {
          bindingId: "bind-ready",
        },
        status: "found",
      });
    });
    resolveLocalDaemonRouteCandidate.mockImplementation(
      ({ primaryBinding, profile }) => {
        if (!primaryBinding) {
          return {
            profileId: profile.openMeldProfileId,
            skipReason: "profile.binding.unbound",
            status: "skipped",
          };
        }
        return {
          profileId: profile.openMeldProfileId,
          route: {
            agentControllerConversationId: null,
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "runtime-ready",
            bindingId: primaryBinding.bindingId,
            contextIdMappingSpec: null,
            profileId: profile.openMeldProfileId,
            streamingMode: "final",
            transportMode: "local-cli",
          },
          status: "accepted",
        };
      }
    );

    const catalog = await loadDaemonRouteCatalog({
      localAdapterContainer: {} as never,
      ownerUserId: "owner-1",
      presenter: {
        view: "agent",
        data: vi.fn(),
        event: vi.fn(),
        line: vi.fn(),
      },
      quiet: true,
    });

    expect(catalog.profileIds).toEqual(["agt-ready"]);
    expect(catalog.routeByProfileId.get("agt-ready")?.bindingId).toBe(
      "bind-ready"
    );
    expect(
      resolveCurrentEffectiveProfileWorkingFolderRuntime
    ).toHaveBeenCalledWith({
      account: { hostKey: "gateway.test", userKey: "owner-1" },
      defaultProjectId: "project-1",
      mode: "inspect",
      openMeldProfileId: "agt-ready",
    });
    expect(
      catalog.routeByProfileId.get("agt-ready")?.workingFolderRuntime
        ?.effectiveRuntimeWorkingDirectory
    ).toBe("/tmp/default-project");
    expect(catalog.skippedProfiles).toEqual([
      {
        profileId: "agt-binding-down",
        profileName: "Binding API Down",
        skipReason: "profile.binding.read_unavailable",
      },
    ]);
    expect(catalog.workingFolderObservations).toEqual([
      {
        bindingId: "bind-ready",
        configurationRevision: null,
        defaultProjectId: "project-1",
        localProjectBindingGeneration: "project-generation-1",
        observedAtMs: 1,
        profileId: "agt-ready",
        reasonCode: null,
        source: "default_project",
        status: "ready",
      },
    ]);
  });

  it("keeps a precise current fact when a Default Project folder is missing", async () => {
    listOpenMeldProfiles.mockResolvedValue([
      createProfile("agt-missing-folder", "Missing Folder", "project-1"),
    ]);
    getPrimaryBinding.mockResolvedValue({
      binding: {
        bindingId: "bind-missing-folder",
        configurationRevision: 3,
      },
      status: "found",
    });
    resolveLocalDaemonRouteCandidate.mockReturnValue({
      profileId: "agt-missing-folder",
      route: {
        agentControllerConversationId: null,
        agentControllerRef: "builtin:codex",
        bindingId: "bind-missing-folder",
        configurationRevision: 3,
        contextIdMappingSpec: null,
        profileId: "agt-missing-folder",
        streamingMode: "final",
        transportMode: "local-cli",
      },
      status: "accepted",
    });
    resolveCurrentEffectiveProfileWorkingFolderRuntime.mockResolvedValueOnce({
      configPath: null,
      configuredWorkspacePath: "/tmp/missing-project",
      defaultProjectBindingGeneration: "project-generation-2",
      defaultProjectFailureReason: "folder_missing",
      defaultProjectId: "project-1",
      reasonCode: "workspace.missing",
      reasonText: "missing",
      status: "missing",
      workingFolderFact: {
        defaultProjectId: "project-1",
        localProjectBindingGeneration: "project-generation-2",
        observedAtMs: 2,
        reasonCode: "project.local_connection.folder_missing",
        source: "default_project",
        status: "missing",
      },
      workingFolderSource: "default_project",
      workspaceMode: null,
    });

    const catalog = await loadDaemonRouteCatalog({
      localAdapterContainer: {} as never,
      ownerUserId: "owner-1",
      presenter: {
        view: "agent",
        data: vi.fn(),
        event: vi.fn(),
        line: vi.fn(),
      },
      quiet: true,
    });

    expect(catalog.profileIds).toEqual([]);
    expect(catalog.skippedProfiles).toEqual([
      {
        profileId: "agt-missing-folder",
        profileName: "Missing Folder",
        skipReason: "workspace.missing",
      },
    ]);
    expect(catalog.workingFolderObservations).toEqual([
      {
        bindingId: "bind-missing-folder",
        configurationRevision: 3,
        defaultProjectId: "project-1",
        localProjectBindingGeneration: "project-generation-2",
        observedAtMs: 2,
        profileId: "agt-missing-folder",
        reasonCode: "project.local_connection.folder_missing",
        source: "default_project",
        status: "missing",
      },
    ]);
  });
});

function createProfile(
  openMeldProfileId: string,
  profileName: string,
  defaultProjectId: string | null = null
) {
  return {
    defaultProjectId,
    openMeldProfileId,
    ownerUserId: "owner-1",
    profileKind: "agent",
    profileName,
  };
}
