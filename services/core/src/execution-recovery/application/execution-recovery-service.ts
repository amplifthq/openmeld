import type {
  ExecuteExecutionRecoveryBody,
  ExecutionRecoveryActionCapability,
  ExecutionRecoveryDestination,
  ExecutionRecoveryIdentity,
  ExecutionRecoveryProjection,
} from "@openmeld/schemas/types";

type InspectExecutionRecoveryInput = {
  destination: ExecutionRecoveryDestination;
  explicitUserStop: boolean;
  freshExecutionCapability: {
    exactSourceWakeVerified: boolean;
  };
  identity: ExecutionRecoveryIdentity;
  outcomeUnknown: boolean;
  retainedResult: {
    available: boolean;
    recoveredPublicationId: string | null;
  };
  resumeCapability: {
    exactAssociationVerified: boolean;
    serviceSupportsResume: boolean;
  };
  terminalFailureCode?: string | null;
  updatedAtMs: number;
};

type RecoveryExecutionDependencies = {
  replayDurableResult: (input: {
    command: ExecuteExecutionRecoveryBody;
    markEffectStarted: () => Promise<void>;
    projection: ExecutionRecoveryProjection;
  }) => Promise<{
    publicationId: string;
    status: "already_completed" | "completed";
  }>;
  resumeControllerConversation: (input: {
    command: ExecuteExecutionRecoveryBody;
    markEffectStarted: () => Promise<void>;
    projection: ExecutionRecoveryProjection;
  }) => Promise<{
    publicationId: string | null;
    status:
      | "already_completed"
      | "completed"
      | "new_execution_requested"
      | "outcome_unknown";
  }>;
  retryAsNewExecution: (input: {
    command: ExecuteExecutionRecoveryBody;
    markEffectStarted: () => Promise<void>;
    projection: ExecutionRecoveryProjection;
  }) => Promise<{
    newExecutionId: string;
    status: "new_execution_requested" | "outcome_unknown";
  }>;
};

const disabledCapability = (
  action: ExecutionRecoveryActionCapability["action"],
  label: ExecutionRecoveryActionCapability["label"],
  reasonCode: string,
  warning: string | null = null
): ExecutionRecoveryActionCapability => ({
  action,
  enabled: false,
  label,
  reasonCode,
  warning,
});

export function inspectExecutionRecovery(
  input: InspectExecutionRecoveryInput
): ExecutionRecoveryProjection {
  const retryWarning =
    "This creates a new execution and may run the task again, including external side effects.";
  const actions = {
    recoverResult: disabledCapability(
      "recover_result",
      "Recover result",
      "execution_recovery.retained_result_unavailable"
    ),
    resumeControllerConversation: disabledCapability(
      "resume_controller_conversation",
      "Recover reply",
      "execution_recovery.exact_conversation_unavailable"
    ),
    retryAsNewExecution: disabledCapability(
      "retry_as_new_execution",
      "Retry as new execution",
      "execution_recovery.higher_priority_action_available",
      retryWarning
    ),
  };
  const shouldRetryUsageWakeAsNewExecution =
    input.terminalFailureCode === "usage_exhausted" &&
    input.freshExecutionCapability.exactSourceWakeVerified;

  if (input.explicitUserStop) {
    return {
      actions,
      destination: input.destination,
      identity: input.identity,
      recommendedAction: null,
      recoveredPublicationId: input.retainedResult.recoveredPublicationId,
      status: "unavailable",
      tier: "none",
      updatedAtMs: input.updatedAtMs,
    };
  }

  if (input.outcomeUnknown) {
    return {
      actions: {
        ...actions,
        retryAsNewExecution: {
          ...actions.retryAsNewExecution,
          reasonCode: "execution_recovery.external_outcome_unknown",
        },
      },
      destination: input.destination,
      identity: input.identity,
      recommendedAction: null,
      recoveredPublicationId: input.retainedResult.recoveredPublicationId,
      status: "outcome_unknown",
      tier: "manual_review",
      updatedAtMs: input.updatedAtMs,
    };
  }

  if (input.retainedResult.recoveredPublicationId !== null) {
    return {
      actions: {
        ...actions,
        resumeControllerConversation: {
          ...actions.resumeControllerConversation,
          reasonCode: "execution_recovery.result_already_recovered",
        },
      },
      destination: input.destination,
      identity: input.identity,
      recommendedAction: null,
      recoveredPublicationId: input.retainedResult.recoveredPublicationId,
      status: "recovered",
      tier: input.identity.resultRef
        ? "durable_result_replay"
        : "exact_controller_conversation_resume",
      updatedAtMs: input.updatedAtMs,
    };
  }

  if (input.retainedResult.available && input.identity.resultRef) {
    const recovered = input.retainedResult.recoveredPublicationId !== null;
    return {
      actions: {
        ...actions,
        recoverResult: {
          action: "recover_result",
          enabled: !recovered,
          label: "Recover result",
          reasonCode: recovered
            ? "execution_recovery.result_already_recovered"
            : "execution_recovery.retained_result_available",
          warning: null,
        },
      },
      destination: input.destination,
      identity: input.identity,
      recommendedAction: recovered ? null : "recover_result",
      recoveredPublicationId: input.retainedResult.recoveredPublicationId,
      status: recovered ? "recovered" : "available",
      tier: "durable_result_replay",
      updatedAtMs: input.updatedAtMs,
    };
  }

  if (
    input.identity.agentControllerRef &&
    input.identity.agentControllerConversationId &&
    input.resumeCapability.exactAssociationVerified &&
    input.resumeCapability.serviceSupportsResume &&
    !shouldRetryUsageWakeAsNewExecution
  ) {
    return {
      actions: {
        ...actions,
        resumeControllerConversation: {
          action: "resume_controller_conversation",
          enabled: true,
          label: "Recover reply",
          reasonCode: "execution_recovery.exact_conversation_available",
          warning:
            "OpenMeld will ask the same Agent conversation to post the reply it already finished. It will not run the task again.",
        },
      },
      destination: input.destination,
      identity: input.identity,
      recommendedAction: "resume_controller_conversation",
      recoveredPublicationId: null,
      status: "available",
      tier: "exact_controller_conversation_resume",
      updatedAtMs: input.updatedAtMs,
    };
  }

  if (!input.freshExecutionCapability.exactSourceWakeVerified) {
    return {
      actions: {
        ...actions,
        retryAsNewExecution: {
          ...actions.retryAsNewExecution,
          reasonCode: "execution_recovery.exact_source_wake_unavailable",
        },
      },
      destination: input.destination,
      identity: input.identity,
      recommendedAction: null,
      recoveredPublicationId: null,
      status: "unavailable",
      tier: "none",
      updatedAtMs: input.updatedAtMs,
    };
  }

  return {
    actions: {
      ...actions,
      retryAsNewExecution: {
        action: "retry_as_new_execution",
        enabled: true,
        label: "Retry as new execution",
        reasonCode: "execution_recovery.fresh_execution_only",
        warning: retryWarning,
      },
    },
    destination: input.destination,
    identity: input.identity,
    recommendedAction: "retry_as_new_execution",
    recoveredPublicationId: null,
    status: "available",
    tier: "fresh_execution",
    updatedAtMs: input.updatedAtMs,
  };
}

export async function executeExecutionRecovery(input: {
  command: ExecuteExecutionRecoveryBody;
  dependencies: RecoveryExecutionDependencies;
  markEffectStarted: () => Promise<void>;
  projection: ExecutionRecoveryProjection;
}): Promise<{
  action: ExecuteExecutionRecoveryBody["action"];
  newExecutionId: string | null;
  operationId: string;
  publicationId: string | null;
  status:
    | "already_completed"
    | "completed"
    | "new_execution_requested"
    | "outcome_unknown";
}> {
  assertExecutionRecoveryCommandCanRun(input);

  if (input.command.action === "recover_result") {
    const result = await input.dependencies.replayDurableResult({
      command: input.command,
      markEffectStarted: input.markEffectStarted,
      projection: input.projection,
    });
    return {
      action: input.command.action,
      newExecutionId: null,
      operationId: input.command.operationId,
      publicationId: result.publicationId,
      status: result.status,
    };
  }
  if (input.command.action === "resume_controller_conversation") {
    const result = await input.dependencies.resumeControllerConversation({
      command: input.command,
      markEffectStarted: input.markEffectStarted,
      projection: input.projection,
    });
    return {
      action: input.command.action,
      newExecutionId: null,
      operationId: input.command.operationId,
      publicationId: result.publicationId,
      status: result.status,
    };
  }
  const result = await input.dependencies.retryAsNewExecution({
    command: input.command,
    markEffectStarted: input.markEffectStarted,
    projection: input.projection,
  });
  return {
    action: input.command.action,
    newExecutionId: result.newExecutionId,
    operationId: input.command.operationId,
    publicationId: null,
    status: result.status,
  };
}

export function assertExecutionRecoveryCommandCanRun(input: {
  command: ExecuteExecutionRecoveryBody;
  projection: ExecutionRecoveryProjection;
}): void {
  assertExecutionRecoveryCommandMatchesProjection(input);
  const capability = resolveRequestedCapability(
    input.command.action,
    input.projection
  );
  if (!capability.enabled) {
    throw new Error(
      `execution_recovery.action_unavailable:${capability.reasonCode}`
    );
  }
}

export function assertExecutionRecoveryCommandMatchesProjection(input: {
  command: ExecuteExecutionRecoveryBody;
  projection: ExecutionRecoveryProjection;
}): void {
  assertExactRecoveryCommand(input.command, input.projection);
}

function resolveRequestedCapability(
  action: ExecuteExecutionRecoveryBody["action"],
  projection: ExecutionRecoveryProjection
): ExecutionRecoveryActionCapability {
  if (action === "recover_result") {
    return projection.actions.recoverResult;
  }
  if (action === "resume_controller_conversation") {
    return projection.actions.resumeControllerConversation;
  }
  return projection.actions.retryAsNewExecution;
}

function assertExactRecoveryCommand(
  command: ExecuteExecutionRecoveryBody,
  projection: ExecutionRecoveryProjection
): void {
  if (
    !(
      isSameExecutionRecoveryIdentity(
        command.expectedIdentity,
        projection.identity
      ) &&
      isSameExecutionRecoveryDestination(
        command.destination,
        projection.destination
      )
    )
  ) {
    throw new Error("execution_recovery.identity_mismatch");
  }
}

function isSameExecutionRecoveryIdentity(
  left: ExecutionRecoveryIdentity,
  right: ExecutionRecoveryIdentity
): boolean {
  return (
    left.spaceId === right.spaceId &&
    left.dispatchId === right.dispatchId &&
    left.attemptId === right.attemptId &&
    left.taskId === right.taskId &&
    left.targetProfileId === right.targetProfileId &&
    left.runtimeCoordinatorExecutionId ===
      right.runtimeCoordinatorExecutionId &&
    left.resultRef === right.resultRef &&
    left.agentControllerRef === right.agentControllerRef &&
    left.agentControllerConversationId === right.agentControllerConversationId
  );
}

function isSameExecutionRecoveryDestination(
  left: ExecutionRecoveryDestination,
  right: ExecutionRecoveryDestination
): boolean {
  if (left.surface !== right.surface || left.spaceId !== right.spaceId) {
    return false;
  }
  if (left.surface === "space" && right.surface === "space") {
    return left.threadId === right.threadId;
  }
  if (left.surface !== "space" && right.surface !== "space") {
    return (
      left.conversationId === right.conversationId &&
      left.messageId === right.messageId
    );
  }
  return false;
}
