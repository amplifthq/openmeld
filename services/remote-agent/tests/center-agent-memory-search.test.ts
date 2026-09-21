import { centerAgentSearchMemoryResponseSchema } from "@openmeld/schemas";
import type { CenterAgentSearchMemoryRpcInput } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCenterAgentMemberMemoryRef,
  buildCenterAgentOrganizationMemoryRef,
} from "../../core/src/center-agent-memory/contract";
import { createD1CenterAgentMemoryRepository } from "../../core/src/center-agent-memory/d1-memory-repository";
import { rpcCenterAgentSearchMemory } from "../../core/src/center-agent-memory/memory-search-rpc";
import { applyDrizzleMigrationsForTables } from "../../core/tests-node/helpers/sqlite-d1-harness.test-support";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import { isRemoteAgentToolResultWithinLimit } from "../agent-core/tool-result-boundary";
import {
  createEvidenceFixture,
  EVIDENCE_OTHER_SPACE_ID,
  EVIDENCE_SPACE_ID,
} from "./center-agent-evidence.test-support";
import { executeEvidenceCodeMode } from "./evidence-code-mode.test-support";
import {
  createRoutineTurnEnvelope,
  createSubmitTurnRequest,
  TEST_NOW_MS,
} from "./fixtures";

type ProviderQuery = { query: string; userId?: string; graphId?: string };
type ProviderFact = {
  uuid: string;
  fact: string;
  episodes: string[];
  createdAt: string;
  name: string;
  sourceNodeUuid: string;
  targetNodeUuid: string;
};
type ProviderEpisode = {
  uuid: string;
  createdAt: string;
  content: string;
  metadata: Record<string, string | number>;
};

const provider = vi.hoisted(() => ({
  search: vi.fn(),
  episode: vi.fn(),
  add: vi.fn(),
  create: vi.fn(),
  userAdd: vi.fn(),
  userDelete: vi.fn(),
  graphDelete: vi.fn(),
}));
vi.mock("../../core/src/generated-runtime/zep-cloud.mjs", () => ({
  ZepClient: class {
    graph = {
      search: provider.search,
      episode: { get: provider.episode },
      add: provider.add,
      create: provider.create,
      delete: provider.graphDelete,
    };
    user = { add: provider.userAdd, delete: provider.userDelete };
  },
}));
const PUBLIC_SPACE_ID = "c".repeat(64);
const CONCLUSION = "The release review was scheduled for Friday.";
const UNAVAILABLE_PATTERN = /unavailable|not available|not implemented/i;
const fixtures: Awaited<ReturnType<typeof createEvidenceFixture>>[] = [];
const graphs = new Map<string, ProviderFact[]>();
const episodes = new Map<string, ProviderEpisode>();
beforeEach(() => {
  vi.clearAllMocks();
  graphs.clear();
  episodes.clear();
  provider.search.mockImplementation((input: ProviderQuery) =>
    Promise.resolve({
      edges:
        input.query === "review"
          ? (graphs.get(input.userId ?? input.graphId ?? "") ?? [])
          : [],
    })
  );
  provider.episode.mockImplementation((id: string) =>
    episodes.has(id)
      ? Promise.resolve(episodes.get(id))
      : Promise.reject(new Error("Provider episode unavailable"))
  );
});
afterEach(() => {
  for (const f of fixtures.splice(0)) {
    f.harness.close();
  }
});

async function fixture(
  options: {
    shared?: boolean;
    request?: ReturnType<typeof createSubmitTurnRequest>;
  } = {}
) {
  const base = createSubmitTurnRequest();
  const shared = createSubmitTurnRequest({
    spaceId: EVIDENCE_SPACE_ID,
    turnEnvelope: {
      ...base.turnEnvelope,
      interactionEnvironment: "organization_shared",
      space: {
        ...base.turnEnvelope.space,
        id: EVIDENCE_SPACE_ID,
        kind: "space",
        isCenterAgentDm: false,
      },
      trigger: { source: "space_wake" },
    },
  });
  const f = await createEvidenceFixture({
    request: options.request ?? (options.shared ? shared : undefined),
  });
  fixtures.push(f);
  applyDrizzleMigrationsForTables(f.harness, [
    "center_agent_memory_policies",
    "center_agent_memory_subjects",
  ]);
  Reflect.set(f.env, "ZEP_OPENMELD_API_KEY", "controlled-test-provider");
  if (!options.shared) {
    const current = f.spaces.get(f.request.spaceId);
    if (!current) {
      throw new Error("Missing current conversation.");
    }
    f.spaces.set(f.request.spaceId, {
      ...current,
      directMessage: {
        pairKey: `${f.speaker.profileId}:${f.request.agentProfileId}`,
      },
    });
  }
  for (const spaceId of [EVIDENCE_OTHER_SPACE_ID, PUBLIC_SPACE_ID]) {
    f.spaces.set(spaceId, {
      spaceId,
      organizationId: f.request.organizationId,
      visibility: spaceId === PUBLIC_SPACE_ID ? "public" : "private",
      accessMode: spaceId === PUBLIC_SPACE_ID ? "public" : "members_only",
      name:
        spaceId === PUBLIC_SPACE_ID
          ? "Public review"
          : "Private prior conversation",
    });
  }
  const repository = createD1CenterAgentMemoryRepository(f.harness.db);
  const member = await repository.upsertMemberSubject({
    organizationId: f.request.organizationId,
    memberId: f.speaker.id,
    userId: f.speaker.ownerUserId,
    nowMs: TEST_NOW_MS - 2000,
  });
  const organization = await repository.upsertOrganizationSubject({
    organizationId: f.request.organizationId,
    nowMs: TEST_NOW_MS - 2000,
  });
  graphs.set(member.subjectId, []);
  graphs.set(organization.subjectId, []);
  const binding = {
    centerAgentSearchMemory: (input: CenterAgentSearchMemoryRpcInput) =>
      rpcCenterAgentSearchMemory(f.env, input),
  };
  async function read(query = "review") {
    return centerAgentSearchMemoryResponseSchema.parse(
      await f.execute(binding, "openmeld_search_center_agent_memory", { query })
    );
  }
  return { ...f, binding, member, organization, read, repository };
}

function fact(
  f: Awaited<ReturnType<typeof fixture>>,
  input: {
    text?: string;
    scope?: "member" | "organization";
    sources: {
      spaceId: string;
      signalId: string;
      occurredAtMs?: number;
      source?: string;
    }[];
  }
) {
  const selector =
    input.scope === "organization"
      ? f.organization.subjectId
      : f.member.subjectId;
  const ids = input.sources.map((source, index) => {
    const id = `episode-${episodes.size}-${index}`;
    episodes.set(id, {
      uuid: id,
      createdAt: new Date(TEST_NOW_MS - 1000 + index).toISOString(),
      content:
        "User: What did we decide? Center Agent: A remembered conclusion.",
      metadata: {
        openmeld_memory_version: 1,
        openmeld_memory_capture_method: "automatic_turn",
        openmeld_memory_occurred_at_ms:
          source.occurredAtMs ?? TEST_NOW_MS - 1000 + index,
        openmeld_memory_source: source.source ?? "space_conversation",
        openmeld_memory_source_conversation_id: source.spaceId,
        openmeld_memory_source_message_id: source.signalId,
      },
    });
    const signals = f.signals.get(source.spaceId) ?? new Set<string>();
    signals.add(source.signalId);
    f.signals.set(source.spaceId, signals);
    return id;
  });
  const current = graphs.get(selector) ?? [];
  current.push({
    uuid: `edge-${current.length}`,
    createdAt: new Date(TEST_NOW_MS).toISOString(),
    name: "remembered_conclusion",
    sourceNodeUuid: "source-node",
    targetNodeUuid: "target-node",
    fact: input.text ?? CONCLUSION,
    episodes: ids,
  });
  graphs.set(selector, current);
  return ids;
}

function persistedSubjects(f: Awaited<ReturnType<typeof fixture>>) {
  return f.harness.queryAll({
    sql: "SELECT * FROM center_agent_memory_subjects ORDER BY subject_id",
  });
}

describe("authorized retained-memory search from normal member tools", () => {
  it("recalls a prior conclusion from a new private conversation with every permitted source and no writes", async () => {
    const f = await fixture();
    fact(f, {
      sources: [
        {
          spaceId: EVIDENCE_OTHER_SPACE_ID,
          signalId: "prior-message-1",
          source: "ca_dm",
        },
        { spaceId: EVIDENCE_OTHER_SPACE_ID, signalId: "prior-message-2" },
      ],
    });
    const before = persistedSubjects(f);
    const output = await executeEvidenceCodeMode({
      fixture: f,
      binding: f.binding,
      toolName: "openmeld_search_center_agent_memory",
      payload: { query: "  review  ", limit: 6 },
    });
    const result = centerAgentSearchMemoryResponseSchema.parse(
      (output as { result: unknown }).result
    );
    expect(result.status).toBe("matched");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      text: CONCLUSION,
      scope: "member",
      currentness: "not_verified",
      interpretation: "remembered_summary_not_quote",
    });
    expect(result.items[0]?.sources.map((source) => source.signalId)).toEqual([
      "prior-message-1",
      "prior-message-2",
    ]);
    expect(result.items[0]?.sources[0]?.occurredAtMs).toBe(TEST_NOW_MS - 1000);
    expect(f.signalReads.map((read) => read.signalId)).toEqual([
      "prior-message-1",
      "prior-message-2",
    ]);
    expect(provider.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "review", userId: f.member.subjectId })
    );
    expect(persistedSubjects(f)).toEqual(before);
    for (const mutation of [
      provider.add,
      provider.create,
      provider.userAdd,
      provider.userDelete,
      provider.graphDelete,
    ]) {
      expect(mutation).not.toHaveBeenCalled();
    }
    expect(isRemoteAgentToolResultWithinLimit(output)).toBe(true);
  });

  it("does not turn no match, total outage or a partial graph read into the same empty success", async () => {
    const f = await fixture();
    expect(await f.read("unrelated")).toMatchObject({
      status: "no_match",
      items: [],
    });
    provider.search.mockRejectedValue(new Error("Provider down"));
    expect(await f.read()).toMatchObject({ status: "unavailable", items: [] });
    fact(f, {
      sources: [
        { spaceId: EVIDENCE_OTHER_SPACE_ID, signalId: "known-conclusion" },
      ],
    });
    provider.search.mockImplementation((input: ProviderQuery) =>
      input.graphId
        ? Promise.reject(new Error("Organization lookup unavailable"))
        : Promise.resolve({ edges: graphs.get(f.member.subjectId) })
    );
    const partial = await f.read();
    expect(partial.status).toBe("partial");
    expect(partial.items[0]?.text).toBe(CONCLUSION);
    expect(partial).not.toHaveProperty("failedSourceCount");
  });

  it("reports incomplete provider provenance without disclosing a broken fact or hidden references", async () => {
    const f = await fixture();
    const ids = fact(f, {
      text: "Unverifiable confidential fact",
      sources: [
        { spaceId: EVIDENCE_OTHER_SPACE_ID, signalId: "valid-support" },
        { spaceId: PUBLIC_SPACE_ID, signalId: "broken-support" },
      ],
    });
    const last = ids.at(-1);
    if (!last) {
      throw new Error("Missing source episode.");
    }
    episodes.delete(last);
    const result = await f.read();
    expect(result).toMatchObject({ status: "partial", items: [] });
    expect(JSON.stringify(result)).not.toContain("broken-support");
    expect(JSON.stringify(result)).not.toContain(
      "Unverifiable confidential fact"
    );
  });

  it("requires all synthesized sources to be safe for the current shared audience, not just the earliest", async () => {
    const f = await fixture({ shared: true });
    fact(f, {
      scope: "organization",
      text: "Mixed private finance conclusion",
      sources: [
        {
          spaceId: PUBLIC_SPACE_ID,
          signalId: "earliest-public",
          occurredAtMs: TEST_NOW_MS - 2000,
        },
        {
          spaceId: EVIDENCE_OTHER_SPACE_ID,
          signalId: "later-private",
          occurredAtMs: TEST_NOW_MS - 1000,
        },
      ],
    });
    fact(f, {
      scope: "organization",
      text: "The public review starts at noon.",
      sources: [{ spaceId: PUBLIC_SPACE_ID, signalId: "public-only" }],
    });
    const output = await executeEvidenceCodeMode({
      fixture: f,
      binding: f.binding,
      toolName: "openmeld_search_center_agent_memory",
      payload: { query: "review" },
    });
    const result = centerAgentSearchMemoryResponseSchema.parse(
      (output as { result: unknown }).result
    );
    expect(result.items.map((item) => item.text)).toEqual([
      "The public review starts at noon.",
    ]);
    expect(JSON.stringify(output)).not.toContain(
      "Mixed private finance conclusion"
    );
    expect(JSON.stringify(output)).not.toContain(EVIDENCE_OTHER_SPACE_ID);
    expect(JSON.stringify(output)).not.toContain("later-private");
    expect(result).not.toHaveProperty("omittedCount");
  });

  it.each([
    "missing_message",
    "revoked_space",
    "wrong_organization",
    "unsupported_channel",
  ] as const)("does not reveal a %s source", async (failure) => {
    const f = await fixture();
    fact(f, {
      sources: [
        {
          spaceId: EVIDENCE_OTHER_SPACE_ID,
          signalId: "sensitive-source",
          source:
            failure === "unsupported_channel"
              ? "slack_conversation"
              : "space_conversation",
        },
      ],
    });
    if (failure === "missing_message") {
      f.signals.get(EVIDENCE_OTHER_SPACE_ID)?.clear();
    }
    if (failure === "revoked_space") {
      f.spaces.delete(EVIDENCE_OTHER_SPACE_ID);
    }
    if (failure === "wrong_organization") {
      f.spaces.set(EVIDENCE_OTHER_SPACE_ID, {
        spaceId: EVIDENCE_OTHER_SPACE_ID,
        organizationId: "another-org",
        visibility: "private",
      });
    }
    const result = await f.read();
    expect(result.items).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("sensitive-source");
    expect(JSON.stringify(result)).not.toContain(CONCLUSION);
    expect(JSON.stringify(result)).not.toContain(EVIDENCE_OTHER_SPACE_ID);
    expect(result.coverage.unsupportedSources).toContain("slack_conversation");
  });

  it("preserves a later reversal as another dated source without presenting either summary as current approval", async () => {
    const f = await fixture();
    fact(f, {
      sources: [
        {
          spaceId: EVIDENCE_OTHER_SPACE_ID,
          signalId: "original",
          occurredAtMs: TEST_NOW_MS - 2000,
        },
      ],
    });
    fact(f, {
      text: "The review plan was later changed from Friday to Monday.",
      sources: [
        {
          spaceId: EVIDENCE_OTHER_SPACE_ID,
          signalId: "reversal",
          occurredAtMs: TEST_NOW_MS - 1000,
        },
      ],
    });
    const result = await f.read();
    expect(result.items).toHaveLength(2);
    expect(
      result.items.every((item) => item.currentness === "not_verified")
    ).toBe(true);
    expect(result.items[1]?.sources[0]?.occurredAtMs).toBeGreaterThan(
      result.items[0]?.sources[0]?.occurredAtMs ?? 0
    );
    expect(result.coverage.currentDecisionVerification).toBe(
      "read_original_sources_and_current_organization_document_revisions"
    );
  });

  it("does not recreate deleted subjects or enable a disabled organization graph", async () => {
    const f = await fixture();
    await f.repository.markMemberDeleted({
      organizationId: f.request.organizationId,
      userId: f.speaker.ownerUserId,
      deletedAtMs: TEST_NOW_MS,
    });
    await f.repository.upsertPolicy({
      organizationId: f.request.organizationId,
      organizationMemoryOptIn: false,
      nowMs: TEST_NOW_MS,
      updatedByUserId: f.speaker.ownerUserId,
    });
    const before = persistedSubjects(f);
    expect(await f.read()).toMatchObject({ status: "no_match", items: [] });
    expect(provider.search).not.toHaveBeenCalled();
    expect(persistedSubjects(f)).toEqual(before);
    expect(provider.create).not.toHaveBeenCalled();
    expect(provider.userAdd).not.toHaveBeenCalled();
  });

  it("rechecks member revocation after the provider read and rejects model-supplied authority", async () => {
    const f = await fixture();
    await expect(
      f.execute(f.binding, "openmeld_search_center_agent_memory", {
        query: "review",
        graphId: "another-member",
      })
    ).rejects.toThrow();
    await expect(f.read(" ")).rejects.toThrow();
    await expect(f.read("x".repeat(401))).rejects.toThrow();
    provider.search.mockImplementation(() => {
      f.harness.run({
        sql: "DELETE FROM members WHERE id = ?",
        params: [f.speaker.id],
      });
      return Promise.resolve({ edges: [] });
    });
    await expect(f.read()).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a converted private reply audience and Routine callers explicitly", async () => {
    const f = await fixture();
    const current = f.spaces.get(f.request.spaceId);
    if (!current?.directMessage) {
      throw new Error("Missing current DM.");
    }
    f.spaces.set(f.request.spaceId, {
      ...current,
      directMessage: {
        ...current.directMessage,
        convertedAt: new Date(TEST_NOW_MS).toISOString(),
      },
    });
    await expect(f.read()).rejects.toMatchObject({
      code: "center_agent.memory_search_surface_unsupported",
    });
    expect(provider.search).not.toHaveBeenCalled();
    const routine = await fixture({
      request: createSubmitTurnRequest({
        turnEnvelope: createRoutineTurnEnvelope(),
      }),
    });
    await expect(
      rpcCenterAgentSearchMemory(routine.env, {
        query: "review",
        context: buildRemoteAgentCoreContext(
          routine.callbackContext,
          "routine-search"
        ),
        speakerMember: {
          memberId: routine.speaker.id,
          userId: routine.speaker.ownerUserId,
        },
      })
    ).rejects.toMatchObject({
      code: "center_agent.memory_search_surface_unsupported",
    });
  });

  it("fails explicitly with an older Core and derives selectors only from current member and organization", async () => {
    const f = await fixture();
    await expect(
      f.execute({}, "openmeld_search_center_agent_memory", { query: "review" })
    ).rejects.toThrow(UNAVAILABLE_PATTERN);
    await f.read();
    const expectedMember = buildCenterAgentMemberMemoryRef({
      organizationId: f.request.organizationId,
      memberId: f.speaker.id,
      userId: f.speaker.ownerUserId,
    });
    const expectedOrganization = buildCenterAgentOrganizationMemoryRef({
      organizationId: f.request.organizationId,
    });
    expect(
      provider.search.mock.calls.map(([input]) => input.userId ?? input.graphId)
    ).toEqual([expectedMember.subjectId, expectedOrganization.subjectId]);
  });
});
