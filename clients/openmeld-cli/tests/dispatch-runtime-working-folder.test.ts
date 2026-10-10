import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executionContextTaskSchema } from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonProfileRouteConfig } from "../src/local-service/core/types";
import {
  CURRENT_ROUTE_WORKING_FOLDER_FRESHNESS_MS,
  resolveDispatchRuntimeContext,
  resolveDispatchWorkingFolderRuntimeContext,
} from "../src/local-service/execution/dispatch-runtime-preparation";

const {
  listProjectConnectionsWithStatus,
  resolveCurrentEffectiveProfileWorkingFolderRuntime,
  resolveEffectiveProfileWorkingFolderRuntime,
} = vi.hoisted(() => ({
  listProjectConnectionsWithStatus: vi.fn(),
  resolveCurrentEffectiveProfileWorkingFolderRuntime: vi.fn(),
  resolveEffectiveProfileWorkingFolderRuntime: vi.fn(),
}));
vi.mock("../src/agent-activity/project-bindings", () => ({
  listProjectConnectionsWithStatus,
}));
const CURRENT_WORKING_FOLDER_FACT_ERROR_PATTERN =
  /^profile\.working_folder\.current_fact_/u;

vi.mock("../src/profile-workspace/effective-runtime-resolution", () => ({
  resolveCurrentEffectiveProfileWorkingFolderRuntime,
  resolveEffectiveProfileWorkingFolderRuntime,
}));

describe("dispatch runtime working folder", () => {
  beforeEach(() => {
    listProjectConnectionsWithStatus.mockReset();
    listProjectConnectionsWithStatus.mockResolvedValue([]);
    resolveCurrentEffectiveProfileWorkingFolderRuntime.mockReset();
    resolveEffectiveProfileWorkingFolderRuntime.mockReset();
    resolveCurrentEffectiveProfileWorkingFolderRuntime.mockResolvedValue(
      createCurrentWorkingFolder()
    );
  });

  it("preserves a precise invalid Default Project connection failure", async () => {
    resolveEffectiveProfileWorkingFolderRuntime.mockResolvedValue({
      configPath: null,
      configuredWorkspacePath: "/tmp/project-invalid",
      defaultProjectBindingGeneration: "generation-invalid",
      defaultProjectId: "project-invalid",
      reasonCode: "workspace.invalid",
      reasonText: "invalid",
      status: "invalid",
      workingFolderSource: "default_project",
      workspaceMode: null,
    });

    await expect(
      resolveDispatchRuntimeContext({
        defaultProjectId: "project-invalid",
        openMeldProfileId: "agt-1",
      })
    ).rejects.toMatchObject({
      code: "project.local_connection.invalid",
      message: "project.local_connection.invalid",
      projectFailureContext: {
        bindingGeneration: "generation-invalid",
        projectId: "project-invalid",
      },
    });
    expect(resolveEffectiveProfileWorkingFolderRuntime).toHaveBeenCalledWith({
      defaultProjectId: "project-invalid",
      mode: "dispatch",
      openMeldProfileId: "agt-1",
    });
  });

  it("uses the exact current Default Project route for a legacy dispatch without a Default Project field", async () => {
    const routeConfig = createCurrentRoute();

    await expect(
      resolveDispatchWorkingFolderRuntimeContext({
        ...createDispatchIdentityInput(routeConfig),
        defaultProjectId: null,
        defaultProjectIdWasProvided: false,
        nowMs: 10_000,
        routeConfig,
        targetProfileId: "agt-1",
      })
    ).resolves.toEqual({
      providerRuntimeWorkingDirectory: "/tmp/current-default-project",
    });
    expect(resolveEffectiveProfileWorkingFolderRuntime).not.toHaveBeenCalled();
    expect(
      resolveCurrentEffectiveProfileWorkingFolderRuntime
    ).toHaveBeenCalledOnce();
  });

  it("fails closed after the Default Project mutation is durable but before the new route is registered", async () => {
    const routeConfig = createCurrentRoute();
    resolveCurrentEffectiveProfileWorkingFolderRuntime.mockResolvedValue(
      createCurrentWorkingFolder({
        bindingGeneration: "generation-2",
        repositoryPath: "/tmp/new-default-project",
      })
    );

    await expect(
      resolveDispatchWorkingFolderRuntimeContext({
        ...createDispatchIdentityInput(routeConfig),
        defaultProjectId: null,
        defaultProjectIdWasProvided: false,
        nowMs: 10_000,
        routeConfig,
        targetProfileId: "agt-1",
      })
    ).rejects.toMatchObject({
      code: "profile.working_folder.current_fact_changed",
    });
  });

  it("automatically accepts the new Default Project after its route is registered", async () => {
    const routeConfig = createCurrentRoute({
      bindingGeneration: "generation-2",
      repositoryPath: "/tmp/new-default-project",
    });
    resolveCurrentEffectiveProfileWorkingFolderRuntime.mockResolvedValue(
      createCurrentWorkingFolder({
        bindingGeneration: "generation-2",
        repositoryPath: "/tmp/new-default-project",
      })
    );

    await expect(
      resolveDispatchWorkingFolderRuntimeContext({
        ...createDispatchIdentityInput(routeConfig),
        defaultProjectId: null,
        defaultProjectIdWasProvided: false,
        nowMs: 10_000,
        routeConfig,
        targetProfileId: "agt-1",
      })
    ).resolves.toEqual({
      providerRuntimeWorkingDirectory: "/tmp/new-default-project",
    });
  });

  it("fails closed after a Profile workspace changes but before the new route is registered", async () => {
    const routeConfig = createCurrentProfileWorkspaceRoute();
    resolveCurrentEffectiveProfileWorkingFolderRuntime.mockResolvedValue(
      createCurrentProfileWorkspace({
        repositoryPath: "/tmp/new-profile-workspace",
      })
    );

    await expect(
      resolveDispatchWorkingFolderRuntimeContext({
        ...createDispatchIdentityInput(routeConfig),
        defaultProjectId: null,
        defaultProjectIdWasProvided: false,
        nowMs: 10_000,
        routeConfig,
        targetProfileId: "agt-1",
      })
    ).rejects.toMatchObject({
      code: "profile.working_folder.current_fact_changed",
    });
  });

  it("automatically accepts the new Profile workspace after its route is registered", async () => {
    const routeConfig = createCurrentProfileWorkspaceRoute({
      repositoryPath: "/tmp/new-profile-workspace",
    });
    resolveCurrentEffectiveProfileWorkingFolderRuntime.mockResolvedValue(
      createCurrentProfileWorkspace({
        repositoryPath: "/tmp/new-profile-workspace",
      })
    );

    await expect(
      resolveDispatchWorkingFolderRuntimeContext({
        ...createDispatchIdentityInput(routeConfig),
        defaultProjectId: null,
        defaultProjectIdWasProvided: false,
        nowMs: 10_000,
        routeConfig,
        targetProfileId: "agt-1",
      })
    ).resolves.toEqual({
      providerRuntimeWorkingDirectory: "/tmp/new-profile-workspace",
    });
  });

  it.each([
    ["missing", null, 10_000],
    [
      "stale",
      createCurrentRoute({
        observedAtMs: 10_000 - CURRENT_ROUTE_WORKING_FOLDER_FRESHNESS_MS,
      }),
      10_000,
    ],
    [
      "binding mismatch",
      createCurrentRoute({ bindingId: "binding-other" }),
      10_000,
    ],
    [
      "configuration mismatch",
      createCurrentRoute({ configurationRevision: 8 }),
      10_000,
    ],
  ] as const)("fails closed before resolving a fresh folder when the legacy route is %s", async (_case, routeConfig, nowMs) => {
    await expect(
      resolveDispatchWorkingFolderRuntimeContext({
        ...createDispatchIdentityInput(),
        defaultProjectId: null,
        defaultProjectIdWasProvided: false,
        nowMs,
        routeConfig,
        targetProfileId: "agt-1",
      })
    ).rejects.toMatchObject({
      code: expect.stringMatching(CURRENT_WORKING_FOLDER_FACT_ERROR_PATTERN),
    });
    expect(resolveEffectiveProfileWorkingFolderRuntime).not.toHaveBeenCalled();
  });

  it("fails closed when legacy Binding configuration identity is absent", async () => {
    const routeConfig = createCurrentRoute();
    const dispatchIdentity = createDispatchIdentityInput();
    const {
      configurationRevision: _configurationRevision,
      ...controllerSnapshot
    } = dispatchIdentity.controllerSnapshot;
    routeConfig.configurationRevision = undefined;

    await expect(
      resolveDispatchWorkingFolderRuntimeContext({
        ...dispatchIdentity,
        controllerSnapshot,
        defaultProjectId: null,
        defaultProjectIdWasProvided: false,
        nowMs: 10_000,
        routeConfig,
        targetProfileId: "agt-1",
      })
    ).rejects.toMatchObject({
      code: "profile.working_folder.current_fact_identity_mismatch",
    });
  });

  it("requires a matching current route when the dispatch provides a Default Project", async () => {
    const routeConfig = createCurrentRoute();

    await expect(
      resolveDispatchWorkingFolderRuntimeContext({
        ...createDispatchIdentityInput(routeConfig),
        defaultProjectId: "project-1",
        defaultProjectIdWasProvided: true,
        nowMs: 10_000,
        routeConfig,
        targetProfileId: "agt-1",
      })
    ).resolves.toEqual({
      providerRuntimeWorkingDirectory: "/tmp/current-default-project",
    });
    expect(resolveEffectiveProfileWorkingFolderRuntime).not.toHaveBeenCalled();
    expect(
      resolveCurrentEffectiveProfileWorkingFolderRuntime
    ).toHaveBeenCalledWith({
      defaultProjectId: "project-1",
      mode: "dispatch",
      openMeldProfileId: "agt-1",
    });
  });

  it("uses the exact selected repository connection instead of the Profile default folder", async () => {
    const selectedFingerprint = `sha256:${"a".repeat(64)}`;
    listProjectConnectionsWithStatus.mockResolvedValue([
      {
        bindingGeneration: "generation-repository-b",
        boundAtMs: 1,
        isDefault: false,
        organizationId: "organization-1",
        ownerUserId: "user-1",
        projectId: "project-2",
        projectSlug: "selected-project",
        repositoryFingerprint: selectedFingerprint,
        repositoryPath: "/tmp/repository-b",
        status: "available",
      },
    ]);
    const routeConfig = createCurrentRoute();
    await expect(
      resolveDispatchWorkingFolderRuntimeContext({
        ...createDispatchIdentityInput(routeConfig),
        defaultProjectId: "project-1",
        defaultProjectIdWasProvided: true,
        executionContext: createProjectExecutionContext(
          selectedFingerprint,
          "project-2"
        ),
        ownerUserId: "user-1",
        nowMs: 10_000,
        routeConfig,
        targetProfileId: "agt-1",
      })
    ).resolves.toEqual({
      providerRuntimeWorkingDirectory: "/tmp/repository-b",
    });
    expect(listProjectConnectionsWithStatus).toHaveBeenCalledWith({
      organizationId: "organization-1",
    });
  });

  it("accepts selected Project work when the Default Project folder is missing while ordinary work remains blocked", async () => {
    const selectedFingerprint = `sha256:${"a".repeat(64)}`;
    const routeConfig = createCurrentRoute();
    routeConfig.workingFolderRuntime = createMissingDefaultFolder(9000);
    resolveCurrentEffectiveProfileWorkingFolderRuntime.mockResolvedValue(
      createMissingDefaultFolder(10_000)
    );
    listProjectConnectionsWithStatus.mockResolvedValue([
      {
        bindingGeneration: "selected-generation",
        boundAtMs: 1,
        isDefault: true,
        organizationId: "organization-1",
        ownerUserId: "user-1",
        projectId: "project-2",
        projectSlug: "selected-project",
        repositoryFingerprint: selectedFingerprint,
        repositoryPath: "/tmp/selected-repository",
        status: "available",
      },
    ]);
    const request = {
      ...createDispatchIdentityInput(routeConfig),
      defaultProjectId: "project-1",
      defaultProjectIdWasProvided: true,
      nowMs: 10_000,
      ownerUserId: "user-1",
      routeConfig,
      targetProfileId: "agt-1",
    };

    await expect(
      resolveDispatchWorkingFolderRuntimeContext({
        ...request,
        executionContext: createProjectExecutionContext(
          selectedFingerprint,
          "project-2"
        ),
      })
    ).resolves.toEqual({
      providerRuntimeWorkingDirectory: "/tmp/selected-repository",
    });
    await expect(
      resolveDispatchWorkingFolderRuntimeContext(request)
    ).rejects.toMatchObject({
      code: "project.local_connection.folder_missing",
    });
    const ledgerRootPath = await realpath(
      await mkdtemp(join(tmpdir(), "openmeld-space-handoff-"))
    );
    try {
      const { projectWork: _projectWork, ...context } =
        createProjectExecutionContext(selectedFingerprint, "project-2");
      const spaceOnly = {
        ...context,
        access: "space_context" as const,
        workspace: "isolated" as const,
      };
      resolveCurrentEffectiveProfileWorkingFolderRuntime.mockClear();
      listProjectConnectionsWithStatus.mockClear();
      const input = {
        ...request,
        ledgerRootPath,
        executionContext: spaceOnly,
        defaultProjectId: "different-unavailable-default",
      };
      const result = await resolveDispatchWorkingFolderRuntimeContext(input);
      expect(result.providerRuntimeWorkingDirectory).toBe(
        join(ledgerRootPath, "execution-context-workspaces", spaceOnly.id)
      );
      expect(
        (await stat(result.providerRuntimeWorkingDirectory)).isDirectory()
      ).toBe(true);
      expect(
        resolveCurrentEffectiveProfileWorkingFolderRuntime
      ).not.toHaveBeenCalled();
      expect(listProjectConnectionsWithStatus).not.toHaveBeenCalled();
      await expect(
        resolveDispatchWorkingFolderRuntimeContext({
          ...input,
          controllerSnapshot: {
            ...input.controllerSnapshot,
            bindingId: "another-binding",
          },
        })
      ).rejects.toMatchObject({
        code: "profile.working_folder.current_fact_identity_mismatch",
      });
    } finally {
      await rm(ledgerRootPath, { recursive: true, force: true });
    }
  });

  it("uses the configured local default among clones and blocks an unresolved clone choice", async () => {
    const fingerprint = `sha256:${"a".repeat(64)}`;
    const routeConfig = createCurrentRoute();
    const clones = [
      {
        bindingGeneration: "clone-a",
        boundAtMs: 1,
        isDefault: false,
        organizationId: "organization-1",
        ownerUserId: "user-1",
        projectId: "project-1",
        projectSlug: "payments",
        repositoryFingerprint: fingerprint,
        repositoryPath: "/tmp/clone-a",
        status: "available" as const,
      },
      {
        bindingGeneration: "clone-b",
        boundAtMs: 2,
        isDefault: true,
        organizationId: "organization-1",
        ownerUserId: "user-1",
        projectId: "project-1",
        projectSlug: "payments",
        repositoryFingerprint: fingerprint,
        repositoryPath: "/tmp/clone-b",
        status: "available" as const,
      },
    ];
    listProjectConnectionsWithStatus.mockResolvedValue(clones);
    const request = {
      ...createDispatchIdentityInput(routeConfig),
      defaultProjectId: "project-1",
      defaultProjectIdWasProvided: true,
      executionContext: createProjectExecutionContext(fingerprint),
      ownerUserId: "user-1",
      nowMs: 10_000,
      routeConfig,
      targetProfileId: "agt-1",
    };
    await expect(
      resolveDispatchWorkingFolderRuntimeContext(request)
    ).resolves.toEqual({
      providerRuntimeWorkingDirectory: "/tmp/clone-b",
    });
    listProjectConnectionsWithStatus.mockResolvedValue([
      { ...clones[0], isDefault: false },
      { ...clones[1], isDefault: false },
      {
        ...clones[1],
        bindingGeneration: "other-repository-default",
        repositoryFingerprint: `sha256:${"b".repeat(64)}`,
        repositoryPath: "/tmp/other-repository",
      },
    ]);
    await expect(
      resolveDispatchWorkingFolderRuntimeContext(request)
    ).rejects.toMatchObject({
      code: "project.local_connection.invalid",
    });
  });

  it("blocks selected code work when no local folder matches its Project and repository", async () => {
    const routeConfig = createCurrentRoute();
    await expect(
      resolveDispatchWorkingFolderRuntimeContext({
        ...createDispatchIdentityInput(routeConfig),
        defaultProjectId: "project-1",
        defaultProjectIdWasProvided: true,
        executionContext: createProjectExecutionContext(
          `sha256:${"b".repeat(64)}`
        ),
        ownerUserId: "user-1",
        nowMs: 10_000,
        routeConfig,
        targetProfileId: "agt-1",
      })
    ).rejects.toMatchObject({ code: "project.local_connection.missing" });
    listProjectConnectionsWithStatus.mockResolvedValue([
      {
        bindingGeneration: "another-owner-binding",
        boundAtMs: 1,
        isDefault: true,
        organizationId: "organization-1",
        ownerUserId: "user-2",
        projectId: "project-1",
        projectSlug: "payments",
        repositoryFingerprint: `sha256:${"b".repeat(64)}`,
        repositoryPath: "/tmp/another-owner-repository",
        status: "available",
      },
    ]);
    await expect(
      resolveDispatchWorkingFolderRuntimeContext({
        ...createDispatchIdentityInput(routeConfig),
        defaultProjectId: "project-1",
        defaultProjectIdWasProvided: true,
        executionContext: createProjectExecutionContext(
          `sha256:${"b".repeat(64)}`
        ),
        ownerUserId: "user-1",
        nowMs: 10_000,
        routeConfig,
        targetProfileId: "agt-1",
      })
    ).rejects.toMatchObject({ code: "project.local_connection.missing" });
  });

  it("rejects a delivered Default Project that disagrees with the current route and requests a refresh", async () => {
    const routeConfig = createCurrentRoute();
    const onCurrentWorkingFolderFactRejected = vi.fn();

    await expect(
      resolveDispatchWorkingFolderRuntimeContext({
        ...createDispatchIdentityInput(routeConfig),
        defaultProjectId: "project-other",
        defaultProjectIdWasProvided: true,
        nowMs: 10_000,
        onCurrentWorkingFolderFactRejected,
        routeConfig,
        targetProfileId: "agt-1",
      })
    ).rejects.toMatchObject({
      code: "profile.working_folder.current_fact_identity_mismatch",
    });
    expect(onCurrentWorkingFolderFactRejected).toHaveBeenCalledOnce();
    expect(
      resolveCurrentEffectiveProfileWorkingFolderRuntime
    ).not.toHaveBeenCalled();
  });
});

function createProjectExecutionContext(
  repositoryFingerprint: string,
  projectId = "project-1"
) {
  return executionContextTaskSchema.parse({
    version: 1,
    id: "11111111-1111-4111-8111-111111111111",
    scope: {
      organizationId: "organization-1",
      requesterProfileId: "human-1",
      spaceId: "space-1",
      targetProfileId: "agt-1",
      threadId: null,
    },
    access: "workspace",
    projectWork: { projectId, repositoryFingerprint },
    workspace: "current",
    nativeConversationId: null,
    runtimeWorkspaceFingerprint: null,
  });
}

function createCurrentRoute(
  overrides: {
    bindingId?: string;
    bindingGeneration?: string;
    configurationRevision?: number;
    observedAtMs?: number;
    repositoryPath?: string;
  } = {}
): DaemonProfileRouteConfig {
  const bindingGeneration = overrides.bindingGeneration ?? "generation-1";
  const repositoryPath =
    overrides.repositoryPath ?? "/tmp/current-default-project";
  return {
    agentControllerRef: "builtin:codex",
    bindingId: overrides.bindingId ?? "binding-1",
    configurationRevision: overrides.configurationRevision ?? 7,
    contextIdMappingSpec: {
      mappingVersion: 1,
      sourceField: "OPENMELD_CLI_CONTEXT_ID",
    },
    openMeldServiceRuntimeId: "runtime-1",
    profileId: "agt-1",
    streamingMode: "final",
    transportMode: "local-cli",
    workingFolderRuntime: {
      configPath: null,
      configuredWorkspacePath: repositoryPath,
      defaultProjectBindingGeneration: bindingGeneration,
      defaultProjectId: "project-1",
      effectiveRuntimeWorkingDirectory: repositoryPath,
      runtimeContext: {
        providerRuntimeWorkingDirectory: repositoryPath,
      },
      status: "ready",
      workingFolderFact: {
        defaultProjectId: "project-1",
        localProjectBindingGeneration: bindingGeneration,
        observedAtMs: overrides.observedAtMs ?? 9000,
        reasonCode: null,
        source: "default_project",
        status: "ready",
      },
      workingFolderSource: "default_project",
      workspaceMode: null,
    },
  };
}

function createCurrentWorkingFolder(
  overrides: { bindingGeneration?: string; repositoryPath?: string } = {}
) {
  const bindingGeneration = overrides.bindingGeneration ?? "generation-1";
  const repositoryPath =
    overrides.repositoryPath ?? "/tmp/current-default-project";
  return {
    configPath: null,
    configuredWorkspacePath: repositoryPath,
    defaultProjectBindingGeneration: bindingGeneration,
    defaultProjectId: "project-1",
    effectiveRuntimeWorkingDirectory: repositoryPath,
    runtimeContext: {
      providerRuntimeWorkingDirectory: repositoryPath,
    },
    status: "ready" as const,
    workingFolderFact: {
      defaultProjectId: "project-1",
      localProjectBindingGeneration: bindingGeneration,
      observedAtMs: 10_000,
      reasonCode: null,
      source: "default_project" as const,
      status: "ready" as const,
    },
    workingFolderSource: "default_project" as const,
    workspaceMode: null,
  };
}

function createMissingDefaultFolder(observedAtMs: number) {
  return {
    configPath: null,
    configuredWorkspacePath: "/tmp/missing-default-project",
    defaultProjectBindingGeneration: "generation-1",
    defaultProjectFailureReason: "folder_missing" as const,
    defaultProjectId: "project-1",
    reasonCode: "workspace.missing" as const,
    reasonText: "missing",
    status: "missing" as const,
    workingFolderFact: {
      defaultProjectId: "project-1",
      localProjectBindingGeneration: "generation-1",
      observedAtMs,
      reasonCode: "project.local_connection.folder_missing" as const,
      source: "default_project" as const,
      status: "missing" as const,
    },
    workingFolderSource: "default_project" as const,
    workspaceMode: null,
  };
}

function createCurrentProfileWorkspaceRoute(
  overrides: { repositoryPath?: string } = {}
): DaemonProfileRouteConfig {
  const repositoryPath =
    overrides.repositoryPath ?? "/tmp/current-profile-workspace";
  const route = createCurrentRoute();
  route.workingFolderRuntime = {
    configPath: "/tmp/profile-workspace.json",
    configuredWorkspacePath: repositoryPath,
    effectiveRuntimeWorkingDirectory: repositoryPath,
    runtimeContext: {
      providerRuntimeWorkingDirectory: repositoryPath,
    },
    status: "ready",
    workingFolderFact: {
      defaultProjectId: null,
      localProjectBindingGeneration: null,
      observedAtMs: 9000,
      reasonCode: null,
      source: "profile_workspace",
      status: "ready",
    },
    workingFolderSource: "profile_workspace",
    workspaceMode: "custom",
  };
  return route;
}

function createCurrentProfileWorkspace(
  overrides: { repositoryPath?: string } = {}
) {
  const repositoryPath =
    overrides.repositoryPath ?? "/tmp/current-profile-workspace";
  return {
    configPath: "/tmp/profile-workspace.json",
    configuredWorkspacePath: repositoryPath,
    effectiveRuntimeWorkingDirectory: repositoryPath,
    runtimeContext: {
      providerRuntimeWorkingDirectory: repositoryPath,
    },
    status: "ready" as const,
    workingFolderFact: {
      defaultProjectId: null,
      localProjectBindingGeneration: null,
      observedAtMs: 10_000,
      reasonCode: null,
      source: "profile_workspace" as const,
      status: "ready" as const,
    },
    workingFolderSource: "profile_workspace" as const,
    workspaceMode: "custom" as const,
  };
}

function createDispatchIdentityInput(routeConfig = createCurrentRoute()) {
  return {
    controllerSnapshot: {
      agentControllerRef: "builtin:codex",
      bindingId: "binding-1",
      configurationRevision: 7,
      targetBindingEnabled: true,
      targetBindingState: "bound" as const,
    },
    executionIdentity: {
      authority: "core_runtime_registry_binding_route" as const,
      core: {
        agentControllerRef: "builtin:codex",
        bindingId: "binding-1",
        dispatchId: "dispatch-1",
        modelVersion: "openmeld.runtime.execution_identity.v1" as const,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority" as const,
          value: "runtime-1",
        },
        spaceId: "space-1",
        targetProfileId: routeConfig.profileId,
      },
    },
  };
}
