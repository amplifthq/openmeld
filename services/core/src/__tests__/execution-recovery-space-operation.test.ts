import type {
  ExecuteExecutionRecoveryBody,
  ExecuteExecutionRecoveryResponse,
  ExecutionRecoveryAction,
  ExecutionRecoveryProjection,
  SpaceDispatchTraceSnapshot,
} from "@openmeld/schemas/types";
import { describe, expect, it, type Mock, vi } from "vitest";
import { createProjectionPostgresBinding } from "../../test-support/postgresql-query.test-support";
import {
  buildExecutionRecoveryOperationKeys,
  EXECUTION_RECOVERY_OPERATION_LEASE_MS,
} from "../execution-recovery/application/execution-recovery-operation-identity";
import { beginExecutionRecoveryOperation } from "../execution-recovery/application/execution-recovery-operation-state";
import { inspectExecutionRecovery } from "../execution-recovery/application/execution-recovery-service";
import {
  resolveExecutionRecoveryResultRef,
  Space,
} from "../space/transport/do/space";

type TransactionPort = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
};

const actions = [
  "recover_result",
  "resume_controller_conversation",
] as const satisfies readonly ExecutionRecoveryAction[];
const EFFECT_OPERATION_ID_PATTERN = /^execution-recovery-effect:[a-f0-9]{64}$/u;

describe("Space execution recovery result source", () => {
  it("uses the Space result inbox when a workstation Wake has no native delivery record", () => {
    const resultRef = "dispatch-1::attempt-1";

    expect(
      resolveExecutionRecoveryResultRef({
        nativeDelivery: null,
        nativeResultRef: null,
        resultInbox: {
          resultKey: resultRef,
        } as SpaceDispatchTraceSnapshot["resultInbox"],
      })
    ).toBe(resultRef);
  });
});

describe("Space execution recovery fenced operation", () => {
  it.each(
    actions
  )("reclaims a crashed pre-effect %s reservation after restart without poisoning the claim", async (action) => {
    const projection = buildProjection(action);
    const storage = createSharedStorage();
    const crashedCommand = buildCommand(
      action,
      projection,
      "caller-op-crashed-before-effect"
    );
    const operationKeys =
      await buildExecutionRecoveryOperationKeys(crashedCommand);
    const crashedAttemptId = "execution-recovery-attempt:crashed";
    await beginExecutionRecoveryOperation(storage, {
      attemptId: crashedAttemptId,
      claimStorageKey: operationKeys.claimStorageKey,
      commandJson: operationKeys.commandJson,
      effectOperationId: operationKeys.effectOperationId,
      leaseDurationMs: EXECUTION_RECOVERY_OPERATION_LEASE_MS,
      nowMs: 0,
      operationId: crashedCommand.operationId,
      operationStorageKey: operationKeys.operationStorageKey,
    });
    const effect = vi.fn(async () => buildEffectResult(action));
    const restartedSpace = createSpace({
      effect,
      projection,
      resolveAuthoritative: vi.fn(async () => null),
      storage,
    });

    const recovered = await restartedSpace.rpcExecuteExecutionRecovery({
      body: buildCommand(
        action,
        projection,
        "caller-op-after-pre-effect-crash"
      ),
      spaceId: projection.identity.spaceId,
    });

    expect(recovered).toMatchObject({
      action,
      operationId: "caller-op-after-pre-effect-crash",
      status: "completed",
    });
    expect(effect).toHaveBeenCalledOnce();
  });

  it.each(
    actions
  )("fences concurrent %s callers with different operation IDs behind one effect", async (action) => {
    const projection = buildProjection(action);
    const storage = createSharedStorage();
    let resolveEffect:
      | ((value: ReturnType<typeof buildEffectResult>) => void)
      | undefined;
    const effectResult = new Promise<ReturnType<typeof buildEffectResult>>(
      (resolve) => {
        resolveEffect = resolve;
      }
    );
    const effect = vi.fn(async () => await effectResult);
    const space = createSpace({
      effect,
      projection,
      resolveAuthoritative: vi.fn(async () => null),
      storage,
    });

    const firstCall = space.rpcExecuteExecutionRecovery({
      body: buildCommand(action, projection, "caller-op-concurrent-1"),
      spaceId: projection.identity.spaceId,
    });
    await vi.waitFor(() => expect(effect).toHaveBeenCalledOnce());
    const concurrent = await space.rpcExecuteExecutionRecovery({
      body: buildCommand(action, projection, "caller-op-concurrent-2"),
      spaceId: projection.identity.spaceId,
    });

    expect(concurrent).toMatchObject({
      action,
      operationId: "caller-op-concurrent-2",
      status: "outcome_unknown",
    });
    resolveEffect?.(buildEffectResult(action));
    const first = await firstCall;
    const repeated = await space.rpcExecuteExecutionRecovery({
      body: buildCommand(action, projection, "caller-op-concurrent-3"),
      spaceId: projection.identity.spaceId,
    });

    expect(first.operationId).toBe("caller-op-concurrent-1");
    expect(repeated).toEqual({
      ...first,
      operationId: "caller-op-concurrent-3",
    });
    expect(effect).toHaveBeenCalledOnce();
  });

  it.each(
    actions
  )("retries %s after a pre-effect failure with one stable effect identity across restart", async (action) => {
    const projection = buildProjection(action);
    const storage = createSharedStorage();
    const beforeEffect = vi
      .fn()
      .mockRejectedValueOnce(new Error("failed before authoritative effect"))
      .mockResolvedValueOnce(undefined);
    const effect = vi.fn(async () => buildEffectResult(action));
    const firstSpace = createSpace({
      beforeEffect,
      effect,
      projection,
      resolveAuthoritative: vi.fn(async () => null),
      storage,
    });
    const firstCommand = buildCommand(action, projection, "caller-op-1");

    await expect(
      firstSpace.rpcExecuteExecutionRecovery({
        body: firstCommand,
        spaceId: projection.identity.spaceId,
      })
    ).rejects.toThrow("failed before authoritative effect");

    const restartedSpace = createSpace({
      beforeEffect,
      effect,
      projection,
      resolveAuthoritative: vi.fn(async () => null),
      storage,
    });
    const recovered = await restartedSpace.rpcExecuteExecutionRecovery({
      body: buildCommand(action, projection, "caller-op-2"),
      spaceId: projection.identity.spaceId,
    });

    expect(recovered).toMatchObject({
      action,
      operationId: "caller-op-2",
      status: "completed",
    });
    expect(beforeEffect).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenCalledOnce();
    const firstEffectOperationId =
      beforeEffect.mock.calls[0]?.[0]?.command?.operationId;
    const secondEffectOperationId =
      beforeEffect.mock.calls[1]?.[0]?.command?.operationId;
    expect(firstEffectOperationId).toMatch(EFFECT_OPERATION_ID_PATTERN);
    expect(secondEffectOperationId).toBe(firstEffectOperationId);
  });

  it.each(
    actions
  )("reconciles %s after an authoritative effect followed by an exception and never repeats the effect", async (action) => {
    const projection = buildProjection(action);
    const storage = createSharedStorage();
    const authoritative = buildAuthoritativeResponse(
      action,
      projection,
      "effect-owned-operation"
    );
    let effectExists = false;
    const effect = vi.fn(() => {
      effectExists = true;
      return Promise.reject(
        new Error("transport failed after authoritative effect")
      );
    });
    const resolveAuthoritative = vi.fn(async () =>
      effectExists ? authoritative : null
    );
    const firstSpace = createSpace({
      effect,
      projection,
      resolveAuthoritative,
      storage,
    });

    const first = await firstSpace.rpcExecuteExecutionRecovery({
      body: buildCommand(action, projection, "caller-op-1"),
      spaceId: projection.identity.spaceId,
    });
    const restartedSpace = createSpace({
      effect,
      projection,
      resolveAuthoritative,
      storage,
    });
    const repeated = await restartedSpace.rpcExecuteExecutionRecovery({
      body: buildCommand(action, projection, "caller-op-2"),
      spaceId: projection.identity.spaceId,
    });

    expect(first).toEqual({
      ...authoritative,
      operationId: "caller-op-1",
    });
    expect(repeated).toEqual({
      ...authoritative,
      operationId: "caller-op-2",
    });
    expect(effect).toHaveBeenCalledOnce();
  });

  it.each(
    actions
  )("keeps an unreconciled %s provider outcome fenced across restart", async (action) => {
    const projection = buildProjection(action, {
      providerOutcomeCanBeAmbiguous: true,
    });
    const storage = createSharedStorage();
    const effect = vi.fn(() =>
      Promise.reject(new Error("provider outcome is unknown"))
    );
    const firstSpace = createSpace({
      effect,
      projection,
      resolveAuthoritative: vi.fn(async () => null),
      storage,
    });

    await expect(
      firstSpace.rpcExecuteExecutionRecovery({
        body: buildCommand(action, projection, "caller-op-unknown-1"),
        spaceId: projection.identity.spaceId,
      })
    ).rejects.toThrow("provider outcome is unknown");

    const restartedSpace = createSpace({
      effect,
      projection,
      resolveAuthoritative: vi.fn(async () => null),
      storage,
    });
    await expect(
      restartedSpace.rpcExecuteExecutionRecovery({
        body: buildCommand(action, projection, "caller-op-unknown-2"),
        spaceId: projection.identity.spaceId,
      })
    ).resolves.toMatchObject({
      action,
      operationId: "caller-op-unknown-2",
      status: "outcome_unknown",
    });
    expect(effect).toHaveBeenCalledOnce();
  });
});

function buildProjection(
  action: ExecutionRecoveryAction,
  options: { providerOutcomeCanBeAmbiguous?: boolean } = {}
): ExecutionRecoveryProjection {
  const identity = {
    agentControllerConversationId:
      action === "retry_as_new_execution" ? null : "conversation-1",
    agentControllerRef: "builtin:codex",
    attemptId: "attempt-1",
    dispatchId: `dispatch-${action}`,
    resultRef: action === "recover_result" ? `result-${action}` : null,
    runtimeCoordinatorExecutionId: "runtime-execution-1",
    spaceId: "space-1",
    targetProfileId: "agent-1",
    taskId: "task-1",
  };
  return inspectExecutionRecovery({
    destination: options.providerOutcomeCanBeAmbiguous
      ? {
          conversationId: "channel-1",
          messageId: "message-1",
          spaceId: identity.spaceId,
          surface: "slack",
        }
      : {
          spaceId: identity.spaceId,
          surface: "space",
          threadId: null,
        },
    explicitUserStop: false,
    identity,
    outcomeUnknown: false,
    retainedResult: {
      available: action === "recover_result",
      recoveredPublicationId: null,
    },
    resumeCapability: {
      exactAssociationVerified: action === "resume_controller_conversation",
      serviceSupportsResume: action === "resume_controller_conversation",
    },
    updatedAtMs: 100,
  });
}

function buildCommand(
  action: ExecutionRecoveryAction,
  projection: ExecutionRecoveryProjection,
  operationId: string
): ExecuteExecutionRecoveryBody {
  return {
    action,
    destination: projection.destination,
    expectedIdentity: projection.identity,
    operationId,
  };
}

function buildEffectResult(action: ExecutionRecoveryAction) {
  return action === "retry_as_new_execution"
    ? {
        newExecutionId: `new-execution-${action}`,
        status: "new_execution_requested" as const,
      }
    : {
        publicationId: `publication-${action}`,
        status: "completed" as const,
      };
}

function buildAuthoritativeResponse(
  action: ExecutionRecoveryAction,
  projection: ExecutionRecoveryProjection,
  operationId: string
): ExecuteExecutionRecoveryResponse {
  const status =
    action === "retry_as_new_execution"
      ? ("new_execution_requested" as const)
      : ("completed" as const);
  return {
    action,
    newExecutionId:
      action === "retry_as_new_execution" ? `new-execution-${action}` : null,
    operationId,
    publicationId:
      action === "retry_as_new_execution" ? null : `publication-${action}`,
    reasonCode: resolveAuthoritativeReasonCode(action),
    recovery: projection,
    status,
  };
}

function resolveAuthoritativeReasonCode(
  action: ExecutionRecoveryAction
): ExecuteExecutionRecoveryResponse["reasonCode"] {
  if (action === "recover_result") {
    return "execution_recovery.result_replayed";
  }
  if (action === "resume_controller_conversation") {
    return "execution_recovery.controller_conversation_resumed";
  }
  return "execution_recovery.new_execution_requested";
}

function createSharedStorage() {
  const records = new Map<string, unknown>();
  let tail = Promise.resolve();
  return {
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
  };
}

function createSpace(input: {
  beforeEffect?: Mock<
    (effectInput: {
      markEffectStarted: () => Promise<void>;
    }) => Promise<unknown>
  >;
  effect: Mock<
    (effectInput: {
      markEffectStarted: () => Promise<void>;
    }) => Promise<unknown>
  >;
  projection: ExecutionRecoveryProjection;
  resolveAuthoritative: ReturnType<typeof vi.fn>;
  storage: ReturnType<typeof createSharedStorage>;
}): Space {
  const space = Object.create(Space.prototype) as Space;
  const effectProperty = resolveEffectProperty(
    input.projection.recommendedAction
  );
  const runEffect = async (effectInput: {
    markEffectStarted: () => Promise<void>;
  }) => {
    await input.beforeEffect?.(effectInput);
    await effectInput.markEffectStarted();
    return await input.effect(effectInput);
  };
  Object.defineProperties(space, {
    bindings: {
      value: { OPENMELD_POSTGRESQL: createProjectionPostgresBinding(() => []) },
    },
    applySpaceRef: { value: vi.fn() },
    ctx: { value: { storage: input.storage } },
    [effectProperty]: { value: runEffect },
    resolveAuthoritativeExecutionRecoveryResponse: {
      value: input.resolveAuthoritative,
    },
    rpcInspectExecutionRecovery: {
      value: vi.fn(async () => ({ recovery: input.projection })),
    },
    spaceId: { value: input.projection.identity.spaceId },
  });
  return space;
}

function resolveEffectProperty(
  action: ExecutionRecoveryProjection["recommendedAction"]
):
  | "replayRetainedExecutionResult"
  | "resumeExactControllerConversation"
  | "retryExecutionAsNewWake" {
  if (action === "recover_result") {
    return "replayRetainedExecutionResult";
  }
  if (action === "resume_controller_conversation") {
    return "resumeExactControllerConversation";
  }
  if (action === "retry_as_new_execution") {
    return "retryExecutionAsNewWake";
  }
  throw new Error("test projection must expose a recovery action");
}
