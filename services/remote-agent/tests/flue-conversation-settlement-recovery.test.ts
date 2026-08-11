import { DatabaseSync } from "node:sqlite";
import {
  type ConversationProducerClaim,
  type ConversationRecord,
  createSessionStorageKey,
} from "@flue/runtime/adapter";
import {
  type AgentConversationSnapshot,
  handleAgentConversationRead,
  SqliteConversationStreamStore,
} from "@flue/runtime/internal";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCloudflareSqlHarness,
  createTransactionRunner,
} from "./helpers/cloudflare-sql-harness.test-support";

const AGENT_NAME = "center-agent";
const CONVERSATION_ID = "conversation_poisoned";
const INSTANCE_ID = "space_poisoned";
const STREAM_PATH = `agent:${AGENT_NAME}:${INSTANCE_ID}`;
const SUBMISSION_ID = "submission_interrupted";
const ATTEMPT_ONE_ID = "attempt_interrupted";
const ATTEMPT_TWO_ID = "attempt_replacement";

const MODEL_INFO = {
  api: "openai-completions" as const,
  provider: "openrouter" as const,
  model: "test-model",
};

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

type ConversationRecordInput = {
  [Type in ConversationRecord["type"]]: Omit<
    Extract<ConversationRecord, { type: Type }>,
    "v" | "conversationId" | "harness" | "session" | "timestamp"
  >;
}[ConversationRecord["type"]];

describe("Flue conversation settlement recovery", () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.close();
    }
  });

  it("replays a settled replacement stream without leaving the interrupted attempt in progress", async () => {
    const { append, database, store } = await createHarness(databases);

    await append([
      record({
        id: "record_conversation_created",
        type: "conversation_created",
        affinityKey: INSTANCE_ID,
        createdAt: "2026-07-13T00:00:00.000Z",
        kind: "root",
      }),
      record({
        id: "record_user_one",
        type: "user_message",
        messageId: "entry_user_one",
        parentId: null,
        content: [{ type: "text", text: "First message" }],
      }),
    ]);

    createRunningSubmission(database, ATTEMPT_ONE_ID);
    await append(
      [
        record({
          id: "record_assistant_orphan_started",
          type: "assistant_message_started",
          submissionId: SUBMISSION_ID,
          attemptId: ATTEMPT_ONE_ID,
          messageId: "entry_assistant_orphan",
          parentId: "entry_user_one",
          modelInfo: MODEL_INFO,
        }),
      ],
      ATTEMPT_ONE_ID
    );

    setRunningAttempt(database, ATTEMPT_TWO_ID);
    await expect(
      append(
        [
          record({
            id: "record_late_orphan_completion",
            type: "assistant_message_completed",
            submissionId: SUBMISSION_ID,
            attemptId: ATTEMPT_ONE_ID,
            messageId: "entry_assistant_orphan",
            stopReason: "aborted",
            usage: EMPTY_USAGE,
          }),
        ],
        ATTEMPT_ONE_ID
      )
    ).rejects.toMatchObject({
      name: "ConversationStreamStoreError",
      meta: {
        operation: "append",
        reason:
          "Submission attempt no longer owns work for this agent instance.",
      },
    });
    await append(
      [
        record({
          id: "record_assistant_replacement_started",
          type: "assistant_message_started",
          submissionId: SUBMISSION_ID,
          attemptId: ATTEMPT_TWO_ID,
          messageId: "entry_assistant_replacement",
          parentId: "entry_user_one",
          modelInfo: MODEL_INFO,
        }),
        record({
          id: "record_assistant_replacement_completed",
          type: "assistant_message_completed",
          submissionId: SUBMISSION_ID,
          attemptId: ATTEMPT_TWO_ID,
          messageId: "entry_assistant_replacement",
          stopReason: "error",
          usage: EMPTY_USAGE,
          error: "Replacement attempt failed",
        }),
      ],
      ATTEMPT_TWO_ID
    );

    const settlement = record({
      id: "record_submission_settled",
      type: "submission_settled",
      submissionId: SUBMISSION_ID,
      attemptId: ATTEMPT_TWO_ID,
      outcome: "failed",
      error: { message: "Replacement attempt failed" },
    });
    beginSettlement(database, settlement);
    await append([settlement], ATTEMPT_TWO_ID);
    finishSettlement(database);

    const replayed = await readHistory(store);

    expect(replayed.messages.map((message) => message.id)).toEqual([
      "entry_user_one",
      "entry_assistant_replacement",
    ]);
    expect(replayed.settlements).toEqual([
      {
        submissionId: SUBMISSION_ID,
        outcome: "failed",
        error: { message: "Replacement attempt failed" },
      },
    ]);

    await append([
      record({
        id: "record_user_two",
        type: "user_message",
        messageId: "entry_user_two",
        parentId: "entry_assistant_replacement",
        content: [{ type: "text", text: "Second message" }],
      }),
    ]);

    await expect(readHistory(store)).resolves.toMatchObject({
      messages: [
        { id: "entry_user_one" },
        { id: "entry_assistant_replacement" },
        { id: "entry_user_two" },
      ],
    });
  });

  it("ignores a superseded orphan completion after its replacement moved the conversation tail", async () => {
    const { append, store } = await createHarness(databases);

    await append([
      record({
        id: "record_conversation_created",
        type: "conversation_created",
        affinityKey: INSTANCE_ID,
        createdAt: "2026-07-13T00:00:00.000Z",
        kind: "root",
      }),
      record({
        id: "record_user_one",
        type: "user_message",
        messageId: "entry_user_one",
        parentId: null,
        content: [{ type: "text", text: "First message" }],
      }),
      record({
        id: "record_assistant_orphan_started",
        type: "assistant_message_started",
        messageId: "entry_assistant_orphan",
        parentId: "entry_user_one",
        modelInfo: MODEL_INFO,
      }),
      record({
        id: "record_assistant_replacement_started",
        type: "assistant_message_started",
        messageId: "entry_assistant_replacement",
        parentId: "entry_user_one",
        modelInfo: MODEL_INFO,
      }),
      record({
        id: "record_assistant_replacement_completed",
        type: "assistant_message_completed",
        messageId: "entry_assistant_replacement",
        stopReason: "error",
        usage: EMPTY_USAGE,
        error: "Replacement attempt failed",
      }),
    ]);
    await expect(readHistory(store)).resolves.toMatchObject({
      messages: [
        { id: "entry_user_one" },
        { id: "entry_assistant_replacement" },
        { id: "entry_assistant_orphan" },
      ],
    });

    await append([
      record({
        id: "record_assistant_orphan_completed",
        type: "assistant_message_completed",
        messageId: "entry_assistant_orphan",
        stopReason: "aborted",
        usage: EMPTY_USAGE,
      }),
    ]);

    await expect(readHistory(store)).resolves.toMatchObject({
      messages: [
        { id: "entry_user_one" },
        { id: "entry_assistant_replacement" },
      ],
    });
  });

  it("lets settlement clear a legacy assistant attempt without submission metadata", async () => {
    const { append, database, store } = await createHarness(databases);

    await append([
      record({
        id: "record_conversation_created",
        type: "conversation_created",
        affinityKey: INSTANCE_ID,
        createdAt: "2026-07-13T00:00:00.000Z",
        kind: "root",
      }),
      record({
        id: "record_user_one",
        type: "user_message",
        messageId: "entry_user_one",
        parentId: null,
        content: [{ type: "text", text: "First message" }],
      }),
      record({
        id: "record_legacy_assistant_started",
        type: "assistant_message_started",
        messageId: "entry_legacy_assistant",
        parentId: "entry_user_one",
        modelInfo: MODEL_INFO,
      }),
    ]);

    createRunningSubmission(database, ATTEMPT_TWO_ID);
    const settlement = record({
      id: "record_submission_settled",
      type: "submission_settled",
      submissionId: SUBMISSION_ID,
      attemptId: ATTEMPT_TWO_ID,
      outcome: "failed",
      error: { message: "Replacement attempt failed" },
    });
    beginSettlement(database, settlement);
    await append([settlement], ATTEMPT_TWO_ID);
    finishSettlement(database);

    await append([
      record({
        id: "record_user_two",
        type: "user_message",
        messageId: "entry_user_two",
        parentId: "entry_user_one",
        content: [{ type: "text", text: "Second message" }],
      }),
    ]);

    await expect(readHistory(store)).resolves.toMatchObject({
      messages: [{ id: "entry_user_one" }, { id: "entry_user_two" }],
    });
  });

  it("lets a new user turn advance past an interrupted assistant attempt", async () => {
    const { append, store } = await createHarness(databases);

    await append([
      record({
        id: "record_conversation_created",
        type: "conversation_created",
        affinityKey: INSTANCE_ID,
        createdAt: "2026-07-13T00:00:00.000Z",
        kind: "root",
      }),
      record({
        id: "record_user_one",
        type: "user_message",
        messageId: "entry_user_one",
        parentId: null,
        content: [{ type: "text", text: "First message" }],
      }),
      record({
        id: "record_interrupted_assistant_started",
        type: "assistant_message_started",
        messageId: "entry_interrupted_assistant",
        parentId: "entry_user_one",
        modelInfo: MODEL_INFO,
      }),
      record({
        id: "record_user_two",
        type: "user_message",
        messageId: "entry_user_two",
        parentId: "entry_user_one",
        content: [{ type: "text", text: "Second message" }],
      }),
    ]);

    await expect(readHistory(store)).resolves.toMatchObject({
      messages: [{ id: "entry_user_one" }, { id: "entry_user_two" }],
    });
  });

  it("lets a new dispatch signal advance past an interrupted assistant attempt", async () => {
    const { append, store } = await createHarness(databases);

    await append([
      record({
        id: "record_conversation_created",
        type: "conversation_created",
        affinityKey: INSTANCE_ID,
        createdAt: "2026-07-13T00:00:00.000Z",
        kind: "root",
      }),
      record({
        id: "record_dispatch_one",
        type: "signal",
        messageId: "entry_dispatch_one",
        parentId: null,
        signalType: "dispatch_input",
        tagName: "dispatch",
        content: '{"message":"First message"}',
        attributes: {},
      }),
      record({
        id: "record_interrupted_assistant_started",
        type: "assistant_message_started",
        messageId: "entry_interrupted_assistant",
        parentId: "entry_dispatch_one",
        modelInfo: MODEL_INFO,
      }),
      record({
        id: "record_dispatch_two",
        type: "signal",
        messageId: "entry_dispatch_two",
        parentId: "entry_dispatch_one",
        signalType: "dispatch_input",
        tagName: "dispatch",
        content: '{"message":"Second message"}',
        attributes: {},
      }),
    ]);

    await expect(readHistory(store)).resolves.toMatchObject({
      messages: [{ id: "entry_dispatch_one" }, { id: "entry_dispatch_two" }],
    });
  });
});

async function createHarness(databases: DatabaseSync[]) {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  const store = new SqliteConversationStreamStore(
    createCloudflareSqlHarness(database),
    createTransactionRunner(database)
  );
  createSubmissionTable(database);
  await store.createStream(STREAM_PATH, {
    agentName: AGENT_NAME,
    instanceId: INSTANCE_ID,
  });
  const claim = await store.acquireProducer(STREAM_PATH, "test-producer");

  return {
    append: createAppender(store, claim),
    database,
    store,
  };
}

function record(input: ConversationRecordInput): ConversationRecord {
  return {
    v: 1,
    conversationId: CONVERSATION_ID,
    harness: "default",
    session: "default",
    timestamp: "2026-07-13T00:00:00.000Z",
    ...input,
  } as unknown as ConversationRecord;
}

function createAppender(
  store: SqliteConversationStreamStore,
  claim: ConversationProducerClaim
) {
  let producerSequence = claim.nextProducerSequence;

  return async (
    records: readonly ConversationRecord[],
    attemptId?: string
  ): Promise<void> => {
    await store.append({
      path: STREAM_PATH,
      producerId: claim.producerId,
      producerEpoch: claim.producerEpoch,
      incarnation: claim.incarnation,
      producerSequence,
      ...(attemptId
        ? { submission: { submissionId: SUBMISSION_ID, attemptId } }
        : {}),
      records,
    });
    producerSequence += 1;
  };
}

async function readHistory(
  store: SqliteConversationStreamStore
): Promise<AgentConversationSnapshot> {
  const response = await handleAgentConversationRead({
    store,
    path: STREAM_PATH,
    request: new Request("https://openmeld.test/conversation?view=history"),
  });
  if (!response.ok) {
    throw new Error(
      `Expected conversation history, received ${response.status}: ${await response.text()}`
    );
  }
  return (await response.json()) as AgentConversationSnapshot;
}

function createSubmissionTable(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE flue_agent_submissions (
      submission_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      attempt_id TEXT,
      session_key TEXT NOT NULL,
      settlement_record_id TEXT,
      settlement_record_json TEXT
    )
  `);
}

function createRunningSubmission(
  database: DatabaseSync,
  attemptId: string
): void {
  database
    .prepare(
      `INSERT INTO flue_agent_submissions
        (submission_id, status, attempt_id, session_key)
       VALUES (?, 'running', ?, ?)`
    )
    .run(
      SUBMISSION_ID,
      attemptId,
      createSessionStorageKey(INSTANCE_ID, "default", "default")
    );
}

function setRunningAttempt(database: DatabaseSync, attemptId: string): void {
  database
    .prepare(
      "UPDATE flue_agent_submissions SET attempt_id = ? WHERE submission_id = ?"
    )
    .run(attemptId, SUBMISSION_ID);
}

function beginSettlement(
  database: DatabaseSync,
  settlement: ConversationRecord
): void {
  database
    .prepare(
      `UPDATE flue_agent_submissions
       SET status = 'terminalizing',
           settlement_record_id = ?,
           settlement_record_json = ?
       WHERE submission_id = ?`
    )
    .run(settlement.id, JSON.stringify(settlement), SUBMISSION_ID);
}

function finishSettlement(database: DatabaseSync): void {
  database
    .prepare(
      "UPDATE flue_agent_submissions SET status = 'settled' WHERE submission_id = ?"
    )
    .run(SUBMISSION_ID);
}
