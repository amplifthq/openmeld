import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const TEST_EXECUTION_CONTEXT = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

const CREATION_REQUEST = {
  actorProfileId: HUMAN_PROFILE_ID,
  completedAt: null,
  configuration: {
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
  createdAt: "2026-08-20T00:00:00.000Z",
  decidedAt: null,
  failureMessage: null,
  id: "creation-request-1",
  nativeSessionId: null,
  organizationId: "org-1",
  profileName: "Review Agent",
  requestedSpaceId: null,
  requesterUserId: "owner-1",
  sessionStrategy: "new",
  source: "web",
  status: "pending",
  statusReason: "approval_required",
  targetOwnerUserId: "owner-2",
  updatedAt: "2026-08-20T00:00:00.000Z",
} as const;

describe("Agent Profile creation request routes", () => {
  it("forwards create, list, and decision calls with the active actor context", async () => {
    const { coreRpc, env } = makeEnv();

    const createResponse = await app.fetch(
      new Request(
        "http://local/v1/organizations/org-1/agent-profile-creation-requests",
        {
          body: JSON.stringify({
            idempotencyKey: "create-review-agent",
            profileName: "Review Agent",
            sessionStrategy: "new",
            source: "web",
            targetOwnerUserId: "owner-2",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    const listResponse = await app.fetch(
      new Request(
        "http://local/v1/organizations/org-1/agent-profile-creation-requests"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    const decisionResponse = await app.fetch(
      new Request(
        "http://local/v1/organizations/org-1/agent-profile-creation-requests/creation-request-1/decision",
        {
          body: JSON.stringify({ decision: "approve" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(createResponse.status).toBe(200);
    expect(listResponse.status).toBe(200);
    expect(decisionResponse.status).toBe(200);
    expect(coreRpc.createAgentProfileCreationRequest).toHaveBeenCalledWith({
      context: expectedContext(),
      idempotencyKey: "create-review-agent",
      organizationId: "org-1",
      profileName: "Review Agent",
      sessionStrategy: "new",
      source: "web",
      targetOwnerUserId: "owner-2",
    });
    expect(coreRpc.listAgentProfileCreationRequests).toHaveBeenCalledWith({
      context: expectedContext(),
      organizationId: "org-1",
    });
    expect(coreRpc.decideAgentProfileCreationRequest).toHaveBeenCalledWith({
      context: expectedContext(),
      decision: "approve",
      organizationId: "org-1",
      requestId: "creation-request-1",
    });
  });

  it("reads and updates approval preferences independently for new and existing sessions", async () => {
    const { coreRpc, env } = makeEnv();
    const route =
      "http://local/v1/organizations/org-1/agent-profile-creation-approval-preference";

    const readResponse = await app.fetch(
      new Request(route),
      env,
      TEST_EXECUTION_CONTEXT
    );
    const updateResponse = await app.fetch(
      new Request(route, {
        body: JSON.stringify({
          existingSessionPolicy: "never_allow",
          newSessionPolicy: "automatically_allow",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(readResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(
      coreRpc.setAgentProfileCreationApprovalPreference
    ).toHaveBeenCalledWith({
      context: expectedContext(),
      existingSessionPolicy: "never_allow",
      newSessionPolicy: "automatically_allow",
      organizationId: "org-1",
    });
  });
});

function expectedContext() {
  return {
    activeOrganizationId: "org-1",
    actorContext: {
      callerPrincipalId: "owner-1",
      openMeldProfileId: HUMAN_PROFILE_ID,
      ownerUserId: "owner-1",
      profileKind: "human",
      profileName: "Mira",
      requestId: "req-agent-profile-creation",
    },
  };
}

function makeEnv() {
  const preference = {
    existingSessionPolicy: "ask_every_time" as const,
    newSessionPolicy: "ask_every_time" as const,
    organizationId: "org-1",
    updatedAt: null,
    userId: "owner-1",
  };
  const coreRpc = {
    createAgentProfileCreationRequest: vi.fn(async () => ({
      replayed: false,
      request: CREATION_REQUEST,
    })),
    decideAgentProfileCreationRequest: vi.fn(async () => ({
      request: CREATION_REQUEST,
    })),
    getAgentProfileCreationApprovalPreference: vi.fn(async () => preference),
    listAgentProfileCreationRequests: vi.fn(async () => ({
      organizationId: "org-1",
      requests: [CREATION_REQUEST],
    })),
    setAgentProfileCreationApprovalPreference: vi.fn(async () => preference),
  };
  const resolvedProfile = {
    openMeldProfileId: HUMAN_PROFILE_ID,
    ownerUserId: "owner-1",
    profileKind: "human" as const,
    profileName: "Mira",
  };
  const claims = {
    activeOrganizationId: "org-1",
    authenticated: true,
    authMethod: "session",
    callerPrincipalId: "owner-1",
    ownerIds: ["owner-1"],
    requestId: "req-agent-profile-creation",
  };
  const authRpc = {
    resolveProfile: vi.fn(async () => ({ ok: true, resolvedProfile })),
    resolveRequestAuth: vi.fn(async () => ({ claims, ok: true })),
    resolveRequestAuthWithProfile: vi.fn(async () => ({
      claims,
      ok: true,
      profile: { ok: true, resolvedProfile },
    })),
  };
  return {
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
  };
}
