import { PostgresDatabase } from "@openmeld/db/postgresql";
import type {
  RemoteAgentWorkerSubmitTurnRequest,
  SignalEnvelope,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  buildRemoteAgentConversationContinuityContext,
  resolveCenterAgentSpaceConversationId,
} from "../src/remote-agent/application/remote-agent-conversation-continuity";
import { resolveSpaceDispatchConversationContinuityScope } from "../src/space/application/space-dispatch-conversation-continuity";

const SPACE_ID = "0123456789abcdef".repeat(4);
const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

describe("Remote Agent conversation rollover continuity", () => {
  it.each([
    false,
    true,
  ])("keeps rollover root isolation while retaining Center Agent DM history=%s", async (dm) => {
    const request = createSpaceRequest();
    request.turnEnvelope.space.isCenterAgentDm = dm;
    request.turnEnvelope.space.kind = dm ? "dm" : "space";
    request.conversationId = resolveCenterAgentSpaceConversationId({
      spaceId: request.spaceId,
      sourceSignalId: request.triggerMessageId,
      isCenterAgentDm: dm,
    });
    const rootReader = vi.fn(async () => ({
      ok: true as const,
      value: {
        nextCursor: null,
        signals: [
          createTextSignal(
            request.triggerMessageId,
            "Original walkthrough",
            100
          ),
          createTextSignal("own-result", "27 original operations", 200),
        ],
      },
    }));
    const mainReader = vi.fn(async () => ({
      ok: true as const,
      value: {
        nextCursor: null,
        signals: [createTextSignal("other-main", "Other main history", 90)],
      },
    }));
    const result = await buildRemoteAgentConversationContinuityContext({
      db: new PostgresDatabase({
        connectionString: "postgresql://127.0.0.1:1/unexpected_database_access",
      }),
      env: {
        OPENMELD_SPACES: createSpaceNamespace({
          rpcListRequestRootContinuitySignalsResult: rootReader,
          rpcListDispatchConversationContinuitySignalsResult: mainReader,
        }),
      } as unknown as CoreBindings,
      generation: 1,
      request,
    });
    expect(result.entries.map((entry) => entry.content.text)).toEqual(
      dm
        ? ["Other main history"]
        : ["Original walkthrough", "27 original operations"]
    );
    expect(rootReader).toHaveBeenCalledTimes(dm ? 0 : 1);
    expect(mainReader).toHaveBeenCalledTimes(dm ? 1 : 0);
  });
  it("keeps one request root across approvals without changing Center Agent DM continuity", () => {
    const base = { spaceId: SPACE_ID, isCenterAgentDm: false };
    const initial = resolveCenterAgentSpaceConversationId({
      ...base,
      sourceSignalId: "walkthrough",
    });
    const approvals = Array.from({ length: 27 }, (_, index) =>
      resolveCenterAgentSpaceConversationId({
        ...base,
        sourceSignalId: `approval-${index}`,
        threadContext: {
          threadId: "thr-walkthrough",
          rootSignalId: "walkthrough",
        },
      })
    );
    expect(new Set(approvals)).toEqual(new Set([initial]));
    expect(
      resolveCenterAgentSpaceConversationId({
        ...base,
        sourceSignalId: "circle",
      })
    ).not.toBe(initial);
    expect(
      resolveCenterAgentSpaceConversationId({
        ...base,
        sourceSignalId: "dm-first",
        isCenterAgentDm: true,
      })
    ).toBe(SPACE_ID);
    expect(
      resolveCenterAgentSpaceConversationId({
        ...base,
        sourceSignalId: "dm-followup",
        isCenterAgentDm: true,
      })
    ).toBe(SPACE_ID);
  });
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
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
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
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
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
