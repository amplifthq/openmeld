import {
  remoteAgentAdmissionAttemptEvidenceSchema,
  remoteAgentTaskContinuationEvidenceSchema,
} from "@openmeld/schemas";
import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/d1/native-delivery-ledger-repo";

type AdmissionEvidence = ReturnType<
  typeof remoteAgentAdmissionAttemptEvidenceSchema.parse
>;

/** Observe the existing owner; do not mutate its ledger or infer execution. */
export function reportNativeDeliveryAdmissionEvidence(input: {
  delivery?: RemoteAgentNativeDeliveryRecord;
  accepted?: boolean;
  submissionId?: string;
  elapsedMs?: number;
  observedAtMs: number;
  phase: AdmissionEvidence["phase"];
  outcome?: AdmissionEvidence["outcome"];
}): void {
  const delivery = input.delivery;
  if (!delivery) {
    return;
  }
  const parsed = remoteAgentAdmissionAttemptEvidenceSchema.safeParse({
    v: 1,
    deliveryId: delivery.deliveryId,
    dispatchId: delivery.dispatchId,
    idempotencyKey: delivery.idempotencyKey,
    attempt: delivery.admissionAttemptCount,
    deliveryCreatedAtMs: delivery.createdAtMs,
    currentAttemptSubmittedAtMs: delivery.submittedAtMs,
    observedAtMs: input.observedAtMs,
    retryDueAtMs: delivery.admissionRetryDueAtMs,
    ...(input.elapsedMs === undefined ? {} : { elapsedMs: input.elapsedMs }),
    ...(input.accepted === undefined ? {} : { accepted: input.accepted }),
    ...(input.submissionId === undefined
      ? {}
      : { submissionId: input.submissionId }),
    phase: input.phase,
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
  });
  if (!parsed.success) {
    console.warn("[core.remote_agent.admission_attempt.evidence_invalid]");
    return;
  }
  // No prompts, outcomes, raw errors, credentials or worker request payloads.
  console.info("[core.remote_agent.admission_attempt]", parsed.data);
}

type ContinuationEvidence = ReturnType<
  typeof remoteAgentTaskContinuationEvidenceSchema.parse
>;

export function reportTaskContinuationEvidence(
  input: Omit<ContinuationEvidence, "v">
): void {
  const parsed = remoteAgentTaskContinuationEvidenceSchema.safeParse({
    v: 1,
    ...input,
  });
  if (!parsed.success) {
    console.warn("[core.remote_agent.task_continuation.evidence_invalid]");
    return;
  }
  console.info("[core.remote_agent.task_continuation.stage]", parsed.data);
}

export async function observeTaskContinuationPreparation<T>(
  input: Pick<ContinuationEvidence, "idempotencyKey" | "subscriptionId">,
  stage: ContinuationEvidence["stage"],
  prepare: () => Promise<T>
): Promise<T> {
  const started = performance.now();
  // Callers may pass their full input object. Select correlation fields rather
  // than spreading request/context data into the strict diagnostic envelope.
  const identity = {
    idempotencyKey: input.idempotencyKey,
    subscriptionId: input.subscriptionId,
  };
  reportTaskContinuationEvidence({
    ...identity,
    stage,
    event: "started",
    observedAtMs: Date.now(),
  });
  try {
    const result = await prepare();
    reportTaskContinuationEvidence({
      ...identity,
      stage,
      event: "finished",
      observedAtMs: Date.now(),
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
    });
    return result;
  } catch (error) {
    reportTaskContinuationEvidence({
      ...identity,
      stage,
      event: "failed",
      observedAtMs: Date.now(),
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
    });
    throw error;
  }
}
