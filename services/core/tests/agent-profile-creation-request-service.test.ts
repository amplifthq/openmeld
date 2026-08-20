import type {
  AgentProfileCreationApprovalPolicy,
  CreateAgentProfileCreationRequestBody,
} from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentProfileCreationRequestConflictError,
  AgentProfileCreationRequestExecutionError,
  AgentProfileCreationRequestForbiddenError,
  type AgentProfileCreationRequestRecord,
  type AgentProfileCreationRequestRepository,
  createAgentProfileCreationRequestService,
} from "../src/agent-profile-creation-request/agent-profile-creation-request-service";

const NOW_MS = Date.parse("2026-08-20T10:00:00.000Z");

describe("Agent Profile creation request service", () => {
  let repository: InMemoryRepository;
  const createAgentProfile = vi.fn();
  const projectApprovalInbox = vi.fn();
  const resolveApprovalInbox = vi.fn();

  beforeEach(() => {
    repository = new InMemoryRepository();
    createAgentProfile.mockReset();
    createAgentProfile.mockResolvedValue(
      "agt_11111111-1111-4111-8111-111111111111"
    );
    projectApprovalInbox.mockReset();
    resolveApprovalInbox.mockReset();
  });

  it("keeps a teammate request pending under the safe default policy", async () => {
    const service = createService();

    const result = await service.create({
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });

    expect(result.replayed).toBe(false);
    expect(result.request).toMatchObject({
      status: "pending",
      statusReason: "approval_required",
    });
    expect(projectApprovalInbox).toHaveBeenCalledWith(result.request);
    expect(createAgentProfile).not.toHaveBeenCalled();
  });

  it("creates the target owner's Profile immediately when they allow new-session requests", async () => {
    repository.preference = {
      existingSessionPolicy: "ask_every_time",
      newSessionPolicy: "automatically_allow",
    };
    const service = createService();

    const result = await service.create({
      actorProfileId: "center-agent-profile",
      body: requestBody({ source: "center_agent" }),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });

    expect(result.request).toMatchObject({
      createdAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      status: "completed",
      statusReason: "profile_created",
    });
    expect(createAgentProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        actorProfileId: "center-agent-profile",
        requesterUserId: "user-requester",
        targetOwnerUserId: "user-target",
      })
    );
  });

  it("lets a member create their own Profile without an approval round trip", async () => {
    repository.preference = {
      existingSessionPolicy: "never_allow",
      newSessionPolicy: "never_allow",
    };
    const service = createService();

    const result = await service.create({
      actorProfileId: "human-requester",
      body: requestBody({ targetOwnerUserId: "user-requester" }),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });

    expect(result.request.status).toBe("completed");
    expect(createAgentProfile).toHaveBeenCalledTimes(1);
    expect(projectApprovalInbox).not.toHaveBeenCalled();
  });

  it("records a denied request so the requester can see the outcome", async () => {
    repository.preference = {
      existingSessionPolicy: "ask_every_time",
      newSessionPolicy: "never_allow",
    };
    const service = createService();

    const result = await service.create({
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });

    expect(result.request).toMatchObject({
      status: "declined",
      statusReason: "target_policy_denied",
    });
    expect(createAgentProfile).not.toHaveBeenCalled();
    expect(projectApprovalInbox).not.toHaveBeenCalled();
  });

  it("replays the same request and rejects idempotency key reuse for another intent", async () => {
    const service = createService();
    const input = {
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    };

    const first = await service.create(input);
    const replay = await service.create(input);

    expect(replay).toEqual({ replayed: true, request: first.request });
    await expect(
      service.create({
        ...input,
        body: { ...input.body, profileName: "Different Agent" },
      })
    ).rejects.toBeInstanceOf(AgentProfileCreationRequestConflictError);
  });

  it("lets only the target owner approve and completes the request once", async () => {
    const service = createService();
    const created = await service.create({
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });

    await expect(
      service.decide({
        decision: "approve",
        organizationId: "org-1",
        requestId: created.request.id,
        userId: "user-requester",
      })
    ).rejects.toBeInstanceOf(AgentProfileCreationRequestForbiddenError);

    const approved = await service.decide({
      decision: "approve",
      organizationId: "org-1",
      requestId: created.request.id,
      userId: "user-target",
    });

    expect(approved.status).toBe("completed");
    expect(createAgentProfile).toHaveBeenCalledTimes(1);
    expect(resolveApprovalInbox).toHaveBeenCalledWith(approved);
  });

  it("lets the requester cancel a pending request", async () => {
    const service = createService();
    const created = await service.create({
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });

    const cancelled = await service.cancel({
      organizationId: "org-1",
      requestId: created.request.id,
      requesterUserId: "user-requester",
    });

    expect(cancelled).toMatchObject({
      status: "cancelled",
      statusReason: "requester_cancelled",
    });
    expect(resolveApprovalInbox).toHaveBeenCalledWith(cancelled);
  });

  it("keeps the committed Profile visible when its requested setup fails", async () => {
    repository.preference = {
      existingSessionPolicy: "ask_every_time",
      newSessionPolicy: "automatically_allow",
    };
    createAgentProfile.mockRejectedValueOnce(
      new AgentProfileCreationRequestExecutionError({
        cause: new Error("Codex is no longer ready on Felix’s Mac."),
        createdAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      })
    );

    const result = await createService().create({
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });

    expect(result.request).toMatchObject({
      createdAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      failureMessage: "Codex is no longer ready on Felix’s Mac.",
      status: "failed",
      statusReason: "profile_creation_failed",
    });
  });

  function createService() {
    return createAgentProfileCreationRequestService({
      createAgentProfile,
      now: () => NOW_MS,
      projectApprovalInbox,
      randomUuid: () => "22222222-2222-4222-8222-222222222222",
      repository,
      resolveApprovalInbox,
    });
  }
});

function requestBody(
  overrides: Partial<CreateAgentProfileCreationRequestBody> = {}
): CreateAgentProfileCreationRequestBody {
  return {
    idempotencyKey: "request-1",
    profileName: "Release Reviewer",
    sessionStrategy: "new",
    source: "web",
    targetOwnerUserId: "user-target",
    ...overrides,
  };
}

class InMemoryRepository implements AgentProfileCreationRequestRepository {
  preference: {
    existingSessionPolicy: AgentProfileCreationApprovalPolicy;
    newSessionPolicy: AgentProfileCreationApprovalPolicy;
  } | null = null;
  private readonly records: AgentProfileCreationRequestRecord[] = [];

  findByIdempotencyKey(input: {
    idempotencyKey: string;
    organizationId: string;
    requesterUserId: string;
  }) {
    return Promise.resolve(
      this.records.find(
        (record) =>
          record.idempotencyKey === input.idempotencyKey &&
          record.organizationId === input.organizationId &&
          record.requesterUserId === input.requesterUserId
      ) ?? null
    );
  }

  getById(input: { organizationId: string; requestId: string }) {
    return Promise.resolve(
      this.records.find(
        (record) =>
          record.id === input.requestId &&
          record.organizationId === input.organizationId
      ) ?? null
    );
  }

  getPreference() {
    return Promise.resolve(
      this.preference
        ? {
            ...this.preference,
            organizationId: "org-1",
            updatedAtMs: NOW_MS,
            userId: "user-target",
          }
        : null
    );
  }

  insert(record: AgentProfileCreationRequestRecord) {
    this.records.push(record);
    return Promise.resolve(record);
  }

  listForParticipant() {
    return Promise.resolve([...this.records]);
  }

  transition(input: {
    expectedStatuses: AgentProfileCreationRequestRecord["status"][];
    requestId: string;
    update: Partial<AgentProfileCreationRequestRecord>;
  }) {
    const index = this.records.findIndex(
      (record) =>
        record.id === input.requestId &&
        input.expectedStatuses.includes(record.status)
    );
    if (index < 0) {
      return Promise.resolve(null);
    }
    const current = this.records[index];
    if (!current) {
      return Promise.resolve(null);
    }
    const updated = { ...current, ...input.update };
    this.records[index] = updated;
    return Promise.resolve(updated);
  }

  upsertPreference(): Promise<never> {
    return Promise.reject(new Error("not implemented in this test"));
  }
}
