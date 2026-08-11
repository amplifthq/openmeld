import { describe, expect, it } from "vitest";
import {
  CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION,
  CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER,
  centerAgentCreateTaskToolRpcInputSchema,
  centerAgentTaskAttemptSchema,
  centerAgentTaskDetailSchema,
  centerAgentTaskEventSchema,
  centerAgentTaskResponseContractVersionHeaderSchema,
  centerAgentTaskResponseV1Schema,
  centerAgentTaskResponseV2Schema,
  centerAgentTaskSchema,
  continueCenterAgentTaskBodySchema,
  continueCenterAgentTaskRpcInputSchema,
  createCenterAgentTaskResponseSchema,
  getCenterAgentTaskRpcInputSchema,
  listCenterAgentTasksResponseSchema,
  listCenterAgentTasksRpcInputSchema,
  retryCenterAgentTaskBodySchema,
  retryCenterAgentTaskRpcInputSchema,
  stopCenterAgentTaskBodySchema,
  stopCenterAgentTaskRpcInputSchema,
} from "../../src/schemas/http/center-agent-tasks";

const CREATED_AT = "2026-08-08T01:00:00.000Z";
const UPDATED_AT = "2026-08-08T01:01:00.000Z";

const queuedTask = {
  activeAttemptGeneration: null,
  createdAt: CREATED_AT,
  finishedAt: null,
  goal: "Research the current onboarding flow and summarize the gaps.",
  id: "center-agent-task-1",
  organizationId: "organization-1",
  origin: { kind: "open_meld" },
  requesterUserId: "user-1",
  status: "queued",
  title: "Review onboarding flow",
  updatedAt: CREATED_AT,
  version: 1,
} as const;

const queuedTaskProjection = {
  ...queuedTask,
  outcome: null,
  phase: "queued",
  state: "active",
} as const;

describe("Center Agent Task HTTP contracts", () => {
  it("defines a model-tool-only create contract with attributed request context", () => {
    const input = {
      context: {
        activeOrganizationId: "organization-1",
        actorContext: {
          callerPrincipalId: "user-1",
          profileKind: "agent" as const,
          requestId: "request-1",
          openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
        },
        agentControllerConversationId: "conversation-1",
      },
      goal: queuedTask.goal,
      idempotencyKey: "create-task-1",
      speakerMember: { memberId: "member-1", userId: "user-1" },
      submissionId: "submission-1",
      title: queuedTask.title,
    };

    expect(centerAgentCreateTaskToolRpcInputSchema.parse(input)).toEqual(input);
    expect(
      centerAgentCreateTaskToolRpcInputSchema.safeParse({
        ...input,
        requesterUserId: "user-1",
      }).success
    ).toBe(false);
    expect(
      createCenterAgentTaskResponseSchema.parse({ task: queuedTask })
    ).toEqual({
      task: queuedTaskProjection,
    });
  });

  it("derives one canonical product state, phase, and outcome projection", () => {
    const result = centerAgentTaskSchema.parse(queuedTask);
    const messageChannelTask = {
      ...queuedTask,
      origin: {
        destination: {
          appId: "cli_aad19a1d2f389ed3",
          chatId: "oc_private_provider_chat",
          connectionId: "connection_123",
          provider: "lark",
          rootMessageId: "om_root_message_123",
          tenantKey: "tenant_123",
          threadId: "omt_thread_123",
        },
        kind: "message_channel",
      },
      requesterUserId: null,
    } as const;

    expect(result).toEqual(queuedTaskProjection);
    expect(result).not.toHaveProperty("boardLane");
    expect(centerAgentTaskSchema.parse(messageChannelTask)).toEqual({
      ...messageChannelTask,
      outcome: null,
      phase: "queued",
      state: "active",
    });
    expect(
      centerAgentTaskSchema.parse({
        ...queuedTask,
        activeAttemptGeneration: 1,
        status: "running",
        updatedAt: UPDATED_AT,
      })
    ).toMatchObject({ outcome: null, phase: null, state: "active" });
    expect(
      centerAgentTaskSchema.parse({
        ...queuedTask,
        activeAttemptGeneration: 1,
        executionEvidence: {
          attemptGeneration: 1,
          kind: "native_delivery",
          observedAt: UPDATED_AT,
        },
        status: "running",
        updatedAt: UPDATED_AT,
      })
    ).toMatchObject({ outcome: null, phase: "working", state: "active" });
    expect(
      centerAgentTaskSchema.parse({
        ...queuedTask,
        activeAttemptGeneration: 1,
        status: "stopping",
        updatedAt: UPDATED_AT,
      })
    ).toMatchObject({ outcome: null, phase: "stopping", state: "active" });
    expect(
      centerAgentTaskSchema.parse({
        ...queuedTask,
        activeAttemptGeneration: 1,
        finishedAt: UPDATED_AT,
        status: "succeeded",
        updatedAt: UPDATED_AT,
      })
    ).toMatchObject({ outcome: "completed", phase: null, state: "finished" });
    expect(
      centerAgentTaskSchema.safeParse({
        ...queuedTask,
        origin: { kind: "message_channel", provider: "lark" },
        requesterUserId: null,
      }).success
    ).toBe(false);
  });

  it("keeps the version-one response shape explicit during rolling deployment", () => {
    const runningTask = {
      ...queuedTask,
      activeAttemptGeneration: 1,
      status: "running" as const,
      updatedAt: UPDATED_AT,
    };

    expect(centerAgentTaskResponseV1Schema.parse(runningTask)).toMatchObject({
      outcome: null,
      phase: "working",
      state: "active",
    });
    expect(
      centerAgentTaskResponseV1Schema.safeParse({
        ...runningTask,
        executionEvidence: {
          attemptGeneration: 1,
          kind: "native_delivery",
          observedAt: UPDATED_AT,
        },
      }).success
    ).toBe(false);
    expect(CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION).toBe(3);
    expect(CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER).toBe(
      "x-openmeld-center-agent-task-response-version"
    );
    expect(centerAgentTaskResponseContractVersionHeaderSchema.parse("2")).toBe(
      2
    );
    expect(centerAgentTaskResponseContractVersionHeaderSchema.parse("3")).toBe(
      3
    );
    expect(
      centerAgentTaskResponseContractVersionHeaderSchema.safeParse("02").success
    ).toBe(false);
  });

  it("adds requester and Local Agent provenance only to the version-three Task", () => {
    const attributedTask = {
      ...queuedTask,
      origin: {
        kind: "open_meld" as const,
        localAgent: { client: "codex", kind: "local_agent" as const },
        requestedBy: {
          displayName: "Mira",
          profileId: "human-1",
          userId: "user-1",
        },
      },
    };

    expect(centerAgentTaskSchema.parse(attributedTask).origin).toEqual(
      attributedTask.origin
    );
    expect(
      centerAgentTaskResponseV2Schema.safeParse(attributedTask).success
    ).toBe(false);
    expect(
      centerAgentTaskSchema.safeParse({
        ...attributedTask,
        origin: {
          ...attributedTask.origin,
          localAgent: {
            ...attributedTask.origin.localAgent,
            sessionId: "private-thread-id",
          },
        },
      }).success
    ).toBe(false);
  });

  it("rejects task timestamps or active generations that contradict status", () => {
    const invalidRunning = centerAgentTaskSchema.safeParse({
      ...queuedTask,
      status: "running",
    });
    const invalidTerminal = centerAgentTaskSchema.safeParse({
      ...queuedTask,
      activeAttemptGeneration: 1,
      status: "succeeded",
    });
    const invalidQueued = centerAgentTaskSchema.safeParse({
      ...queuedTask,
      finishedAt: UPDATED_AT,
    });

    expect(invalidRunning.success).toBe(false);
    expect(invalidTerminal.success).toBe(false);
    expect(invalidQueued.success).toBe(false);
    expect(
      centerAgentTaskSchema.safeParse({
        ...queuedTask,
        activeAttemptGeneration: 1,
        executionEvidence: {
          attemptGeneration: 2,
          kind: "native_delivery",
          observedAt: UPDATED_AT,
        },
        status: "running",
        updatedAt: UPDATED_AT,
      }).success
    ).toBe(false);
    expect(
      centerAgentTaskSchema.safeParse({
        ...queuedTask,
        activeAttemptGeneration: 1,
        executionEvidence: {
          attemptGeneration: 1,
          kind: "native_delivery",
          observedAt: UPDATED_AT,
        },
        status: "stopping",
        updatedAt: UPDATED_AT,
      }).success
    ).toBe(false);
  });

  it("accepts attempts only when lifecycle fields match their status", () => {
    const attempt = {
      createdAt: CREATED_AT,
      failureCode: null,
      finishedAt: null,
      generation: 1,
      id: "attempt-1",
      startedAt: UPDATED_AT,
      status: "running",
      taskHandle: {
        deliveryId: "delivery-1",
        kind: "native_delivery",
        v: 1,
      },
      taskId: queuedTask.id,
    } as const;

    expect(centerAgentTaskAttemptSchema.parse(attempt)).toEqual(attempt);
    expect(
      centerAgentTaskAttemptSchema.parse({
        ...attempt,
        status: "stopping",
      })
    ).toMatchObject({ finishedAt: null, status: "stopping" });
    expect(
      centerAgentTaskAttemptSchema.safeParse({
        ...attempt,
        failureCode: "execution_failed",
      }).success
    ).toBe(false);
    expect(
      centerAgentTaskAttemptSchema.safeParse({
        ...attempt,
        finishedAt: UPDATED_AT,
        startedAt: CREATED_AT,
        status: "failed",
      }).success
    ).toBe(false);
  });

  it("keeps visible activity bounded and explicitly attributed", () => {
    const event = {
      actor: "center_agent",
      attemptGeneration: 1,
      id: "event-1",
      kind: "center_agent_update",
      occurredAt: UPDATED_AT,
      taskId: queuedTask.id,
      text: "I am comparing the current entry points now.",
    } as const;

    expect(centerAgentTaskEventSchema.parse(event)).toEqual(event);
    expect(
      centerAgentTaskEventSchema.parse({
        ...event,
        actor: "requester",
        kind: "stop_requested",
        text: "Stop requested. Waiting to confirm the current work has stopped.",
      })
    ).toMatchObject({ kind: "stop_requested" });
    expect(
      centerAgentTaskEventSchema.safeParse({
        ...event,
        text: "x".repeat(4001),
      }).success
    ).toBe(false);
  });

  it("provides stable list, detail, and mutation payloads without a stored lane", () => {
    expect(
      listCenterAgentTasksResponseSchema.parse({
        nextCursor: null,
        organizationId: queuedTask.organizationId,
        tasks: [queuedTask],
      }).tasks
    ).toHaveLength(1);
    expect(
      centerAgentTaskDetailSchema.parse({
        attempts: [],
        events: [],
        task: queuedTask,
      })
    ).toEqual({ attempts: [], events: [], task: queuedTaskProjection });
    expect(
      continueCenterAgentTaskBodySchema.parse({
        expectedVersion: 1,
        idempotencyKey: "continue-1",
        text: "Also compare the Slack entry point.",
      })
    ).toEqual({
      expectedVersion: 1,
      idempotencyKey: "continue-1",
      text: "Also compare the Slack entry point.",
    });
    expect(stopCenterAgentTaskBodySchema.parse({ expectedVersion: 1 })).toEqual(
      { expectedVersion: 1 }
    );
    expect(
      retryCenterAgentTaskBodySchema.parse({
        expectedVersion: 2,
        idempotencyKey: "retry-1",
      })
    ).toEqual({ expectedVersion: 2, idempotencyKey: "retry-1" });
  });

  it("composes strict cross-service RPC inputs from the HTTP contracts", () => {
    const context = {
      activeOrganizationId: "organization-1",
      actorContext: {
        callerPrincipalId: "user-1",
        profileKind: "human" as const,
        requestId: "request-1",
        openMeldProfileId: "11111111-1111-4111-8111-111111111111",
      },
    };
    expect(
      listCenterAgentTasksRpcInputSchema.parse({
        context,
        limit: 20,
        responseContractVersion: 2,
      })
    ).toEqual({ context, limit: 20, responseContractVersion: 2 });
    expect(
      getCenterAgentTaskRpcInputSchema.parse({
        context,
        taskId: queuedTask.id,
      })
    ).toEqual({ context, taskId: queuedTask.id });
    expect(
      continueCenterAgentTaskRpcInputSchema.parse({
        context,
        expectedVersion: 1,
        idempotencyKey: "continue-1",
        taskId: queuedTask.id,
        text: "Also compare Slack.",
      })
    ).toMatchObject({ idempotencyKey: "continue-1", taskId: queuedTask.id });
    expect(
      stopCenterAgentTaskRpcInputSchema.parse({
        context,
        expectedVersion: 1,
        taskId: queuedTask.id,
      })
    ).toMatchObject({ taskId: queuedTask.id });
    expect(
      retryCenterAgentTaskRpcInputSchema.safeParse({
        context,
        expectedVersion: 2,
        idempotencyKey: "retry-1",
        taskId: queuedTask.id,
        unknown: true,
      }).success
    ).toBe(false);
    expect(
      getCenterAgentTaskRpcInputSchema.safeParse({
        context,
        responseContractVersion: 1,
        taskId: queuedTask.id,
      }).success
    ).toBe(false);
  });
});
