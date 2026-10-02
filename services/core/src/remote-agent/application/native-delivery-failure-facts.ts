import {
  agentFailureFactsSchema,
  resolveHostedAgentCallbackFailureReasonCode,
} from "@openmeld/schemas";
import type { AgentFailureFacts } from "@openmeld/schemas/types";
import { readAgentTaskContinuationReplyLanguage } from "../../agent-task-coordination/infrastructure/d1/agent-task-coordination-repo";
import { readOrganizationWorkingLanguagePreference } from "../../organizations/organization-working-language-repository";
import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/d1/native-delivery-ledger-repo";

/**
 * Transitional persisted-copy fallback, not a per-task semantic language fact.
 * Used only when no upstream reply-language decision accompanies this task.
 * Never infer that decision from message text or relabel the Organization hint.
 */
export async function readNativeFailureLanguageFallback(input: {
  db: D1Database | undefined;
  organizationId: string;
}): Promise<string | undefined> {
  if (!input.db) {
    return undefined;
  }
  const preference = await readOrganizationWorkingLanguagePreference({
    ...input,
    db: input.db,
  });
  return preference.languageTag ?? undefined;
}

export async function resolveNativeFailureLanguage(input: {
  coordinationDb: D1Database | undefined;
  db: D1Database | undefined;
  delivery: Pick<
    RemoteAgentNativeDeliveryRecord,
    | "organizationId"
    | "idempotencyKey"
    | "spaceId"
    | "profileId"
    | "executionRecoverySubmitRequest"
  > & {
    workerSubmitRequest?: RemoteAgentNativeDeliveryRecord["workerSubmitRequest"];
  };
}): Promise<string | undefined> {
  const request =
    input.delivery.workerSubmitRequest ??
    input.delivery.executionRecoverySubmitRequest;
  const trigger = request?.turnEnvelope.trigger;
  let subscriptionId: string | undefined;
  if (
    trigger?.source === "task_continuation" ||
    trigger?.source === "task_watch_continuation"
  ) {
    subscriptionId = trigger.subscriptionId;
  } else if (trigger?.source === "routine") {
    subscriptionId = trigger.continuation?.subscriptionId;
  }
  if (request && subscriptionId && input.coordinationDb) {
    if (
      request.organizationId !== input.delivery.organizationId ||
      request.idempotencyKey !== input.delivery.idempotencyKey ||
      request.spaceId !== input.delivery.spaceId ||
      request.agentProfileId !== input.delivery.profileId
    ) {
      throw new Error("agent_task_continuation.language_identity_mismatch");
    }
    const language = await readAgentTaskContinuationReplyLanguage({
      db: input.coordinationDb,
      subscriptionId,
      organizationId: input.delivery.organizationId,
      continuationIdempotencyKey: input.delivery.idempotencyKey,
    });
    if (language) {
      return language;
    }
  }
  return await readNativeFailureLanguageFallback({
    db: input.db,
    organizationId: input.delivery.organizationId,
  });
}

/** The native owner supplies certainty; no ACK means unknown, not not-started. */
export function buildTaskContinuationAdmissionFailureFacts(input: {
  delivery: RemoteAgentNativeDeliveryRecord;
  maxAttempts: number;
  languageTag?: string;
}): AgentFailureFacts {
  return agentFailureFactsSchema.parse({
    v: 1,
    reasonCode: "remote_agent.admission_timeout",
    stage: "admission",
    result: { status: "unknown" },
    retry: {
      status: "exhausted",
      attempt: input.delivery.admissionAttemptCount,
      maxAttempts: input.maxAttempts,
    },
    recovery: { status: "none" },
    recoveryActions: [],
    diagnosticReference: {
      spaceId: input.delivery.spaceId,
      dispatchId: input.delivery.dispatchId,
      ...(input.delivery.attemptId
        ? { attemptId: input.delivery.attemptId }
        : {}),
    },
    ...(input.languageTag ? { languageTag: input.languageTag } : {}),
  });
}

/** A failed execution callback does not prove that earlier actions did not run. */
export function buildRoutineExecutionFailureFacts(input: {
  delivery: Pick<RemoteAgentNativeDeliveryRecord, "dispatchId" | "spaceId"> & {
    attemptId?: string | null;
  };
  failureCode: string;
  failureDetail?: string | null;
  languageTag?: string;
}): AgentFailureFacts {
  const unavailable =
    input.failureCode === "remote_agent.empty_assistant_response" ||
    input.failureCode === "remote_agent.turn.output_limit_exceeded";
  return agentFailureFactsSchema.parse({
    v: 1,
    reasonCode: resolveHostedAgentCallbackFailureReasonCode(input),
    stage: "execution",
    result: { status: unavailable ? "unavailable" : "unknown" },
    retry: { status: "none" },
    recovery: { status: "none" },
    recoveryActions: [],
    diagnosticReference: {
      spaceId: input.delivery.spaceId,
      dispatchId: input.delivery.dispatchId,
      ...(input.delivery.attemptId
        ? { attemptId: input.delivery.attemptId }
        : {}),
    },
    ...(input.languageTag ? { languageTag: input.languageTag } : {}),
  });
}

/** A timed-out receipt lookup is not evidence that a Routine never ran. */
export function buildRoutineUnconfirmedAdmissionFailureFacts(input: {
  delivery: Pick<RemoteAgentNativeDeliveryRecord, "dispatchId" | "spaceId"> & {
    attemptId?: string | null;
  };
  languageTag?: string;
}): AgentFailureFacts {
  return agentFailureFactsSchema.parse({
    v: 1,
    reasonCode: "remote_agent.worker_ack_recovery_expired",
    stage: "admission",
    executionConfirmation: "unknown",
    result: { status: "unknown" },
    retry: { status: "exhausted" },
    recovery: { status: "none" },
    recoveryActions: [],
    diagnosticReference: {
      spaceId: input.delivery.spaceId,
      dispatchId: input.delivery.dispatchId,
      ...(input.delivery.attemptId
        ? { attemptId: input.delivery.attemptId }
        : {}),
    },
    ...(input.languageTag ? { languageTag: input.languageTag } : {}),
  });
}
