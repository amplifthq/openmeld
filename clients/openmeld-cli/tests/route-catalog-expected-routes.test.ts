import type { ModelCatalog } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDaemonRouteCatalog } from "../src/local-service/routing/route-catalog";
import type { ExpectedRoutesReadResult } from "../src/system/expected-routes-read-session";

const getPrimaryBinding = vi.fn();
const listOpenMeldProfiles = vi.fn();
const readExpectedRoutes = vi.fn<() => Promise<ExpectedRoutesReadResult>>();
const resolveCurrentOpenMeldAccountContext = vi.fn();
const resolveProfileWorkspaceRuntime = vi.fn();
const listProjectConnectionsWithStatus = vi.fn();

vi.mock("@openmeld/api-client", () => ({
  createAgentProfileBindingApi: () => ({
    getPrimaryBinding: (input: { agentProfileId: string }) =>
      getPrimaryBinding(input),
  }),
}));

vi.mock("../src/config/openmeld-profiles-api", () => ({
  listOpenMeldProfiles: () => listOpenMeldProfiles(),
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: async () => "https://gateway.test",
}));

vi.mock("../src/config/account-context", () => ({
  resolveCurrentOpenMeldAccountContext: () =>
    resolveCurrentOpenMeldAccountContext(),
}));

vi.mock("../src/system/expected-routes-read-session", () => ({
  createExpectedRoutesReadSession: () => ({
    read: () => readExpectedRoutes(),
  }),
}));

vi.mock("../src/profile-workspace/runtime-resolution", () => ({
  resolveProfileWorkspaceRuntime: (
    input: Parameters<typeof resolveProfileWorkspaceRuntime>[0]
  ) => resolveProfileWorkspaceRuntime(input),
}));

vi.mock("../src/agent-activity/project-bindings", () => ({
  listProjectConnectionsWithStatus: () => listProjectConnectionsWithStatus(),
}));

vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: () => ({}),
}));

const QUIET_PRESENTER = {
  view: "agent",
  data: vi.fn(),
  event: vi.fn(),
  line: vi.fn(),
} as const;

const LOCAL_CONTROLLERS = new Map([
  [
    "codex",
    {
      agentId: "codex",
      contextIdMappingSpec: {
        mappingVersion: 1,
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
      },
      displayName: "Codex",
      enabled: true,
      launchContract: { kind: "builtin" },
      retry: null,
      streamingMode: "final",
      timeoutMs: 1000,
      transportMode: "local-cli",
      updatedAt: "2026-06-12T00:00:00.000Z",
    },
  ],
]);

vi.mock("../src/local-service/routing/resolve-controller-support", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/routing/resolve-controller-support")
  >("../src/local-service/routing/resolve-controller-support");
  return {
    ...actual,
    readLocalEnabledControllers: async () => LOCAL_CONTROLLERS,
  };
});

// Minimal adapter container: the real registry resolves builtin:codex to an
// adapter id; the container only needs to hand that adapter back.
const LOCAL_ADAPTER_CONTAINER = {
  getAdapter: (adapterId: string) => ({ adapter: {}, adapterId }),
  getRequiredAdapter: (adapterId: string) => ({ adapter: {}, adapterId }),
  listAdapters: () => [{ adapterId: "local-cli" }],
} as never;

const REMOTE_MODEL_CATALOG: ModelCatalog = {
  schemaVersion: 1,
  updatedAt: "2026-06-18T00:00:00.000Z",
  agentControllers: {
    codex: {
      defaultModelId: "gpt-remote-default",
      models: [
        {
          displayName: "Remote Default",
          id: "gpt-remote-default",
          minCliVersion: null,
          supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
          unavailable: false,
        },
      ],
    },
  },
};

const createExpectedRoute = (agentProfileId: string) => ({
  agentProfileId,
  bindingId: `bind-${agentProfileId}`,
  bindingState: "enabled_primary" as const,
  configurationRevision: 7,
  defaultProjectId: null,
  executionTarget: {
    agentControllerConversationId: null,
    agentControllerRef: "builtin:codex",
    openMeldServiceRuntimeId: "runtime-this-device",
  },
  agentControllerCollaborationMode: "codex:plan" as const,
  agentControllerPermissionMode: "codex:approveForMe" as const,
  profileName: `Profile ${agentProfileId}`,
  reasonCodes: [],
  routable: true,
});

describe("route catalog expected-routes fast path", () => {
  beforeEach(() => {
    getPrimaryBinding.mockReset();
    listOpenMeldProfiles.mockReset();
    readExpectedRoutes.mockReset();
    resolveCurrentOpenMeldAccountContext.mockReset();
    resolveCurrentOpenMeldAccountContext.mockResolvedValue({
      key: { hostKey: "gateway.test", userKey: "owner-1" },
      source: "session",
    });
    resolveProfileWorkspaceRuntime.mockReset();
    resolveProfileWorkspaceRuntime.mockResolvedValue({ status: "ready" });
    listProjectConnectionsWithStatus.mockReset().mockResolvedValue([]);
  });

  it("builds the catalog from the projection without any per-profile reads", async () => {
    readExpectedRoutes.mockResolvedValue({
      contractVersion: "v4",
      response: {
        openMeldServiceRuntimeId: "runtime-this-device",
        excludedProfiles: [
          { agentProfileId: "agt-inactive", reasonCode: "profile.inactive" },
          {
            agentProfileId: "agt-elsewhere",
            reasonCode: "binding.other_runtime",
          },
        ],
        expectedRoutes: [createExpectedRoute("agt-fast")],
        generatedAt: "2026-06-12T00:00:00.000Z",
        runtimeResolution: "resolved",
      },
      status: "resolved",
    });

    const catalog = await loadDaemonRouteCatalog({
      localAdapterContainer: LOCAL_ADAPTER_CONTAINER,
      ownerUserId: "owner-1",
      presenter: QUIET_PRESENTER,
      quiet: true,
    });

    expect(catalog.profileIds).toEqual(["agt-fast"]);
    expect(catalog.routeByProfileId.get("agt-fast")?.bindingId).toBe(
      "bind-agt-fast"
    );
    expect(
      catalog.routeByProfileId.get("agt-fast")?.configurationRevision
    ).toBe(7);
    expect(
      catalog.routeByProfileId.get("agt-fast")?.agentControllerCollaborationMode
    ).toBe("codex:plan");
    expect(
      catalog.routeByProfileId.get("agt-fast")?.agentControllerPermissionMode
    ).toBe("codex:approveForMe");
    // Server exclusions map to local skip diagnostics; other-runtime
    // bindings are not this device's routes and stay out entirely.
    expect(catalog.skippedProfiles).toEqual([
      {
        profileId: "agt-inactive",
        profileName: null,
        skipReason: "profile.status.inactive",
      },
    ]);
    expect(listOpenMeldProfiles).not.toHaveBeenCalled();
    expect(getPrimaryBinding).not.toHaveBeenCalled();
  });

  it("uses the operation-scoped model catalog for route conversation policy", async () => {
    readExpectedRoutes.mockResolvedValue({
      contractVersion: "v4",
      response: {
        openMeldServiceRuntimeId: "runtime-this-device",
        excludedProfiles: [],
        expectedRoutes: [createExpectedRoute("agt-fast")],
        generatedAt: "2026-06-12T00:00:00.000Z",
        runtimeResolution: "resolved",
      },
      status: "resolved",
    });

    const catalog = await loadDaemonRouteCatalog({
      localAdapterContainer: LOCAL_ADAPTER_CONTAINER,
      modelCatalogRead: {
        read: async () => REMOTE_MODEL_CATALOG,
      },
      ownerUserId: "owner-1",
      presenter: QUIET_PRESENTER,
      quiet: true,
    });

    expect(
      catalog.routeByProfileId.get("agt-fast")?.conversationPolicy
    ).toEqual({
      collaborationMode: "plan",
      fallbackModel: "gpt-remote-default",
      model: "gpt-remote-default",
    });
  });

  it("resolves the current account once for every workspace in the catalog", async () => {
    readExpectedRoutes.mockResolvedValue({
      contractVersion: "v4",
      response: {
        openMeldServiceRuntimeId: "runtime-this-device",
        excludedProfiles: [],
        expectedRoutes: [
          createExpectedRoute("agt-one"),
          createExpectedRoute("agt-two"),
        ],
        generatedAt: "2026-06-12T00:00:00.000Z",
        runtimeResolution: "resolved",
      },
      status: "resolved",
    });

    await loadDaemonRouteCatalog({
      localAdapterContainer: LOCAL_ADAPTER_CONTAINER,
      ownerUserId: "owner-1",
      presenter: QUIET_PRESENTER,
      quiet: true,
    });

    expect(resolveCurrentOpenMeldAccountContext).toHaveBeenCalledTimes(1);
    expect(resolveProfileWorkspaceRuntime).toHaveBeenCalledTimes(2);
    expect(resolveProfileWorkspaceRuntime).toHaveBeenNthCalledWith(1, {
      account: { hostKey: "gateway.test", userKey: "owner-1" },
      mode: "inspect",
      openMeldProfileId: "agt-one",
    });
    expect(resolveProfileWorkspaceRuntime).toHaveBeenNthCalledWith(2, {
      account: { hostKey: "gateway.test", userKey: "owner-1" },
      mode: "inspect",
      openMeldProfileId: "agt-two",
    });
  });

  it("uses the v4 Default Project identity without rebuilding the route from profile reads", async () => {
    readExpectedRoutes.mockResolvedValue({
      contractVersion: "v4",
      response: {
        openMeldServiceRuntimeId: "runtime-this-device",
        excludedProfiles: [],
        expectedRoutes: [
          {
            ...createExpectedRoute("agt-project"),
            defaultProjectId: "project-v4",
          },
        ],
        generatedAt: "2026-06-12T00:00:00.000Z",
        runtimeResolution: "resolved",
      },
      status: "resolved",
    });
    listProjectConnectionsWithStatus.mockResolvedValue([
      {
        bindingGeneration: "local-generation-v4",
        isDefault: true,
        organizationId: "org-1",
        projectId: "project-v4",
        projectSlug: "project-v4",
        repositoryFingerprint: null,
        repositoryPath: "/tmp/project-v4",
        status: "available",
      },
    ]);

    const catalog = await loadDaemonRouteCatalog({
      localAdapterContainer: LOCAL_ADAPTER_CONTAINER,
      ownerUserId: "owner-1",
      presenter: QUIET_PRESENTER,
      quiet: true,
    });

    expect(listOpenMeldProfiles).not.toHaveBeenCalled();
    expect(getPrimaryBinding).not.toHaveBeenCalled();
    expect(catalog.expectedRoutesContractVersion).toBe("v4");
    expect(catalog.workingFolderExpectedProfileIds).toEqual(["agt-project"]);
    expect(
      catalog.routeByProfileId.get("agt-project")?.workingFolderRuntime
    ).toMatchObject({
      defaultProjectId: "project-v4",
      effectiveRuntimeWorkingDirectory: "/tmp/project-v4",
      workingFolderFact: {
        localProjectBindingGeneration: "local-generation-v4",
        source: "default_project",
        status: "ready",
      },
    });
    expect(catalog.workingFolderObservations).toEqual([
      expect.objectContaining({
        bindingId: "bind-agt-project",
        configurationRevision: 7,
        defaultProjectId: "project-v4",
        localProjectBindingGeneration: "local-generation-v4",
        profileId: "agt-project",
        reasonCode: null,
        source: "default_project",
        status: "ready",
      }),
    ]);
  });

  it("reports one v4 working-folder fact even when the local controller route is skipped", async () => {
    readExpectedRoutes.mockResolvedValue({
      contractVersion: "v4",
      response: {
        openMeldServiceRuntimeId: "runtime-this-device",
        excludedProfiles: [],
        expectedRoutes: [
          {
            ...createExpectedRoute("agt-broken-controller"),
            executionTarget: {
              agentControllerConversationId: null,
              agentControllerRef: "not-a-controller-ref",
              openMeldServiceRuntimeId: "runtime-this-device",
            },
          },
        ],
        generatedAt: "2026-06-12T00:00:00.000Z",
        runtimeResolution: "resolved",
      },
      status: "resolved",
    });
    resolveProfileWorkspaceRuntime.mockResolvedValue({
      configPath: "/tmp/profile-workspace.json",
      configuredWorkspacePath: "/tmp/profile-workspace",
      effectiveRuntimeWorkingDirectory: "/tmp/profile-workspace",
      runtimeContext: {
        providerRuntimeWorkingDirectory: "/tmp/profile-workspace",
      },
      status: "ready",
      workspaceMode: "custom",
    });

    const catalog = await loadDaemonRouteCatalog({
      localAdapterContainer: LOCAL_ADAPTER_CONTAINER,
      ownerUserId: "owner-1",
      presenter: QUIET_PRESENTER,
      quiet: true,
    });

    expect(catalog.profileIds).toEqual([]);
    expect(catalog.skippedProfiles).toEqual([
      {
        profileId: "agt-broken-controller",
        profileName: "Profile agt-broken-controller",
        skipReason: "controller.binding.incomplete",
      },
    ]);
    expect(catalog.workingFolderExpectedProfileIds).toEqual([
      "agt-broken-controller",
    ]);
    expect(catalog.workingFolderObservations).toEqual([
      expect.objectContaining({
        bindingId: "bind-agt-broken-controller",
        configurationRevision: 7,
        defaultProjectId: null,
        profileId: "agt-broken-controller",
        source: "profile_workspace",
        status: "ready",
      }),
    ]);
  });

  it("falls back to per-profile binding reads when the projection is unavailable", async () => {
    readExpectedRoutes.mockResolvedValue({
      status: "legacy_endpoint_unavailable",
    });
    listOpenMeldProfiles.mockResolvedValue([
      {
        openMeldProfileId: "agt-legacy",
        ownerUserId: "owner-1",
        profileKind: "agent",
        profileName: "Legacy",
        status: "active",
      },
    ]);
    getPrimaryBinding.mockResolvedValue({
      binding: {
        agentControllerPermissionMode: "codex:fullAccess",
        bindingId: "bind-legacy",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerConversationId: null,
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: { value: "runtime-this-device" },
        },
        routable: true,
      },
      status: "found",
    });

    const catalog = await loadDaemonRouteCatalog({
      localAdapterContainer: LOCAL_ADAPTER_CONTAINER,
      ownerUserId: "owner-1",
      presenter: QUIET_PRESENTER,
      quiet: true,
    });

    expect(listOpenMeldProfiles).toHaveBeenCalledTimes(1);
    expect(getPrimaryBinding).toHaveBeenCalledTimes(1);
    expect(catalog.profileIds).toEqual(["agt-legacy"]);
    expect(
      catalog.routeByProfileId.get("agt-legacy")?.agentControllerPermissionMode
    ).toBe("codex:fullAccess");
  });

  it("uses current profile and Default Project facts after an older Core negotiates v3", async () => {
    const { defaultProjectId: _v4DefaultProjectId, ...v3ExpectedRoute } =
      createExpectedRoute("agt-legacy");
    readExpectedRoutes.mockResolvedValue({
      contractVersion: "v3",
      response: {
        openMeldServiceRuntimeId: "runtime-this-device",
        excludedProfiles: [],
        expectedRoutes: [v3ExpectedRoute],
        generatedAt: "2026-06-12T00:00:00.000Z",
        runtimeResolution: "resolved",
      },
      status: "resolved",
    });
    listOpenMeldProfiles.mockResolvedValue([
      {
        defaultProjectId: "project-legacy",
        openMeldProfileId: "agt-legacy",
        ownerUserId: "owner-1",
        profileKind: "agent",
        profileName: "Legacy",
        status: "active",
      },
    ]);
    getPrimaryBinding.mockResolvedValue({
      binding: {
        bindingId: "bind-legacy",
        bindingState: "enabled_primary",
        configurationRevision: 7,
        executionTarget: {
          agentControllerConversationId: null,
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: { value: "runtime-this-device" },
        },
        routable: true,
      },
      status: "found",
    });
    listProjectConnectionsWithStatus.mockResolvedValue([
      {
        bindingGeneration: "local-generation-1",
        isDefault: true,
        organizationId: "org-1",
        projectId: "project-legacy",
        projectSlug: "legacy",
        repositoryFingerprint: null,
        repositoryPath: "/tmp/project-legacy",
        status: "available",
      },
    ]);

    const catalog = await loadDaemonRouteCatalog({
      localAdapterContainer: LOCAL_ADAPTER_CONTAINER,
      ownerUserId: "owner-1",
      presenter: QUIET_PRESENTER,
      quiet: true,
    });

    expect(listOpenMeldProfiles).toHaveBeenCalledTimes(1);
    expect(getPrimaryBinding).toHaveBeenCalledTimes(1);
    expect(catalog.expectedRoutesContractVersion).toBeUndefined();
    expect(
      catalog.routeByProfileId.get("agt-legacy")?.workingFolderRuntime
    ).toMatchObject({
      defaultProjectId: "project-legacy",
      effectiveRuntimeWorkingDirectory: "/tmp/project-legacy",
      workingFolderFact: {
        localProjectBindingGeneration: "local-generation-1",
        source: "default_project",
        status: "ready",
      },
    });
  });

  it("fails the load when the projection read rejects so the set never shrinks", async () => {
    readExpectedRoutes.mockRejectedValue(
      new Error("profile facts are temporarily unavailable")
    );

    await expect(
      loadDaemonRouteCatalog({
        localAdapterContainer: LOCAL_ADAPTER_CONTAINER,
        ownerUserId: "owner-1",
        presenter: QUIET_PRESENTER,
        quiet: true,
      })
    ).rejects.toThrow("profile facts are temporarily unavailable");

    expect(listOpenMeldProfiles).not.toHaveBeenCalled();
    expect(getPrimaryBinding).not.toHaveBeenCalled();
  });
});
