import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonProfileRouteConfig } from "../src/local-service/core/types";
import {
  CURRENT_ROUTE_WORKING_FOLDER_FRESHNESS_MS,
  resolveDispatchRuntimeContext,
  resolveDispatchWorkingFolderRuntimeContext,
} from "../src/local-service/execution/dispatch-runtime-preparation";

const {
  resolveCurrentEffectiveProfileWorkingFolderRuntime,
  resolveEffectiveProfileWorkingFolderRuntime,
} = vi.hoisted(() => ({
  resolveCurrentEffectiveProfileWorkingFolderRuntime: vi.fn(),
  resolveEffectiveProfileWorkingFolderRuntime: vi.fn(),
}));
const CURRENT_WORKING_FOLDER_FACT_ERROR_PATTERN =
  /^profile\.working_folder\.current_fact_/u;

vi.mock("../src/profile-workspace/effective-runtime-resolution", () => ({
  resolveCurrentEffectiveProfileWorkingFolderRuntime,
  resolveEffectiveProfileWorkingFolderRuntime,
}));

describe("dispatch runtime working folder", () => {
  beforeEach(() => {
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

  it("keeps the explicit Default Project path on the canonical resolver", async () => {
    resolveEffectiveProfileWorkingFolderRuntime.mockResolvedValue({
      defaultProjectId: "project-explicit",
      effectiveRuntimeWorkingDirectory: "/tmp/project-explicit",
      runtimeContext: {
        providerRuntimeWorkingDirectory: "/tmp/project-explicit",
      },
      status: "ready",
      workingFolderSource: "default_project",
    });

    await expect(
      resolveDispatchWorkingFolderRuntimeContext({
        ...createDispatchIdentityInput(),
        defaultProjectId: "project-explicit",
        defaultProjectIdWasProvided: true,
        routeConfig: null,
        targetProfileId: "agt-1",
      })
    ).resolves.toEqual({
      providerRuntimeWorkingDirectory: "/tmp/project-explicit",
    });
    expect(resolveEffectiveProfileWorkingFolderRuntime).toHaveBeenCalledWith({
      defaultProjectId: "project-explicit",
      mode: "dispatch",
      openMeldProfileId: "agt-1",
    });
  });
});

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
