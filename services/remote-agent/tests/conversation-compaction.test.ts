import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const SLACK_MESSAGE_TOOL_NAME = "openmeld_post_slack_channel_message";
const CANONICAL_ACTION_EVIDENCE_HEADING_PATTERN =
  /^## Canonical Action Evidence$/mu;
type CompactionStartObservation = Extract<
  FlueObservation,
  { type: "compaction_start" }
>;
type CompactionObservation = Extract<FlueObservation, { type: "compaction" }>;

describe("Remote Agent conversation compaction", () => {
  it("installs one canonical section for facts, status, and pending work", () => {
    const runtimeSource = readFileSync(resolveProjectionModulePath(), "utf8");
    const promptStart = runtimeSource.indexOf("const SUMMARIZATION_PROMPT = `");
    const promptEnd = runtimeSource.indexOf(
      "const UPDATE_SUMMARIZATION_PROMPT = `",
      promptStart
    );
    expect(promptStart).toBeGreaterThanOrEqual(0);
    expect(promptEnd).toBeGreaterThan(promptStart);
    const initialPrompt = runtimeSource.slice(promptStart, promptEnd);

    expect(initialPrompt.match(/^## .+$/gmu)).toEqual([
      "## Goal",
      "## Constraints & Preferences",
      "## Observed Facts",
      "## Current Status",
      "## Pending Plan",
      "## Key Decisions",
      "## Critical Context",
    ]);
  });

  it("rebuilds historical tool evidence from canonical events across repeated compaction", async () => {
    const { buildCanonicalActionEvidence, compact } =
      await loadInstalledCompactionInternals();
    const canonicalConversation = conversationWithCompletedSlackMessages(3);
    const firstCanonicalActionEvidence = buildCanonicalActionEvidence(
      canonicalConversation
    );
    const prompts: string[] = [];
    const generatedSummaries = [
      summaryWithoutHistoricalMessages("Preparing the post-deploy check."),
      summaryWithoutHistoricalMessages("The deployment is now stable."),
    ];
    const observer = {
      end: () => undefined,
      run: async () => ({
        content: [
          {
            text: generatedSummaries.shift() ?? "",
            type: "text" as const,
          },
        ],
        stopReason: "stop",
      }),
      start: (
        _purpose: string,
        _model: unknown,
        context: { messages: Array<{ content: Array<{ text: string }> }> }
      ) => {
        prompts.push(context.messages[0]?.content[0]?.text ?? "");
        return { turnId: `turn_${prompts.length}` };
      },
    };
    const model = {
      api: "test",
      contextWindow: 200_000,
      id: "test/compaction",
      maxTokens: 16_000,
      provider: "test",
    };

    const first = await compact(
      compactionPreparation({
        canonicalActionEvidence: firstCanonicalActionEvidence,
      }),
      model,
      undefined,
      undefined,
      observer
    );
    appendCompactionCheckpoint(canonicalConversation, first.summary);
    const secondCanonicalActionEvidence = buildCanonicalActionEvidence(
      canonicalConversation
    );
    const second = await compact(
      compactionPreparation({
        canonicalActionEvidence: secondCanonicalActionEvidence,
        previousSummary: first.summary,
      }),
      model,
      undefined,
      undefined,
      observer
    );

    const expectedEvidence =
      `- ${SLACK_MESSAGE_TOOL_NAME}: calls=3; non_error_results=3; ` +
      "error_results=0; first=2026-08-18T16:00:01.000Z; " +
      "latest=2026-08-18T16:00:06.000Z";
    expect(firstCanonicalActionEvidence).toBe(expectedEvidence);
    expect(secondCanonicalActionEvidence).toBe(expectedEvidence);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain(
      `<canonical-action-evidence>\n${expectedEvidence}\n</canonical-action-evidence>`
    );
    expect(prompts[1]).not.toMatch(CANONICAL_ACTION_EVIDENCE_HEADING_PATTERN);
    expect(second.summary).toContain(
      "## Current Status\n- The deployment is now stable."
    );
    expect(second.summary).toContain(
      "## Pending Plan\n1. Send one post-deploy test message."
    );
    expect(second.summary).toContain(
      `## Canonical Action Evidence\n${expectedEvidence}`
    );
    expect(
      second.summary.match(/^## Canonical Action Evidence$/gmu)
    ).toHaveLength(1);
  });

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

type CanonicalConversation = {
  activeLeafId: string;
  entries: Map<string, unknown>;
};

type InstalledCompactionInternals = {
  buildCanonicalActionEvidence: (conversation: CanonicalConversation) => string;
  compact: (
    preparation: ReturnType<typeof compactionPreparation>,
    model: Record<string, unknown>,
    apiKey: undefined,
    signal: undefined,
    observer: {
      end: () => undefined;
      run: () => Promise<{
        content: Array<{ text: string; type: "text" }>;
        stopReason: string;
      }>;
      start: (
        purpose: string,
        model: unknown,
        context: { messages: Array<{ content: Array<{ text: string }> }> }
      ) => { turnId: string };
    }
  ) => Promise<{ summary: string }>;
};

function resolveProjectionModulePath(): string {
  const runtimeDistPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../node_modules/@flue/runtime/dist"
  );
  const projectionModuleName = readdirSync(runtimeDistPath).find(
    (name) =>
      name.startsWith("conversation-projections-") && name.endsWith(".mjs")
  );
  if (!projectionModuleName) {
    throw new Error("Installed Flue compaction module was not found.");
  }
  return join(runtimeDistPath, projectionModuleName);
}

async function loadInstalledCompactionInternals(): Promise<InstalledCompactionInternals> {
  const moduleUrl = pathToFileURL(resolveProjectionModulePath()).href;
  return (await import(
    /* @vite-ignore */ moduleUrl
  )) as InstalledCompactionInternals;
}

function conversationWithCompletedSlackMessages(
  count: number
): CanonicalConversation {
  const entries = new Map<string, unknown>();
  let parentId: string | null = null;

  for (let index = 0; index < count; index += 1) {
    const callId = `call_${index + 1}`;
    const assistantId = `assistant_${index + 1}`;
    const resultId = `result_${index + 1}`;
    const callTimestamp = new Date(
      Date.UTC(2026, 7, 18, 16, 0, index * 2 + 1)
    ).toISOString();
    const resultTimestamp = new Date(
      Date.UTC(2026, 7, 18, 16, 0, index * 2 + 2)
    ).toISOString();
    entries.set(assistantId, {
      id: assistantId,
      message: {
        content: [
          {
            arguments: {},
            id: callId,
            name: SLACK_MESSAGE_TOOL_NAME,
            type: "toolCall",
          },
        ],
        role: "assistant",
        stopReason: "toolUse",
        timestamp: Date.parse(callTimestamp),
      },
      parentId,
      timestamp: callTimestamp,
      type: "message",
    });
    entries.set(resultId, {
      id: resultId,
      message: {
        content: [{ text: "Message sent.", type: "text" }],
        isError: false,
        role: "toolResult",
        timestamp: Date.parse(resultTimestamp),
        toolCallId: callId,
        toolName: SLACK_MESSAGE_TOOL_NAME,
      },
      parentId: assistantId,
      timestamp: resultTimestamp,
      type: "message",
    });
    parentId = resultId;
  }

  return {
    activeLeafId: parentId ?? "",
    entries,
  };
}

function appendCompactionCheckpoint(
  conversation: CanonicalConversation,
  summary: string
): void {
  const sourceLeafId = conversation.activeLeafId;
  conversation.entries.set("compaction_1", {
    details: {
      files: { edited: [], read: [], written: [] },
      splitTurn: false,
      tokensAfter: 8000,
    },
    firstKeptEntryId: "assistant_1",
    id: "compaction_1",
    parentId: sourceLeafId,
    sourceLeafId,
    summary,
    timestamp: "2026-08-18T17:00:00.000Z",
    tokensBefore: 24_000,
    type: "compaction",
    usage: {
      input: 1000,
      output: 500,
      totalTokens: 1500,
    },
  });
  conversation.activeLeafId = "compaction_1";
}

function compactionPreparation(input: {
  canonicalActionEvidence: string;
  previousSummary?: string;
}) {
  return {
    canonicalActionEvidence: input.canonicalActionEvidence,
    fileOps: {
      edited: new Set<string>(),
      read: new Set<string>(),
      written: new Set<string>(),
    },
    isSplitTurn: false,
    messagesToSummarize: [
      {
        content: "The deployment finished; a new smoke test is still pending.",
        role: "user",
        timestamp: Date.UTC(2026, 7, 18, 17),
      },
    ],
    previousSummary: input.previousSummary,
    settings: {
      keepRecentTokens: 4000,
      reserveTokens: 16_000,
    },
    tokensBefore: 24_000,
    turnPrefixMessages: [],
  };
}

function summaryWithoutHistoricalMessages(currentStatus: string): string {
  return `## Goal
- Validate the deployed Center Agent.

## Constraints & Preferences
- Keep historical facts separate from pending work.

## Observed Facts
- The production deployment completed.

## Current Status
- ${currentStatus}

## Pending Plan
1. Send one post-deploy test message.

## Key Decisions
- **Use the real Slack thread**: It proves the user-visible path.

## Critical Context
- Earlier Slack messages remain relevant historical evidence.`;
}

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
