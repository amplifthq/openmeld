import {
  type AgentWakeRouteRegistration,
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
  setCurrentAgentProfileWorkspaceResponseSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentCheckAgentProfileReadinessResponse,
  CenterAgentCreateAgentProfileResponse,
  CenterAgentLocalAgentConnectionCandidate,
  CenterAgentProductOperationStep,
  EnsureAgentProfilePrimaryBindingResponse,
  LocalRuntimesResponse,
  SetCurrentAgentProfileWorkspaceResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  buildCenterAgentLocalAgentConnectionCandidateId,
  buildCenterAgentReadinessResponse,
  type CenterAgentProductOperationDeps,
  connectAgentProfileToLocalAgentOperation,
  createConfiguredAgentProfileOperation,
  projectCenterAgentComputerSetupOptions,
  projectCenterAgentLocalAgentConnectionCandidates,
  updateAgentProfileRuntimeSettingsOperation,
} from "../src/center-agent/application/product-operations";
import { createCoreRpcHttpError } from "../src/rpc/errors";

const ORGANIZATION_ID = "org_11111111-1111-4111-8111-111111111111";
const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const NOW_ISO = "2026-07-08T00:00:00.000Z";

describe("Center Agent product operations", () => {
  it("projects local agent connection candidates from Core runtime reports", () => {
    const response = projectCenterAgentLocalAgentConnectionCandidates({
      localRuntimes: createLocalRuntimesResponse(),
      organizationId: ORGANIZATION_ID,
    });

    expect(response).toEqual({
      candidates: [
        expect.objectContaining({
          agentControllerRef: "builtin:codex",
          agentDisplayName: "Codex",
          candidateId: buildCenterAgentLocalAgentConnectionCandidateId({
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
    const updateRequired = createLocalRuntimesResponse();
    const updateComputer = updateRequired.localRuntimes[0];
    const updateTarget = updateComputer?.executionTargets[0];
    if (!(updateComputer && updateTarget)) {
      throw new Error("Expected one computer and one execution target.");
    }
    updateComputer.connectedComputerId = "computer_1";
    updateComputer.connectionStatus = "connected";
    updateTarget.reasonCodes = ["service.update_required"];

    expect(projectCenterAgentComputerSetupOptions(updateRequired)).toEqual([
      expect.objectContaining({
        connectedComputerId: "computer_1",
        reasonCodes: ["service.update_required"],
        recommendedMode: "update_service",
        status: "needs_attention",
      }),
    ]);

    updateTarget.reasonCodes = [];
    updateTarget.status = "stale";

    expect(projectCenterAgentComputerSetupOptions(updateRequired)).toEqual([
      expect.objectContaining({
        connectedComputerId: "computer_1",
        recommendedMode: "reconnect",
        status: "needs_attention",
      }),
    ]);
  });

  it("maps candidate preflight failures to a stable structured error before setup starts", async () => {
    const createAgentProfile = vi.fn();
    const sourceError = new Error("Local runtime inventory read failed.");
    const operation = createConfiguredAgentProfileOperation({
      deps: {
        addAgentProfileToSpace: vi.fn(),
        authorizeAgentProfileForOrganization: vi.fn(),
        checkAgentProfileReadiness: vi.fn(),
        createAgentProfile,
        enableAgentProfile: vi.fn(),
        ensureAgentProfilePrimaryBinding: vi.fn(),
        listLocalAgentConnectionCandidates: vi.fn(() =>
          Promise.reject(sourceError)
        ),
        setAgentProfileWorkspace: vi.fn(),
        updateAgentControllerCollaborationMode: vi.fn(),
        updateAgentControllerPermissionMode: vi.fn(),
        updateModelSelection: vi.fn(),
        updateOpenCodePermission: vi.fn(),
      },
      request: {
        candidateId: createCandidate().candidateId,
        profileName: "Codex Agent",
        spaceId: SPACE_ID,
      },
    });

    await expect(operation).rejects.toMatchObject({
      code: "center_agent.local_agent_connection_candidates_unavailable",
      message:
        'HTTP 503: {"ok":false,"error":{"code":"center_agent.local_agent_connection_candidates_unavailable","message":"Local agent connection candidates are unavailable: Local runtime inventory read failed."}}',
      stack: expect.stringContaining(sourceError.stack ?? sourceError.message),
      status: 503,
    });
    expect(createAgentProfile).not.toHaveBeenCalled();
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

  it("adds the Agent Profile to the Space before reporting route.not_registered readiness", async () => {
    const candidate = createCandidate();
    const binding = acceptedBindingResponse();
    const readiness = routeNotRegisteredReadinessResponse();
    const workspace = workspaceResponse();
    const calls: string[] = [];
    const addAgentProfileToSpace = vi.fn(() => {
      calls.push("add_agent_profile_to_space");
      return Promise.resolve();
    });
    const checkAgentProfileReadiness = vi.fn(() => {
      calls.push("check_agent_profile_readiness");
      return Promise.resolve(readiness);
    });
    const deps: CenterAgentProductOperationDeps = {
      addAgentProfileToSpace,
      authorizeAgentProfileForOrganization: vi.fn(() => Promise.resolve()),
      checkAgentProfileReadiness,
      createAgentProfile: vi.fn(() =>
        Promise.resolve(createAgentProfileResponse())
      ),
      enableAgentProfile: vi.fn(() => Promise.resolve()),
      ensureAgentProfilePrimaryBinding: vi.fn(() => Promise.resolve(binding)),
      listLocalAgentConnectionCandidates: vi.fn(() =>
        Promise.resolve({
          candidates: [candidate],
          organizationId: ORGANIZATION_ID,
        })
      ),
      setAgentProfileWorkspace: vi.fn(() => Promise.resolve(workspace)),
      updateAgentControllerCollaborationMode: vi.fn(),
      updateAgentControllerPermissionMode: vi.fn(),
      updateModelSelection: vi.fn(),
      updateOpenCodePermission: vi.fn(),
    };

    const response = await createConfiguredAgentProfileOperation({
      deps,
      request: {
        candidateId: candidate.candidateId,
        profileName: "Codex Agent",
        spaceId: SPACE_ID,
        workspaceMode: "custom",
        workspacePath: "/Users/felix/work/openmeld",
      },
    });

    expect(addAgentProfileToSpace).toHaveBeenCalledOnce();
    expect(addAgentProfileToSpace).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      spaceId: SPACE_ID,
    });
    expect(checkAgentProfileReadiness).toHaveBeenCalledOnce();
    expect(checkAgentProfileReadiness).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
    });
    expect(calls).toEqual([
      "add_agent_profile_to_space",
      "check_agent_profile_readiness",
    ]);
    expect(response).toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      canReply: false,
      connection: { status: "completed" },
      profile: { profileName: "Codex Agent" },
      readiness: {
        canReply: false,
      },
      spaceId: SPACE_ID,
      status: "blocked",
      workspace,
    });
    expect(
      response.readiness?.blockers.map(({ reasonCode }) => reasonCode)
    ).toContain("route.not_registered");
    expect(
      response.readiness?.readiness.agentExecutionReadiness.reasonCodes
    ).toContain("route.not_registered");
    expect(
      response.steps.map(({ name, status }) => ({ name, status }))
    ).toEqual([
      { name: "create_agent_profile", status: "completed" },
      { name: "enable_agent_profile", status: "completed" },
      {
        name: "select_local_agent_connection_candidate",
        status: "completed",
      },
      { name: "connect_agent_profile_to_local_agent", status: "completed" },
      {
        name: "authorize_agent_profile_for_organization",
        status: "completed",
      },
      { name: "update_agent_profile_workspace", status: "completed" },
      { name: "add_agent_profile_to_space", status: "completed" },
      { name: "check_agent_profile_readiness", status: "completed" },
    ]);
    expect(
      response.connection?.steps.map(({ name, status }) => ({ name, status }))
    ).toEqual([
      {
        name: "select_local_agent_connection_candidate",
        status: "completed",
      },
      { name: "connect_agent_profile_to_local_agent", status: "completed" },
    ]);
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

  it("returns created profile progress when enabling the Agent Profile fails", async () => {
    const createResponse = createAgentProfileResponse();

    const response = await createConfiguredAgentProfileOperation({
      deps: {
        addAgentProfileToSpace: vi.fn(),
        authorizeAgentProfileForOrganization: vi.fn(),
        checkAgentProfileReadiness: vi.fn(),
        createAgentProfile: vi.fn(() => Promise.resolve(createResponse)),
        enableAgentProfile: vi.fn(() =>
          Promise.reject(new Error("Agent Profile could not be enabled."))
        ),
        ensureAgentProfilePrimaryBinding: vi.fn(),
        listLocalAgentConnectionCandidates: vi.fn(() =>
          Promise.resolve({
            candidates: [createCandidate()],
            organizationId: ORGANIZATION_ID,
          })
        ),
        setAgentProfileWorkspace: vi.fn(),
        updateAgentControllerCollaborationMode: vi.fn(),
        updateAgentControllerPermissionMode: vi.fn(),
        updateModelSelection: vi.fn(),
        updateOpenCodePermission: vi.fn(),
      },
      request: {
        candidateId: createCandidate().candidateId,
        profileName: "Codex Agent",
        spaceId: SPACE_ID,
      },
    });

    expect(response).toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      canReply: false,
      profile: createResponse.profile,
      status: "blocked",
    });
    expect(
      response.steps.map(({ name, status }) => ({ name, status }))
    ).toEqual([
      { name: "create_agent_profile", status: "completed" },
      { name: "enable_agent_profile", status: "failed" },
      {
        name: "select_local_agent_connection_candidate",
        status: "skipped",
      },
      { name: "connect_agent_profile_to_local_agent", status: "skipped" },
      {
        name: "authorize_agent_profile_for_organization",
        status: "skipped",
      },
      { name: "add_agent_profile_to_space", status: "skipped" },
      { name: "check_agent_profile_readiness", status: "skipped" },
    ]);
    expect(response.steps[1]).toMatchObject({
      message: "Agent Profile could not be enabled.",
      name: "enable_agent_profile",
      nextAction: "Review this failed step, then retry the operation.",
      status: "failed",
    });
  });

  it("preserves the stable profile-create 503 in a blocked configured operation", async () => {
    const createProfileError = createCoreRpcHttpError({
      status: 503,
      reason: "Agent Profile creation is unavailable.",
      code: "center_agent.profile_create_unavailable",
    });

    const response = await createConfiguredAgentProfileOperation({
      deps: {
        addAgentProfileToSpace: vi.fn(),
        authorizeAgentProfileForOrganization: vi.fn(),
        checkAgentProfileReadiness: vi.fn(),
        createAgentProfile: vi.fn(() => Promise.reject(createProfileError)),
        enableAgentProfile: vi.fn(),
        ensureAgentProfilePrimaryBinding: vi.fn(),
        listLocalAgentConnectionCandidates: vi.fn(() =>
          Promise.resolve({
            candidates: [createCandidate()],
            organizationId: ORGANIZATION_ID,
          })
        ),
        setAgentProfileWorkspace: vi.fn(),
        updateAgentControllerCollaborationMode: vi.fn(),
        updateAgentControllerPermissionMode: vi.fn(),
        updateModelSelection: vi.fn(),
        updateOpenCodePermission: vi.fn(),
      },
      request: {
        candidateId: createCandidate().candidateId,
        profileName: "Codex Agent",
        spaceId: SPACE_ID,
      },
    });

    expect(response).toMatchObject({
      canReply: false,
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
      status: "blocked",
    });
    expect(
      response.steps.map(({ name, status }) => ({ name, status }))
    ).toEqual([
      { name: "create_agent_profile", status: "failed" },
      { name: "enable_agent_profile", status: "skipped" },
      {
        name: "select_local_agent_connection_candidate",
        status: "skipped",
      },
      { name: "connect_agent_profile_to_local_agent", status: "skipped" },
      {
        name: "authorize_agent_profile_for_organization",
        status: "skipped",
      },
      { name: "add_agent_profile_to_space", status: "skipped" },
      { name: "check_agent_profile_readiness", status: "skipped" },
    ]);
    expect(response.steps[0]).toMatchObject({
      message:
        'HTTP 503: {"ok":false,"error":{"code":"center_agent.profile_create_unavailable","message":"Agent Profile creation is unavailable."}}',
      name: "create_agent_profile",
      nextAction: "Review this failed step, then retry the operation.",
      status: "failed",
    });
  });

  it("creates, enables, connects, configures, adds, and checks a working Agent Profile", async () => {
    const candidate = createCandidate();
    const binding = acceptedBindingResponse();
    const readiness = readyReadinessResponse();
    const workspace = workspaceResponse();
    const calls: string[] = [];
    const deps: CenterAgentProductOperationDeps = {
      addAgentProfileToSpace: vi.fn(() => {
        calls.push("add_agent_profile_to_space");
        return Promise.resolve();
      }),
      authorizeAgentProfileForOrganization: vi.fn(() => {
        calls.push("authorize_agent_profile_for_organization");
        return Promise.resolve();
      }),
      checkAgentProfileReadiness: vi.fn(() => {
        calls.push("check_agent_profile_readiness");
        return Promise.resolve(readiness);
      }),
      createAgentProfile: vi.fn(() => {
        calls.push("create_agent_profile");
        return Promise.resolve(createAgentProfileResponse());
      }),
      enableAgentProfile: vi.fn(() => {
        calls.push("enable_agent_profile");
        return Promise.resolve();
      }),
      ensureAgentProfilePrimaryBinding: vi.fn(() => {
        calls.push("connect_agent_profile_to_local_agent");
        return Promise.resolve(binding);
      }),
      listLocalAgentConnectionCandidates: vi.fn(() =>
        Promise.resolve({
          candidates: [candidate],
          organizationId: ORGANIZATION_ID,
        })
      ),
      setAgentProfileWorkspace: vi.fn(() => {
        calls.push("update_agent_profile_workspace");
        return Promise.resolve(workspace);
      }),
      updateAgentControllerCollaborationMode: vi.fn(),
      updateAgentControllerPermissionMode: vi.fn(),
      updateModelSelection: vi.fn(),
      updateOpenCodePermission: vi.fn(),
    };

    const response = await createConfiguredAgentProfileOperation({
      deps,
      request: {
        agentControllerPermissionMode: "codex:askForApproval",
        candidateId: candidate.candidateId,
        modelId: "gpt-5.5-codex",
        profileName: "Codex Agent",
        spaceId: SPACE_ID,
        workspaceMode: "custom",
        workspacePath: "/Users/felix/work/openmeld",
      },
    });

    expect(calls).toEqual([
      "create_agent_profile",
      "enable_agent_profile",
      "connect_agent_profile_to_local_agent",
      "authorize_agent_profile_for_organization",
      "update_agent_profile_workspace",
      "add_agent_profile_to_space",
      "check_agent_profile_readiness",
    ]);
    expect(response).toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      canReply: true,
      connection: { status: "completed" },
      profile: { profileName: "Codex Agent" },
      readiness,
      spaceId: SPACE_ID,
      status: "completed",
      workspace,
    });
    expect(stepNames(response.steps)).toEqual([
      "create_agent_profile",
      "enable_agent_profile",
      "select_local_agent_connection_candidate",
      "connect_agent_profile_to_local_agent",
      "authorize_agent_profile_for_organization",
      "update_agent_profile_workspace",
      "add_agent_profile_to_space",
      "check_agent_profile_readiness",
    ]);
  });

  it("returns profile and connection progress when the configured Binding is rejected", async () => {
    const candidate = createCandidate();
    const rejectedBinding = rejectedBindingResponse();
    const deps: CenterAgentProductOperationDeps = {
      addAgentProfileToSpace: vi.fn(),
      authorizeAgentProfileForOrganization: vi.fn(),
      checkAgentProfileReadiness: vi.fn(),
      createAgentProfile: vi.fn(() =>
        Promise.resolve(createAgentProfileResponse())
      ),
      enableAgentProfile: vi.fn(() => Promise.resolve()),
      ensureAgentProfilePrimaryBinding: vi.fn(() =>
        Promise.resolve(rejectedBinding)
      ),
      listLocalAgentConnectionCandidates: vi.fn(() =>
        Promise.resolve({
          candidates: [candidate],
          organizationId: ORGANIZATION_ID,
        })
      ),
      setAgentProfileWorkspace: vi.fn(),
      updateAgentControllerCollaborationMode: vi.fn(),
      updateAgentControllerPermissionMode: vi.fn(),
      updateModelSelection: vi.fn(),
      updateOpenCodePermission: vi.fn(),
    };

    const response = await createConfiguredAgentProfileOperation({
      deps,
      request: {
        candidateId: candidate.candidateId,
        profileName: "Codex Agent",
        spaceId: SPACE_ID,
      },
    });

    expect(response).toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      canReply: false,
      connection: {
        binding: rejectedBinding,
        candidate,
        status: "blocked",
      },
      profile: { profileName: "Codex Agent" },
      status: "blocked",
    });
    expect(
      response.steps.map(({ name, status }) => ({ name, status }))
    ).toEqual([
      { name: "create_agent_profile", status: "completed" },
      { name: "enable_agent_profile", status: "completed" },
      {
        name: "select_local_agent_connection_candidate",
        status: "completed",
      },
      { name: "connect_agent_profile_to_local_agent", status: "failed" },
      {
        name: "authorize_agent_profile_for_organization",
        status: "skipped",
      },
      { name: "add_agent_profile_to_space", status: "skipped" },
      { name: "check_agent_profile_readiness", status: "skipped" },
    ]);
    expect(response.steps[3]).toMatchObject({
      name: "connect_agent_profile_to_local_agent",
      nextAction:
        "Review the returned Binding reason codes, then reconnect this Agent Profile.",
      status: "failed",
    });
  });

  it("stops before Space membership when Organization Wake access cannot be enabled", async () => {
    const candidate = createCandidate();
    const addAgentProfileToSpace = vi.fn();
    const checkAgentProfileReadiness = vi.fn();
    const response = await createConfiguredAgentProfileOperation({
      deps: {
        addAgentProfileToSpace,
        authorizeAgentProfileForOrganization: vi.fn(() =>
          Promise.reject(new Error("Organization Wake access write failed."))
        ),
        checkAgentProfileReadiness,
        createAgentProfile: vi.fn(() =>
          Promise.resolve(createAgentProfileResponse())
        ),
        enableAgentProfile: vi.fn(() => Promise.resolve()),
        ensureAgentProfilePrimaryBinding: vi.fn(() =>
          Promise.resolve(acceptedBindingResponse())
        ),
        listLocalAgentConnectionCandidates: vi.fn(() =>
          Promise.resolve({
            candidates: [candidate],
            organizationId: ORGANIZATION_ID,
          })
        ),
        setAgentProfileWorkspace: vi.fn(),
        updateAgentControllerCollaborationMode: vi.fn(),
        updateAgentControllerPermissionMode: vi.fn(),
        updateModelSelection: vi.fn(),
        updateOpenCodePermission: vi.fn(),
      },
      request: {
        candidateId: candidate.candidateId,
        profileName: "Release Reviewer",
        spaceId: SPACE_ID,
      },
    });

    expect(addAgentProfileToSpace).not.toHaveBeenCalled();
    expect(checkAgentProfileReadiness).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      canReply: false,
      status: "blocked",
      steps: expect.arrayContaining([
        expect.objectContaining({
          message: "Organization Wake access write failed.",
          name: "authorize_agent_profile_for_organization",
          status: "failed",
        }),
      ]),
    });
  });

  it("returns explicit model validation details from configured profile creation", async () => {
    const candidate = createCandidate();
    const validationMessage =
      'Model "gpt-99-nonexistent" is not supported for Agent Controller "builtin:codex". Supported models: gpt-5.6-sol, gpt-5.5.';
    const deps: CenterAgentProductOperationDeps = {
      addAgentProfileToSpace: vi.fn(),
      authorizeAgentProfileForOrganization: vi.fn(),
      checkAgentProfileReadiness: vi.fn(),
      createAgentProfile: vi.fn(() =>
        Promise.resolve(createAgentProfileResponse())
      ),
      enableAgentProfile: vi.fn(() => Promise.resolve()),
      ensureAgentProfilePrimaryBinding: vi.fn(() =>
        Promise.reject(
          createCoreRpcHttpError({
            status: 400,
            code: "agent_profile_binding.model_not_supported",
            reason: validationMessage,
          })
        )
      ),
      listLocalAgentConnectionCandidates: vi.fn(() =>
        Promise.resolve({
          candidates: [candidate],
          organizationId: ORGANIZATION_ID,
        })
      ),
      setAgentProfileWorkspace: vi.fn(),
      updateAgentControllerCollaborationMode: vi.fn(),
      updateAgentControllerPermissionMode: vi.fn(),
      updateModelSelection: vi.fn(),
      updateOpenCodePermission: vi.fn(),
    };

    const response = await createConfiguredAgentProfileOperation({
      deps,
      request: {
        candidateId: candidate.candidateId,
        modelId: "gpt-99-nonexistent",
        profileName: "Codex Agent",
        spaceId: SPACE_ID,
      },
    });

    expect(response).toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      canReply: false,
      status: "blocked",
      steps: [
        { name: "create_agent_profile", status: "completed" },
        { name: "enable_agent_profile", status: "completed" },
        {
          name: "select_local_agent_connection_candidate",
          status: "completed",
        },
        {
          message: `HTTP 400: ${JSON.stringify({
            ok: false,
            error: {
              code: "agent_profile_binding.model_not_supported",
              message: validationMessage,
            },
          })}`,
          name: "connect_agent_profile_to_local_agent",
          nextAction: "Review this failed step, then retry the operation.",
          status: "failed",
        },
        {
          name: "authorize_agent_profile_for_organization",
          status: "skipped",
        },
        { name: "add_agent_profile_to_space", status: "skipped" },
        { name: "check_agent_profile_readiness", status: "skipped" },
      ],
    });
    expect(deps.ensureAgentProfilePrimaryBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          modelId: "gpt-99-nonexistent",
        }),
      })
    );
    expect(deps.addAgentProfileToSpace).not.toHaveBeenCalled();
    expect(deps.checkAgentProfileReadiness).not.toHaveBeenCalled();
  });

  it("marks final readiness skipped when adding the Agent Profile to the Space fails", async () => {
    const candidate = createCandidate();
    const binding = acceptedBindingResponse();
    const workspace = workspaceResponse();
    const addAgentProfileToSpace = vi.fn(() =>
      Promise.reject(new Error("Space membership write failed."))
    );
    const checkAgentProfileReadiness = vi.fn();
    const setAgentProfileWorkspace = vi.fn(() => Promise.resolve(workspace));
    const deps: CenterAgentProductOperationDeps = {
      addAgentProfileToSpace,
      authorizeAgentProfileForOrganization: vi.fn(() => Promise.resolve()),
      checkAgentProfileReadiness,
      createAgentProfile: vi.fn(() =>
        Promise.resolve(createAgentProfileResponse())
      ),
      enableAgentProfile: vi.fn(() => Promise.resolve()),
      ensureAgentProfilePrimaryBinding: vi.fn(() => Promise.resolve(binding)),
      listLocalAgentConnectionCandidates: vi.fn(() =>
        Promise.resolve({
          candidates: [candidate],
          organizationId: ORGANIZATION_ID,
        })
      ),
      setAgentProfileWorkspace,
      updateAgentControllerCollaborationMode: vi.fn(),
      updateAgentControllerPermissionMode: vi.fn(),
      updateModelSelection: vi.fn(),
      updateOpenCodePermission: vi.fn(),
    };

    const response = await createConfiguredAgentProfileOperation({
      deps,
      request: {
        candidateId: candidate.candidateId,
        profileName: "Codex Agent",
        spaceId: SPACE_ID,
        workspaceMode: "custom",
        workspacePath: "/Users/felix/work/openmeld",
      },
    });

    expect(setAgentProfileWorkspace).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      workspaceMode: "custom",
      workspacePath: "/Users/felix/work/openmeld",
    });
    expect(addAgentProfileToSpace).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      spaceId: SPACE_ID,
    });
    expect(checkAgentProfileReadiness).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      canReply: false,
      connection: {
        binding,
        candidate,
        status: "completed",
      },
      profile: { profileName: "Codex Agent" },
      status: "blocked",
      workspace,
    });
    expect(response.readiness).toBeUndefined();
    expect(
      response.steps.map(({ name, status }) => ({ name, status }))
    ).toEqual([
      { name: "create_agent_profile", status: "completed" },
      { name: "enable_agent_profile", status: "completed" },
      {
        name: "select_local_agent_connection_candidate",
        status: "completed",
      },
      { name: "connect_agent_profile_to_local_agent", status: "completed" },
      {
        name: "authorize_agent_profile_for_organization",
        status: "completed",
      },
      { name: "update_agent_profile_workspace", status: "completed" },
      { name: "add_agent_profile_to_space", status: "failed" },
      { name: "check_agent_profile_readiness", status: "skipped" },
    ]);
    expect(response.steps.at(-2)).toMatchObject({
      message: "Space membership write failed.",
      name: "add_agent_profile_to_space",
      status: "failed",
    });
  });

  it("marks the final readiness step failed when the readiness query throws", async () => {
    const candidate = createCandidate();
    const addAgentProfileToSpace = vi.fn(() => Promise.resolve());
    const response = await createConfiguredAgentProfileOperation({
      deps: {
        addAgentProfileToSpace,
        authorizeAgentProfileForOrganization: vi.fn(() => Promise.resolve()),
        checkAgentProfileReadiness: vi.fn(() =>
          Promise.reject(new Error("Readiness lookup failed."))
        ),
        createAgentProfile: vi.fn(() =>
          Promise.resolve(createAgentProfileResponse())
        ),
        enableAgentProfile: vi.fn(() => Promise.resolve()),
        ensureAgentProfilePrimaryBinding: vi.fn(() =>
          Promise.resolve(acceptedBindingResponse())
        ),
        listLocalAgentConnectionCandidates: vi.fn(() =>
          Promise.resolve({
            candidates: [candidate],
            organizationId: ORGANIZATION_ID,
          })
        ),
        setAgentProfileWorkspace: vi.fn(),
        updateAgentControllerCollaborationMode: vi.fn(),
        updateAgentControllerPermissionMode: vi.fn(),
        updateModelSelection: vi.fn(),
        updateOpenCodePermission: vi.fn(),
      },
      request: {
        candidateId: candidate.candidateId,
        profileName: "Codex Agent",
        spaceId: SPACE_ID,
      },
    });

    expect(addAgentProfileToSpace).toHaveBeenCalledOnce();
    expect(response.readiness).toBeUndefined();
    expect(
      response.steps.map(({ name, status }) => ({ name, status }))
    ).toEqual([
      { name: "create_agent_profile", status: "completed" },
      { name: "enable_agent_profile", status: "completed" },
      {
        name: "select_local_agent_connection_candidate",
        status: "completed",
      },
      { name: "connect_agent_profile_to_local_agent", status: "completed" },
      {
        name: "authorize_agent_profile_for_organization",
        status: "completed",
      },
      { name: "add_agent_profile_to_space", status: "completed" },
      { name: "check_agent_profile_readiness", status: "failed" },
    ]);
    expect(response.steps.at(-1)).toMatchObject({
      message: "Readiness lookup failed.",
      name: "check_agent_profile_readiness",
      status: "failed",
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

function createCandidate(): CenterAgentLocalAgentConnectionCandidate {
  const candidate = projectCenterAgentLocalAgentConnectionCandidates({
    localRuntimes: createLocalRuntimesResponse(),
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

function createAgentProfileResponse(): CenterAgentCreateAgentProfileResponse {
  return {
    attribution: {
      actorProfileId: "agt_center",
      onBehalfOf: null,
    },
    organizationId: ORGANIZATION_ID,
    profile: {
      createdAt: NOW_ISO,
      createdByUserId: "user_1",
      creatorProfileId: "agt_center",
      isDefault: false,
      lastUsedAt: null,
      managedRole: null,
      ownerUserId: "user_1",
      profileHandle: "codex-agent",
      profileKind: "agent",
      profileName: "Codex Agent",
      source: "user_created",
      status: "active",
      updatedAt: NOW_ISO,
      openMeldProfileId: AGENT_PROFILE_ID,
    },
    resource: {
      id: AGENT_PROFILE_ID,
      type: "agent_profile",
    },
  };
}

function workspaceResponse(): SetCurrentAgentProfileWorkspaceResponse {
  return setCurrentAgentProfileWorkspaceResponseSchema.parse({
    agentProfileId: AGENT_PROFILE_ID,
    status: "updated",
    workspaceMode: "custom",
    workspacePath: "/Users/felix/work/openmeld",
  });
}

function routeNotRegisteredReadinessResponse(): CenterAgentCheckAgentProfileReadinessResponse {
  const wakeRouteStatus: WakeRouteStatus = { status: "checking" };
  const agentWakeRouteRegistration: AgentWakeRouteRegistration = {
    daemonSessionId: "daemon-session-1",
    deviceId: "device_1",
    lane: "dev-local",
    reasonCode: "wake_route.registration_pending_first_report",
    reportedAtMs: null,
    serviceVersion: "1.0.0",
    status: "pending",
  };
  const agentExecutionReadiness = resolveAgentExecutionStatus({
    agentProfileId: AGENT_PROFILE_ID,
    binding: readinessBinding(),
    localService: {
      reachable: true,
      refreshable: true,
      reasonCodes: ["local_service.refresh_in_progress"],
      source: "runtime_transport",
    },
    profile: {
      active: true,
      reasonCodes: [],
      source: "profile_identity",
    },
    route: {
      observedAt: NOW_ISO,
      reasonCodes: ["route.not_registered"],
      status: "offline",
    },
    runtimeReadiness: {
      displayState: "ready",
      ready: true,
      reasonCodes: [],
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
      action: "check_status",
      target: { kind: "status" },
    },
    profileName: "Codex Agent",
    routeDeviceId: null,
    routeLane: null,
    runtimeDeviceDisplayName: null,
    wakeRouteEvidence: createDaemonRouteObservationSummary({
      observedAt: NOW_ISO,
      reasonCode: "route.not_registered",
      status: "offline",
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

function stepNames(
  steps: readonly CenterAgentProductOperationStep[]
): CenterAgentProductOperationStep["name"][] {
  return steps.map((step) => step.name);
}
