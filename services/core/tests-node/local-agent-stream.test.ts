import { RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION } from "@openmeld/schemas";
import type {
  RuntimeCoordinatorFinalizationCommand,
  RuntimeCoordinatorFinalizationOutcome,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildLocalAgentStreamTerminal,
  createLocalAgentStreamClosureRetryEntry,
  incrementLocalAgentStreamClosureRetryEntry,
  listDueLocalAgentStreamClosureRetryEntries,
  readNextLocalAgentStreamClosureRetryAtMs,
  removeLocalAgentStreamClosureRetryEntry,
  upsertLocalAgentStreamClosureRetryEntry,
} from "../src/runtime-transport/application/local-agent-stream";

describe("Local Agent stream terminal copy", () => {
  it("uses the structured task failure while the durable reply is finalizing", () => {
    expect(
      buildLocalAgentStreamTerminal({
        command: buildFailedFinalizationCommand({
          errorCode: "model.inventory_unavailable",
          errorMessage:
            "model.inventory_unavailable: Cursor ACP model inventory was unavailable",
        }),
        outcome: {
          finalizationCommandId: "command-1",
          ok: true,
          publicationErrorCode: null,
          publishedSignalId: "failure-signal-1",
          publishState: "reply_published",
          status: "finalized",
        } satisfies RuntimeCoordinatorFinalizationOutcome,
      })
    ).toEqual({
      kind: "failed",
      noticeText:
        "Cursor couldn't confirm which models are available right now. Try waking the agent again.",
      reasonCode: "model.inventory_unavailable",
    });
  });
});

describe("Local Agent stream closure retry storage", () => {
  it("keeps concurrent stream retries independent when one entry is removed", async () => {
    const storage = new TransactionalMemoryStorage();
    const durableStorage = storage as unknown as DurableObjectStorage;
    const first = createLocalAgentStreamClosureRetryEntry({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      nowMs: 1000,
      runtimeCoordinatorExecutionId: "execution-1",
      spaceId: "space-1",
      terminal: {
        kind: "stopped",
        noticeText: "The Agent stopped this reply.",
        reasonCode: "adapter.cancel.accepted",
      },
    });
    const second = createLocalAgentStreamClosureRetryEntry({
      attemptId: "attempt-2",
      dispatchId: "dispatch-2",
      nowMs: 1000,
      runtimeCoordinatorExecutionId: "execution-2",
      spaceId: "space-2",
      terminal: {
        kind: "failed",
        noticeText: "The Agent finished, but its reply could not be posted.",
        reasonCode: "runtime_coordinator.publication_retry_exhausted",
      },
    });

    await Promise.all([
      upsertLocalAgentStreamClosureRetryEntry({
        entry: first,
        storage: durableStorage,
      }),
      upsertLocalAgentStreamClosureRetryEntry({
        entry: second,
        storage: durableStorage,
      }),
    ]);

    await expect(
      listDueLocalAgentStreamClosureRetryEntries({
        limit: 2,
        nowMs: Number.MAX_SAFE_INTEGER,
        storage: durableStorage,
      })
    ).resolves.toEqual([first, second]);

    await removeLocalAgentStreamClosureRetryEntry({
      storage: durableStorage,
      streamId: first.streamId,
    });

    await expect(
      listDueLocalAgentStreamClosureRetryEntries({
        limit: 2,
        nowMs: Number.MAX_SAFE_INTEGER,
        storage: durableStorage,
      })
    ).resolves.toEqual([second]);
    expect(storage.countKeysContaining(":entry:")).toBe(1);
    expect(storage.countKeysContaining(":due:")).toBe(1);
    expect(storage.hasArrayValue()).toBe(false);
  });

  it("moves one due marker when a stream retry is rescheduled", async () => {
    const storage = new TransactionalMemoryStorage();
    const durableStorage = storage as unknown as DurableObjectStorage;
    const entry = createLocalAgentStreamClosureRetryEntry({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      nowMs: 1000,
      runtimeCoordinatorExecutionId: "execution-1",
      spaceId: "space-1",
      terminal: {
        kind: "stopped",
        noticeText: "The Agent stopped this reply.",
        reasonCode: "adapter.cancel.accepted",
      },
    });
    await upsertLocalAgentStreamClosureRetryEntry({
      entry,
      storage: durableStorage,
    });

    const rescheduled = incrementLocalAgentStreamClosureRetryEntry({
      entry,
      nowMs: 10_000,
    });
    await upsertLocalAgentStreamClosureRetryEntry({
      entry: rescheduled,
      storage: durableStorage,
    });

    expect(storage.countKeysContaining(":entry:")).toBe(1);
    expect(storage.countKeysContaining(":due:")).toBe(1);
    await expect(
      listDueLocalAgentStreamClosureRetryEntries({
        limit: 1,
        nowMs: Number.MAX_SAFE_INTEGER,
        storage: durableStorage,
      })
    ).resolves.toEqual([rescheduled]);
  });

  it("keeps corrupt retry work observable instead of treating it as empty", async () => {
    const storage = new TransactionalMemoryStorage();
    const durableStorage = storage as unknown as DurableObjectStorage;
    const entry = createLocalAgentStreamClosureRetryEntry({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      nowMs: 1000,
      runtimeCoordinatorExecutionId: "execution-1",
      spaceId: "space-1",
      terminal: {
        kind: "stopped",
        noticeText: "The Agent stopped this reply.",
        reasonCode: "adapter.cancel.accepted",
      },
    });
    await upsertLocalAgentStreamClosureRetryEntry({
      entry,
      storage: durableStorage,
    });
    storage.corruptFirstKeyContaining(":entry:");

    await expect(
      readNextLocalAgentStreamClosureRetryAtMs(durableStorage)
    ).rejects.toThrow("local_agent_stream_closure_retry_entry_invalid");
    expect(storage.countKeysContaining(":due:")).toBe(1);
  });
});

function buildFailedFinalizationCommand(input: {
  errorCode: string;
  errorMessage: string;
}): RuntimeCoordinatorFinalizationCommand {
  return {
    acceptedResult: {
      acceptedAtMs: 2000,
      attemptId: "attempt-1",
      daemonSessionId: "daemon-session-1",
      dispatchId: "dispatch-1",
      executionTokenFingerprint: "fingerprint-1",
      executionTokenRunId: "run-1",
      leaseEpoch: 1,
      runtimeCoordinatorExecutionId: "execution-1",
      submittedConnectionGeneration: 1,
      targetProfileId: "agent-1",
      taskId: "task-1",
      taskResult: {
        code: "service.task_result",
        payload: {
          agentId: "agent-1",
          attemptId: "attempt-1",
          deduped: false,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          errorType: "adapter",
          sourceEventId: "signal-1",
          status: "failed",
          taskId: "task-1",
        },
        v: 4,
      },
    },
    createdAtMs: 2100,
    dispatchFact: {
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      dispatchOwner: {
        id: "owner-1",
        kind: "owner_account",
      },
      enqueuedAtMs: 1000,
      idempotencyKey: "dispatch-1:attempt-1",
      sourceClientMessageId: "client-message-1",
      sourceEventId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
      taskId: "task-1",
    },
    dispatchId: "dispatch-1",
    executionTokenRunId: "run-1",
    finalizationCommandId: "command-1",
    modelVersion: RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION,
    publicationIdempotencyKey: "publication-1",
    resultIdempotencyKey: "result-1",
    runtimeCoordinatorExecutionId: "execution-1",
    spaceId: "space-1",
    targetOwnerUserId: "owner-1",
    targetProfileId: "agent-1",
    targetProfileMentionLabel: null,
    targetProfileName: "Cursor Agent",
  };
}

class TransactionalMemoryStorage {
  private readonly records = new Map<string, unknown>();
  private transactionTail: Promise<void> = Promise.resolve();

  readonly get = <T>(key: string): Promise<T | undefined> =>
    Promise.resolve(this.records.get(key) as T | undefined);

  readonly delete = (key: string): Promise<boolean> =>
    Promise.resolve(this.records.delete(key));

  readonly list = <T>(options: {
    limit?: number;
    prefix?: string;
  }): Promise<Map<string, T>> =>
    Promise.resolve(
      new Map(
        [...this.records.entries()]
          .filter(([key]) =>
            options.prefix ? key.startsWith(options.prefix) : true
          )
          .sort(([left], [right]) => left.localeCompare(right))
          .slice(0, options.limit) as [string, T][]
      )
    );

  readonly put = (key: string, value: unknown): Promise<void> => {
    this.records.set(key, value);
    return Promise.resolve();
  };

  readonly transaction = <T>(
    operation: (transaction: DurableObjectTransaction) => Promise<T>
  ): Promise<T> => {
    const result = this.transactionTail.then(() =>
      operation({
        delete: this.delete,
        get: this.get,
        list: this.list,
        put: this.put,
      } as unknown as DurableObjectTransaction)
    );
    this.transactionTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  countKeysContaining(fragment: string): number {
    return [...this.records.keys()].filter((key) => key.includes(fragment))
      .length;
  }

  corruptFirstKeyContaining(fragment: string): void {
    const key = [...this.records.keys()].find((candidate) =>
      candidate.includes(fragment)
    );
    if (!key) {
      throw new Error(`test_storage_key_missing:${fragment}`);
    }
    this.records.set(key, { v: 1 });
  }

  hasArrayValue(): boolean {
    return [...this.records.values()].some(Array.isArray);
  }
}
