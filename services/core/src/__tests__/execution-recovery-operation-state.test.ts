import { describe, expect, it } from "vitest";
import {
  beginExecutionRecoveryOperation,
  completeExecutionRecoveryOperationAttempt,
  failExecutionRecoveryOperationAttempt,
  markExecutionRecoveryOperationEffectStarted,
} from "../execution-recovery/application/execution-recovery-operation-state";

type TransactionPort = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
};

function createStorage() {
  const records = new Map<string, unknown>();
  let tail = Promise.resolve();
  return {
    records,
    storage: {
      transaction<T>(
        run: (transaction: TransactionPort) => Promise<T>
      ): Promise<T> {
        const result = tail.then(() =>
          run({
            get: async <Value>(key: string) =>
              records.get(key) as Value | undefined,
            put: <Value>(key: string, value: Value) => {
              records.set(key, value);
              return Promise.resolve();
            },
          })
        );
        tail = result.then(
          () => undefined,
          () => undefined
        );
        return result;
      },
    },
  };
}

describe("execution recovery operation state", () => {
  it("reclaims an expired reservation that crashed before the effect boundary", async () => {
    const { storage } = createStorage();
    const commandJson =
      '{"action":"recover_result","destination":{"spaceId":"space-1","surface":"space","threadId":null},"expectedIdentity":{"dispatchId":"dispatch-1"}}';
    const first = await beginExecutionRecoveryOperation(storage, {
      attemptId: "attempt-reserved-1",
      claimStorageKey: "claim-reserved-1",
      commandJson,
      leaseDurationMs: 10,
      nowMs: 100,
      operationId: "operation-reserved-1",
      operationStorageKey: "operation-reserved-1",
    });

    expect(first).toMatchObject({
      attemptId: "attempt-reserved-1",
      status: "claimed",
    });
    await expect(
      beginExecutionRecoveryOperation(storage, {
        attemptId: "attempt-reserved-2",
        claimStorageKey: "claim-reserved-1",
        commandJson,
        leaseDurationMs: 10,
        nowMs: 111,
        operationId: "operation-reserved-2",
        operationStorageKey: "operation-reserved-2",
      })
    ).resolves.toMatchObject({
      attemptId: "attempt-reserved-2",
      effectOperationId: "claim-reserved-1",
      status: "claimed",
    });
  });

  it("keeps an expired effect-started attempt outcome unknown and fences its stale transition", async () => {
    const { storage } = createStorage();
    const commandJson =
      '{"action":"resume_controller_conversation","destination":{"spaceId":"space-1","surface":"space","threadId":null},"expectedIdentity":{"dispatchId":"dispatch-1"}}';
    await beginExecutionRecoveryOperation(storage, {
      attemptId: "attempt-effect-1",
      claimStorageKey: "claim-effect-1",
      commandJson,
      leaseDurationMs: 10,
      nowMs: 100,
      operationId: "operation-effect-1",
      operationStorageKey: "operation-effect-1",
    });
    await markExecutionRecoveryOperationEffectStarted(storage, {
      attemptId: "attempt-effect-1",
      claimStorageKey: "claim-effect-1",
      commandJson,
      nowMs: 101,
    });

    await expect(
      beginExecutionRecoveryOperation(storage, {
        attemptId: "attempt-effect-2",
        claimStorageKey: "claim-effect-1",
        commandJson,
        leaseDurationMs: 10,
        nowMs: 111,
        operationId: "operation-effect-2",
        operationStorageKey: "operation-effect-2",
      })
    ).resolves.toMatchObject({
      effectOperationId: "claim-effect-1",
      status: "outcome_unknown",
    });
    await expect(
      markExecutionRecoveryOperationEffectStarted(storage, {
        attemptId: "attempt-effect-1",
        claimStorageKey: "claim-effect-1",
        commandJson,
        nowMs: 112,
      })
    ).rejects.toThrow("execution_recovery.operation_attempt_fenced");
  });

  it("reclaims expired and outcome-unknown leases with one stable effect identity while fencing old attempts", async () => {
    const { storage } = createStorage();
    const commandJson =
      '{"action":"resume_controller_conversation","destination":{"spaceId":"space-1","surface":"space","threadId":null},"expectedIdentity":{"dispatchId":"dispatch-1"}}';
    const first = await beginExecutionRecoveryOperation(storage, {
      attemptId: "attempt-lease-1",
      claimStorageKey: "claim-lease-1",
      commandJson,
      effectOperationId: "effect-lease-1",
      leaseDurationMs: 10,
      nowMs: 100,
      operationId: "operation-lease-1",
      operationStorageKey: "operation-lease-1",
    });
    const afterExpiry = await beginExecutionRecoveryOperation(storage, {
      attemptId: "attempt-lease-2",
      claimStorageKey: "claim-lease-1",
      commandJson,
      effectOperationId: "different-effect-must-not-win",
      leaseDurationMs: 10,
      nowMs: 111,
      operationId: "operation-lease-2",
      operationStorageKey: "operation-lease-2",
    });

    expect(first).toMatchObject({
      effectOperationId: "effect-lease-1",
      status: "claimed",
    });
    expect(afterExpiry).toMatchObject({
      attemptId: "attempt-lease-2",
      effectOperationId: "effect-lease-1",
      status: "claimed",
    });
    await expect(
      failExecutionRecoveryOperationAttempt(storage, {
        attemptId: "attempt-lease-1",
        claimStorageKey: "claim-lease-1",
        commandJson,
        nowMs: 112,
      })
    ).rejects.toThrow("execution_recovery.operation_attempt_fenced");

    await markExecutionRecoveryOperationEffectStarted(storage, {
      attemptId: "attempt-lease-2",
      claimStorageKey: "claim-lease-1",
      commandJson,
      nowMs: 113,
    });
    await failExecutionRecoveryOperationAttempt(storage, {
      attemptId: "attempt-lease-2",
      claimStorageKey: "claim-lease-1",
      commandJson,
      nowMs: 114,
    });
    await expect(
      beginExecutionRecoveryOperation(storage, {
        attemptId: "attempt-lease-blocked",
        claimStorageKey: "claim-lease-1",
        commandJson,
        leaseDurationMs: 10,
        nowMs: 115,
        operationId: "operation-lease-blocked",
        operationStorageKey: "operation-lease-blocked",
      })
    ).resolves.toMatchObject({
      effectOperationId: "effect-lease-1",
      status: "outcome_unknown",
    });
  });

  it("retries a side effect that failed before it started and fences the old attempt", async () => {
    const { storage } = createStorage();
    const commandJson =
      '{"action":"recover_result","destination":{"spaceId":"space-1","surface":"space","threadId":null},"expectedIdentity":{"dispatchId":"dispatch-1"}}';
    const first = await beginExecutionRecoveryOperation(storage, {
      attemptId: "attempt-1",
      claimStorageKey: "claim-1",
      commandJson,
      leaseDurationMs: 30_000,
      nowMs: 100,
      operationId: "operation-1",
      operationStorageKey: "operation-1",
    });
    expect(first).toMatchObject({
      attemptId: "attempt-1",
      effectOperationId: "claim-1",
      status: "claimed",
    });

    await failExecutionRecoveryOperationAttempt(storage, {
      attemptId: "attempt-1",
      claimStorageKey: "claim-1",
      commandJson,
      nowMs: 101,
    });

    const second = await beginExecutionRecoveryOperation(storage, {
      attemptId: "attempt-2",
      claimStorageKey: "claim-1",
      commandJson,
      leaseDurationMs: 30_000,
      nowMs: 102,
      operationId: "operation-2",
      operationStorageKey: "operation-2",
    });
    expect(second).toMatchObject({
      attemptId: "attempt-2",
      effectOperationId: "claim-1",
      status: "claimed",
    });

    await expect(
      completeExecutionRecoveryOperationAttempt(storage, {
        attemptId: "attempt-1",
        claimStorageKey: "claim-1",
        commandJson,
        nowMs: 103,
        response: {
          action: "recover_result",
          newExecutionId: null,
          operationId: "operation-1",
          publicationId: "stale-signal",
          reasonCode: "execution_recovery.result_replayed",
          recovery: {
            actions: {
              recoverResult: {
                action: "recover_result",
                enabled: false,
                label: "Recover result",
                reasonCode: "execution_recovery.result_already_recovered",
                warning: null,
              },
              resumeControllerConversation: {
                action: "resume_controller_conversation",
                enabled: false,
                label: "Continue conversation",
                reasonCode: "execution_recovery.result_already_recovered",
                warning: null,
              },
              retryAsNewExecution: {
                action: "retry_as_new_execution",
                enabled: false,
                label: "Retry as new execution",
                reasonCode:
                  "execution_recovery.higher_priority_action_available",
                warning: "This creates a new execution.",
              },
            },
            destination: {
              spaceId: "space-1",
              surface: "space",
              threadId: null,
            },
            identity: {
              agentControllerConversationId: null,
              agentControllerRef: null,
              attemptId: "attempt-1",
              dispatchId: "dispatch-1",
              resultRef: "result-1",
              runtimeCoordinatorExecutionId: "execution-1",
              spaceId: "space-1",
              targetProfileId: "agent-1",
              taskId: "task-1",
            },
            recommendedAction: null,
            recoveredPublicationId: "stale-signal",
            status: "recovered",
            tier: "durable_result_replay",
            updatedAtMs: 103,
          },
          status: "completed",
        },
      })
    ).rejects.toThrow("execution_recovery.operation_attempt_fenced");
  });
});
