import {
  markRemoteAgentMessageChannelAdmissionWatchdogOutcomeUnknown,
  markRemoteAgentMessageChannelAdmissionWatchdogPublished,
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  releaseRemoteAgentMessageChannelAdmissionWatchdogClaim,
  releaseRemoteAgentMessageChannelTerminalFailureClaim,
} from "../infrastructure/d1/native-delivery-ledger-repo";
import type { MessageChannelProviderRegistry } from "./message-channel-adapters";
import { resolveMessageChannelPublicationTarget } from "./message-channel-publication-target";
import {
  type MessageChannelTerminalPublicationResult,
  publishMessageChannelTerminalResult,
} from "./message-channel-terminal-publication";

export type RemoteAgentMessageChannelAdmissionFailurePublicationOutcome =
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      resultId: string;
      status: "published";
    }
  | {
      reasonCode: string;
      status: "retryable";
    }
  | {
      status: "outcome_unknown";
    };

export async function publishRemoteAgentMessageChannelAdmissionFailure(input: {
  claimId: string;
  clock?: () => number;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord & {
    status: "failed" | "worker_unavailable";
  };
  failureCode: string;
  failureMessage: string;
  releaseMode: "preserve_terminal" | "restore_admission";
  registry: MessageChannelProviderRegistry;
}): Promise<RemoteAgentMessageChannelAdmissionFailurePublicationOutcome> {
  assertClaimedAdmissionFailure(input);
  const providerPublicationIdempotencyKey =
    requireProviderPublicationIdempotencyKey(input.delivery);
  const targetResolution = await resolveMessageChannelPublicationTarget({
    db: input.db,
    delivery: input.delivery,
    registry: input.registry,
  });
  if (targetResolution.status === "retryable") {
    return await releaseForRetry({
      ...input,
      providerPublicationIdempotencyKey,
      reasonCode: targetResolution.reasonCode,
    });
  }

  const clock = input.clock ?? Date.now;
  let publication: MessageChannelTerminalPublicationResult;
  try {
    publication = await publishMessageChannelTerminalResult({
      attachments: [],
      delivery: input.delivery,
      failureCode: input.failureCode,
      target: targetResolution.target,
      text: input.failureMessage,
    });
  } catch {
    const marked = await markOutcomeUnknown({
      ...input,
      nowMs: clock(),
      providerProgressSequence: null,
      providerPublicationIdempotencyKey,
    });
    return marked
      ? { status: "outcome_unknown" }
      : await resolveAdmissionFailurePublicationRace(input);
  }

  if (publication.status === "outcome_unknown") {
    const marked = await markOutcomeUnknown({
      ...input,
      nowMs: clock(),
      providerProgressSequence: publication.providerProgressSequence,
      providerPublicationIdempotencyKey,
    });
    return marked
      ? { status: "outcome_unknown" }
      : await resolveAdmissionFailurePublicationRace(input);
  }
  if (publication.status === "failed") {
    return await releaseForRetry({
      ...input,
      providerPublicationIdempotencyKey,
      reasonCode: publication.reasonCode,
    });
  }

  const resultId = publication.resultId;
  const published =
    await markRemoteAgentMessageChannelAdmissionWatchdogPublished({
      claimId: input.claimId,
      db: input.db,
      failureCode: input.failureCode,
      idempotencyKey: input.delivery.idempotencyKey,
      nowMs: clock(),
      providerProgressSequence: publication.providerProgressSequence,
      providerPublicationIdempotencyKey,
      providerPublicationResultId: resultId,
    });
  if (!isConfirmedAdmissionFailurePublication(published, resultId)) {
    const marked = await markOutcomeUnknown({
      ...input,
      nowMs: clock(),
      providerProgressSequence: publication.providerProgressSequence,
      providerPublicationIdempotencyKey,
    });
    return marked
      ? { status: "outcome_unknown" }
      : await resolveAdmissionFailurePublicationRace(input);
  }
  return { delivery: published, resultId, status: "published" };
}

function assertClaimedAdmissionFailure(input: {
  claimId: string;
  delivery: RemoteAgentNativeDeliveryRecord;
  failureCode: string;
}): void {
  if (
    input.delivery.conversationKind !== "message_channel" ||
    (input.delivery.status !== "failed" &&
      input.delivery.status !== "worker_unavailable") ||
    input.delivery.failureCode !== input.failureCode ||
    input.delivery.submissionId !== null ||
    input.delivery.acceptedAtMs !== null ||
    input.delivery.finalPublicationState !== "claimed" ||
    input.delivery.finalPublicationClaimId !== input.claimId
  ) {
    throw new Error(
      "Message Channel admission failure does not own its publication claim"
    );
  }
}

function requireProviderPublicationIdempotencyKey(
  delivery: RemoteAgentNativeDeliveryRecord
): string {
  const value = delivery.providerPublicationIdempotencyKey?.trim();
  if (!value) {
    throw new Error(
      "Message Channel admission failure has no publication idempotency key"
    );
  }
  return value;
}

async function releaseForRetry(input: {
  claimId: string;
  clock?: () => number;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  failureCode: string;
  providerPublicationIdempotencyKey: string;
  reasonCode: string;
  releaseMode: "preserve_terminal" | "restore_admission";
}): Promise<RemoteAgentMessageChannelAdmissionFailurePublicationOutcome> {
  const releaseInput = {
    claimId: input.claimId,
    db: input.db,
    failureCode: input.failureCode,
    idempotencyKey: input.delivery.idempotencyKey,
    nowMs: (input.clock ?? Date.now)(),
    providerPublicationIdempotencyKey: input.providerPublicationIdempotencyKey,
  };
  const released =
    input.releaseMode === "preserve_terminal"
      ? await releaseRemoteAgentMessageChannelTerminalFailureClaim(releaseInput)
      : await releaseRemoteAgentMessageChannelAdmissionWatchdogClaim(
          releaseInput
        );
  if (released) {
    return { reasonCode: input.reasonCode, status: "retryable" };
  }
  const marked = await markOutcomeUnknown({
    ...input,
    nowMs: (input.clock ?? Date.now)(),
    providerProgressSequence: null,
  });
  return marked
    ? { status: "outcome_unknown" }
    : await resolveAdmissionFailurePublicationRace(input);
}

async function markOutcomeUnknown(input: {
  claimId: string;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  failureCode: string;
  nowMs: number;
  providerProgressSequence: number | null;
  providerPublicationIdempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  return await markRemoteAgentMessageChannelAdmissionWatchdogOutcomeUnknown({
    claimId: input.claimId,
    db: input.db,
    failureCode: input.failureCode,
    idempotencyKey: input.delivery.idempotencyKey,
    nowMs: input.nowMs,
    providerProgressSequence: input.providerProgressSequence,
    providerPublicationIdempotencyKey: input.providerPublicationIdempotencyKey,
  });
}

async function resolveAdmissionFailurePublicationRace(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
}): Promise<RemoteAgentMessageChannelAdmissionFailurePublicationOutcome> {
  const current = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.delivery.idempotencyKey,
  });
  if (
    current?.finalPublicationState === "published" &&
    current.providerPublicationResultId
  ) {
    return {
      delivery: current,
      resultId: current.providerPublicationResultId,
      status: "published",
    };
  }
  if (current?.finalPublicationState === "outcome_unknown") {
    return { status: "outcome_unknown" };
  }
  return {
    reasonCode: "remote_agent.message_channel_failure_publication_claim_lost",
    status: "retryable",
  };
}

function isConfirmedAdmissionFailurePublication(
  delivery: RemoteAgentNativeDeliveryRecord | null,
  resultId: string
): delivery is RemoteAgentNativeDeliveryRecord {
  return Boolean(
    delivery &&
      delivery.conversationKind === "message_channel" &&
      (delivery.status === "failed" ||
        delivery.status === "worker_unavailable") &&
      delivery.finalPublicationState === "published" &&
      delivery.providerPublicationResultId === resultId &&
      delivery.publishedSignalId === null
  );
}
