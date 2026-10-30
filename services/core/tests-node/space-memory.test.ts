import { expect, it, onTestFinished, vi } from "vitest";
import type {
  CenterAgentMemoryAdapter,
  CenterAgentMemoryEpisode,
  CenterAgentMemorySearchResult,
  CenterAgentMemorySpaceAccess,
} from "../src/center-agent-memory/contract";
import { createCenterAgentMemoryService } from "../src/center-agent-memory/memory-service";
import { createPostgresCenterAgentMemoryRepository } from "../src/center-agent-memory/postgresql-memory-repository";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const VERSION = `sha256:${"a".repeat(64)}`;
const OTHER_VERSION = `sha256:${"b".repeat(64)}`;

it("captures the owning Space source and isolates later recall across Spaces and organization-wide queries", async () => {
  const f = await fixture();
  await f.capture("space-a");
  await f.capture("space-b");
  expect(f.writes.map((write) => write.episode)).toEqual([
    expect.objectContaining({
      userMessage: "Confirmed in space-a",
      assistantMessage: "",
      sourceVersion: VERSION,
      sourceAuthorKind: "human",
      occurredAtMs: 1000,
    }),
    expect.objectContaining({
      userMessage: "Confirmed in space-b",
      assistantMessage: "",
      sourceVersion: VERSION,
      sourceAuthorKind: "human",
      occurredAtMs: 1000,
    }),
  ]);
  expect(f.writes.every((write) => write.ref.subject.kind === "space")).toBe(
    true
  );
  expect((await f.recall("space-a")).items).toEqual([
    expect.objectContaining({
      subject: "space",
      text: expect.stringContaining("Confirmed in space-a"),
    }),
  ]);
  expect((await f.recall("space-b")).items).toEqual([
    expect.objectContaining({
      subject: "space",
      text: expect.stringContaining("Confirmed in space-b"),
    }),
  ]);
  expect(
    (
      await f.service.recallForOrganization({
        organizationId: f.organizationId,
        query: "Confirmed",
      })
    ).items
  ).toEqual([]);
  expect(
    await f.repository.readActiveSubjects({
      organizationId: "other-organization",
      spaceId: "space-a",
    })
  ).toEqual([]);
});

it.each([
  "revoked",
  "edited",
  "recalled",
  "foreign_support",
] as const)("revalidates Space sources after provider latency: %s", async (change) => {
  const f = await fixture();
  await f.capture("space-a");
  const pending = deferred();
  const started = deferred();
  f.adapter.search = async (input) => {
    started.resolve();
    await pending.promise;
    const items = f.search(input);
    if (change === "foreign_support") {
      return items.map((item) => ({
        ...item,
        supportingSources: [{ ...item, sourceConversationId: "space-b" }],
      }));
    }
    return items;
  };
  const read = f.recall("space-a");
  await started.promise;
  if (change === "revoked") {
    f.state.authorized = false;
  }
  if (change === "edited") {
    f.state.version = OTHER_VERSION;
  }
  if (change === "recalled") {
    f.state.sourceExists = false;
  }
  pending.resolve();
  expect((await read).items).toEqual([]);
});

it("keeps a late write from restoring erased Space memory", async () => {
  const f = await fixture();
  const started = deferred();
  const pending = deferred();
  f.adapter.addEpisode = async (input) => {
    started.resolve();
    await pending.promise;
    return f.add(input);
  };
  const write = f.capture("space-a");
  await started.promise;
  await f.service.deleteSpaceMemory({
    organizationId: f.organizationId,
    spaceId: "space-a",
  });
  pending.resolve();
  await write;
  await Promise.all(f.background);
  expect([...f.facts.values()].flat()).toEqual([]);
  expect((await f.recall("space-a")).items).toEqual([]);
  await expect(f.capture("space-a")).rejects.toThrow("space_deleted");
});

it("keeps same-name speakers distinguishable through original-source grounding", async () => {
  const f = await fixture();
  await f.repository.upsertSpaceSubject({
    organizationId: f.organizationId,
    spaceId: "space-a",
    nowMs: 1000,
  });
  const first = {
    source: "space_conversation" as const,
    sourceConversationId: "space-a",
    sourceMessageId: "first",
    sourceVersion: VERSION,
    sourceAuthorKind: "human" as const,
    occurredAtMs: 1000,
    captureMethod: "automatic_turn" as const,
  };
  const second = {
    ...first,
    sourceMessageId: "second",
    sourceVersion: OTHER_VERSION,
    occurredAtMs: 2000,
  };
  f.adapter.search = async () => [
    {
      ...first,
      subject: "space",
      text: "A member prefers short updates.",
      supportingSources: [first, second],
    },
  ];
  f.spaceAccess.readSource = async ({ signalId }) =>
    signalId === "first"
      ? {
          text: "I prefer Chinese.",
          version: VERSION,
          occurredAtMs: 1000,
          author: {
            profileKind: "human",
            profileId: "person-a",
            profileName: "Nora",
          },
        }
      : {
          text: "I prefer English.",
          version: OTHER_VERSION,
          occurredAtMs: 2000,
          author: {
            profileKind: "human",
            profileId: "person-b",
            profileName: "Nora",
          },
        };
  const items = (await f.recall("space-a")).items;
  expect(
    items.some(
      (item) =>
        item.text.includes("person-a") &&
        item.text.includes("I prefer Chinese.")
    )
  ).toBe(true);
  expect(
    items.some(
      (item) =>
        item.text.includes("person-b") &&
        item.text.includes("I prefer English.")
    )
  ).toBe(true);
});

it("reports a source transport failure as unavailable rather than a successful empty recall", async () => {
  const f = await fixture();
  await f.capture("space-a");
  f.spaceAccess.readSource = () =>
    Promise.reject(new Error("source transport unavailable"));
  expect(await f.recall("space-a")).toMatchObject({
    items: [],
    status: "unavailable",
  });
});

it("disabling policy during a write suppresses recall without turning the toggle into an erase", async () => {
  const f = await fixture();
  const started = deferred();
  const pending = deferred();
  f.adapter.addEpisode = async (input) => {
    started.resolve();
    await pending.promise;
    return f.add(input);
  };
  const write = f.capture("space-a");
  await started.promise;
  await f.repository.upsertPolicy({
    organizationId: f.organizationId,
    organizationMemoryOptIn: false,
    updatedByUserId: f.userId,
    nowMs: 2000,
  });
  pending.resolve();
  await write;
  expect((await f.recall("space-a")).items).toEqual([]);
  expect([...f.facts.values()].flat()).toHaveLength(1);
  await f.repository.upsertPolicy({
    organizationId: f.organizationId,
    organizationMemoryOptIn: true,
    updatedByUserId: f.userId,
    nowMs: 3000,
  });
  expect((await f.recall("space-a")).items).toHaveLength(1);
});

async function fixture() {
  const harness = await createPostgresHarness();
  onTestFinished(() => harness.close());
  const organizationId = "memory-organization";
  const userId = "memory-user";
  await harness.query({
    text: "INSERT INTO openmeld.users (id, name, email) VALUES ($1, 'Member', 'memory@example.invalid')",
    values: [userId],
  });
  await harness.query({
    text: "INSERT INTO openmeld.organizations (id, name, slug, created_at) VALUES ($1, 'Memory', 'memory', 1000)",
    values: [organizationId],
  });
  const repository = createPostgresCenterAgentMemoryRepository(harness.db);
  const state = { authorized: true, sourceExists: true, version: VERSION };
  const spaceAccess: CenterAgentMemorySpaceAccess = {
    canRead: async (input) =>
      state.authorized && input.organizationId === organizationId,
    readSource: async (input) =>
      state.authorized && state.sourceExists
        ? {
            text: `Confirmed in ${input.spaceId}`,
            version: state.version,
            occurredAtMs: 1000,
            author: {
              profileKind: "human",
              profileId: "11111111-1111-4111-8111-111111111111",
              profileName: "Member",
            },
          }
        : null,
  };
  const facts = new Map<string, CenterAgentMemorySearchResult[]>();
  const writes: Parameters<CenterAgentMemoryAdapter["addEpisode"]>[0][] = [];
  const add = (
    input: Parameters<CenterAgentMemoryAdapter["addEpisode"]>[0]
  ) => {
    writes.push(input);
    const episode: CenterAgentMemoryEpisode = input.episode;
    facts.set(input.ref.subjectId, [
      {
        ...episode,
        subject: input.ref.subject.kind,
        text: episode.userMessage,
      },
    ]);
    return Promise.resolve({
      episodeId: `episode-${writes.length}`,
      processed: true,
    });
  };
  const search = (input: Parameters<CenterAgentMemoryAdapter["search"]>[0]) =>
    facts.get(input.ref.subjectId) ?? [];
  const adapter: CenterAgentMemoryAdapter = {
    ensureMemberUser: async () => undefined,
    ensureOrganizationGraph: async () => undefined,
    deleteMemberUser: async () => "not_found",
    deleteOrganizationGraph: (ref) => {
      facts.delete(ref.subjectId);
      return Promise.resolve("deleted");
    },
    addEpisode: add,
    search: async (input) => search(input),
  };
  const background: Promise<unknown>[] = [];
  const service = createCenterAgentMemoryService({
    adapter,
    repository,
    spaceAccess,
    nowMs: () => 2000,
    waitUntil: (promise) => {
      background.push(promise);
    },
    logger: { warn: vi.fn() },
  });
  const speakerMember = { memberId: "member", userId };
  const capture = (spaceId: string) =>
    service.rememberTurn({
      organizationId,
      speakerMember,
      source: "space_conversation",
      interactionEnvironment: "organization_shared",
      sourceConversationId: spaceId,
      sourceMessageId: "source-1",
      occurredAtMs: 9999,
      userMessage: "Stale supplied summary",
      assistantMessage: "An Agent guess",
    });
  const recall = (spaceId: string) =>
    service.recallForTurn({
      organizationId,
      speakerMember,
      spaceId,
      query: "Confirmed",
    });
  return {
    repository,
    state,
    spaceAccess,
    adapter,
    service,
    capture,
    recall,
    writes,
    facts,
    search,
    add,
    background,
    organizationId,
    userId,
  };
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
