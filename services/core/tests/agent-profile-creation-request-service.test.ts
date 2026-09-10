import {
  DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";
import type {
  AgentProfileCreationApprovalPolicy,
  CreateAgentProfileCreationRequestBody,
} from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentProfileCreationRequestInboxProjectionService } from "../src/agent-profile-creation-request/agent-profile-creation-request-inbox-projection";
import {
  AGENT_PROFILE_CREATION_STALE_AFTER_MS,
  AgentProfileCreationRequestConflictError,
  AgentProfileCreationRequestExecutionError,
  AgentProfileCreationRequestForbiddenError,
  type AgentProfileCreationRequestInboxProjectionOperation,
  type AgentProfileCreationRequestInboxProjectionRecord,
  type AgentProfileCreationRequestRecord,
  type AgentProfileCreationRequestRepository,
  createAgentProfileCreationRequestService,
  failStaleAgentProfileCreationRequests,
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

  it("creates a personal Remote Agent without local evidence and rejects creating one for a teammate", async () => {
    const configuration = {
      ...DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
      agentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
    };
    const result = await createService().create({
      actorProfileId: "human-requester",
      organizationId: "org-1",
      requesterUserId: "user-requester",
      body: requestBody({ configuration, targetOwnerUserId: "user-requester" }),
    });
    expect(result.request.status).toBe("completed");
    expect(createAgentProfile).toHaveBeenCalledOnce();
    await expect(
      createService().create({
        actorProfileId: "human-requester",
        organizationId: "org-1",
        requesterUserId: "user-requester",
        body: requestBody({
          configuration,
          idempotencyKey: "remote-for-teammate",
          targetOwnerUserId: "user-teammate",
        }),
      })
    ).rejects.toBeInstanceOf(AgentProfileCreationRequestForbiddenError);
    expect(createAgentProfile).toHaveBeenCalledOnce();
  });

  it("rejects a Web request without a run target before creating any identity or request", async () => {
    const service = createService();
    await expect(
      service.create({
        actorProfileId: "human-requester",
        body: requestBody({ configuration: undefined }),
        organizationId: "org-1",
        requesterUserId: "user-requester",
      })
    ).rejects.toThrow("Choose a local agent on a connected computer");
    expect(await repository.listForParticipant()).toHaveLength(0);
    expect(createAgentProfile).not.toHaveBeenCalled();
    expect(projectApprovalInbox).not.toHaveBeenCalled();
  });

  it("preserves intentional CLI manual profiles without a local binding", async () => {
    const result = await createService().create({
      actorProfileId: "human-requester",
      body: requestBody({
        configuration: undefined,
        source: "cli",
        targetOwnerUserId: "user-requester",
      }),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });
    expect(result.request.status).toBe("completed");
    expect(createAgentProfile).toHaveBeenCalledOnce();
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
      }),
      expect.objectContaining({
        checkpointCreatedAgentProfileId: expect.any(Function),
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

  it("retries a failed Inbox projection when the same request is replayed", async () => {
    projectApprovalInbox
      .mockRejectedValueOnce(new Error("Inbox is temporarily unavailable."))
      .mockResolvedValueOnce(undefined);
    const service = createService();
    const input = {
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    };

    const first = await service.create(input);
    const replay = await service.create(input);

    expect(first.request.status).toBe("pending");
    expect(replay).toEqual({ replayed: true, request: first.request });
    expect(projectApprovalInbox).toHaveBeenCalledTimes(2);
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
    expect(resolveApprovalInbox).toHaveBeenCalledWith(
      expect.objectContaining({
        id: approved.id,
        status: "approved",
        statusReason: "target_approved",
      })
    );
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

  it("does not cancel a request after Profile creation has started", async () => {
    const creation = deferred<string>();
    createAgentProfile.mockReturnValueOnce(creation.promise);
    const service = createService();
    const created = await service.create({
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });

    const approval = service.decide({
      decision: "approve",
      organizationId: "org-1",
      requestId: created.request.id,
      userId: "user-target",
    });
    await vi.waitFor(() => {
      expect(createAgentProfile).toHaveBeenCalledTimes(1);
    });

    await expect(
      service.cancel({
        organizationId: "org-1",
        requestId: created.request.id,
        requesterUserId: "user-requester",
      })
    ).rejects.toThrow("This request can no longer be cancelled.");

    creation.resolve("agt_11111111-1111-4111-8111-111111111111");
    await expect(approval).resolves.toMatchObject({
      createdAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      status: "completed",
    });
  });

  it("does not cancel a failed request after its Profile identity was committed", async () => {
    repository.preference = {
      existingSessionPolicy: "ask_every_time",
      newSessionPolicy: "automatically_allow",
    };
    createAgentProfile.mockRejectedValueOnce(
      new AgentProfileCreationRequestExecutionError({
        cause: new Error("The selected Computer is no longer reachable."),
        createdAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      })
    );
    const service = createService();
    const created = await service.create({
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });

    await expect(
      service.cancel({
        organizationId: "org-1",
        requestId: created.request.id,
        requesterUserId: "user-requester",
      })
    ).rejects.toThrow("This request can no longer be cancelled.");
    await expect(
      repository.getById({
        organizationId: "org-1",
        requestId: created.request.id,
      })
    ).resolves.toMatchObject({
      createdAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      status: "failed",
      statusReason: "profile_created",
    });
  });

  it("lets only one concurrent retry execute Profile creation", async () => {
    const service = createService();
    const created = await service.create({
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });
    createAgentProfile.mockRejectedValueOnce(new Error("Temporary failure"));
    await expect(
      service.decide({
        decision: "approve",
        organizationId: "org-1",
        requestId: created.request.id,
        userId: "user-target",
      })
    ).resolves.toMatchObject({ status: "failed" });

    const retryCreation = deferred<string>();
    createAgentProfile.mockReturnValue(retryCreation.promise);
    const retries = Promise.allSettled([
      service.retry({
        organizationId: "org-1",
        requestId: created.request.id,
        userId: "user-requester",
      }),
      service.retry({
        organizationId: "org-1",
        requestId: created.request.id,
        userId: "user-target",
      }),
    ]);
    await vi.waitFor(() => {
      expect(createAgentProfile).toHaveBeenCalledTimes(2);
    });

    retryCreation.resolve("agt_11111111-1111-4111-8111-111111111111");
    const results = await retries;

    expect(createAgentProfile).toHaveBeenCalledTimes(2);
    expect(
      results.some(
        (result) =>
          result.status === "fulfilled" && result.value.status === "completed"
      )
    ).toBe(true);
  });

  it("turns an abandoned creation claim into an explicit retryable failure", async () => {
    const creation = deferred<string>();
    createAgentProfile.mockReturnValueOnce(creation.promise);
    const service = createService();
    const created = await service.create({
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });
    const approval = service.decide({
      decision: "approve",
      organizationId: "org-1",
      requestId: created.request.id,
      userId: "user-target",
    });
    await vi.waitFor(() => {
      expect(createAgentProfile).toHaveBeenCalledTimes(1);
    });

    await expect(
      failStaleAgentProfileCreationRequests({
        nowMs: NOW_MS + AGENT_PROFILE_CREATION_STALE_AFTER_MS + 10,
        repository,
      })
    ).resolves.toEqual({ markedFailed: 1, scanned: 1, superseded: 0 });

    creation.resolve("agt_11111111-1111-4111-8111-111111111111");
    await expect(approval).resolves.toMatchObject({
      failureMessage:
        "OpenMeld lost contact while creating this Agent. Retry to continue safely.",
      status: "failed",
    });
    await expect(
      service.retry({
        organizationId: "org-1",
        requestId: created.request.id,
        userId: "user-requester",
      })
    ).resolves.toMatchObject({ status: "completed" });
    expect(createAgentProfile).toHaveBeenCalledTimes(2);
  });

  it("checkpoints a committed identity before the initial setup attempt finishes", async () => {
    repository.preference = {
      existingSessionPolicy: "ask_every_time",
      newSessionPolicy: "automatically_allow",
    };
    const agentProfileId = "agt_11111111-1111-4111-8111-111111111111";
    const setup = deferred<string>();
    createAgentProfile.mockImplementationOnce(async (_request, checkpoint) => {
      await checkpoint.checkpointCreatedAgentProfileId(agentProfileId);
      return await setup.promise;
    });
    const service = createService();
    const creation = service.create({
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });

    await vi.waitFor(async () => {
      await expect(
        repository.findByIdempotencyKey({
          idempotencyKey: "request-1",
          organizationId: "org-1",
          requesterUserId: "user-requester",
        })
      ).resolves.toMatchObject({
        createdAgentProfileId: agentProfileId,
        status: "approved",
        statusReason: "profile_created",
      });
    });

    await expect(
      failStaleAgentProfileCreationRequests({
        nowMs: NOW_MS + AGENT_PROFILE_CREATION_STALE_AFTER_MS + 10,
        repository,
      })
    ).resolves.toEqual({ markedFailed: 1, scanned: 1, superseded: 0 });

    setup.resolve(agentProfileId);
    await expect(creation).resolves.toMatchObject({
      request: {
        createdAgentProfileId: agentProfileId,
        failureMessage:
          "OpenMeld lost contact while finishing setup for this Agent. Retry setup to continue safely.",
        status: "failed",
        statusReason: "profile_created",
      },
    });
  });

  it("keeps an abandoned committed-Profile retry in setup-incomplete state", async () => {
    repository.preference = {
      existingSessionPolicy: "ask_every_time",
      newSessionPolicy: "automatically_allow",
    };
    const agentProfileId = "agt_11111111-1111-4111-8111-111111111111";
    createAgentProfile.mockRejectedValueOnce(
      new AgentProfileCreationRequestExecutionError({
        cause: new Error("The selected Computer is no longer reachable."),
        createdAgentProfileId: agentProfileId,
      })
    );
    const retrySetup = deferred<string>();
    createAgentProfile.mockReturnValueOnce(retrySetup.promise);
    const service = createService();
    const created = await service.create({
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });

    const retry = service.retry({
      organizationId: "org-1",
      requestId: created.request.id,
      userId: "user-requester",
    });
    await vi.waitFor(() => {
      expect(createAgentProfile).toHaveBeenCalledTimes(2);
    });

    await expect(
      failStaleAgentProfileCreationRequests({
        nowMs: NOW_MS + AGENT_PROFILE_CREATION_STALE_AFTER_MS + 10,
        repository,
      })
    ).resolves.toEqual({ markedFailed: 1, scanned: 1, superseded: 0 });

    retrySetup.resolve(agentProfileId);
    await expect(retry).resolves.toMatchObject({
      createdAgentProfileId: agentProfileId,
      failureMessage:
        "OpenMeld lost contact while finishing setup for this Agent. Retry setup to continue safely.",
      status: "failed",
      statusReason: "profile_created",
    });
    await expect(
      service.retry({
        organizationId: "org-1",
        requestId: created.request.id,
        userId: "user-requester",
      })
    ).resolves.toMatchObject({
      createdAgentProfileId: agentProfileId,
      status: "completed",
    });
    expect(createAgentProfile).toHaveBeenCalledTimes(3);
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
      statusReason: "profile_created",
    });
  });

  it("keeps a committed Profile retryable after a transient identity checkpoint storage failure", async () => {
    repository.preference = {
      existingSessionPolicy: "ask_every_time",
      newSessionPolicy: "automatically_allow",
    };
    const agentProfileId = "agt_11111111-1111-4111-8111-111111111111";
    repository.identityCheckpointError = new Error(
      "checkpoint storage connection interrupted"
    );
    createAgentProfile.mockImplementationOnce(async (_request, checkpoint) => {
      await checkpoint.checkpointCreatedAgentProfileId(agentProfileId);
      return agentProfileId;
    });
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const service = createService();
    const created = await service.create({
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });

    expect(created.request).toMatchObject({
      createdAgentProfileId: agentProfileId,
      failureMessage:
        "OpenMeld created the Agent, but couldn't finish setup. Retry setup to continue safely.",
      status: "failed",
      statusReason: "profile_created",
    });
    expect(errorLog).toHaveBeenCalledWith(
      "[core.agent_profile_creation_request.execution_failed]",
      expect.objectContaining({
        error: "checkpoint storage connection interrupted",
        requestId: created.request.id,
      })
    );

    // Retry is valid once migration 0149+ provides the current request-state contract.
    await expect(
      service.retry({
        organizationId: "org-1",
        requestId: created.request.id,
        userId: "user-requester",
      })
    ).resolves.toMatchObject({
      createdAgentProfileId: agentProfileId,
      failureMessage: null,
      status: "completed",
      statusReason: "profile_created",
    });
    expect(createAgentProfile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ createdAgentProfileId: agentProfileId }),
      expect.any(Object)
    );
    errorLog.mockRestore();
  });

  it("does not redact ordinary non-checkpoint execution errors based on their message", async () => {
    repository.preference = {
      existingSessionPolicy: "ask_every_time",
      newSessionPolicy: "automatically_allow",
    };
    createAgentProfile.mockRejectedValueOnce(
      new Error("OpenCode model constraint failed during provider setup.")
    );
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const result = await createService().create({
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });

    expect(result.request).toMatchObject({
      createdAgentProfileId: null,
      failureMessage: "OpenCode model constraint failed during provider setup.",
      status: "failed",
      statusReason: "profile_creation_failed",
    });
    expect(errorLog).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("acknowledges durable acceptance without waiting for execution and deduplicates delivery", async () => {
    const service = createService(true);
    const creation = deferred<string>();
    createAgentProfile.mockReturnValue(creation.promise);
    const accepted = await service.create({
      actorProfileId: "human-requester",
      body: requestBody({ targetOwnerUserId: "user-requester" }),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });
    expect(accepted.request.status).toBe("approved");
    expect(createAgentProfile).not.toHaveBeenCalled();
    const selector = { id: accepted.request.id, organizationId: "org-1" };
    const running = service.execute(selector);
    await vi.waitFor(() => expect(createAgentProfile).toHaveBeenCalledOnce());
    expect((await service.execute(selector)).status).toBe("approved");
    creation.resolve("agt_11111111-1111-4111-8111-111111111111");
    expect((await running).status).toBe("completed");
    expect((await service.execute(selector)).status).toBe("completed");
    expect(createAgentProfile).toHaveBeenCalledOnce();
  });

  it("recovers only the requester's exact intent and never exposes another participant's request", async () => {
    const service = createService(true);
    const accepted = await service.create({
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    });
    expect(
      await service.list({
        actorProfileId: "human-requester",
        organizationId: "org-1",
        userId: "user-requester",
        idempotencyKey: "request-1",
      })
    ).toEqual([accepted.request]);
    expect(
      await service.list({
        actorProfileId: "another-profile",
        organizationId: "org-1",
        userId: "user-requester",
        idempotencyKey: "request-1",
      })
    ).toEqual([]);
    expect(
      await service.list({
        organizationId: "org-1",
        userId: "other-user",
        requestId: accepted.request.id,
      })
    ).toEqual([]);
    expect(
      await service.list({
        organizationId: "other-org",
        userId: "user-requester",
        requestId: accepted.request.id,
      })
    ).toEqual([]);
    expect(
      await service.list({
        organizationId: "org-1",
        userId: "user-target",
        idempotencyKey: "request-1",
      })
    ).toEqual([]);
  });

  it("holds teammate admission and replay while preserving self creation", async () => {
    const held = createService(true, false);
    await expect(
      held.setPreference({
        body: {
          newSessionPolicy: "automatically_allow",
          existingSessionPolicy: "automatically_allow",
        },
        organizationId: "org-1",
        userId: "user-requester",
      })
    ).rejects.toBeInstanceOf(AgentProfileCreationRequestForbiddenError);
    const intent = {
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    };
    await expect(held.create(intent)).rejects.toBeInstanceOf(
      AgentProfileCreationRequestForbiddenError
    );
    const accepted = await createService(true).create(intent);
    await expect(held.create(intent)).rejects.toBeInstanceOf(
      AgentProfileCreationRequestForbiddenError
    );
    await expect(
      held.decide({
        organizationId: "org-1",
        requestId: accepted.request.id,
        userId: "user-target",
        decision: "approve",
      })
    ).rejects.toBeInstanceOf(AgentProfileCreationRequestForbiddenError);
    await expect(
      held.retry({
        organizationId: "org-1",
        requestId: accepted.request.id,
        userId: "user-requester",
      })
    ).rejects.toBeInstanceOf(AgentProfileCreationRequestForbiddenError);
    expect(
      await held.list({ organizationId: "org-1", userId: "user-requester" })
    ).toEqual([]);
    expect(createAgentProfile).not.toHaveBeenCalled();
  });

  it("settles queued teammate creation without effects and still completes self creation", async () => {
    const enabled = createService(true);
    const intent = {
      actorProfileId: "human-requester",
      body: requestBody(),
      organizationId: "org-1",
      requesterUserId: "user-requester",
    };
    const accepted = await enabled.create(intent);
    const approved = await enabled.decide({
      organizationId: "org-1",
      requestId: accepted.request.id,
      userId: "user-target",
      decision: "approve",
    });
    const held = createService(true, false);
    const result = await held.execute(approved);
    expect(result.status).toBe("failed");
    expect(result.createdAgentProfileId).toBeNull();
    expect(await held.execute(approved)).toEqual(result);
    expect(createAgentProfile).not.toHaveBeenCalled();

    repository = new InMemoryRepository();
    const self = createService(false, false);
    const own = await self.create({
      ...intent,
      body: requestBody({ targetOwnerUserId: "user-requester" }),
    });
    expect(own.request.status).toBe("completed");
    expect(own.request.createdAgentProfileId).toBeTruthy();
  });

  // Dormant lifecycle coverage explicitly opts in; production defaults stay closed.
  function createService(
    acceptanceOnly = false,
    teammateRequestsEnabled = true
  ) {
    const inboxProjection =
      createAgentProfileCreationRequestInboxProjectionService({
        now: () => NOW_MS,
        project: projectApprovalInbox,
        repository,
        resolve: resolveApprovalInbox,
      });
    const service = createAgentProfileCreationRequestService({
      teammateRequestsEnabled,
      validateNewRequest: async () => {
        // Runtime selection is covered by the RPC boundary tests.
      },
      attemptInboxProjection: inboxProjection.attemptForRequest,
      scheduleExecution: async () => {
        // The fixture delivers explicitly after admission.
      },
      createAgentProfile,
      now: () => NOW_MS,
      randomUuid: () => "22222222-2222-4222-8222-222222222222",
      repository,
    });
    if (acceptanceOnly) {
      return service;
    }
    // Existing lifecycle scenarios exercise admission followed by a separate
    // delivery. Acceptance-only tests above deliberately do not deliver work.
    return {
      ...service,
      create: async (request: Parameters<typeof service.create>[0]) => {
        const result = await service.create(request);
        return { ...result, request: await service.execute(result.request) };
      },
      decide: async (request: Parameters<typeof service.decide>[0]) =>
        await service.execute(await service.decide(request)),
      retry: async (request: Parameters<typeof service.retry>[0]) =>
        await service.execute(await service.retry(request)),
    };
  }
});

function requestBody(
  overrides: Partial<CreateAgentProfileCreationRequestBody> = {}
): CreateAgentProfileCreationRequestBody {
  return {
    configuration: {
      ...DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
      agentControllerRef: "builtin:codex",
      targetComputerId: "device-1",
    },
    idempotencyKey: "request-1",
    profileName: "Release Reviewer",
    sessionStrategy: "new",
    source: "web",
    targetOwnerUserId: "user-target",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

class InMemoryRepository implements AgentProfileCreationRequestRepository {
  listUnclaimedProfileCreations(input: { limit: number }) {
    return Promise.resolve(
      this.records
        .filter(
          (record) =>
            record.status === "approved" &&
            record.profileCreationStartedAtMs === null
        )
        .slice(0, input.limit)
    );
  }
  identityCheckpointError: Error | null = null;
  preference: {
    existingSessionPolicy: AgentProfileCreationApprovalPolicy;
    newSessionPolicy: AgentProfileCreationApprovalPolicy;
  } | null = null;
  private readonly inboxProjections = new Map<
    string,
    Omit<AgentProfileCreationRequestInboxProjectionRecord, "request">
  >();
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

  getInboxProjectionByRequestId(requestId: string) {
    const projection = this.inboxProjections.get(requestId);
    const request = this.records.find((record) => record.id === requestId);
    return Promise.resolve(
      projection && request ? { ...projection, request } : null
    );
  }

  listDueInboxProjections(input: { limit: number; nowMs: number }) {
    return Promise.resolve(
      [...this.inboxProjections.entries()]
        .filter(
          ([, projection]) =>
            (projection.status === "pending" ||
              projection.status === "failed") &&
            (projection.nextRetryAtMs === null ||
              projection.nextRetryAtMs <= input.nowMs)
        )
        .slice(0, input.limit)
        .flatMap(([requestId, projection]) => {
          const request = this.records.find(
            (record) => record.id === requestId
          );
          return request ? [{ ...projection, request }] : [];
        })
    );
  }

  listStaleProfileCreations(input: { limit: number; staleBeforeMs: number }) {
    return Promise.resolve(
      this.records
        .filter(
          (record) =>
            record.status === "approved" &&
            (record.profileCreationStartedAtMs ?? record.updatedAtMs) <=
              input.staleBeforeMs
        )
        .slice(0, input.limit)
    );
  }

  insert(
    record: AgentProfileCreationRequestRecord,
    input?: {
      inboxProjection?: AgentProfileCreationRequestInboxProjectionOperation;
    }
  ) {
    this.records.push(record);
    if (input?.inboxProjection) {
      this.enqueueInboxProjection(record.id, input.inboxProjection);
    }
    return Promise.resolve(record);
  }

  listForParticipant() {
    return Promise.resolve([...this.records]);
  }

  claimProfileCreation(input: {
    expectedProfileCreationStartedAtMs: number | null;
    expectedUpdatedAtMs: number;
    requestId: string;
    startedAtMs: number;
  }) {
    const index = this.records.findIndex(
      (record) =>
        record.id === input.requestId &&
        record.status === "approved" &&
        record.updatedAtMs === input.expectedUpdatedAtMs &&
        record.profileCreationStartedAtMs ===
          input.expectedProfileCreationStartedAtMs
    );
    const current = this.records[index];
    if (!current) {
      return Promise.resolve(null);
    }
    const claimed = {
      ...current,
      profileCreationAttempt: current.profileCreationAttempt + 1,
      profileCreationStartedAtMs: input.startedAtMs,
      updatedAtMs: input.startedAtMs,
    };
    this.records[index] = claimed;
    return Promise.resolve(claimed);
  }

  markInboxProjectionCompleted(input: {
    completedAtMs: number;
    generation: number;
    requestId: string;
  }) {
    const projection = this.inboxProjections.get(input.requestId);
    if (!(projection && projection.generation === input.generation)) {
      if (
        projection &&
        projection.generation > input.generation &&
        projection.status === "completed"
      ) {
        this.inboxProjections.set(input.requestId, {
          ...projection,
          status: "pending",
        });
      }
      return Promise.resolve(false);
    }
    this.inboxProjections.set(input.requestId, {
      ...projection,
      lastError: null,
      nextRetryAtMs: null,
      status: "completed",
    });
    return Promise.resolve(true);
  }

  markInboxProjectionFailed(input: {
    failedAtMs: number;
    generation: number;
    lastError: string;
    nextRetryAtMs: number;
    requestId: string;
  }) {
    const projection = this.inboxProjections.get(input.requestId);
    if (!(projection && projection.generation === input.generation)) {
      if (
        projection &&
        projection.generation > input.generation &&
        projection.status === "completed"
      ) {
        this.inboxProjections.set(input.requestId, {
          ...projection,
          status: "pending",
        });
      }
      return Promise.resolve(false);
    }
    this.inboxProjections.set(input.requestId, {
      ...projection,
      attemptCount: projection.attemptCount + 1,
      lastError: input.lastError,
      nextRetryAtMs: input.nextRetryAtMs,
      status: "failed",
    });
    return Promise.resolve(true);
  }

  synchronizeInboxProjectionIntents(input?: { requestId?: string }) {
    let changed = 0;
    for (const record of this.records) {
      if (input?.requestId && input.requestId !== record.id) {
        continue;
      }
      const operation = record.status === "pending" ? "project" : "resolve";
      const current = this.inboxProjections.get(record.id);
      if (current?.operation === operation) {
        continue;
      }
      this.enqueueInboxProjection(record.id, operation);
      changed += 1;
    }
    return Promise.resolve(changed);
  }

  transition(input: {
    expectedProfileCreationAttempt?: number;
    expectedStatuses: AgentProfileCreationRequestRecord["status"][];
    expectedUpdatedAtMs: number;
    inboxProjection?: AgentProfileCreationRequestInboxProjectionOperation;
    requestId: string;
    update: Partial<AgentProfileCreationRequestRecord>;
  }): Promise<AgentProfileCreationRequestRecord | null> {
    if (
      this.identityCheckpointError &&
      input.update.createdAgentProfileId &&
      input.update.status === undefined
    ) {
      const error = this.identityCheckpointError;
      this.identityCheckpointError = null;
      return Promise.reject(error);
    }
    const index = this.records.findIndex(
      (record) =>
        record.id === input.requestId &&
        input.expectedStatuses.includes(record.status) &&
        record.updatedAtMs === input.expectedUpdatedAtMs &&
        (input.expectedProfileCreationAttempt === undefined ||
          record.profileCreationAttempt ===
            input.expectedProfileCreationAttempt)
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
    if (input.inboxProjection) {
      this.enqueueInboxProjection(updated.id, input.inboxProjection);
    }
    return Promise.resolve(updated);
  }

  upsertPreference(): Promise<never> {
    return Promise.reject(new Error("not implemented in this test"));
  }

  private enqueueInboxProjection(
    requestId: string,
    operation: AgentProfileCreationRequestInboxProjectionOperation
  ) {
    const current = this.inboxProjections.get(requestId);
    this.inboxProjections.set(requestId, {
      attemptCount: 0,
      generation: (current?.generation ?? 0) + 1,
      lastError: null,
      nextRetryAtMs: null,
      operation,
      status: "pending",
    });
  }
}
