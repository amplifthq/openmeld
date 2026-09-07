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

    const response = await updateAgentProfileRuntimeSettingsOperation({
      deps: {
        checkAgentProfileReadiness: vi.fn(),
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
          message: "Local OpenMeld Service could not set the Project folder.",
          name: "update_agent_profile_workspace",
          status: "failed",
        },
      ],
    });
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
    generatedAt: NOW_ISO,
    inventory: createLocalRuntimesResponse(),
    ownerService: {
      online: true,
      sessions: [
        {
          daemonSessionId: "session_1",
          deviceId: "device_1",
          lane: "dev-local",
          serviceVersion: "0.3.163",
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
