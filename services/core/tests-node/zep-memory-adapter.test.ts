import type { Zep } from "@getzep/zep-cloud";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCenterAgentOrganizationMemoryRef,
  buildCenterAgentSpaceMemoryRef,
} from "../src/center-agent-memory/contract";
import { createZepCenterAgentMemoryAdapter } from "../src/center-agent-memory/zep-memory-adapter";

const zepMocks = vi.hoisted(() => ({
  addEpisode: vi.fn(),
  createGraph: vi.fn(),
  deleteGraph: vi.fn(),
  deleteUser: vi.fn(),
  getEpisode: vi.fn(),
  searchGraph: vi.fn(),
  upsertUser: vi.fn(),
}));

vi.mock("../src/generated-runtime/zep-cloud.mjs", () => ({
  ZepClient: class {
    graph = {
      add: zepMocks.addEpisode,
      create: zepMocks.createGraph,
      delete: zepMocks.deleteGraph,
      episode: { get: zepMocks.getEpisode },
      search: zepMocks.searchGraph,
    };

    user = {
      add: zepMocks.upsertUser,
      delete: zepMocks.deleteUser,
    };
  },
}));

const ORGANIZATION_MEMORY_REF = buildCenterAgentOrganizationMemoryRef({
  organizationId: "org_1",
});

describe("Zep Center Agent memory adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    zepMocks.addEpisode.mockResolvedValue({
      uuid: "episode_1",
      content: "",
      createdAt: "2026-10-13T08:32:17Z",
      processed: false,
    } satisfies Zep.Episode);
    zepMocks.getEpisode.mockResolvedValue(undefined);
    zepMocks.searchGraph.mockResolvedValue({});
  });

  it.each([
    "human",
    "agent",
  ] as const)("keeps a versioned %s source distinct from an Agent-generated summary", async (authorKind) => {
    const adapter = createZepCenterAgentMemoryAdapter({ apiKey: "zep_test" });
    const ref = buildCenterAgentSpaceMemoryRef({
      organizationId: "org_1",
      spaceId: "space_1",
    });
    const version = `sha256:${"a".repeat(64)}`;
    await adapter.addEpisode({
      ref,
      episode: {
        captureMethod: "automatic_turn",
        source: "space_conversation",
        sourceConversationId: "space_1",
        sourceMessageId: "message_1",
        occurredAtMs: 1000,
        sourceAuthorKind: authorKind,
        sourceVersion: version,
        userMessage: "Original statement.",
        assistantMessage: "An unsupported Agent interpretation.",
      },
    });
    const request = zepMocks.addEpisode.mock
      .calls[0]?.[0] as Zep.AddDataRequest;
    expect(request.data).toBe(
      `${authorKind === "human" ? "Human" : "Agent"} (original source excerpt): Original statement.`
    );
    expect(request.metadata).toMatchObject({
      openmeld_memory_source_version: version,
      openmeld_memory_source_author_kind: authorKind,
    });
    zepMocks.getEpisode.mockResolvedValue({
      uuid: "episode_1",
      content: request.data,
      metadata: request.metadata,
      createdAt: "1970-01-01T00:00:01.000Z",
      processed: true,
    } satisfies Zep.Episode);
    zepMocks.searchGraph.mockResolvedValue({
      edges: [
        {
          uuid: "edge_1",
          createdAt: "1970-01-01T00:00:01.000Z",
          sourceNodeUuid: "node_1",
          targetNodeUuid: "node_2",
          name: "stated",
          fact: "Original statement.",
          episodes: ["episode_1"],
        },
      ],
    } satisfies Zep.GraphSearchResults);
    expect(
      await adapter.search({ ref, query: "Original statement", limit: 6 })
    ).toEqual([
      expect.objectContaining({
        subject: "space",
        sourceVersion: version,
        sourceAuthorKind: authorKind,
        supportingSources: [
          expect.objectContaining({
            sourceVersion: version,
            sourceAuthorKind: authorKind,
          }),
        ],
      }),
    ]);
  });

  it("stores structured provenance with every memory episode", async () => {
    const adapter = createZepCenterAgentMemoryAdapter({ apiKey: "zep_test" });

    const receipt = await adapter.addEpisode({
      episode: {
        assistantMessage: "I will remember that.",
        captureMethod: "automatic_turn",
        messageChannelProvider: "lark",
        occurredAtMs: 1_753_574_400_000,
        source: "message_channel_conversation",
        sourceConversationId: "lark:connection_1:chat_1:message_1",
        sourceMessageId: "message_1",
        userMessage: "Launch reviews happen on Fridays.",
      },
      ref: ORGANIZATION_MEMORY_REF,
    });

    expect(receipt).toEqual({ episodeId: "episode_1", processed: false });
    expect(zepMocks.addEpisode).toHaveBeenCalledWith(
      {
        createdAt: "2025-07-27T00:00:00.000Z",
        data: expect.stringContaining(
          "User: Launch reviews happen on Fridays."
        ),
        graphId: "org:org_1:center-agent",
        metadata: {
          openmeld_memory_capture_method: "automatic_turn",
          openmeld_memory_occurred_at_ms: 1_753_574_400_000,
          openmeld_memory_source: "message_channel_conversation",
          openmeld_memory_source_conversation_id:
            "lark:connection_1:chat_1:message_1",
          openmeld_memory_source_message_id: "message_1",
          openmeld_memory_version: 1,
          openmeld_message_channel_provider: "lark",
        },
        sourceDescription:
          "OpenMeld Center Agent memory from Lark conversation",
        type: "message",
      },
      { maxRetries: 0 }
    );
    const request = zepMocks.addEpisode.mock.calls[0]?.[0];
    expect(request?.data).not.toContain("lark:connection_1:chat_1:message_1");
    expect(request?.data).not.toContain("message_1");
  });

  it("returns the episode source instead of relabeling memory with the recall entry point", async () => {
    const searchResult = {
      edges: [
        {
          createdAt: "2025-07-27T08:00:01.000Z",
          episodes: ["episode_space_1"],
          fact: "The Launch Room tracks release blockers.",
          name: "tracks",
          sourceNodeUuid: "node_launch_room",
          targetNodeUuid: "node_release_blockers",
          uuid: "edge_1",
          validAt: "2025-07-26T00:00:00Z",
          invalidAt: "2025-08-01T00:00:00Z",
          expiredAt: "2025-08-02T00:00:00Z",
        },
      ],
    } satisfies Zep.GraphSearchResults;
    const sourceEpisode = {
      content: "User: Track release blockers in the Launch Room.",
      createdAt: "2025-07-27T08:00:00.000Z",
      metadata: {
        openmeld_memory_occurred_at_ms: 1_753_574_400_000,
        openmeld_memory_source: "space_conversation",
        openmeld_memory_source_conversation_id: "space_launch_room",
        openmeld_memory_source_message_id: "signal_launch_1",
        openmeld_memory_version: 1,
      },
      uuid: "episode_space_1",
    } satisfies Zep.Episode;
    zepMocks.searchGraph.mockResolvedValue(searchResult);
    zepMocks.getEpisode.mockResolvedValue(sourceEpisode);
    const adapter = createZepCenterAgentMemoryAdapter({ apiKey: "zep_test" });

    await expect(
      adapter.search({
        limit: 6,
        query: "What tracks our release blockers?",
        ref: ORGANIZATION_MEMORY_REF,
      })
    ).resolves.toEqual([
      {
        captureMethod: "automatic_turn",
        occurredAtMs: 1_753_574_400_000,
        source: "space_conversation",
        sourceConversationId: "space_launch_room",
        sourceMessageId: "signal_launch_1",
        subject: "organization",
        text: "[Fact validity: from 2025-07-26T00:00:00.000Z; until 2025-08-01T00:00:00.000Z; superseded 2025-08-02T00:00:00.000Z] The Launch Room tracks release blockers.",
      },
    ]);
    expect(zepMocks.getEpisode).toHaveBeenCalledWith("episode_space_1");
  });

  it("keeps provenance from legacy episode headers during the metadata rollout", async () => {
    zepMocks.searchGraph.mockResolvedValue({
      edges: [
        {
          createdAt: "2025-07-27T00:00:01.000Z",
          episodes: ["episode_legacy_lark_1"],
          fact: "Launch reviews happen on Fridays.",
          name: "happen_on",
          sourceNodeUuid: "node_launch_review",
          targetNodeUuid: "node_friday",
          uuid: "edge_legacy_1",
        },
      ],
    } satisfies Zep.GraphSearchResults);
    zepMocks.getEpisode.mockResolvedValue({
      content: [
        "Source: message_channel_conversation",
        "Conversation: lark:connection_1:chat_1:message_1",
        "Message: message_1",
        "Occurred at: 2025-07-27T00:00:00.000Z",
        "",
        "User: Remember that launch reviews happen on Fridays.",
      ].join("\n"),
      createdAt: "2025-07-27T00:00:00.000Z",
      uuid: "episode_legacy_lark_1",
    } satisfies Zep.Episode);
    const adapter = createZepCenterAgentMemoryAdapter({ apiKey: "zep_test" });

    await expect(
      adapter.search({
        limit: 6,
        query: "When are launch reviews?",
        ref: ORGANIZATION_MEMORY_REF,
      })
    ).resolves.toEqual([
      {
        captureMethod: "automatic_turn",
        messageChannelProvider: "lark",
        occurredAtMs: 1_753_574_400_000,
        source: "message_channel_conversation",
        sourceConversationId: "lark:connection_1:chat_1:message_1",
        sourceMessageId: "message_1",
        subject: "organization",
        text: "[Fact validity: unknown] Launch reviews happen on Fridays.",
      },
    ]);
  });

  it("selects the earliest associated episode instead of trusting provider array order", async () => {
    zepMocks.searchGraph.mockResolvedValue({
      edges: [
        {
          createdAt: "2025-07-28T00:00:00.000Z",
          episodes: ["episode_lark_later", "episode_space_original"],
          fact: "The release review happens on Fridays.",
          name: "happens_on",
          sourceNodeUuid: "node_release_review",
          targetNodeUuid: "node_friday",
          uuid: "edge_multi_source_1",
        },
      ],
    } satisfies Zep.GraphSearchResults);
    zepMocks.getEpisode.mockImplementation((episodeId: string) => {
      if (episodeId === "episode_lark_later") {
        return Promise.resolve({
          content: "User: The release review still happens on Fridays.",
          createdAt: "2025-07-28T00:00:00.000Z",
          metadata: {
            openmeld_memory_capture_method: "automatic_turn",
            openmeld_memory_occurred_at_ms: 1_753_660_800_000,
            openmeld_memory_source: "message_channel_conversation",
            openmeld_memory_source_conversation_id: "lark:later",
            openmeld_memory_source_message_id: "message_later",
            openmeld_memory_version: 1,
            openmeld_message_channel_provider: "lark",
          },
          uuid: episodeId,
        } satisfies Zep.Episode);
      }
      return Promise.resolve({
        content: "User: The release review happens on Fridays.",
        createdAt: "2025-07-27T00:00:00.000Z",
        metadata: {
          openmeld_memory_capture_method: "explicit_save",
          openmeld_memory_occurred_at_ms: 1_753_574_400_000,
          openmeld_memory_source: "space_conversation",
          openmeld_memory_source_conversation_id: "space_original",
          openmeld_memory_source_message_id: "message_original",
          openmeld_memory_version: 1,
        },
        uuid: episodeId,
      } satisfies Zep.Episode);
    });
    const adapter = createZepCenterAgentMemoryAdapter({ apiKey: "zep_test" });

    await expect(
      adapter.search({
        limit: 6,
        query: "When is the release review?",
        ref: ORGANIZATION_MEMORY_REF,
      })
    ).resolves.toEqual([
      {
        captureMethod: "explicit_save",
        occurredAtMs: 1_753_574_400_000,
        source: "space_conversation",
        sourceConversationId: "space_original",
        sourceMessageId: "message_original",
        subject: "organization",
        text: "[Fact validity: unknown] The release review happens on Fridays.",
      },
    ]);
    expect(zepMocks.getEpisode).toHaveBeenCalledWith("episode_lark_later");
    expect(zepMocks.getEpisode).toHaveBeenCalledWith("episode_space_original");
  });

  it("omits facts that contain raw source references and logs provider correlation", async () => {
    const warn = vi.fn();
    zepMocks.searchGraph.mockResolvedValue({
      edges: [
        {
          createdAt: "2025-07-27T00:00:01.000Z",
          episodes: ["episode_private_ref"],
          fact: "The private source was space_private_ref.",
          name: "came_from",
          sourceNodeUuid: "node_fact",
          targetNodeUuid: "node_source",
          uuid: "edge_private_ref",
        },
      ],
    } satisfies Zep.GraphSearchResults);
    zepMocks.getEpisode.mockResolvedValue({
      content: "User: Remember the launch plan.",
      createdAt: "2025-07-27T00:00:00.000Z",
      metadata: {
        openmeld_memory_capture_method: "automatic_turn",
        openmeld_memory_occurred_at_ms: 1_753_574_400_000,
        openmeld_memory_source: "space_conversation",
        openmeld_memory_source_conversation_id: "space_private_ref",
        openmeld_memory_source_message_id: "message_private_ref",
        openmeld_memory_version: 1,
      },
      uuid: "episode_private_ref",
    } satisfies Zep.Episode);
    const adapter = createZepCenterAgentMemoryAdapter({
      apiKey: "zep_test",
      logger: { warn },
    });

    await expect(
      adapter.search({
        limit: 6,
        query: "What is the launch plan?",
        ref: ORGANIZATION_MEMORY_REF,
      })
    ).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[core.center_agent_memory.provenance_unavailable]",
      expect.objectContaining({
        failures: [
          expect.objectContaining({
            edgeId: "edge_private_ref",
            episodeId: "episode_private_ref",
            reasonCode: "fact_contains_source_reference",
          }),
        ],
      })
    );
  });

  it("omits an out-of-range episode timestamp with a precise diagnostic", async () => {
    const warn = vi.fn();
    zepMocks.searchGraph.mockResolvedValue({
      edges: [
        {
          createdAt: "2025-07-27T00:00:01.000Z",
          episodes: ["episode_bad_time"],
          fact: "The release review happens on Fridays.",
          name: "happens_on",
          sourceNodeUuid: "node_release_review",
          targetNodeUuid: "node_friday",
          uuid: "edge_bad_time",
        },
      ],
    } satisfies Zep.GraphSearchResults);
    zepMocks.getEpisode.mockResolvedValue({
      content: "User: The release review happens on Fridays.",
      createdAt: "2025-07-27T00:00:00.000Z",
      metadata: {
        openmeld_memory_capture_method: "automatic_turn",
        openmeld_memory_occurred_at_ms: 9_000_000_000_000_000,
        openmeld_memory_source: "space_conversation",
        openmeld_memory_source_conversation_id: "space_release",
        openmeld_memory_source_message_id: "message_release",
        openmeld_memory_version: 1,
      },
      uuid: "episode_bad_time",
    } satisfies Zep.Episode);
    const adapter = createZepCenterAgentMemoryAdapter({
      apiKey: "zep_test",
      logger: { warn },
    });

    await expect(
      adapter.search({
        limit: 6,
        query: "When is the release review?",
        ref: ORGANIZATION_MEMORY_REF,
      })
    ).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[core.center_agent_memory.provenance_unavailable]",
      expect.objectContaining({
        failures: [
          expect.objectContaining({
            edgeId: "edge_bad_time",
            episodeId: "episode_bad_time",
            reasonCode: "invalid_episode_provenance",
          }),
        ],
      })
    );
    await expect(
      adapter.searchDetailed({
        limit: 6,
        query: "When is the release review?",
        ref: ORGANIZATION_MEMORY_REF,
      })
    ).resolves.toEqual({ items: [], status: "partial" });
  });
});
