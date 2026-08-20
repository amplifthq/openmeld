import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    createAgentProfileCreationRequest: vi.fn(),
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
  createdAgentProfileId: null,
  createdAt: "2026-08-20T10:00:00.000Z",
  decidedAt: null,
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
