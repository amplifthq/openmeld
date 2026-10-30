import {
  REMOTE_AGENT_TURN_ENVELOPE_MEMORY_ITEM_TEXT_MAX_CHARS,
  remoteAgentWorkerSubmitTurnRequestSchema,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  buildCenterAgentMemberMemoryRef,
  buildCenterAgentOrganizationMemoryRef,
  buildCenterAgentSpaceMemoryRef,
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
  it.each([
    40, 320,
  ])("keeps both scopes in the final envelope with %i-character candidates", async (size) => {
    const adapter = createAdapter({
      search: vi.fn(async ({ ref }) =>
        Array.from({ length: 6 }, (_, rank) => ({
          captureMethod: "automatic_turn" as const,
          occurredAtMs: 900,
          source: "space_conversation" as const,
          sourceConversationId: "space_1",
          sourceMessageId: `message_${rank}`,
          subject: ref.subject.kind,
          text: `${ref.subject.kind === "member" ? "I plan to investigate" : "Approved team rule"} ${rank}: ${"x".repeat(size)}`,
        }))
      ),
    });
    const repository = createRepository({ organizationMemoryOptIn: true });
    const service = createCenterAgentMemoryService({ adapter, repository });
    const memory = await service.recallForTurn(createRecallInput());
    expect(
      memory.items.filter((item) => item.subject === "organization").length
    ).toBeGreaterThanOrEqual(2);
    expect(memory.items.some((item) => item.subject === "member")).toBe(true);
    expect(
      memory.items.reduce((total, item) => total + item.text.length, 0)
    ).toBeLessThanOrEqual(1600);
    expect(memory.items.length).toBeLessThanOrEqual(6);
    expect(repository.upsertMemberSubject).not.toHaveBeenCalled();
    expect(repository.upsertOrganizationSubject).not.toHaveBeenCalled();
  });

  it.each([
    "deleted",
    "opted_out",
  ])("withholds an organization read revoked while the provider is pending: %s", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repository = createRepository({ organizationMemoryOptIn: true });
    const adapter = createAdapter({
      search: vi.fn(async ({ ref }) => {
        await pending;
        return [
          {
            captureMethod: "explicit_save" as const,
            occurredAtMs: 900,
            source: "space_conversation" as const,
            sourceConversationId: "space_1",
            sourceMessageId: "message_1",
            subject: ref.subject.kind,
            text: "Team rule",
          },
        ];
      }),
    });
    const service = createCenterAgentMemoryService({ adapter, repository });
    const recall = service.recallForOrganization({
      organizationId: "org_1",
      query: "Team rule",
    });
    await vi.waitFor(() => expect(adapter.search).toHaveBeenCalled());
    vi.mocked(repository.readActiveSubjects).mockResolvedValue([]);
    release?.();
    expect(await recall).toEqual({ items: [], truncated: false });
  });

  it("does not provision a deleted or absent subject during recall", async () => {
    const repository = createRepository({ organizationMemoryOptIn: true });
    vi.mocked(repository.readActiveSubjects).mockResolvedValue([]);
    const adapter = createAdapter();
    const service = createCenterAgentMemoryService({ adapter, repository });
    expect(await service.recallForTurn(createRecallInput())).toEqual({
      items: [],
      truncated: false,
    });
    expect(adapter.search).not.toHaveBeenCalled();
    expect(repository.upsertMemberSubject).not.toHaveBeenCalled();
    expect(repository.upsertOrganizationSubject).not.toHaveBeenCalled();
  });
  it.each([
    ["Web DM", "ca_dm", undefined],
    ["Slack DM", "slack_conversation", undefined],
    ["Lark DM", "message_channel_conversation", "lark"],
    ["Feishu DM", "message_channel_conversation", "feishu"],
  ] as const)("writes a private %s turn only to the verified member while preserving provenance", async (_surface, source, messageChannelProvider) => {
    const adapter = createAdapter();
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: false }),
    });

    await service.rememberTurn(
      createRememberInput({
        interactionEnvironment: "requester_private",
        ...(messageChannelProvider ? { messageChannelProvider } : {}),
        source,
      })
    );

    expect(adapter.ensureMemberUser).toHaveBeenCalledWith(
      expect.objectContaining({
        zepUserId: "org:org_1:member:user_1",
      })
    );
    expect(adapter.ensureOrganizationGraph).not.toHaveBeenCalled();
    expect(adapter.addEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        episode: expect.objectContaining({
          ...(messageChannelProvider ? { messageChannelProvider } : {}),
          source,
        }),
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
      createRememberInput({
        interactionEnvironment: "organization_shared",
        source: "space_conversation",
      })
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
    expect(repository.upsertOrganizationSubject).not.toHaveBeenCalled();
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

  it.each([
    ["shared Space", "space_conversation", undefined],
    ["organization Slack channel", "slack_conversation", undefined],
    ["organization Lark channel", "message_channel_conversation", "lark"],
    ["organization Feishu channel", "message_channel_conversation", "feishu"],
  ] as const)("does not automatically write a completed %s turn to either scope", async (_surface, source, messageChannelProvider) => {
    const adapter = createAdapter();
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: true }),
    });

    await service.rememberTurn(
      createRememberInput({
        interactionEnvironment: "organization_shared",
        ...(messageChannelProvider ? { messageChannelProvider } : {}),
        source,
      })
    );

    expect(adapter.ensureMemberUser).not.toHaveBeenCalled();
    expect(adapter.ensureOrganizationGraph).not.toHaveBeenCalled();
    expect(adapter.addEpisode).not.toHaveBeenCalled();
  });

  it("does not write a shared turn when Organization memory is off", async () => {
    const adapter = createAdapter();
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: false }),
    });

    await service.rememberTurn(
      createRememberInput({
        interactionEnvironment: "organization_shared",
        source: "slack_conversation",
      })
    );

    expect(adapter.ensureMemberUser).not.toHaveBeenCalled();
    expect(adapter.ensureOrganizationGraph).not.toHaveBeenCalled();
    expect(adapter.addEpisode).not.toHaveBeenCalled();
  });

  it.each([
    ["Slack Connect", "slack_conversation", undefined],
    ["externally shared Lark", "message_channel_conversation", "lark"],
    ["externally shared Feishu", "message_channel_conversation", "feishu"],
  ] as const)("does not automatically remember a completed %s turn", async (_surface, source, messageChannelProvider) => {
    const adapter = createAdapter();
    const repository = createRepository({ organizationMemoryOptIn: true });
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository,
    });

    await service.rememberTurn(
      createRememberInput({
        interactionEnvironment: "externally_shared",
        ...(messageChannelProvider ? { messageChannelProvider } : {}),
        source,
      })
    );

    expect(repository.readPolicy).not.toHaveBeenCalled();
    expect(adapter.ensureMemberUser).not.toHaveBeenCalled();
    expect(adapter.ensureOrganizationGraph).not.toHaveBeenCalled();
    expect(adapter.addEpisode).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])("reports the provider processing state on an explicit organization save: %s", async (processed) => {
    const adapter = createAdapter({
      addEpisode: vi.fn(async () => ({ episodeId: "episode_1", processed })),
    });
    const service = createCenterAgentMemoryService({
      adapter,
      nowMs: () => 1000,
      repository: createRepository({ organizationMemoryOptIn: true }),
    });

    const receipt = await service.rememberFactForOrganization({
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
    expect(receipt.status).toBe(processed ? "processed" : "processing");
    expect(adapter.ensureMemberUser).not.toHaveBeenCalled();
    expect(adapter.ensureOrganizationGraph).toHaveBeenCalled();
    expect(adapter.addEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        episode: expect.objectContaining({
          assistantMessage:
            "The member asked to remember this fact for the organization.",
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

    expect(repository.upsertMemberSubject).not.toHaveBeenCalled();
    expect(repository.readActiveSubjects).toHaveBeenCalledWith(
      expect.objectContaining({
        speakerMember: { memberId: "member_current", userId: "user_current" },
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

  it("reports unavailable memory when Zep recall times out", async () => {
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
      status: "unavailable",
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

  it("omits oversized facts whole and keeps a later complete fact in a worker-valid envelope", async () => {
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
        {
          captureMethod: "automatic_turn" as const,
          occurredAtMs: 900,
          source: "ca_dm" as const,
          sourceConversationId: "dm_1",
          sourceMessageId: "message_2",
          subject: input.ref.subject.kind,
          text: "Build only after an explicit request; never merge your own PR.",
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
    expect(
      memory.items[0]?.text.endsWith(
        "Build only after an explicit request; never merge your own PR."
      )
    ).toBe(true);
    expect(memory.items[0]?.text).not.toContain(
      oversizedMemoryText.slice(0, 20)
    );
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
    addEpisode: vi.fn(async () => ({
      episodeId: "episode_1",
      processed: false,
    })),
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
    upsertSpaceSubject: vi.fn(async (value) =>
      buildCenterAgentSpaceMemoryRef(value)
    ),
    beginSpaceDeletion: vi.fn(async () => undefined),
    isSpaceSubjectActive: vi.fn(async () => false),
    markSpaceDeleted: vi.fn(async () => false),
    markSpaceDeleteFailed: vi.fn(async () => undefined),
    readActiveSubjects: vi.fn(async (readInput) => [
      ...(readInput.speakerMember
        ? [
            {
              ...buildCenterAgentMemberMemoryRef({
                organizationId: readInput.organizationId,
                ...readInput.speakerMember,
              }),
              updatedAtMs: 1,
            },
          ]
        : []),
      ...(input.organizationMemoryOptIn
        ? [
            {
              ...buildCenterAgentOrganizationMemoryRef(readInput),
              updatedAtMs: 1,
            },
          ]
        : []),
    ]),
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
    interactionEnvironment: "requester_private",
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
