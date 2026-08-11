import type { FlueObservation } from "@flue/runtime";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { createRemoteAgentConversationCompactionObserver } from "../flue-adapter/conversation-compaction";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const SUBMISSION_ID = "flue_submission_compaction";
type CompactionStartObservation = Extract<
  FlueObservation,
  { type: "compaction_start" }
>;
type CompactionObservation = Extract<FlueObservation, { type: "compaction" }>;

describe("Remote Agent conversation compaction", () => {
  it("flags repeated compaction in one submission without blocking the checkpoint", async () => {
    const storage = await createStorageWithCallbackContext();
    const observer = createRemoteAgentConversationCompactionObserver();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      observer.enqueue({
        event: compactionStartObservation(1),
        storage,
      });
      observer.enqueue({
        event: compactionCompletedObservation(2, 24, 8),
        storage,
      });
      observer.enqueue({
        event: compactionStartObservation(3),
        storage,
      });
      observer.enqueue({
        event: compactionCompletedObservation(4, 8, 4),
        storage,
      });
      await observer.drain(SUBMISSION_ID);
      expect(warn).toHaveBeenCalledWith(
        "[remote_agent.conversation_compaction.attention_required]",
        expect.objectContaining({
          issueCodes: ["repeated_in_submission"],
          submissionId: SUBMISSION_ID,
        })
      );
    } finally {
      warn.mockRestore();
    }

    await expect(
      readRemoteAgentCallbackContext(storage, SUBMISSION_ID)
    ).resolves.toMatchObject({
      conversationCompaction: {
        completedAtMs: TEST_NOW_MS + 40,
        count: 2,
        v: 1,
      },
      organizationSkillReleases: [
        {
          digest: "a".repeat(64),
          name: "release-review",
          releaseId: "release_123",
          skillId: "skill_123",
        },
      ],
    });
  });

  it("flags a compaction that does not reduce its message count", async () => {
    const storage = await createStorageWithCallbackContext();
    const observer = createRemoteAgentConversationCompactionObserver();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      observer.enqueue({
        event: compactionStartObservation(1),
        storage,
      });
      observer.enqueue({
        event: compactionCompletedObservation(2, 24, 24),
        storage,
      });
      await observer.drain(SUBMISSION_ID);
      expect(warn).toHaveBeenCalledWith(
        "[remote_agent.conversation_compaction.attention_required]",
        expect.objectContaining({
          issueCodes: ["message_count_not_reduced"],
          submissionId: SUBMISSION_ID,
        })
      );
    } finally {
      warn.mockRestore();
    }
  });
});

async function createStorageWithCallbackContext(): Promise<InMemoryDurableObjectStorage> {
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(
    storage,
    createRemoteAgentCallbackContext({
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        idempotencyKey: "remote-agent:dispatch_compaction",
        requestId: SUBMISSION_ID,
        status: "pending",
        submissionId: SUBMISSION_ID,
      },
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest({
        dispatchId: "dispatch_compaction",
        idempotencyKey: "remote-agent:dispatch_compaction",
        organizationSkillReleases: [
          {
            digest: "a".repeat(64),
            name: "release-review",
            releaseId: "release_123",
            skillId: "skill_123",
          },
        ],
      }),
    })
  );
  return storage;
}

function compactionStartObservation(
  eventIndex: number
): CompactionStartObservation {
  return {
    agentName: "center-agent",
    estimatedTokens: 120_000,
    eventIndex,
    reason: "threshold",
    submissionId: SUBMISSION_ID,
    timestamp: new Date(TEST_NOW_MS + eventIndex * 10).toISOString(),
    type: "compaction_start",
    v: 3,
  } satisfies FlueObservation;
}

function compactionCompletedObservation(
  eventIndex: number,
  messagesBefore: number,
  messagesAfter: number
): CompactionObservation {
  return {
    agentName: "center-agent",
    durationMs: 250,
    eventIndex,
    isError: false,
    messagesAfter,
    messagesBefore,
    submissionId: SUBMISSION_ID,
    timestamp: new Date(TEST_NOW_MS + eventIndex * 10).toISOString(),
    type: "compaction",
    v: 3,
  } satisfies FlueObservation;
}
