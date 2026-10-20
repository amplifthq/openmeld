import {
  type AgentWakeRouteRegistration,
  buildLocalAgentConnectionCandidateId,
  createAgentProfileBindingDisplayProjection,
  resolveAgentExecutionStatus,
  resolveAgentWakeAvailability,
  type WakeRouteStatus,
} from "@openmeld/agent-runtime";
import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  centerAgentCheckAgentProfileReadinessResponseSchema,
  createDaemonRouteObservationSummary,
  getAgentExecutionReadinessResponseSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentCheckAgentProfileReadinessResponse,
  CenterAgentLocalAgentConnectionCandidate,
  EnsureAgentProfilePrimaryBindingResponse,
  LocalRuntimesResponse,
  PeopleComputersResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  buildCenterAgentReadinessResponse,
  connectAgentProfileToLocalAgentOperation,
  projectCenterAgentComputerSetupOptions,
  projectCenterAgentLocalAgentConnectionCandidates,
  updateAgentProfileRuntimeSettingsOperation,
} from "../src/center-agent/application/product-operations";
import { projectPeopleComputers } from "../src/people-computers/projection";
import { createPublishedLocalComponentsRelease } from "../test-support/published-local-components-release";

const ORGANIZATION_ID = "org_11111111-1111-4111-8111-111111111111";
const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const NOW_ISO = "2026-07-08T00:00:00.000Z";

describe("Center Agent product operations", () => {
  it("does not offer a historical ready report on a disconnected computer", () => {
    const peopleComputers = createPeopleComputersResponse();
    const computer = peopleComputers.computers[0];
    if (!computer) {
      throw new Error("Missing fixture computer.");
    }
    computer.connection = {
      status: "disconnected",
      sessions: [],
      reasonCodes: ["daemon.session.not_found"],
    };
    expect(
      projectCenterAgentLocalAgentConnectionCandidates({
        peopleComputers,
        organizationId: ORGANIZATION_ID,
      }).candidates[0]?.connectable
    ).toBe(false);
  });

  it("requires the exact target lane and a supported live Service", () => {
    const peopleComputers = createPeopleComputersResponse();
    const session = peopleComputers.computers[0]?.connection.sessions[0];
    if (!session) {
      throw new Error("Missing fixture connection.");
    }
    session.runtimeLane = "prod";
    expect(
      projectCenterAgentLocalAgentConnectionCandidates({
        peopleComputers,
        organizationId: ORGANIZATION_ID,
      }).candidates[0]?.connectable
    ).toBe(false);
    session.runtimeLane = "dev-local";
    session.serviceUpdate = {
      wakeBlocked: true,
      reasonCodes: ["service.update_required"],
    };
    expect(
      projectCenterAgentLocalAgentConnectionCandidates({
        peopleComputers,
        organizationId: ORGANIZATION_ID,
      }).candidates[0]
    ).toMatchObject({
      connectable: false,
      reasonCodes: expect.arrayContaining(["service.update_required"]),
    });
  });
  it("projects local agent connection candidates from Core runtime reports", () => {
    const response = projectCenterAgentLocalAgentConnectionCandidates({
      peopleComputers: createPeopleComputersResponse(),
      organizationId: ORGANIZATION_ID,
    });

    expect(response).toEqual({
      candidates: [
        expect.objectContaining({
          agentControllerRef: "builtin:codex",
          agentDisplayName: "Codex",
          candidateId: buildLocalAgentConnectionCandidateId({
            agentControllerRef: "builtin:codex",
            deviceId: "device_1",
            runtimeLane: "dev-local",
            openMeldServiceRuntimeId: "runtime_1",
          }),
          connectable: true,
          deviceDisplayName: "Felix MacBook Pro",
          freshness: "fresh",
          status: "ready",
        }),
      ],
      organizationId: ORGANIZATION_ID,
    });
    expect(response.candidates[0]).not.toHaveProperty("modelOptions");
    const modelOptions = {
      defaultModelId: "test-model",
      models: [
        {
          id: "test-model",
          displayName: "Test Model",
          supportedReasoningLevels: ["medium", "high"],
          minCliVersion: null,
          unavailable: false,
        },
      ],
    };
    const withModels = projectCenterAgentLocalAgentConnectionCandidates({
      peopleComputers: createPeopleComputersResponse(),
      organizationId: ORGANIZATION_ID,
      modelCatalog: {
        schemaVersion: 1,
        updatedAt: NOW_ISO,
        agentControllers: { codex: modelOptions },
      },
    });
    expect(withModels.candidates[0]?.modelOptions).toEqual(modelOptions);
  });

  it("keeps another controller's sign-in failure out of a ready candidate", () => {
    const peopleComputers = createPeopleComputersResponse();
    const target = peopleComputers.computers[0]?.executionTargets[0];
    if (!target) {
      throw new Error("Missing fixture execution target.");
    }
    const authReasons = [
      "provider_account.access_required",
      "controller.auth.unauthenticated",
    ];
    target.capabilities.push({
      agentControllerRef: "builtin:claude-code",
      enabled: true,
      reasonCodes: authReasons,
      status: "not_ready",
    });
    // Runtime reasons aggregate the enabled controllers, including Claude.
    target.status = "partial";
    target.reasonCodes = authReasons;
    const connectionReasons =
      peopleComputers.computers[0]?.connection.sessions[0]?.serviceUpdate
        .reasonCodes ?? [];

    const { candidates } = projectCenterAgentLocalAgentConnectionCandidates({
      peopleComputers,
      organizationId: ORGANIZATION_ID,
    });
    expect(
      candidates.find((item) => item.agentControllerRef === "builtin:codex")
    ).toMatchObject({
      connectable: true,
      status: "ready",
      reasonCodes: connectionReasons,
    });
    expect(
      candidates.find(
        (item) => item.agentControllerRef === "builtin:claude-code"
      )
    ).toMatchObject({
      connectable: false,
      status: "not_ready",
      reasonCodes: [...connectionReasons, ...authReasons],
    });
  });

  it("projects update and reconnect actions from current computer truth", () => {
    const updateRequired = createPeopleComputersResponse();
    const updateComputer = updateRequired.computers[0];
    const updateTarget = updateComputer?.executionTargets[0];
    if (!(updateComputer && updateTarget)) {
      throw new Error("Expected one computer and one execution target.");
    }
    updateComputer.connectedComputerId = "computer_1";
    updateTarget.reasonCodes = ["service.update_required"];

    expect(projectCenterAgentComputerSetupOptions(updateRequired)).toEqual([
      expect.objectContaining({
        connectedComputerId: "computer_1",
        reasonCodes: expect.arrayContaining(["service.update_required"]),
        recommendedMode: "update_service",
        status: "needs_attention",
      }),
    ]);

    updateTarget.reasonCodes = [];
    updateTarget.status = "stale";
    updateComputer.connection = {
      status: "disconnected",
      reasonCodes: ["daemon.session.not_found"],
      sessions: [],
    };

    expect(projectCenterAgentComputerSetupOptions(updateRequired)).toEqual([
      expect.objectContaining({
        connectedComputerId: "computer_1",
        recommendedMode: "reconnect",
        status: "needs_attention",
      }),
    ]);
  });

  it("connects an Agent Profile to a selected local agent and returns reply readiness", async () => {
    const candidate = createCandidate();
    const binding = acceptedBindingResponse();
    const readiness = readyReadinessResponse();
    const deps = {
      checkAgentProfileReadiness: vi.fn(() => Promise.resolve(readiness)),
      ensureAgentProfilePrimaryBinding: vi.fn(() => Promise.resolve(binding)),
      listLocalAgentConnectionCandidates: vi.fn(() =>
        Promise.resolve({
          candidates: [candidate],
          organizationId: ORGANIZATION_ID,
        })
      ),
    };

    const response = await connectAgentProfileToLocalAgentOperation({
      deps,
      request: {
        agentControllerPermissionMode: "codex:askForApproval",
        agentProfileId: AGENT_PROFILE_ID,
        candidateId: candidate.candidateId,
        modelId: "gpt-5.5-codex",
      },
    });

    expect(deps.ensureAgentProfilePrimaryBinding).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      candidate,
      settings: {
        agentControllerPermissionMode: "codex:askForApproval",
        modelId: "gpt-5.5-codex",
      },
    });
    expect(deps.checkAgentProfileReadiness).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
    });
    expect(response).toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      binding,
      canReply: true,
      candidate,
      readiness,
      status: "completed",
      steps: [
        {
          name: "select_local_agent_connection_candidate",
          status: "completed",
        },
        { name: "connect_agent_profile_to_local_agent", status: "completed" },
        { name: "check_agent_profile_readiness", status: "completed" },
      ],
    });
  });

  it("returns candidate and failed step details when a Binding write is rejected", async () => {
    const candidate = createCandidate();
    const binding = rejectedBindingResponse();
    const checkAgentProfileReadiness = vi.fn();

    const response = await connectAgentProfileToLocalAgentOperation({
      deps: {
        checkAgentProfileReadiness,
        ensureAgentProfilePrimaryBinding: vi.fn(() => Promise.resolve(binding)),
        listLocalAgentConnectionCandidates: vi.fn(() =>
          Promise.resolve({
            candidates: [candidate],
            organizationId: ORGANIZATION_ID,
          })
        ),
      },
      request: {
        agentProfileId: AGENT_PROFILE_ID,
        candidateId: candidate.candidateId,
      },
    });

    expect(checkAgentProfileReadiness).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      binding,
      canReply: false,
      candidate,
      status: "blocked",
      steps: [
        {
          name: "select_local_agent_connection_candidate",
          status: "completed",
        },
        {
          message:
            "Binding was rejected: agent_profile_binding.authorization_required.",
          name: "connect_agent_profile_to_local_agent",
          nextAction:
            "Review the returned Binding reason codes, then reconnect this Agent Profile.",
          status: "failed",
        },
      ],
    });
  });

  it("blocks Binding writes when the selected candidate is not connectable", async () => {
    const candidate = {
      ...createCandidate(),
      connectable: false,
      freshness: "stale",
      reasonCodes: ["runtime.local_agent_report.stale"],
      status: "stale",
    } satisfies CenterAgentLocalAgentConnectionCandidate;
    const ensureAgentProfilePrimaryBinding = vi.fn();

    const response = await connectAgentProfileToLocalAgentOperation({
      deps: {
        checkAgentProfileReadiness: vi.fn(),
        ensureAgentProfilePrimaryBinding,
        listLocalAgentConnectionCandidates: vi.fn(() =>
          Promise.resolve({
            candidates: [candidate],
            organizationId: ORGANIZATION_ID,
          })
        ),
      },
      request: {
        agentProfileId: AGENT_PROFILE_ID,
        candidateId: candidate.candidateId,
      },
    });

    expect(ensureAgentProfilePrimaryBinding).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      canReply: false,
      candidate,
      status: "blocked",
      steps: [
        {
          name: "select_local_agent_connection_candidate",
          status: "completed",
        },
        {
          name: "connect_agent_profile_to_local_agent",
          nextAction:
            "Refresh local agents on that computer, then choose a ready candidate.",
          status: "failed",
        },
      ],
    });
  });

  it("reports partial progress when runtime settings fail after a successful Binding update", async () => {
    const binding = acceptedBindingResponse();
    const setAgentProfileDefaultProject = vi.fn();

    const response = await updateAgentProfileRuntimeSettingsOperation({
      deps: {
        checkAgentProfileReadiness: vi.fn(),
        setAgentProfileDefaultProject,
        setAgentProfileWorkspace: vi.fn(() =>
          Promise.reject(
            new Error(
              "Local OpenMeld Service could not set the Project folder."
            )
          )
        ),
        updateAgentControllerCollaborationMode: vi.fn(),
        updateAgentControllerPermissionMode: vi.fn(),
        updateModelSelection: vi.fn(() => Promise.resolve(binding)),
        updateOpenCodePermission: vi.fn(),
      },
      organizationId: ORGANIZATION_ID,
      request: {
        agentProfileId: AGENT_PROFILE_ID,
        modelId: "gpt-5.5-codex",
        workspaceMode: "custom",
        workspacePath: "/Users/felix/work/openmeld",
      },
    });

    expect(response).toMatchObject({
      binding,
      canReply: false,
      status: "blocked",
      steps: [
        {
          name: "update_agent_profile_runtime_settings",
          status: "completed",
        },
        {
          message:
            "The working folder could not be saved on the target Computer.",
          name: "update_agent_profile_workspace",
          status: "failed",
        },
      ],
    });
    expect(setAgentProfileDefaultProject).not.toHaveBeenCalled();
  });

  it.each([
    "custom",
    "openmeld_managed",
  ] as const)("makes the %s folder effective without returning private local facts", async (workspaceMode) => {
    const calls: string[] = [];
    const setAgentProfileDefaultProject = vi.fn(() => {
      calls.push("clear_project");
      return Promise.resolve();
    });
    const response = await updateAgentProfileRuntimeSettingsOperation({
      deps: {
        checkAgentProfileReadiness: vi.fn(() => {
          calls.push("read_readiness");
          return Promise.resolve(readyReadinessResponse());
        }),
        setAgentProfileDefaultProject,
        setAgentProfileWorkspace: () => {
          calls.push("save_folder");
          return Promise.resolve({
            agentProfileId: AGENT_PROFILE_ID,
            status: "updated",
            workspaceMode,
            workspacePath: "/private/test-account/repository",
          });
        },
        updateAgentControllerCollaborationMode: vi.fn(),
        updateAgentControllerPermissionMode: vi.fn(),
        updateModelSelection: vi.fn(),
        updateOpenCodePermission: vi.fn(),
      },
      organizationId: ORGANIZATION_ID,
      request: {
        agentProfileId: AGENT_PROFILE_ID,
        workspaceMode,
        ...(workspaceMode === "custom"
          ? { workspacePath: "/private/test-account/repository" }
          : {}),
      },
    });
    expect(calls).toEqual(["save_folder", "clear_project", "read_readiness"]);
    expect(setAgentProfileDefaultProject).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      defaultProjectId: null,
    });
    expect(response.workspace).toEqual({
      agentProfileId: AGENT_PROFILE_ID,
      status: "updated",
      configurationVersion: null,
    });
    expect(response.status).toBe("completed");
    expect(JSON.stringify(response)).not.toContain("/private/test-account");
  });

  it("sets the default folder by id, then clears Default Project as the second write", async () => {
    const calls: string[] = [];
    const setAgentProfileDefaultFolder = vi.fn(() => {
      calls.push("set_default_folder");
      return Promise.resolve({
        agentProfileId: AGENT_PROFILE_ID,
        status: "updated" as const,
        target: { deviceId: "device-1", runtimeLane: "prod" as const },
      });
    });
    const response = await updateAgentProfileRuntimeSettingsOperation({
      deps: {
        checkAgentProfileReadiness: vi.fn(() => {
          calls.push("read_readiness");
          return Promise.resolve(readyReadinessResponse());
        }),
        setAgentProfileDefaultFolder,
        setAgentProfileDefaultProject: vi.fn(() => {
          calls.push("clear_project");
          return Promise.resolve();
        }),
        setAgentProfileWorkspace: vi.fn(),
        updateAgentControllerCollaborationMode: vi.fn(),
        updateAgentControllerPermissionMode: vi.fn(),
        updateModelSelection: vi.fn(),
        updateOpenCodePermission: vi.fn(),
      },
      organizationId: ORGANIZATION_ID,
      request: {
        agentProfileId: AGENT_PROFILE_ID,
        defaultFolderId: "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11",
      },
    });
    expect(setAgentProfileDefaultFolder).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      folderId: "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11",
    });
    expect(calls).toEqual([
      "set_default_folder",
      "clear_project",
      "read_readiness",
    ]);
    expect(response).toMatchObject({
      status: "completed",
      steps: [
        {
          message: "Default folder was saved on the local Computer.",
          name: "update_agent_profile_workspace",
          status: "completed",
        },
        { name: "update_agent_profile_default_project", status: "completed" },
        { name: "check_agent_profile_readiness", status: "completed" },
      ],
      workspace: {
        agentProfileId: AGENT_PROFILE_ID,
        configurationVersion: null,
        status: "updated",
        target: { deviceId: "device-1", runtimeLane: "prod" },
      },
    });
  });

  it("does not clear Default Project when the default folder id is refused", async () => {
    const setAgentProfileDefaultProject = vi.fn();
    const response = await updateAgentProfileRuntimeSettingsOperation({
      deps: {
        checkAgentProfileReadiness: vi.fn(),
        setAgentProfileDefaultFolder: vi.fn(() =>
          Promise.reject(
            Object.assign(new Error("folder not found"), {
              code: "profile_folder.not_found",
            })
          )
        ),
        setAgentProfileDefaultProject,
        setAgentProfileWorkspace: vi.fn(),
        updateAgentControllerCollaborationMode: vi.fn(),
        updateAgentControllerPermissionMode: vi.fn(),
        updateModelSelection: vi.fn(),
        updateOpenCodePermission: vi.fn(),
      },
      organizationId: ORGANIZATION_ID,
      request: {
        agentProfileId: AGENT_PROFILE_ID,
        defaultFolderId: "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11",
      },
    });
    expect(response.status).toBe("blocked");
    expect(response.steps).toContainEqual(
      expect.objectContaining({
        name: "update_agent_profile_workspace",
        status: "failed",
      })
    );
    expect(setAgentProfileDefaultProject).not.toHaveBeenCalled();
  });

  it("updates Codex Collaboration Mode as an independent runtime setting", async () => {
    const binding = acceptedBindingResponse();
    const updateAgentControllerCollaborationMode = vi.fn(() =>
      Promise.resolve(binding)
    );

    const response = await updateAgentProfileRuntimeSettingsOperation({
      deps: {
        checkAgentProfileReadiness: vi.fn(() =>
          Promise.resolve(readyReadinessResponse())
        ),
        setAgentProfileWorkspace: vi.fn(),
        updateAgentControllerCollaborationMode,
        updateAgentControllerPermissionMode: vi.fn(),
        updateModelSelection: vi.fn(),
        updateOpenCodePermission: vi.fn(),
      },
      organizationId: ORGANIZATION_ID,
      request: {
        agentControllerCollaborationMode: "codex:plan",
        agentProfileId: AGENT_PROFILE_ID,
      },
    });

    expect(updateAgentControllerCollaborationMode).toHaveBeenCalledWith({
      agentControllerCollaborationMode: "codex:plan",
      agentProfileId: AGENT_PROFILE_ID,
    });
    expect(response).toMatchObject({
      binding,
      canReply: true,
      status: "completed",
    });
  });

  it("reports a saved folder as partial setup when Default Project cannot be cleared", async () => {
    const checkAgentProfileReadiness = vi.fn();
    const response = await updateAgentProfileRuntimeSettingsOperation({
      deps: {
        checkAgentProfileReadiness,
        setAgentProfileDefaultProject: () =>
          Promise.reject(
            new Error("Private diagnostic: /private/test-account/repository")
          ),
        setAgentProfileWorkspace: () =>
          Promise.resolve({
            agentProfileId: AGENT_PROFILE_ID,
            status: "updated",
            workspaceMode: "custom",
            workspacePath: "/private/test-account/repository",
          }),
        updateAgentControllerCollaborationMode: vi.fn(),
        updateAgentControllerPermissionMode: vi.fn(),
        updateModelSelection: vi.fn(),
        updateOpenCodePermission: vi.fn(),
      },
      organizationId: ORGANIZATION_ID,
      request: {
        agentProfileId: AGENT_PROFILE_ID,
        workspaceMode: "custom",
        workspacePath: "/private/test-account/repository",
      },
    });
    expect(checkAgentProfileReadiness).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      status: "blocked",
      canReply: false,
      workspace: { agentProfileId: AGENT_PROFILE_ID, status: "updated" },
      steps: [
        { name: "update_agent_profile_workspace", status: "completed" },
        { name: "update_agent_profile_default_project", status: "failed" },
      ],
    });
    expect(JSON.stringify(response)).not.toContain("/private/test-account");
  });
});

function createLocalRuntimesResponse(): LocalRuntimesResponse {
  return {
    currentDeviceId: "device_1",
    currentRuntimeLane: "dev-local",
    localRuntimes: [
      {
        deviceDisplayName: "Felix MacBook Pro",
        deviceDisplayNameSource: "observed",
        deviceId: "device_1",
        deviceType: "laptop",
        executionTargets: [
          {
            capabilities: [
              {
                agentControllerInterface: {
                  agentControllerRef: "builtin:codex",
                  auth: { status: "authenticated" },
                  capabilities: {
                    approvals: true,
                    cancel: true,
                    interrupt: true,
                    modelSelection: true,
                    nativeEventStream: true,
                    permissionModes: true,
                    structuredUserInput: true,
                  },
                  checkedAt: NOW_ISO,
                  controllerId: "codex",
                  displayName: "Codex",
                  launch: {
                    argsPrefix: [],
                    commandPath: "/Applications/Codex.app/Contents/MacOS/Codex",
                    installChoiceCount: 1,
                    status: "ready",
                  },
                  message: null,
                  models: [],
                  nativeInterface: "codex-app-server",
                  schemaVersion: 1,
                  skills: [],
                  status: "ready",
                  version: "1.0.0",
                },
                agentControllerRef: "builtin:codex",
                enabled: true,
                reasonCodes: [],
                status: "ready",
              },
            ],
            deviceId: "device_1",
            isCurrent: true,
            lastObservedAtMs: 1000,
            localAgentCatalog: {
              detectedNotSupportedYet: 0,
              detectedSupported: 0,
              entries: [],
              needsChoice: 0,
              needsRepair: 0,
              notDetected: 0,
              totalBuiltins: 0,
            },
            localAgentControl: {
              refreshCatalog: true,
              setEnabled: true,
              setProfileWorkspace: true,
            },
            reasonCodes: [],
            runtimeLane: "dev-local",
            status: "ready",
            userFacingCommand: "openmeld-dev",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_1",
            },
          },
        ],
        firstSeenAtMs: 500,
        isCurrent: true,
        lastObservedAtMs: 1000,
        osVersion: "15.6",
        platformFamily: "macOS",
      },
    ],
  };
}

function createPeopleComputersResponse(): PeopleComputersResponse {
  return projectPeopleComputers({
    localComponentsRelease: createPublishedLocalComponentsRelease(),
    generatedAt: NOW_ISO,
    inventory: createLocalRuntimesResponse(),
    ownerService: {
      online: true,
      sessions: [
        {
          daemonSessionId: "session_1",
          deviceId: "device_1",
          lane: "dev-local",
          serviceVersion: "999.0.0",
          connectionGeneration: 1,
          lastHeartbeatMs: 1000,
          capabilities: {},
          executionCompatibility: {
            status: "compatible",
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            reasonCode: "daemon.runtime_contract.compatible",
          },
        },
      ],
    },
  });
}

function createCandidate(): CenterAgentLocalAgentConnectionCandidate {
  const candidate = projectCenterAgentLocalAgentConnectionCandidates({
    peopleComputers: createPeopleComputersResponse(),
    organizationId: ORGANIZATION_ID,
  }).candidates[0];
  if (!candidate) {
    throw new Error(
      "Expected the test local runtime to project one candidate."
    );
  }
  return candidate;
}

function acceptedBindingResponse(): EnsureAgentProfilePrimaryBindingResponse {
  return {
    binding: {
      agentControllerPermissionMode: "codex:askForApproval",
      agentProfileId: AGENT_PROFILE_ID,
      authoritySource: "binding_truth",
      bindingId: "binding_1",
      bindingState: "enabled_primary",
      dispatchEligibility: {
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        status: "routable",
      },
      executionTarget: {
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_1",
        },
      },
      grantsClaimSuccess: false,
      modelSelection: {
        modelId: "gpt-5.5-codex",
      },
      reasonCodes: ["agent_profile_binding.command_eligible"],
      resolutionSource: "binding_truth",
      routable: true,
    },
    grantsClaimSuccess: false,
    outcome: "created",
    reasonCodes: ["agent_profile_binding.command_eligible"],
    routable: true,
    status: "accepted",
  };
}

function rejectedBindingResponse(): EnsureAgentProfilePrimaryBindingResponse {
  return {
    grantsClaimSuccess: false,
    reasonCodes: ["agent_profile_binding.authorization_required"],
    routable: false,
    status: "rejected",
  };
}

function readyReadinessResponse(): CenterAgentCheckAgentProfileReadinessResponse {
  const wakeRouteStatus: WakeRouteStatus = {
    connectionGeneration: 1,
    daemonSessionId: "daemon-session-1",
    deviceId: "device_1",
    lane: "dev-local",
    lastHeartbeatMs: 1000,
    leaseEpoch: 1,
    status: "ready",
  };
  const agentWakeRouteRegistration: AgentWakeRouteRegistration = {
    daemonSessionId: "daemon-session-1",
    deviceId: "device_1",
    lane: "dev-local",
    reasonCode: null,
    reportedAtMs: 1000,
    serviceVersion: "1.0.0",
    status: "registered",
  };
  const primaryBinding = readinessBinding();
  const agentExecutionReadiness = resolveAgentExecutionStatus({
    agentProfileId: AGENT_PROFILE_ID,
    binding: primaryBinding,
    localService: {
      reachable: true,
      refreshable: true,
      reasonCodes: ["service.ready"],
      source: "runtime_transport",
    },
    profile: {
      active: true,
      reasonCodes: [],
      source: "profile_identity",
    },
    route: {
      deviceId: "device_1",
      observedAt: NOW_ISO,
      status: "online",
    },
    runtimeReadiness: {
      displayState: "ready",
      ready: true,
      reasonCodes: ["runtime.ready"],
    },
    service: {
      executionCompatible: true,
      expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      reasonCodes: [],
      source: "runtime_transport",
    },
  });
  const readiness = getAgentExecutionReadinessResponseSchema.parse({
    agentControllerRef: "builtin:codex",
    agentExecutionReadiness,
    agentProfileId: AGENT_PROFILE_ID,
    agentWakeAvailability: resolveAgentWakeAvailability({
      agentWakeRouteRegistration,
      readiness: agentExecutionReadiness,
      wakeRouteStatus,
    }),
    agentWakeRouteRegistration,
    generatedAt: NOW_ISO,
    ownerUserId: "user_1",
    primaryBinding: null,
    primaryActionPlan: {
      action: "none",
      target: null,
    },
    profileName: "Codex Agent",
    routeDeviceId: "device_1",
    routeLane: "dev-local",
    runtimeDeviceDisplayName: "Felix MacBook Pro",
    wakeRouteEvidence: createDaemonRouteObservationSummary({
      observedAt: NOW_ISO,
      reasonCode: "online",
      status: "online",
    }),
    wakeRouteStatus,
  });

  return centerAgentCheckAgentProfileReadinessResponseSchema.parse(
    buildCenterAgentReadinessResponse({
      organizationId: ORGANIZATION_ID,
      readiness,
    })
  );
}

function readinessBinding() {
  return createAgentProfileBindingDisplayProjection({
    agentProfileId: AGENT_PROFILE_ID,
    bindingId: "binding_1",
    bindingState: "enabled_primary",
    executionTarget: {
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime_1",
    },
  });
}
