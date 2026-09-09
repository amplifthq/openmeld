import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    createAgentProfileCreationRequest: vi.fn(),
    getAgentProfileCreationDefaults: vi.fn(),
    getCurrentComputers: vi.fn(),
    listAgentProfileCreationRequests: vi.fn(),
  },
  presenterData: vi.fn(),
}));

vi.mock("@openmeld/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openmeld/api-client")>();
  return {
    ...actual,
    createOrganizationApi: vi.fn(() => mocks.api),
  };
});

vi.mock("../src/config/auth-session", () => ({
  getAuthSessionState: vi.fn(async () => ({
    session: {
      activeOrganization: {
        id: "org-1",
        name: "Amplift",
        slug: "amplift",
      },
      user: { id: "user-1" },
    },
    state: "valid",
  })),
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: vi.fn(async () => "https://gateway.example.test"),
}));

vi.mock("../src/local-service/state/current-device-identity", () => ({
  readCurrentLocalDeviceId: vi.fn(async () => "computer-1"),
}));

vi.mock("../src/org/auth-organization-api", () => ({
  getAuthOrganizationSelection: vi.fn(async () => ({
    activeOrganizationId: "org-1",
    lastSelectedOrganizationId: "org-1",
  })),
  listAuthOrganizations: vi.fn(async () => [
    { id: "org-1", name: "Amplift", slug: "amplift" },
  ]),
}));

vi.mock("../src/runtime/context", () => ({
  resolveRuntimeContext: vi.fn(async () => ({ resolvedView: "agent" })),
}));

vi.mock("../src/runtime/presenter/index", () => ({
  createPresenter: vi.fn(() => ({
    data: mocks.presenterData,
    event: vi.fn(),
    line: vi.fn(),
    view: "agent",
  })),
}));

vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: vi.fn(() => ({})),
}));

import { runProfileCreationRequestCreate } from "../src/profile-creation-request/command";

const CREATED_REQUEST = {
  actorProfileId: "profile-requester",
  completedAt: null,
  configuration: {
    agentControllerCollaborationMode: null,
    agentControllerPermissionMode: null,
    agentControllerRef: null,
    authorizeForOrganization: true,
    defaultProjectId: null,
    modelId: null,
    openCodePermission: null,
    reasoningLevel: null,
    targetComputerId: null,
  },
  createdAgentProfileId: null,
  createdAt: "2026-08-20T10:00:00.000Z",
  decidedAt: null,
  failureMessage: null,
  id: "request-1",
  nativeSessionId: "native-session-1",
  organizationId: "org-1",
  profileName: "Review Agent",
  requestedSpaceId: "space-1",
  requesterUserId: "user-1",
  sessionStrategy: "fork",
  source: "local_agent",
  status: "pending",
  statusReason: "approval_required",
  targetOwnerUserId: "user-2",
  updatedAt: "2026-08-20T10:00:00.000Z",
} as const;

describe("Agent Profile creation request CLI", () => {
  beforeEach(() => {
    mocks.api.createAgentProfileCreationRequest.mockReset();
    mocks.api.getAgentProfileCreationDefaults.mockReset().mockResolvedValue({
      agentControllerCollaborationMode: null,
      agentControllerPermissionMode: null,
      agentControllerRef: "builtin:codex",
      defaultProjectId: "project-saved",
      modelId: "gpt-5.5",
      openCodePermission: null,
      organizationId: "org-1",
      reasoningLevel: "high",
      updatedAt: "2026-08-20T09:00:00.000Z",
      userId: "user-1",
    });
    mocks.api.getCurrentComputers.mockReset().mockResolvedValue({
      computers: [
        {
          computerId: "computer-2",
          deviceDisplayName: "Felix's Mac mini",
          deviceType: "personal_computer",
          lastSeenAtMs: 2,
          localAgents: [
            {
              agentControllerRef: "builtin:codex",
              enabled: true,
              status: "ready",
            },
          ],
          osVersion: "macOS 26.0",
          ownerUserId: "user-1",
          platformFamily: "macos",
          serviceState: "connected",
        },
        {
          computerId: "computer-1",
          deviceDisplayName: "Felix's MacBook Pro",
          deviceType: "personal_computer",
          lastSeenAtMs: 1,
          localAgents: [
            {
              agentControllerRef: "builtin:codex",
              enabled: true,
              status: "ready",
            },
          ],
          osVersion: "macOS 26.0",
          ownerUserId: "user-1",
          platformFamily: "macos",
          serviceState: "connected",
        },
      ],
      generatedAt: "2026-08-20T09:00:00.000Z",
      organizationId: "org-1",
    });
    mocks.presenterData.mockReset();
    mocks.api.createAgentProfileCreationRequest.mockResolvedValue({
      replayed: false,
      request: CREATED_REQUEST,
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it("passes the exact native Session ID and Local Agent attribution", async () => {
    await runProfileCreationRequestCreate({
      idempotencyKey: "stable-request-key",
      nativeSessionId: "native-session-1",
      profileName: "Review Agent",
      requestedSpaceId: "space-1",
      sessionStrategy: "fork",
      source: "local-agent",
      targetOwner: "user-2",
      view: "agent",
    });

    expect(mocks.api.createAgentProfileCreationRequest).toHaveBeenCalledWith({
      configuration: CREATED_REQUEST.configuration,
      idempotencyKey: "stable-request-key",
      nativeSessionId: "native-session-1",
      organizationId: "org-1",
      profileName: "Review Agent",
      requestedSpaceId: "space-1",
      sessionStrategy: "fork",
      source: "local_agent",
      targetOwnerUserId: "user-2",
    });
    expect(mocks.presenterData).toHaveBeenCalledWith({
      code: "profile.creation_request.created",
      payload: {
        organization: { id: "org-1", name: "Amplift", slug: "amplift" },
        replayed: false,
        request: CREATED_REQUEST,
      },
    });
  });

  it("keeps the generated intent key when creation status is unknown", async () => {
    mocks.api.createAgentProfileCreationRequest.mockRejectedValue(
      new Error("Network request failed")
    );
    await runProfileCreationRequestCreate({
      profileName: "Review Agent",
      targetOwner: "user-2",
      sessionStrategy: "new",
      view: "agent",
    });
    const key =
      mocks.api.createAgentProfileCreationRequest.mock.calls[0]?.[0]
        .idempotencyKey;
    expect(key).toEqual(expect.any(String));
    expect(mocks.presenterData).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "profile.creation_request.outcome_unknown",
        payload: expect.objectContaining({
          error: expect.objectContaining({
            message:
              "The request may have been accepted. Its final status could not be checked.",
            nextStep: expect.stringContaining(`--idempotency-key ${key}`),
          }),
        }),
      })
    );
    expect(mocks.api.createAgentProfileCreationRequest).toHaveBeenCalledOnce();
  });

  it("passes the teammate Computer and Binding choices through the shared request", async () => {
    await runProfileCreationRequestCreate({
      agentController: "builtin:codex",
      agentControllerCollaborationMode: "codex:plan",
      agentControllerPermissionModeInput: "approve-for-me",
      defaultProjectId: "project-1",
      idempotencyKey: "configured-request-key",
      modelId: "gpt-5.5",
      openCodePermissionInput: '{"edit":"allow","bash":"ask"}',
      profileName: "Configured Agent",
      reasoningLevel: "high",
      targetComputerId: "computer-2",
      targetOwner: "user-2",
      view: "agent",
    });

    expect(mocks.api.getAgentProfileCreationDefaults).not.toHaveBeenCalled();
    expect(mocks.api.createAgentProfileCreationRequest).toHaveBeenCalledWith({
      configuration: {
        agentControllerCollaborationMode: "codex:plan",
        agentControllerPermissionMode: "codex:approveForMe",
        agentControllerRef: "builtin:codex",
        authorizeForOrganization: true,
        defaultProjectId: "project-1",
        modelId: "gpt-5.5",
        openCodePermission: { bash: "ask", edit: "allow" },
        reasoningLevel: "high",
        targetComputerId: "computer-2",
      },
      idempotencyKey: "configured-request-key",
      nativeSessionId: undefined,
      organizationId: "org-1",
      profileName: "Configured Agent",
      requestedSpaceId: undefined,
      sessionStrategy: "new",
      source: "cli",
      targetOwnerUserId: "user-2",
    });
  });

  it("reuses the current user's saved Default Project when the CLI omits --project", async () => {
    await runProfileCreationRequestCreate({
      agentController: "builtin:codex",
      idempotencyKey: "saved-project-request-key",
      profileName: "Project Agent",
      targetComputerId: "computer-1",
      targetOwner: "self",
      view: "agent",
    });

    expect(mocks.api.getAgentProfileCreationDefaults).toHaveBeenCalledWith({
      agentControllerRef: "builtin:codex",
      organizationId: "org-1",
    });
    expect(mocks.api.createAgentProfileCreationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          defaultProjectId: "project-saved",
        }),
      })
    );
  });

  it("uses the current user's ready Computer when --computer is omitted", async () => {
    await runProfileCreationRequestCreate({
      agentController: "builtin:codex",
      idempotencyKey: "auto-computer-request-key",
      organization: "amplift",
      profileName: "Project Agent",
      targetOwner: "self",
      view: "agent",
    });

    expect(mocks.api.getCurrentComputers).toHaveBeenCalledOnce();
    expect(mocks.api.getAgentProfileCreationDefaults).toHaveBeenCalledWith({
      agentControllerRef: "builtin:codex",
      organizationId: "org-1",
    });
    expect(mocks.api.createAgentProfileCreationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          agentControllerRef: "builtin:codex",
          defaultProjectId: "project-saved",
          targetComputerId: "computer-1",
        }),
      })
    );
  });

  it("explains when the requested Local Agent is not ready on this computer", async () => {
    mocks.api.getCurrentComputers.mockResolvedValueOnce({
      computers: [
        {
          computerId: "computer-1",
          deviceDisplayName: "Felix's MacBook Pro",
          deviceType: "personal_computer",
          lastSeenAtMs: 1,
          localAgents: [
            {
              agentControllerRef: "builtin:codex",
              enabled: true,
              status: "not_ready",
            },
          ],
          osVersion: "macOS 26.0",
          ownerUserId: "user-1",
          platformFamily: "macos",
          serviceState: "connected",
        },
      ],
      generatedAt: "2026-08-20T09:00:00.000Z",
      organizationId: "org-1",
    });

    await runProfileCreationRequestCreate({
      agentController: "builtin:codex",
      profileName: "Project Agent",
      targetOwner: "self",
      view: "agent",
    });

    expect(mocks.api.createAgentProfileCreationRequest).not.toHaveBeenCalled();
    expect(mocks.presenterData).toHaveBeenCalledWith({
      code: "profile.creation_request.local_agent_unavailable",
      payload: {
        error: {
          code: "profile.creation_request.local_agent_unavailable",
          details: undefined,
          message: "builtin:codex is not ready on this computer.",
          nextStep:
            "Run `openmeld computer current --view agent` and repair the Local Agent, then retry; or pass another ready `--computer <computer-id>`.",
        },
        status: "error",
      },
    });
  });

  it("requires an explicit Computer when creating for a teammate", async () => {
    await runProfileCreationRequestCreate({
      agentController: "builtin:codex",
      profileName: "Teammate Agent",
      targetOwner: "user-2",
      view: "agent",
    });

    expect(mocks.api.getCurrentComputers).not.toHaveBeenCalled();
    expect(mocks.api.createAgentProfileCreationRequest).not.toHaveBeenCalled();
    expect(mocks.presenterData).toHaveBeenCalledWith({
      code: "profile.creation_request.computer_required",
      payload: {
        error: {
          code: "profile.creation_request.computer_required",
          details: undefined,
          message: "Creating an Agent for a teammate requires their Computer.",
          nextStep:
            "Run `openmeld org computers --view agent`, then pass `--computer <computer-id>`.",
        },
        status: "error",
      },
    });
  });

  it("keeps an explicitly selected Project instead of reading the saved default", async () => {
    await runProfileCreationRequestCreate({
      agentController: "builtin:codex",
      defaultProjectId: "project-explicit",
      idempotencyKey: "explicit-project-request-key",
      profileName: "Explicit Project Agent",
      targetComputerId: "computer-1",
      targetOwner: "self",
      view: "agent",
    });

    expect(mocks.api.getAgentProfileCreationDefaults).not.toHaveBeenCalled();
    expect(mocks.api.createAgentProfileCreationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          defaultProjectId: "project-explicit",
        }),
      })
    );
  });

  it("lets the current user explicitly choose an OpenMeld-managed workspace", async () => {
    await runProfileCreationRequestCreate({
      agentController: "builtin:codex",
      idempotencyKey: "managed-workspace-request-key",
      profileName: "Managed Workspace Agent",
      reuseSavedDefaultProject: false,
      targetComputerId: "computer-1",
      targetOwner: "self",
      view: "agent",
    });

    expect(mocks.api.getAgentProfileCreationDefaults).not.toHaveBeenCalled();
    expect(mocks.api.createAgentProfileCreationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          defaultProjectId: null,
        }),
      })
    );
  });

  it("fails before mutation when a new-session request includes a native Session ID", async () => {
    await runProfileCreationRequestCreate({
      nativeSessionId: "native-session-1",
      profileName: "Review Agent",
      sessionStrategy: "new",
      targetOwner: "user-2",
      view: "agent",
    });

    expect(mocks.api.createAgentProfileCreationRequest).not.toHaveBeenCalled();
    expect(mocks.presenterData).toHaveBeenCalledWith({
      code: "profile.creation_request.native_session_unexpected",
      payload: {
        error: {
          code: "profile.creation_request.native_session_unexpected",
          message: "A new-session request cannot include a native Session ID.",
          nextStep: "Remove `--native-session`, or choose resume or fork.",
        },
        status: "error",
      },
    });
    expect(process.exitCode).toBe(1);
  });
});
