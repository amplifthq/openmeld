import type {
  RemoteAgentWorkerSubmitTurnRequest,
  SignalEnvelope,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { readCenterAgentTaskConversationContinuity } from "../src/center-agent-tasks/application/center-agent-task-conversation-continuity";
import { createCenterAgentTask } from "../src/center-agent-tasks/infrastructure/d1/center-agent-task-repo";
import type { CoreBindings } from "../src/lib/bindings";
import { buildRemoteAgentConversationContinuityContext } from "../src/remote-agent/application/remote-agent-conversation-continuity";
import { resolveSpaceDispatchConversationContinuityScope } from "../src/space/application/space-dispatch-conversation-continuity";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const SPACE_ID = "0123456789abcdef".repeat(4);
const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

describe("Remote Agent conversation rollover continuity", () => {
  it("keeps the Space dispatch's frozen main or thread scope", () => {
    const identity = {
      sourceSignalId: "source",
      spaceId: SPACE_ID,
      targetProfileId: AGENT_PROFILE_ID,
    };

    expect(
      resolveSpaceDispatchConversationContinuityScope({
        ...identity,
        dispatch: {
          sourceEventId: "source",
          spaceId: SPACE_ID,
          targetProfileId: AGENT_PROFILE_ID,
        },
        readSourceThreadId: () => "thread-interleaved",
        readThreadRootSignalId: () => "root-interleaved",
      })
    ).toEqual({ ok: true, scope: { kind: "main" } });
    expect(
      resolveSpaceDispatchConversationContinuityScope({
        ...identity,
        dispatch: {
          sourceEventId: "source",
          spaceId: SPACE_ID,
          targetProfileId: AGENT_PROFILE_ID,
          threadContext: { rootSignalId: "root-1", threadId: "thread-1" },
        },
        readSourceThreadId: () => "thread-1",
        readThreadRootSignalId: () => "root-1",
      })
    ).toEqual({
      ok: true,
      scope: {
        kind: "thread",
        threadContext: { rootSignalId: "root-1", threadId: "thread-1" },
      },
    });
    expect(
      resolveSpaceDispatchConversationContinuityScope({
        ...identity,
        dispatch: {
          sourceEventId: "source",
          spaceId: SPACE_ID,
          targetProfileId: AGENT_PROFILE_ID,
          threadContext: { rootSignalId: "root-1", threadId: "thread-1" },
        },
        readSourceThreadId: () => "thread-2",
        readThreadRootSignalId: () => "root-1",
      })
    ).toEqual({ code: "space.continuity.thread_mismatch", ok: false });
  });

  it("asks the Space owner for the exact dispatch conversation instead of the main timeline", async () => {
    const rpcListSignalsResult = vi.fn(() => {
      throw new Error("generic main-timeline history must not be read");
    });
    const rpcListDispatchConversationContinuitySignalsResult = vi.fn(
      async () => ({
        ok: true as const,
        value: {
          nextCursor: null,
          signals: [
            createTextSignal("thread-root", "Root question", 100),
            createTextSignal("thread-reply", "Thread-only detail", 200),
          ],
        },
      })
    );
    const request = createSpaceRequest();

    await expect(
      buildRemoteAgentConversationContinuityContext({
        db: {} as D1Database,
        env: {
          OPENMELD_SPACES: createSpaceNamespace({
            rpcListDispatchConversationContinuitySignalsResult,
            rpcListSignalsResult,
          }),
        } as unknown as CoreBindings,
        generation: 1,
        request,
      })
    ).resolves.toMatchObject({
      entries: [
        {
          content: { text: "Root question" },
          source: { signalId: "thread-root" },
        },
        {
          content: { text: "Thread-only detail" },
          source: { signalId: "thread-reply" },
        },
      ],
      fromGeneration: 0,
      toGeneration: 1,
    });

    expect(rpcListSignalsResult).not.toHaveBeenCalled();
    expect(
      rpcListDispatchConversationContinuitySignalsResult
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        aroundSignalId: request.triggerMessageId,
        beforeCount: 21,
        spaceId: SPACE_ID,
        spaceAccess: expect.objectContaining({
          actor: expect.objectContaining({
            dispatchId: request.dispatchId,
            sourceSignalId: request.triggerMessageId,
            targetProfileId: AGENT_PROFILE_ID,
          }),
        }),
      })
    );
  });

  it("preserves the Space owner's continuity failure code", async () => {
    const request = createSpaceRequest();

    await expect(
      buildRemoteAgentConversationContinuityContext({
        db: {} as D1Database,
        env: {
          OPENMELD_SPACES: createSpaceNamespace({
            rpcListDispatchConversationContinuitySignalsResult: async () => ({
              code: "space.continuity.thread_mismatch",
              message:
                "The dispatch thread no longer matches its source Signal.",
              ok: false as const,
              status: 409,
            }),
          }),
        } as unknown as CoreBindings,
        generation: 1,
        request,
      })
    ).rejects.toMatchObject({
      code: "space.continuity.thread_mismatch",
    });
  });

  it("uses the Task owner's typed bounded projection and canonical actor mapping", async () => {
    const harness = createTaskHarness();
    try {
      await createCenterAgentTask({
        db: harness.db,
        goal: "Investigate the issue.",
        idempotencyKey: "create-task-1",
        nowMs: 1,
        organizationId: "org-a",
        origin: { kind: "open_meld" },
        requesterUserId: "user-a",
        taskId: "task-1",
        title: "Investigate",
      });
      insertTaskEvent(harness, {
        actor: "system",
        id: "event-oldest",
        occurredAtMs: 50,
        observedAtMs: 50,
        text: "Old bounded context.",
      });
      insertTaskEvent(harness, {
        actor: "requester",
        id: "event-requester",
        occurredAtMs: 100,
        observedAtMs: 100,
        text: "Please investigate.",
      });
      insertTaskEvent(harness, {
        actor: "center_agent",
        id: "event-agent",
        occurredAtMs: 200,
        observedAtMs: 200,
        text: "I found the cause.",
      });
      insertTaskEvent(harness, {
        actor: "system",
        id: "event-system",
        occurredAtMs: 300,
        observedAtMs: 300,
        text: "Retrying safely.",
      });
      insertTaskEvent(harness, {
        actor: "requester",
        id: "event-current",
        occurredAtMs: 400,
        observedAtMs: 400,
        text: "Continue.",
      });
      insertTaskEvent(harness, {
        actor: "center_agent",
        id: "event-later",
        occurredAtMs: 500,
        observedAtMs: 500,
        text: "Must not cross the trigger.",
      });

      await expect(
        readCenterAgentTaskConversationContinuity({
          db: harness.db,
          limit: 3,
          organizationId: "org-a",
          taskId: "task-1",
          triggerEventId: "event-current",
        })
      ).resolves.toEqual({
        entries: [
          expect.objectContaining({
            authorKind: "human",
            eventId: "event-requester",
          }),
          expect.objectContaining({
            authorKind: "agent",
            eventId: "event-agent",
          }),
          expect.objectContaining({
            authorKind: "system",
            eventId: "event-system",
          }),
        ],
        truncated: true,
      });
    } finally {
      harness.close();
    }
  });

  it("fails closed when the exact Task trigger event is unavailable", async () => {
    const harness = createTaskHarness();
    try {
      await createCenterAgentTask({
        db: harness.db,
        goal: "Investigate the issue.",
        idempotencyKey: "create-task-missing-trigger",
        nowMs: 1,
        organizationId: "org-a",
        origin: { kind: "open_meld" },
        requesterUserId: "user-a",
        taskId: "task-missing-trigger",
        title: "Investigate",
      });

      await expect(
        readCenterAgentTaskConversationContinuity({
          db: harness.db,
          limit: 3,
          organizationId: "org-a",
          taskId: "task-missing-trigger",
          triggerEventId: "event-missing",
        })
      ).rejects.toMatchObject({
        code: "center_agent_task.continuity.trigger_not_found",
      });
    } finally {
      harness.close();
    }
  });
});

function createSpaceRequest(): Exclude<
  RemoteAgentWorkerSubmitTurnRequest,
  { v: 1 }
> {
  return {
    v: 2,
    agentProfileId: AGENT_PROFILE_ID,
    agentProfileOwnerUserId: "user-1",
    author: {
      displayName: "Center Agent",
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
    },
    bindingId: "binding-1",
    dispatchId: "dispatch-1",
    idempotencyKey: "turn-1",
    messages: [{ content: "Continue.", role: "user" }],
    modelRoute: {
      automaticModelFallback: false,
      catalogUpdatedAt: "2026-08-12T00:00:00.000Z",
      contextWindow: 128_000,
      displayName: "Test model",
      imageUnderstandingModel: {
        contextWindow: 128_000,
        displayName: "Test vision model",
        inputModalities: ["text", "image"],
        maxOutputTokens: 8192,
        modelId: "test/vision",
        provider: "openrouter",
        reasoningLevel: "medium",
      },
      inputModalities: ["text"],
      maxOutputTokens: 8192,
      modelId: "test/model",
      preference: { kind: "system_default" },
      provider: "openrouter",
      reasoningLevel: "medium",
    },
    onBehalfOf: {
      displayName: "Felix",
      profileId: "00000000-0000-4000-8000-000000000001",
      profileKind: "human",
    },
    organizationId: "org-a",
    sourceClientMessageId: null,
    spaceId: SPACE_ID,
    triggerMessageId: "thread-current",
    turnEnvelope: {
      centerAgent: {
        profileHandle: "center-agent",
        profileName: "Center Agent",
      },
      organization: {
        id: "org-a",
        memberCount: 2,
        name: "OpenMeld",
        personal: false,
      },
      sender: {
        displayName: "Felix",
        id: "member-1",
        kind: "member",
        ownerUserId: "user-1",
        profileId: "00000000-0000-4000-8000-000000000001",
        verified: true,
      },
      space: {
        id: SPACE_ID,
        isCenterAgentDm: false,
        kind: "space",
        name: "Engineering",
      },
      trigger: { source: "space_wake" },
    },
  };
}

function createTextSignal(
  id: string,
  text: string,
  ts: number
): SignalEnvelope {
  return {
    data: { text },
    id,
    profile: {
      kind: "human",
      profileId: "00000000-0000-4000-8000-000000000001",
      profileName: "Felix",
    },
    spaceId: SPACE_ID,
    ts,
    type: "signal.text",
    v: 1,
  };
}

function createSpaceNamespace(
  stub: Record<string, unknown>
): DurableObjectNamespace {
  return {
    get: () => stub as unknown as DurableObjectStub,
    idFromString: (value: string) => ({ toString: () => value }),
  } as unknown as DurableObjectNamespace;
}

function createTaskHarness() {
  const harness = createSqliteD1Harness();
  harness.run({ sql: "CREATE TABLE users (id text PRIMARY KEY NOT NULL)" });
  harness.run({
    sql: "CREATE TABLE organizations (id text PRIMARY KEY NOT NULL)",
  });
  harness.run({ sql: "INSERT INTO users (id) VALUES ('user-a')" });
  harness.run({ sql: "INSERT INTO organizations (id) VALUES ('org-a')" });
  applyDrizzleMigrationsForTables(harness, [
    "center_agent_tasks",
    "center_agent_task_events",
  ]);
  return harness;
}

function insertTaskEvent(
  harness: ReturnType<typeof createTaskHarness>,
  input: {
    actor: "center_agent" | "requester" | "system";
    id: string;
    occurredAtMs: number;
    observedAtMs: number;
    text: string;
  }
): void {
  harness.run({
    params: [
      input.id,
      input.id,
      input.actor,
      input.text,
      input.occurredAtMs,
      input.observedAtMs,
    ],
    sql: `
      INSERT INTO center_agent_task_events (
        id,
        task_id,
        organization_id,
        idempotency_key,
        attempt_generation,
        kind,
        actor,
        text,
        occurred_at_ms,
        observed_at_ms
      ) VALUES (?, 'task-1', 'org-a', ?, NULL, 'center_agent_update', ?, ?, ?, ?)
    `,
  });
}
