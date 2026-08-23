import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
import type {
  ExecuteExecutionRecoveryBody,
  ExecuteExecutionRecoveryResponse,
  ExecutionRecoveryProjection,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import {
  buildRemoteAgentExecutionRecoveryIdentity,
  reconcileRemoteAgentRetainedResultPublication,
  submitRemoteAgentExecutionRecoveryTurn,
} from "../../remote-agent/application/native-delivery-service";
import {
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
} from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { resolveExecutionRecoveryCompletionReasonCode } from "./execution-recovery-completion";
import {
  assertExecutionRecoveryDestinationMatchesDelivery,
  resolveExecutionRecoveryDestination,
} from "./execution-recovery-destination";
import { ExecutionRecoveryEffectNotStartedError } from "./execution-recovery-fenced-operation";
import {
  buildNativeDeliveryRetainedResultRef,
  hasRecoverableNativeDeliveryRetainedResult,
} from "./execution-recovery-native-result";
import { EXECUTION_RECOVERY_OPERATION_CLAIM_STORAGE_PREFIX } from "./execution-recovery-operation-identity";
import {
  findExecutionRecoveryPublicationAtOrigin,
  publishExecutionRecoveryToOrigin,
} from "./execution-recovery-publication";
import { inspectExecutionRecovery } from "./execution-recovery-service";

const REMOTE_AGENT_EXECUTION_CANCELLED_FAILURE_CODE =
  "remote_agent.execution_cancelled";
const RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE =
  "runtime_coordinator.pre_agent_stop_requested";

export async function projectHostedExecutionRecovery(input: {
  delivery: RemoteAgentNativeDeliveryRecord;
  env: CoreBindings;
  nowMs: number;
}): Promise<ExecutionRecoveryProjection> {
  if (input.delivery.conversationKind === "space") {
    throw new Error("execution_recovery.hosted_destination_required");
  }
  const destination = resolveExecutionRecoveryDestination({
    delivery: input.delivery,
    fallbackSpaceId: input.delivery.spaceId,
    fallbackThreadId: null,
  });
  const resultRef = input.delivery.finalPublicationPayload
    ? await buildNativeDeliveryRetainedResultRef(input.delivery)
    : null;
  const retainedResultAvailable = hasRecoverableNativeDeliveryRetainedResult(
    input.delivery
  );
  const recoveredPublicationId = resolveRecoveredPublicationId(input.delivery);
  const request = input.delivery.executionRecoverySubmitRequest;
  const exactSourceRequestVerified = Boolean(
    request &&
      request.organizationId === input.delivery.organizationId &&
      request.spaceId === input.delivery.spaceId &&
      request.agentProfileId === input.delivery.profileId &&
      request.bindingId === input.delivery.bindingId &&
      request.dispatchId === input.delivery.dispatchId &&
      request.idempotencyKey === input.delivery.idempotencyKey
  );
  const exactControllerAssociationVerified =
    exactSourceRequestVerified && input.delivery.submissionId !== null;
  const workerCanSubmit =
    typeof input.env.OPENMELD_REMOTE_AGENT_WORKER?.submitConversationTurn ===
    "function";
  const executionStillActive =
    input.delivery.status === "submitted" ||
    input.delivery.status === "accepted" ||
    input.delivery.status === "retry_observed";
  const publicationOutcomeUnknownWithoutResult =
    input.delivery.finalPublicationState === "outcome_unknown" &&
    !retainedResultAvailable;
  return inspectExecutionRecovery({
    destination,
    explicitUserStop:
      input.delivery.failureCode ===
        REMOTE_AGENT_EXECUTION_CANCELLED_FAILURE_CODE ||
      input.delivery.failureCode ===
        RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
    freshExecutionCapability: {
      exactSourceWakeVerified: Boolean(
        exactSourceRequestVerified &&
          workerCanSubmit &&
          request?.messages.every(
            (message) => (message.attachments?.length ?? 0) === 0
          )
      ),
    },
    identity: {
      agentControllerConversationId: exactControllerAssociationVerified
        ? input.delivery.spaceId
        : null,
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      attemptId: input.delivery.attemptId,
      dispatchId: input.delivery.dispatchId,
      resultRef,
      runtimeCoordinatorExecutionId: null,
      spaceId: input.delivery.spaceId,
      targetProfileId: input.delivery.profileId,
      taskId: null,
    },
    outcomeUnknown:
      publicationOutcomeUnknownWithoutResult ||
      (executionStillActive && !retainedResultAvailable),
    retainedResult: {
      available: retainedResultAvailable,
      recoveredPublicationId,
    },
    resumeCapability: {
      exactAssociationVerified: exactControllerAssociationVerified,
      serviceSupportsResume:
        exactControllerAssociationVerified && workerCanSubmit,
    },
    terminalFailureCode: input.delivery.failureCode,
    updatedAtMs: input.nowMs,
  });
}

export async function replayHostedRetainedExecutionResult(input: {
  command: ExecuteExecutionRecoveryBody;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  env: CoreBindings;
  markEffectStarted: () => Promise<void>;
  projection: ExecutionRecoveryProjection;
}): Promise<{
  publicationId: string;
  status: "already_completed" | "completed";
}> {
  assertExecutionRecoveryDestinationMatchesDelivery({
    delivery: input.delivery,
    destination: input.command.destination,
  });
  const payload = input.delivery.finalPublicationPayload;
  const expectedResultRef = await buildNativeDeliveryRetainedResultRef(
    input.delivery
  );
  if (
    !(
      payload &&
      hasRecoverableNativeDeliveryRetainedResult(input.delivery) &&
      expectedResultRef
    ) ||
    input.projection.identity.resultRef !== expectedResultRef
  ) {
    throw new Error("execution_recovery.identity_mismatch");
  }
  await input.markEffectStarted();
  const publication = await publishExecutionRecoveryToOrigin({
    ...(payload.storageVersion !== 1 && payload.attachments.length > 0
      ? { attachments: payload.attachments }
      : {}),
    db: input.db,
    delivery: input.delivery,
    destination: input.command.destination,
    env: input.env,
    operationId: input.command.operationId,
    reuseOriginalFinalPublicationIdentity: true,
    text: payload.text,
  });
  await reconcileRemoteAgentRetainedResultPublication({
    db: input.db,
    delivery: input.delivery,
    env: input.env,
    nowMs: Date.now(),
    publicationId: publication.publicationId,
  });
  return {
    publicationId: publication.publicationId,
    status:
      publication.status === "already_published"
        ? "already_completed"
        : "completed",
  };
}

export async function submitHostedExecutionRecovery(input: {
  action: "resume_controller_conversation" | "retry_as_new_execution";
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  env: CoreBindings;
  markEffectStarted: () => Promise<void>;
  operationId: string;
}): Promise<
  | {
      publicationId: null;
      status: "new_execution_requested";
    }
  | {
      newExecutionId: string;
      status: "new_execution_requested";
    }
> {
  if (
    typeof input.env.OPENMELD_REMOTE_AGENT_WORKER?.submitConversationTurn !==
    "function"
  ) {
    throw new ExecutionRecoveryEffectNotStartedError(
      "execution_recovery.hosted_worker_unavailable"
    );
  }
  const submitted = await submitRemoteAgentExecutionRecoveryTurn({
    action: input.action,
    db: input.db,
    env: input.env,
    nowMs: Date.now(),
    operationId: input.operationId,
    originalDelivery: input.delivery,
    markEffectStarted: input.markEffectStarted,
  });
  return input.action === "retry_as_new_execution"
    ? {
        newExecutionId: submitted.dispatchId,
        status: "new_execution_requested",
      }
    : {
        publicationId: null,
        status: "new_execution_requested",
      };
}

export async function resolveAuthoritativeHostedExecutionRecovery(input: {
  claimStorageKey: string;
  command: ExecuteExecutionRecoveryBody;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  env: CoreBindings;
  projection: ExecutionRecoveryProjection;
}): Promise<ExecuteExecutionRecoveryResponse | null> {
  if (
    input.command.action !== "retry_as_new_execution" &&
    input.projection.recoveredPublicationId
  ) {
    return {
      action: input.command.action,
      newExecutionId: null,
      operationId: input.command.operationId,
      publicationId: input.projection.recoveredPublicationId,
      reasonCode: resolveExecutionRecoveryCompletionReasonCode({
        action: input.command.action,
        status: "already_completed",
      }),
      recovery: input.projection,
      status: "already_completed",
    };
  }
  if (input.command.action === "recover_result") {
    const publicationId = await findExecutionRecoveryPublicationAtOrigin({
      db: input.db,
      delivery: input.delivery,
      destination: input.command.destination,
      env: input.env,
      operationId: input.command.operationId,
      reuseOriginalFinalPublicationIdentity: true,
    });
    if (!publicationId) {
      return null;
    }
    await reconcileRemoteAgentRetainedResultPublication({
      db: input.db,
      delivery: input.delivery,
      env: input.env,
      nowMs: Date.now(),
      publicationId,
    });
    const refreshedDelivery =
      await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: input.db,
        idempotencyKey: input.delivery.idempotencyKey,
      });
    if (!refreshedDelivery) {
      throw new Error("execution_recovery.execution_not_found");
    }
    const refreshedProjection = await projectHostedExecutionRecovery({
      delivery: refreshedDelivery,
      env: input.env,
      nowMs: Date.now(),
    });
    return {
      action: input.command.action,
      newExecutionId: null,
      operationId: input.command.operationId,
      publicationId,
      reasonCode: resolveExecutionRecoveryCompletionReasonCode({
        action: input.command.action,
        status: "already_completed",
      }),
      recovery: refreshedProjection,
      status: "already_completed",
    };
  }
  const claimDigest = input.claimStorageKey.slice(
    EXECUTION_RECOVERY_OPERATION_CLAIM_STORAGE_PREFIX.length
  );
  const identity = buildRemoteAgentExecutionRecoveryIdentity({
    action: input.command.action,
    operationId: `execution-recovery-effect:${claimDigest}`,
    originalDelivery: input.delivery,
  });
  const recoveryDelivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: identity.idempotencyKey,
  });
  if (
    !(
      recoveryDelivery &&
      (recoveryDelivery.status === "accepted" ||
        recoveryDelivery.status === "retry_observed" ||
        recoveryDelivery.status === "completed")
    )
  ) {
    return null;
  }
  return {
    action: input.command.action,
    newExecutionId:
      input.command.action === "retry_as_new_execution"
        ? recoveryDelivery.dispatchId
        : null,
    operationId: input.command.operationId,
    publicationId:
      recoveryDelivery.providerPublicationResultId ??
      recoveryDelivery.publishedSignalId,
    reasonCode: resolveExecutionRecoveryCompletionReasonCode({
      action: input.command.action,
      status: "new_execution_requested",
    }),
    recovery: input.projection,
    status: "new_execution_requested",
  };
}

function resolveRecoveredPublicationId(
  delivery: RemoteAgentNativeDeliveryRecord
): string | null {
  if (
    delivery.finalPublicationState !== "published" ||
    delivery.finalPublicationPayload?.failureCode !== null ||
    delivery.status !== "completed"
  ) {
    return null;
  }
  return delivery.conversationKind === "message_channel"
    ? delivery.providerPublicationResultId
    : delivery.publishedSignalId;
}
