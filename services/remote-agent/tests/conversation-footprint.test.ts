import { DatabaseSync } from "node:sqlite";
import type { ConversationRecord } from "@flue/runtime/adapter";
import { SqliteConversationStreamStore } from "@flue/runtime/internal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareFlueCenterAgentAdmission } from "../flue-adapter/center-agent-admission";
import {
  assertRemoteAgentConversationFootprintSchema,
  REMOTE_AGENT_CONVERSATION_HARD_LIMIT_BYTES,
  REMOTE_AGENT_CONVERSATION_SOFT_LIMIT_BYTES,
  readRemoteAgentConversationFootprint,
  resolveRemoteAgentConversationFootprintAdmission,
} from "../flue-adapter/conversation-footprint";
import {
  createCloudflareSqlHarness,
  createTransactionRunner,
} from "./helpers/cloudflare-sql-harness.test-support";

// Captured from the published @flue/runtime@2.0.3 SQLite store. The pinned
// beta.9 runtime does not create this table; its presence means the footprint
// reader must not silently apply the older batches.data-only contract.
const FLUE_2_0_3_BATCH_CHUNKS_SCHEMA = `
  CREATE TABLE flue_conversation_stream_batch_chunks (
    path TEXT NOT NULL,
    seq INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    chunk_count INTEGER NOT NULL CHECK (chunk_count > 0),
    data TEXT NOT NULL,
    PRIMARY KEY (path, seq, chunk_index)
  )
`;

class FakeSqlCursor {
  private readonly rows: Record<string, unknown>[];

  constructor(rows: Record<string, unknown>[]) {
    this.rows = rows;
  }

  toArray(): Record<string, unknown>[] {
    return [...this.rows];
  }
}

class FakeSqlStorage {
  readonly statements: string[] = [];
  private readonly fixtures: Array<{
    match: string;
    rows: Record<string, unknown>[];
  }>;

  constructor(
    fixtures: Array<{ match: string; rows: Record<string, unknown>[] }>
  ) {
    this.fixtures = fixtures;
  }

  exec(query: string): FakeSqlCursor {
    this.statements.push(query);
    return new FakeSqlCursor(
      this.fixtures.find(({ match }) => query.includes(match))?.rows ?? []
    );
  }
}

describe("Remote Agent conversation footprint", () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.close();
    }
  });

  it("treats a fresh Durable Object without a Flue stream table as empty", () => {
    const sql = new FakeSqlStorage([]);

    expect(readRemoteAgentConversationFootprint(sql)).toEqual({
      batchCount: 0,
      canonicalBytes: 0,
      largestBatchBytes: 0,
      level: "normal",
    });
    expect(sql.statements).toHaveLength(1);
    expect(sql.statements[0]).toContain("sqlite_schema");
  });

  it("fails closed when initialized Flue state is missing conversation stream tables", () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec(`
      CREATE TABLE flue_agent_submissions (
        submission_id TEXT PRIMARY KEY
      )
    `);
    const sql = createCloudflareSqlHarness(database);

    expect(() => readRemoteAgentConversationFootprint(sql)).toThrow(
      "Remote Agent conversation footprint schema is incompatible with the pinned Flue runtime."
    );
  });

  it("fails closed on the Flue 2.0.3 spilled-batch schema before replay", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    const sql = createCloudflareSqlHarness(database);
    const store = new SqliteConversationStreamStore(
      sql,
      createTransactionRunner(database)
    );
    const path = "agent:center-agent:future-chunk-schema";
    await store.createStream(path, {
      agentName: "center-agent",
      instanceId: "future-chunk-schema",
    });
    database.exec(FLUE_2_0_3_BATCH_CHUNKS_SCHEMA);
    database
      .prepare(
        `
          INSERT INTO flue_conversation_stream_batches (
            path,
            seq,
            producer_id,
            producer_epoch,
            producer_sequence,
            data
          ) VALUES (?, 0, 'future-producer', 1, 0, ?)
        `
      )
      .run(path, JSON.stringify({ $flueChunkCount: 1 }));
    database
      .prepare(
        `
          INSERT INTO flue_conversation_stream_batch_chunks (
            path,
            seq,
            chunk_index,
            chunk_count,
            data
          ) VALUES (?, 0, 0, 1, ?)
        `
      )
      .run(path, '[{"type":"future_spilled_record"}]');

    const ensureInitialized = vi.fn(async () => undefined);

    await expect(
      prepareFlueCenterAgentAdmission({
        assertConversationFootprintSchema: () =>
          assertRemoteAgentConversationFootprintSchema(sql),
        cleanupFinalizedSubmissionReplay: async () => undefined,
        ensureInitialized,
        readConversationFootprint: () =>
          readRemoteAgentConversationFootprint(sql),
        readExistingSubmission: async () => ({
          claimedAtMs: 1000,
          status: "claimed",
        }),
        reportConversationFootprintBeforeReplay: () => undefined,
      })
    ).rejects.toThrow(
      "Remote Agent conversation footprint schema is incompatible with the pinned Flue runtime."
    );
    expect(ensureInitialized).not.toHaveBeenCalled();
  });

  it("reads only aggregate size facts and marks the soft-limit range", () => {
    const sql = new FakeSqlStorage([
      {
        match: "sqlite_schema",
        rows: [
          { name: "flue_conversation_streams" },
          { name: "flue_conversation_stream_batches" },
        ],
      },
      {
        match: "PRAGMA table_info",
        rows: [{ name: "data" }],
      },
      {
        match: "FROM flue_conversation_stream_batches",
        rows: [
          {
            batch_count: 120,
            canonical_bytes: REMOTE_AGENT_CONVERSATION_SOFT_LIMIT_BYTES,
            largest_batch_bytes: 131_072,
          },
        ],
      },
    ]);

    expect(readRemoteAgentConversationFootprint(sql)).toEqual({
      batchCount: 120,
      canonicalBytes: REMOTE_AGENT_CONVERSATION_SOFT_LIMIT_BYTES,
      largestBatchBytes: 131_072,
      level: "soft_limit",
    });
    expect(sql.statements.join("\n").toLowerCase()).not.toContain(
      "select data"
    );
  });

  it("rejects before replay at the hard limit with one actionable outcome", () => {
    expect(
      resolveRemoteAgentConversationFootprintAdmission({
        batchCount: 180,
        canonicalBytes: REMOTE_AGENT_CONVERSATION_HARD_LIMIT_BYTES,
        largestBatchBytes: 131_072,
        level: "hard_limit",
      })
    ).toEqual({
      message:
        "Remote Agent rejected the turn before replay because its conversation history reached the safety limit.",
      reasonCode: "remote_agent.conversation_history_limit_exceeded",
    });
  });

  it("asks a rollover-capable Core to rotate at the soft limit before replay", () => {
    expect(
      resolveRemoteAgentConversationFootprintAdmission(
        {
          batchCount: 120,
          canonicalBytes: REMOTE_AGENT_CONVERSATION_SOFT_LIMIT_BYTES,
          largestBatchBytes: 131_072,
          level: "soft_limit",
        },
        { automaticRolloverSupported: true }
      )
    ).toEqual({
      message:
        "Remote Agent rejected the turn before replay because its conversation history reached the safety limit.",
      reasonCode: "remote_agent.conversation_history_limit_exceeded",
    });
  });

  it("rotates before replay when the selected model cannot carry a normal-size stored history", () => {
    expect(
      resolveRemoteAgentConversationFootprintAdmission(
        {
          batchCount: 40,
          canonicalBytes: 2_000_000,
          largestBatchBytes: 131_072,
          level: "normal",
        },
        {
          automaticRolloverSupported: true,
          providerContextCapacity: { inputTokenBudget: 450_000 },
        } as Parameters<
          typeof resolveRemoteAgentConversationFootprintAdmission
        >[1]
      )
    ).toEqual({
      message:
        "Remote Agent rejected the turn before replay because its conversation history reached the safety limit.",
      reasonCode: "remote_agent.conversation_history_limit_exceeded",
    });
  });

  it("fails closed when aggregate storage facts are invalid", () => {
    const sql = new FakeSqlStorage([
      {
        match: "sqlite_schema",
        rows: [
          { name: "flue_conversation_streams" },
          { name: "flue_conversation_stream_batches" },
        ],
      },
      {
        match: "PRAGMA table_info",
        rows: [{ name: "data" }],
      },
      {
        match: "FROM flue_conversation_stream_batches",
        rows: [
          {
            batch_count: -1,
            canonical_bytes: "not-a-number",
            largest_batch_bytes: 0,
          },
        ],
      },
    ]);

    expect(() => readRemoteAgentConversationFootprint(sql)).toThrow(
      "Remote Agent conversation footprint is invalid."
    );
  });

  it("fails closed when an existing Flue stream schema is incomplete", () => {
    const sql = new FakeSqlStorage([
      {
        match: "sqlite_schema",
        rows: [{ name: "flue_conversation_streams" }],
      },
    ]);

    expect(() => readRemoteAgentConversationFootprint(sql)).toThrow(
      "Remote Agent conversation footprint schema is incompatible with the pinned Flue runtime."
    );
  });

  it("fails closed when the Flue batch payload column has drifted", () => {
    const sql = new FakeSqlStorage([
      {
        match: "sqlite_schema",
        rows: [
          { name: "flue_conversation_streams" },
          { name: "flue_conversation_stream_batches" },
        ],
      },
      {
        match: "PRAGMA table_info",
        rows: [{ name: "payload" }],
      },
    ]);

    expect(() => readRemoteAgentConversationFootprint(sql)).toThrow(
      "Remote Agent conversation footprint schema is incompatible with the pinned Flue runtime."
    );
  });

  it("measures batches written through the pinned Flue SQLite store", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    const sql = createCloudflareSqlHarness(database);
    const store = new SqliteConversationStreamStore(
      sql,
      createTransactionRunner(database)
    );
    const path = "agent:center-agent:footprint-contract";
    await store.createStream(path, {
      agentName: "center-agent",
      instanceId: "footprint-contract",
    });
    const claim = await store.acquireProducer(path, "footprint-test");
    await store.append({
      path,
      producerId: claim.producerId,
      producerEpoch: claim.producerEpoch,
      incarnation: claim.incarnation,
      producerSequence: claim.nextProducerSequence,
      records: [
        {
          v: 1,
          id: "record_conversation_created",
          type: "conversation_created",
          conversationId: "conversation_footprint_contract",
          harness: "default",
          session: "default",
          timestamp: "2026-08-10T00:00:00.000Z",
          affinityKey: "footprint-contract",
          createdAt: "2026-08-10T00:00:00.000Z",
          kind: "root",
        } satisfies ConversationRecord,
      ],
    });

    const footprint = readRemoteAgentConversationFootprint(sql);

    expect(footprint).toMatchObject({
      batchCount: 1,
      level: "normal",
    });
    expect(footprint.canonicalBytes).toBeGreaterThan(0);
    expect(footprint.largestBatchBytes).toBe(footprint.canonicalBytes);

    const ensureInitialized = vi.fn(async () => undefined);
    await expect(
      prepareFlueCenterAgentAdmission({
        assertConversationFootprintSchema: () =>
          assertRemoteAgentConversationFootprintSchema(sql),
        cleanupFinalizedSubmissionReplay: async () => undefined,
        ensureInitialized,
        readConversationFootprint: () =>
          readRemoteAgentConversationFootprint(sql),
        readExistingSubmission: async () => ({
          claimedAtMs: 1000,
          status: "claimed",
        }),
        reportConversationFootprintBeforeReplay: () => undefined,
      })
    ).resolves.toMatchObject({ admission: "claimed", outcome: "ready" });
    expect(ensureInitialized).toHaveBeenCalledOnce();
  });
});
