import type {
  ExecuteExecutionRecoveryBody,
  ExecuteExecutionRecoveryResponse,
  ExecutionRecoveryProjection,
} from "@openmeld/schemas/types";
import { resolveExecutionRecoveryCompletionReasonCode } from "./execution-recovery-completion";
import {
  buildExecutionRecoveryOperationKeys,
  EXECUTION_RECOVERY_OPERATION_LEASE_MS,
} from "./execution-recovery-operation-identity";
import {
  beginExecutionRecoveryOperation,
  completeExecutionRecoveryOperationAttempt,
  type ExecutionRecoveryOperationStorage,
  failExecutionRecoveryOperationAttempt,
  inspectExecutionRecoveryOperation,
  markExecutionRecoveryOperationEffectStarted,
  reconcileExecutionRecoveryOperationSucceeded,
} from "./execution-recovery-operation-state";
import {
  assertExecutionRecoveryCommandCanRun,
  assertExecutionRecoveryCommandMatchesProjection,
  executeExecutionRecovery,
} from "./execution-recovery-service";

type ExecutionRecoveryDependencies = Parameters<
  typeof executeExecutionRecovery
>[0]["dependencies"];

export class ExecutionRecoveryEffectNotStartedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExecutionRecoveryEffectNotStartedError";
  }
}

export async function executeFencedExecutionRecoveryOperation(input: {
  command: ExecuteExecutionRecoveryBody;
  dependencies: ExecutionRecoveryDependencies;
  inspectProjection: () => Promise<ExecutionRecoveryProjection>;
  nowMs?: () => number;
  projection: ExecutionRecoveryProjection;
  resolveAuthoritative: (input: {
    claimStorageKey: string;
    command: ExecuteExecutionRecoveryBody;
    projection: ExecutionRecoveryProjection;
  }) => Promise<ExecuteExecutionRecoveryResponse | null>;
  storage: ExecutionRecoveryOperationStorage;
}): Promise<ExecuteExecutionRecoveryResponse> {
  const nowMs = input.nowMs ?? Date.now;
  assertExecutionRecoveryCommandMatchesProjection({
    command: input.command,
    projection: input.projection,
  });
  const operationKeys = await buildExecutionRecoveryOperationKeys(
    input.command
  );
  const storedOperation = await inspectExecutionRecoveryOperation(
    input.storage,
    {
      claimStorageKey: operationKeys.claimStorageKey,
      commandJson: operationKeys.commandJson,
      operationStorageKey: operationKeys.operationStorageKey,
    }
  );
  if (storedOperation.status === "completed" && storedOperation.response) {
    return withCallerOperationId(
      storedOperation.response,
      input.command.operationId
    );
  }
  const authoritativeResponse = await input.resolveAuthoritative({
    claimStorageKey: operationKeys.claimStorageKey,
    command: input.command,
    projection: input.projection,
  });
  if (
    storedOperation.status !== "absent" &&
    authoritativeResponse &&
    (await reconcileExecutionRecoveryOperationSucceeded(input.storage, {
      claimStorageKey: operationKeys.claimStorageKey,
      commandJson: operationKeys.commandJson,
      nowMs: nowMs(),
      response: authoritativeResponse,
    }))
  ) {
    return withCallerOperationId(
      authoritativeResponse,
      input.command.operationId
    );
  }
  assertExecutionRecoveryCommandCanRun({
    command: input.command,
    projection: input.projection,
  });
  const operation = await beginExecutionRecoveryOperation(input.storage, {
    attemptId: `execution-recovery-attempt:${crypto.randomUUID()}`,
    claimStorageKey: operationKeys.claimStorageKey,
    commandJson: operationKeys.commandJson,
    effectOperationId: operationKeys.effectOperationId,
    leaseDurationMs: EXECUTION_RECOVERY_OPERATION_LEASE_MS,
    nowMs: nowMs(),
    operationId: input.command.operationId,
    operationStorageKey: operationKeys.operationStorageKey,
  });
  if (operation.status === "completed") {
    return withCallerOperationId(operation.response, input.command.operationId);
  }
  if (operation.status !== "claimed") {
    return {
      action: input.command.action,
      newExecutionId: null,
      operationId: input.command.operationId,
      publicationId: null,
      reasonCode: "execution_recovery.operation_outcome_unknown",
      recovery: input.projection,
      status: "outcome_unknown",
    };
  }

  const effectCommand = {
    ...input.command,
    operationId: operation.effectOperationId,
  };
  let execution: Awaited<ReturnType<typeof executeExecutionRecovery>>;
  try {
    execution = await executeExecutionRecovery({
      command: effectCommand,
      dependencies: input.dependencies,
      markEffectStarted: async () =>
        await markExecutionRecoveryOperationEffectStarted(input.storage, {
          attemptId: operation.attemptId,
          claimStorageKey: operationKeys.claimStorageKey,
          commandJson: operationKeys.commandJson,
          nowMs: nowMs(),
        }),
      projection: input.projection,
    });
  } catch (error) {
    const reconciled = await reconcileFailedExecutionRecoveryEffect({
      command: input.command,
      error,
      inspectProjection: input.inspectProjection,
      nowMs,
      operationKeys,
      resolveAuthoritative: input.resolveAuthoritative,
      storage: input.storage,
    });
    if (reconciled) {
      return withCallerOperationId(reconciled, input.command.operationId);
    }
    await failExecutionRecoveryOperationAttempt(input.storage, {
      attemptId: operation.attemptId,
      claimStorageKey: operationKeys.claimStorageKey,
      commandJson: operationKeys.commandJson,
      nowMs: nowMs(),
    });
    throw error;
  }

  const refreshed = await input.inspectProjection();
  const response: ExecuteExecutionRecoveryResponse = {
    action: execution.action,
    newExecutionId: execution.newExecutionId,
    operationId: input.command.operationId,
    publicationId: execution.publicationId,
    reasonCode: resolveExecutionRecoveryCompletionReasonCode({
      action: execution.action,
      status: execution.status,
    }),
    recovery: refreshed,
    status: execution.status,
  };
  if (response.status === "outcome_unknown") {
    await failExecutionRecoveryOperationAttempt(input.storage, {
      attemptId: operation.attemptId,
      claimStorageKey: operationKeys.claimStorageKey,
      commandJson: operationKeys.commandJson,
      nowMs: nowMs(),
    });
    return response;
  }
  await completeExecutionRecoveryOperationAttempt(input.storage, {
    attemptId: operation.attemptId,
    claimStorageKey: operationKeys.claimStorageKey,
    commandJson: operationKeys.commandJson,
    nowMs: nowMs(),
    response,
  });
  return response;
}

async function reconcileFailedExecutionRecoveryEffect(input: {
  command: ExecuteExecutionRecoveryBody;
  error: unknown;
  inspectProjection: () => Promise<ExecutionRecoveryProjection>;
  nowMs: () => number;
  operationKeys: Awaited<
    ReturnType<typeof buildExecutionRecoveryOperationKeys>
  >;
  resolveAuthoritative: (input: {
    claimStorageKey: string;
    command: ExecuteExecutionRecoveryBody;
    projection: ExecutionRecoveryProjection;
  }) => Promise<ExecuteExecutionRecoveryResponse | null>;
  storage: ExecutionRecoveryOperationStorage;
}): Promise<ExecuteExecutionRecoveryResponse | null> {
  try {
    const refreshed = await input.inspectProjection();
    const reconciled = await input.resolveAuthoritative({
      claimStorageKey: input.operationKeys.claimStorageKey,
      command: input.command,
      projection: refreshed,
    });
    if (!reconciled) {
      return null;
    }
    await reconcileExecutionRecoveryOperationSucceeded(input.storage, {
      claimStorageKey: input.operationKeys.claimStorageKey,
      commandJson: input.operationKeys.commandJson,
      nowMs: input.nowMs(),
      response: reconciled,
    });
    return reconciled;
  } catch (reconciliationError) {
    console.warn("[core.execution_recovery.reconciliation_failed]", {
      action: input.command.action,
      dispatchId: input.command.expectedIdentity.dispatchId,
      error:
        reconciliationError instanceof Error
          ? reconciliationError.message
          : String(reconciliationError),
      originalError:
        input.error instanceof Error
          ? input.error.message
          : String(input.error),
    });
    return null;
  }
}

function withCallerOperationId(
  response: ExecuteExecutionRecoveryResponse,
  operationId: string
): ExecuteExecutionRecoveryResponse {
  return {
    ...response,
    operationId,
  };
}
