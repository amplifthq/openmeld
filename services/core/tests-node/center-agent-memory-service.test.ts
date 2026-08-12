import {
  REMOTE_AGENT_TURN_ENVELOPE_MEMORY_ITEM_TEXT_MAX_CHARS,
  remoteAgentWorkerSubmitTurnRequestSchema,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  buildCenterAgentMemberMemoryRef,
  buildCenterAgentOrganizationMemoryRef,
  CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS,
  type CenterAgentMemoryAdapter,
  type CenterAgentMemoryNativeDeliveryLedger,
  type CenterAgentMemoryRepository,
  type RecallCenterAgentMemoryForTurnInput,
  type RecallCenterAgentMemoryForTurnResult,
  type RememberCenterAgentTurnInput,
} from "../src/center-agent-memory/contract";
import { createCenterAgentMemoryService } from "../src/center-agent-memory/memory-service";

describe("Center Agent memory service", () => {
  it("writes CA-DM turns only to the speaker member graph", async () => {
    const adapter = createAdapter();
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: true }),
    });

    await service.rememberTurn(createRememberInput({ source: "ca_dm" }));

    expect(adapter.ensureMemberUser).toHaveBeenCalledWith(
      expect.objectContaining({
        zepUserId: "org:org_1:member:user_1",
      })
    );
    expect(adapter.ensureOrganizationGraph).not.toHaveBeenCalled();
    expect(adapter.addEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: expect.objectContaining({
          subject: expect.objectContaining({ kind: "member" }),
        }),
      })
    );
  });

  it("does not write or recall organization memory while org opt-in is off", async () => {
    const adapter = createAdapter();
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: false }),
    });

    await service.rememberTurn(
      createRememberInput({ source: "space_conversation" })
    );
    const memory = await service.recallForTurn(createRecallInput());

    expect(memory.items).toHaveLength(1);
    expect(adapter.ensureOrganizationGraph).not.toHaveBeenCalled();
    expect(adapter.addEpisode).not.toHaveBeenCalled();
    expect(adapter.search).toHaveBeenCalledTimes(1);
    expect(adapter.search).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: expect.objectContaining({
          subject: expect.objectContaining({
            kind: "member",
            userId: "user_1",
          }),
        }),
      })
    );
  });

  it("recalls only enabled Organization memory for an unattended Routine", async () => {
    const adapter = createAdapter();
    const repository = createRepository({ organizationMemoryOptIn: true });
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository,
    });

    const memory = await service.recallForOrganization({
      organizationId: "org_1",
      query: "Review feedback trends.",
    });

    expect(memory.items).toEqual([
      expect.objectContaining({ subject: "organization" }),
    ]);
    expect(repository.upsertMemberSubject).not.toHaveBeenCalled();
    expect(repository.upsertOrganizationSubject).toHaveBeenCalledTimes(1);
    expect(adapter.search).toHaveBeenCalledTimes(1);
  });

  it("never sends an oversized search query to the memory adapter", async () => {
    const adapter = createAdapter();
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: true }),
    });

    await service.recallForOrganization({
      organizationId: "org_1",
      query: "q".repeat(500),
    });

    const adapterQuery = vi.mocked(adapter.search).mock.calls[0]?.[0].query;
    expect(adapterQuery?.length).toBeLessThanOrEqual(
      CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS
    );
  });

  it("writes Slack turns only to organization memory when org opt-in is on", async () => {
    const adapter = createAdapter();
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: true }),
    });

    await service.rememberTurn(
      createRememberInput({ source: "slack_conversation" })
    );

    expect(adapter.ensureMemberUser).not.toHaveBeenCalled();
    expect(adapter.ensureOrganizationGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        zepGraphId: "org:org_1:center-agent",
      })
    );
    expect(adapter.addEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        episode: expect.objectContaining({ source: "slack_conversation" }),
        ref: expect.objectContaining({
          subject: expect.objectContaining({ kind: "organization" }),
        }),
      })
    );
  });

  it("does not write Slack turns when org opt-in is off", async () => {
    const adapter = createAdapter();
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: false }),
    });

    await service.rememberTurn(
      createRememberInput({ source: "slack_conversation" })
    );

    expect(adapter.ensureMemberUser).not.toHaveBeenCalled();
    expect(adapter.ensureOrganizationGraph).not.toHaveBeenCalled();
    expect(adapter.addEpisode).not.toHaveBeenCalled();
  });

  it("writes explicit organization memory requests only to organization memory", async () => {
    const adapter = createAdapter();
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: true }),
    });

    await service.rememberFactForOrganization({
      fact: "The launch owner is Maya.",
      organizationId: "org_1",
      origin: {
        messageChannelProvider: "lark",
        occurredAtMs: 1200,
        source: "message_channel_conversation",
        sourceConversationId: "lark:connection_1:chat_1:message_1",
        sourceMessageId: "msg_1",
      },
      speakerMember: { memberId: "member_1", userId: "user_1" },
    });

    expect(adapter.ensureMemberUser).not.toHaveBeenCalled();
    expect(adapter.ensureOrganizationGraph).toHaveBeenCalled();
    expect(adapter.addEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        episode: expect.objectContaining({
          assistantMessage:
            "Saved to organization memory: The launch owner is Maya.",
          captureMethod: "explicit_save",
          messageChannelProvider: "lark",
          source: "message_channel_conversation",
          userMessage: "The launch owner is Maya.",
        }),
        ref: expect.objectContaining({
          subject: expect.objectContaining({ kind: "organization" }),
        }),
      })
    );
  });

  it("rejects explicit organization memory requests while org opt-in is off", async () => {
    const adapter = createAdapter();
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: false }),
    });

    await expect(
      service.rememberFactForOrganization({
        fact: "The launch owner is Maya.",
        organizationId: "org_1",
        origin: {
          occurredAtMs: 1200,
          source: "ca_dm",
          sourceConversationId: "dm_1",
          sourceMessageId: "msg_1",
        },
        speakerMember: { memberId: "member_1", userId: "user_1" },
      })
    ).rejects.toThrow(
      "center_agent_memory.organization_memory_opt_in_required"
    );
    expect(adapter.ensureOrganizationGraph).not.toHaveBeenCalled();
    expect(adapter.addEpisode).not.toHaveBeenCalled();
  });

  it("recalls only the current speaker member graph for shared Space personalization", async () => {
    const adapter = createAdapter();
    const repository = createRepository({ organizationMemoryOptIn: true });
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository,
    });

    await service.recallForTurn(
      createRecallInput({
        speakerMember: { memberId: "member_current", userId: "user_current" },
      })
    );

    expect(repository.upsertMemberSubject).toHaveBeenCalledTimes(1);
    expect(repository.upsertMemberSubject).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_current",
        userId: "user_current",
      })
    );
    expect(adapter.search).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: expect.objectContaining({
          zepUserId: "org:org_1:member:user_current",
        }),
      })
    );
    expect(adapter.search).not.toHaveBeenCalledWith(
      expect.objectContaining({
        ref: expect.objectContaining({
          zepUserId: "org:org_1:member:user_other",
        }),
      })
    );
  });

  it("deletes durable Zep user and organization graphs instead of deleting threads", async () => {
    const adapter = createAdapter();
    const nativeDeliveryLedger = createNativeDeliveryLedger();
    const service = createCenterAgentMemoryService({
      adapter,
      nativeDeliveryLedger,
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: true }),
    });

    await expect(
      service.deleteMemberMemory({ organizationId: "org_1", userId: "user_1" })
    ).resolves.toBe("deleted");
    await expect(
      service.deleteOrganizationMemory({ organizationId: "org_1" })
    ).resolves.toBe("deleted");

    expect(adapter.deleteMemberUser).toHaveBeenCalledWith(
      expect.objectContaining({ zepUserId: "org:org_1:member:user_1" })
    );
    expect(adapter.deleteOrganizationGraph).toHaveBeenCalledWith(
      expect.objectContaining({ zepGraphId: "org:org_1:center-agent" })
    );
    expect(nativeDeliveryLedger.clearTriggerTextForMember).toHaveBeenCalledWith(
      {
        organizationId: "org_1",
        userId: "user_1",
      }
    );
    expect(
      nativeDeliveryLedger.clearTriggerTextForOrganization
    ).toHaveBeenCalledWith({
      organizationId: "org_1",
    });
    expect("deleteThread" in adapter).toBe(false);
  });

  it("clears local Organization delivery text before reporting a provider deletion failure", async () => {
    const adapter = createAdapter({
      deleteOrganizationGraph: vi.fn(() =>
        Promise.reject(new Error("Zep organization deletion failed"))
      ),
    });
    const nativeDeliveryLedger = createNativeDeliveryLedger();
    const repository = createRepository({ organizationMemoryOptIn: true });
    const service = createCenterAgentMemoryService({
      adapter,
      nativeDeliveryLedger,
      nowMs: () => 1000,
      repository,
    });

    await expect(
      service.deleteOrganizationMemory({ organizationId: "org_1" })
    ).rejects.toThrow("Zep organization deletion failed");

    expect(
      nativeDeliveryLedger.clearTriggerTextForOrganization
    ).toHaveBeenCalledWith({ organizationId: "org_1" });
    expect(
      vi.mocked(nativeDeliveryLedger.clearTriggerTextForOrganization).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(adapter.deleteOrganizationGraph).mock.invocationCallOrder[0] ??
        0
    );
    expect(repository.markOrganizationDeleteFailed).toHaveBeenCalledWith({
      error: "Zep organization deletion failed",
      nowMs: 1000,
      organizationId: "org_1",
    });
  });

  it("returns an empty memory envelope when Zep recall times out", async () => {
    const adapter = createAdapter({
      search: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<CenterAgentMemoryAdapter["search"]>>>(
            () => undefined
          )
      ),
    });
    const service = createCenterAgentMemoryService({
      adapter,
      logger: { warn: vi.fn() },
      nowMs: () => 1000,
      recallTimeoutMs: 1,
      repository: createRepository({ organizationMemoryOptIn: true }),
    });

    await expect(service.recallForTurn(createRecallInput())).resolves.toEqual({
      items: [],
      truncated: false,
    });
  });

  it("allows a normal two-stage provider recall to finish", async () => {
    vi.useFakeTimers();
    try {
      const adapter = createAdapter({
        search: vi.fn(async (input) => {
          await new Promise((resolve) => setTimeout(resolve, 1600));
          return [
            {
              captureMethod: "automatic_turn" as const,
              occurredAtMs: 900,
              source: "ca_dm" as const,
              sourceConversationId: "dm_1",
              sourceMessageId: "message_1",
              subject: input.ref.subject.kind,
              text: "The member's private launch color is indigo-47.",
            },
          ];
        }),
      });
      const service = createCenterAgentMemoryService({
        adapter,
        logger: { warn: vi.fn() },
        nowMs: () => 1000,
        repository: createRepository({ organizationMemoryOptIn: false }),
      });

      const recall = service.recallForTurn(createRecallInput());
      await vi.advanceTimersByTimeAsync(1600);

      await expect(recall).resolves.toEqual({
        items: [
          expect.objectContaining({
            subject: "member",
            text: expect.stringContaining("indigo-47"),
          }),
        ],
        truncated: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("projects oversized memory items into worker-valid turn envelopes", async () => {
    const oversizedMemoryText = "x".repeat(
      REMOTE_AGENT_TURN_ENVELOPE_MEMORY_ITEM_TEXT_MAX_CHARS + 200
    );
    const adapter = createAdapter({
      search: vi.fn(async (input) => [
        {
          captureMethod: "automatic_turn" as const,
          occurredAtMs: 900,
          source: "ca_dm" as const,
          sourceConversationId: "dm_1",
          sourceMessageId: "message_1",
          subject: input.ref.subject.kind,
          text: oversizedMemoryText,
        },
      ]),
    });
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: false }),
    });

    const memory = await service.recallForTurn(createRecallInput());

    expect(memory.truncated).toBe(true);
    expect(memory.items).toHaveLength(1);
    expect(memory.items[0]?.text).toHaveLength(
      REMOTE_AGENT_TURN_ENVELOPE_MEMORY_ITEM_TEXT_MAX_CHARS
    );
    expect(memory.items[0]?.text.endsWith("...")).toBe(true);
    expect(() =>
      remoteAgentWorkerSubmitTurnRequestSchema.parse(
        createWorkerSubmitRequest(memory)
      )
    ).not.toThrow();
  });

  it("projects Message Channel memory with its exact provider", async () => {
    const service = createCenterAgentMemoryService({
      adapter: createAdapter({
        search: vi.fn(async (input) => [
          {
            captureMethod: "automatic_turn" as const,
            messageChannelProvider: "lark" as const,
            occurredAtMs: 900,
            source: "message_channel_conversation" as const,
            sourceConversationId: "lark:connection_1:chat_1:message_1",
            sourceMessageId: "message_1",
            subject: input.ref.subject.kind,
            text: `${input.ref.subject.kind} memory`,
          },
        ]),
      }),
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: false }),
    });

    const memory = await service.recallForTurn(createRecallInput());

    expect(memory).toEqual({
      items: [
        {
          provider: "lark",
          source: "message_channel_conversation",
          subject: "member",
          text: "[Recorded 1970-01-01T00:00:00.900Z] member memory",
        },
      ],
      truncated: false,
    });
    expect(JSON.stringify(memory)).not.toContain(
      "lark:connection_1:chat_1:message_1"
    );
  });

  it("fails closed when Message Channel memory has no provider", async () => {
    const service = createCenterAgentMemoryService({
      adapter: createAdapter({
        search: vi.fn(async (input) => [
          {
            captureMethod: "automatic_turn" as const,
            occurredAtMs: 900,
            source: "message_channel_conversation" as const,
            sourceConversationId: "lark:connection_1:chat_1:message_1",
            sourceMessageId: "message_1",
            subject: input.ref.subject.kind,
            text: `${input.ref.subject.kind} memory`,
          },
        ]),
      }),
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: false }),
    });

    await expect(service.recallForTurn(createRecallInput())).rejects.toThrow(
      "Message Channel memory projection requires its provider"
    );
  });

  it("tells the model when a fact was explicitly saved without replacing its source", async () => {
    const service = createCenterAgentMemoryService({
      adapter: createAdapter({
        search: vi.fn(async (input) => [
          {
            captureMethod: "explicit_save" as const,
            occurredAtMs: 900,
            source: "space_conversation" as const,
            sourceConversationId: "space_1",
            sourceMessageId: "message_1",
            subject: input.ref.subject.kind,
            text: "The launch owner is Maya.",
          },
        ]),
      }),
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: false }),
    });

    const memory = await service.recallForTurn(createRecallInput());

    expect(memory.items).toEqual([
      {
        source: "space_conversation",
        subject: "member",
        text: "[Recorded 1970-01-01T00:00:00.900Z] [Explicitly saved] The launch owner is Maya.",
      },
    ]);
  });
});

function createAdapter(
  overrides: Partial<CenterAgentMemoryAdapter> = {}
): CenterAgentMemoryAdapter {
  return {
    addEpisode: vi.fn(async () => undefined),
    deleteMemberUser: vi.fn(async () => "deleted" as const),
    deleteOrganizationGraph: vi.fn(async () => "deleted" as const),
    ensureMemberUser: vi.fn(async () => undefined),
    ensureOrganizationGraph: vi.fn(async () => undefined),
    search: vi.fn(async (input) => [
      {
        captureMethod: "automatic_turn" as const,
        occurredAtMs: 900,
        source: "ca_dm" as const,
        sourceConversationId: "dm_1",
        sourceMessageId: "message_1",
        subject: input.ref.subject.kind,
        text: `${input.ref.subject.kind} memory`,
      },
    ]),
    ...overrides,
  };
}

function createNativeDeliveryLedger(): CenterAgentMemoryNativeDeliveryLedger {
  return {
    clearTriggerTextForMember: vi.fn(async () => undefined),
    clearTriggerTextForOrganization: vi.fn(async () => undefined),
  };
}

function createRepository(input: {
  organizationMemoryOptIn: boolean;
}): CenterAgentMemoryRepository {
  return {
    markMemberDeleted: vi.fn(async () => true),
    markMemberDeleteFailed: vi.fn(async () => undefined),
    markOrganizationDeleted: vi.fn(async () => true),
    markOrganizationDeleteFailed: vi.fn(async () => undefined),
    readPolicy: vi.fn(async () => ({
      organizationMemoryOptIn: input.organizationMemoryOptIn,
      updatedByUserId: null,
    })),
    upsertPolicy: vi.fn(async (policyInput) => ({
      organizationMemoryOptIn: policyInput.organizationMemoryOptIn,
      updatedByUserId: policyInput.updatedByUserId,
    })),
    upsertMemberSubject: vi.fn(async (subjectInput) =>
      buildCenterAgentMemberMemoryRef(subjectInput)
    ),
    upsertOrganizationSubject: vi.fn(async (subjectInput) =>
      buildCenterAgentOrganizationMemoryRef(subjectInput)
    ),
  };
}

function createRecallInput(
  overrides: Partial<RecallCenterAgentMemoryForTurnInput> = {}
): RecallCenterAgentMemoryForTurnInput {
  return {
    organizationId: "org_1",
    query: "What should I remember?",
    speakerMember: { memberId: "member_1", userId: "user_1" },
    ...overrides,
  };
}

function createRememberInput(
  overrides: Partial<RememberCenterAgentTurnInput> = {}
): RememberCenterAgentTurnInput {
  return {
    assistantMessage: "I will remember that.",
    occurredAtMs: 1000,
    organizationId: "org_1",
    source: "ca_dm",
    sourceConversationId: "space_1",
    sourceMessageId: "signal_1",
    speakerMember: { memberId: "member_1", userId: "user_1" },
    userMessage: "Our deploy day is Thursday.",
    ...overrides,
  };
}

function createWorkerSubmitRequest(
  memory: RecallCenterAgentMemoryForTurnResult
) {
  return {
    agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
    agentProfileOwnerUserId: "user_1",
    author: {
      displayName: "Ari",
      profileId: null,
      profileKind: "human",
    },
    bindingId: "binding_1",
    dispatchId: "dispatch_1",
    idempotencyKey: "remote-agent:dispatch_1",
    messages: [{ content: "What should I remember?", role: "user" }],
    onBehalfOf: null,
    organizationId: "org_1",
    spaceId: "space_1",
    triggerMessageId: "signal_1",
    turnEnvelope: {
      sender: {
        kind: "member",
        id: "member_1",
        displayName: "Ari",
        role: "owner",
        verified: true,
      },
      space: {
        id: "space_1",
        name: "Ari and Center Agent",
        kind: "dm",
        isCenterAgentDm: true,
      },
      organization: {
        id: "org_1",
        name: "OpenMeld Labs",
        personal: false,
        memberCount: 1,
      },
      centerAgent: {
        profileName: "Center Agent",
        profileHandle: "center-agent",
      },
      trigger: {
        source: "web_dm",
      },
      memory,
    },
    v: 1,
  };
}
