import type { SignalEnvelope } from "@openmeld/protocol";
import { activateAgentDelegationChildren } from "../../agent-task-coordination/infrastructure/d1/agent-delegation-repo";
import { readCoreRpcHttpStatus } from "../../rpc/errors";
import { prepareCenterAgentAuditJournalEntryIfMissingStatement } from "../center-agent-repository";
import {
  CenterAgentWakePublicationClaimLostError,
  type CenterAgentWakePublicationCommand,
  type CenterAgentWakePublicationRecord,
  claimCenterAgentWakePublication,
  listDueCenterAgentWakePublications,
  markCenterAgentWakePublicationAccepted,
  markCenterAgentWakePublicationCompleted,
  markCenterAgentWakePublicationFailed,
  prepareCenterAgentWakePublicationRecord,
  readCenterAgentWakePublication,
  rescheduleCenterAgentWakePublication,
} from "../infrastructure/d1/center-agent-wake-publication-repo";
import {
  CenterAgentDelegationPreparationError,
  cancelPreparedCenterAgentWakeDelegation,
  prepareCenterAgentWakeDelegation,
} from "./center-agent-delegation-service";

const BASE_RETRY_DELAY_MS = 15_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;
const PUBLICATION_CLAIM_LEASE_MS = 5 * 60_000;
const PUBLICATION_ATTEMPT_TIMEOUT_MS = 30_000;
const PUBLICATION_REDRIVE_BATCH_BUDGET_MS = 45_000;

type CenterAgentWakePublicationExecution =
  | {
      attribution: CenterAgentWakePublicationCommand["attribution"];
      signal: Extract<SignalEnvelope, { type: "signal.text" }>;
      status: "accepted";
    }
  | {
      attribution: CenterAgentWakePublicationCommand["attribution"];
      retryAfterSeconds: number;
      status: "pending";
    };

type PublishCenterAgentWakeSignal = (
  command: CenterAgentWakePublicationCommand
) => Promise<SignalEnvelope>;

type ResolveCenterAgentWakeSignal = (
  command: CenterAgentWakePublicationCommand
) => Promise<SignalEnvelope | null>;

export async function prepareCenterAgentWakePublication(input: {
  command: CenterAgentWakePublicationCommand;
  db: D1Database;
  nowMs: number;
}): Promise<CenterAgentWakePublicationRecord> {
  return await prepareCenterAgentWakePublicationRecord(input);
}

export async function executeCenterAgentWakePublication(input: {
  db: D1Database;
  destinationNeutralContinuations?: boolean;
  nowMs: number;
  publicationId: string;
  publishSignal: PublishCenterAgentWakeSignal;
  publishTimeoutMs?: number;
  resolveSignal: ResolveCenterAgentWakeSignal;
}): Promise<CenterAgentWakePublicationExecution> {
  const existing = await requirePublication(input);
  if (existing.state === "completed") {
    return acceptedExecution(existing);
  }
  if (existing.state === "failed") {
    throw new Error(
      existing.lastError ?? "Center Agent Wake publication already failed"
    );
  }
  const claimId = crypto.randomUUID();
  const publication = await claimCenterAgentWakePublication({
    claimExpiresAtMs: input.nowMs + PUBLICATION_CLAIM_LEASE_MS,
    claimId,
    db: input.db,
    nowMs: input.nowMs,
    publicationId: input.publicationId,
  });
  if (!publication) {
    return await resolveCurrentPublicationExecution(input);
  }

  let signalAccepted = publication.signal !== null;
  let stage: "prepare" | "publish" | "finalize" = "prepare";
  try {
    await prepareCenterAgentWakeDelegation({
      actorProfileId: publication.command.attribution.actorProfileId,
      childSpaceId: publication.command.spaceId,
      clientMessageId: publication.command.clientMessageId,
      completionMode: publication.command.completionMode,
      db: input.db,
      destinationNeutralContinuations:
        input.destinationNeutralContinuations === true,
      ...(publication.command.fallbackAgentProfileId
        ? {
            fallbackAgentProfileId: publication.command.fallbackAgentProfileId,
          }
        : {}),
      nowMs: input.nowMs,
      organizationId: publication.command.organizationId,
      parentSubmissionId: publication.command.parentSubmissionId,
      targetProfileIds: publication.command.activationTargets,
      text: publication.command.text,
    });
    let signal = publication.signal;
    if (!signal) {
      stage = "publish";
      signal = await requireTextSignal(
        withPublicationAttemptDeadline(
          input.publishSignal(publication.command),
          normalizePublishTimeoutMs(input.publishTimeoutMs)
        )
      );
      await markCenterAgentWakePublicationAccepted({
        claimId,
        db: input.db,
        nowMs: input.nowMs,
        publicationId: publication.publicationId,
        signal,
      });
      signalAccepted = true;
    }
    stage = "finalize";
    return await finalizeAcceptedPublication({
      claimId,
      db: input.db,
      nowMs: input.nowMs,
      publication,
      signal,
    });
  } catch (error) {
    return await handlePublicationExecutionError({
      claimId,
      error,
      input,
      publication,
      signalAccepted,
      stage,
    });
  }
}

async function handlePublicationExecutionError(input: {
  claimId: string;
  error: unknown;
  input: {
    db: D1Database;
    nowMs: number;
    publishTimeoutMs?: number;
    resolveSignal: ResolveCenterAgentWakeSignal;
  };
  publication: CenterAgentWakePublicationRecord;
  signalAccepted: boolean;
  stage: "prepare" | "publish" | "finalize";
}): Promise<CenterAgentWakePublicationExecution> {
  if (input.error instanceof CenterAgentWakePublicationClaimLostError) {
    return await resolveCurrentPublicationExecution({
      db: input.input.db,
      nowMs: input.input.nowMs,
      publicationId: input.publication.publicationId,
    });
  }
  const definiteRejection = isDefinitePublicationRejection(input.error);
  if (!input.signalAccepted && input.stage === "publish" && definiteRejection) {
    const reconciliation = await reconcileRejectedPublication(input);
    if (reconciliation.kind === "execution") {
      return reconciliation.execution;
    }
  }
  if (!input.signalAccepted && definiteRejection) {
    return await failRejectedPublication(input);
  }
  return await rescheduleAsPending({
    db: input.input.db,
    error: input.error,
    claimId: input.claimId,
    nowMs: input.input.nowMs,
    publication: input.publication,
  });
}

async function reconcileRejectedPublication(input: {
  claimId: string;
  input: {
    db: D1Database;
    nowMs: number;
    publishTimeoutMs?: number;
    resolveSignal: ResolveCenterAgentWakeSignal;
  };
  publication: CenterAgentWakePublicationRecord;
}): Promise<
  | { kind: "not_found" }
  | { execution: CenterAgentWakePublicationExecution; kind: "execution" }
> {
  let reconciledSignal: Extract<SignalEnvelope, { type: "signal.text" }> | null;
  try {
    reconciledSignal = await requireOptionalTextSignal(
      withPublicationAttemptDeadline(
        input.input.resolveSignal(input.publication.command),
        normalizePublishTimeoutMs(input.input.publishTimeoutMs)
      )
    );
  } catch (error) {
    return {
      execution: await rescheduleAsPending({
        db: input.input.db,
        error,
        claimId: input.claimId,
        nowMs: input.input.nowMs,
        publication: input.publication,
      }),
      kind: "execution",
    };
  }
  if (!reconciledSignal) {
    return { kind: "not_found" };
  }
  try {
    await markCenterAgentWakePublicationAccepted({
      claimId: input.claimId,
      db: input.input.db,
      nowMs: input.input.nowMs,
      publicationId: input.publication.publicationId,
      signal: reconciledSignal,
    });
    return {
      execution: await finalizeAcceptedPublication({
        claimId: input.claimId,
        db: input.input.db,
        nowMs: input.input.nowMs,
        publication: input.publication,
        signal: reconciledSignal,
      }),
      kind: "execution",
    };
  } catch (error) {
    const execution =
      error instanceof CenterAgentWakePublicationClaimLostError
        ? await resolveCurrentPublicationExecution({
            db: input.input.db,
            nowMs: input.input.nowMs,
            publicationId: input.publication.publicationId,
          })
        : await rescheduleAsPending({
            db: input.input.db,
            error,
            claimId: input.claimId,
            nowMs: input.input.nowMs,
            publication: input.publication,
          });
    return { execution, kind: "execution" };
  }
}

async function failRejectedPublication(input: {
  claimId: string;
  error: unknown;
  input: { db: D1Database; nowMs: number };
  publication: CenterAgentWakePublicationRecord;
}): Promise<CenterAgentWakePublicationExecution> {
  try {
    await cancelPreparedCenterAgentWakeDelegation({
      db: input.input.db,
      delegationId: input.publication.command.delegationId,
      nowMs: input.input.nowMs,
      subscriptionIds: input.publication.command.subscriptionIds,
    });
    await markCenterAgentWakePublicationFailed({
      claimId: input.claimId,
      db: input.input.db,
      error: formatError(input.error),
      nowMs: input.input.nowMs,
      publicationId: input.publication.publicationId,
    });
  } catch (cleanupError) {
    return await rescheduleAsPending({
      db: input.input.db,
      error: cleanupError,
      claimId: input.claimId,
      nowMs: input.input.nowMs,
      publication: input.publication,
    });
  }
  throw input.error;
}

export async function retryPendingCenterAgentWakePublications(input: {
  batchBudgetMs?: number;
  clock?: () => number;
  db: D1Database;
  destinationNeutralContinuations?: boolean;
  limit?: number;
  nowMs: number;
  publishSignal: PublishCenterAgentWakeSignal;
  publishTimeoutMs?: number;
  resolveSignal: ResolveCenterAgentWakeSignal;
}): Promise<{
  completed: number;
  deferred: number;
  failed: number;
  rescheduled: number;
}> {
  const due = await listDueCenterAgentWakePublications({
    db: input.db,
    limit: input.limit,
    nowMs: input.nowMs,
  });
  const result = {
    completed: 0,
    deferred: 0,
    failed: 0,
    rescheduled: 0,
  };
  const clock = input.clock ?? Date.now;
  const batchDeadlineMs = clock() + normalizeBatchBudgetMs(input.batchBudgetMs);
  for (const [index, publication] of due.entries()) {
    const remainingBatchMs = batchDeadlineMs - clock();
    if (remainingBatchMs <= 0) {
      result.deferred += due.length - index;
      break;
    }
    try {
      await withPublicationAttemptDeadline(
        executeCenterAgentWakePublication({
          db: input.db,
          destinationNeutralContinuations:
            input.destinationNeutralContinuations === true,
          nowMs: input.nowMs,
          publicationId: publication.publicationId,
          publishSignal: input.publishSignal,
          publishTimeoutMs: Math.min(
            normalizePublishTimeoutMs(input.publishTimeoutMs),
            Math.max(1, Math.floor(remainingBatchMs))
          ),
          resolveSignal: input.resolveSignal,
        }),
        Math.max(1, Math.floor(remainingBatchMs))
      );
    } catch {
      // The attempt can continue after the batch deadline because Promises are
      // not cancellable. Observe only within the remaining budget and report
      // the durable state below instead of guessing that it was rescheduled.
    }
    const remainingObservationMs = batchDeadlineMs - clock();
    if (remainingObservationMs <= 0) {
      result.deferred += 1;
      continue;
    }
    let current: CenterAgentWakePublicationRecord | null;
    try {
      current = await withPublicationAttemptDeadline(
        readCenterAgentWakePublication({
          db: input.db,
          publicationId: publication.publicationId,
        }),
        Math.max(1, Math.floor(remainingObservationMs))
      );
    } catch {
      result.deferred += 1;
      continue;
    }
    if (current?.state === "completed") {
      result.completed += 1;
    } else if (current?.state === "failed") {
      result.failed += 1;
    } else if (
      current?.claimId === null &&
      current.nextAttemptAtMs > input.nowMs
    ) {
      result.rescheduled += 1;
    } else {
      result.deferred += 1;
    }
  }
  return result;
}

async function requirePublication(input: {
  db: D1Database;
  publicationId: string;
}): Promise<CenterAgentWakePublicationRecord> {
  const publication = await readCenterAgentWakePublication(input);
  if (!publication) {
    throw new Error("Center Agent Wake publication does not exist");
  }
  return publication;
}

async function requireTextSignal(
  signalPromise: Promise<SignalEnvelope>
): Promise<Extract<SignalEnvelope, { type: "signal.text" }>> {
  const signal = await signalPromise;
  if (signal.type !== "signal.text") {
    throw Object.assign(
      new Error(
        `Center Agent Space Wake expected signal.text but received ${signal.type}`
      ),
      {
        code: "center_agent.wake_signal_type_invalid",
        status: 500,
      }
    );
  }
  return signal;
}

async function requireOptionalTextSignal(
  signalPromise: Promise<SignalEnvelope | null>
): Promise<Extract<SignalEnvelope, { type: "signal.text" }> | null> {
  const signal = await signalPromise;
  return signal === null
    ? null
    : await requireTextSignal(Promise.resolve(signal));
}

async function finalizeAcceptedPublication(input: {
  claimId: string;
  db: D1Database;
  nowMs: number;
  publication: CenterAgentWakePublicationRecord;
  signal: Extract<SignalEnvelope, { type: "signal.text" }>;
}): Promise<
  Extract<CenterAgentWakePublicationExecution, { status: "accepted" }>
> {
  await activateAgentDelegationChildren({
    db: input.db,
    delegationId: input.publication.command.delegationId,
    nowMs: input.nowMs,
  });
  await prepareCenterAgentAuditJournalEntryIfMissingStatement({
    action: "wake_agent_profiles_in_space",
    actorProfileId: input.publication.command.attribution.actorProfileId,
    attribution: input.publication.command.attribution,
    db: input.db,
    id: buildAuditEntryId(input.publication.publicationId),
    nowMs: input.nowMs,
    organizationId: input.publication.command.organizationId,
    resource: {
      id: input.publication.command.spaceId,
      type: "space",
    },
  }).run();
  await markCenterAgentWakePublicationCompleted({
    claimId: input.claimId,
    db: input.db,
    nowMs: input.nowMs,
    publicationId: input.publication.publicationId,
  });
  return {
    attribution: input.publication.command.attribution,
    signal: input.signal,
    status: "accepted",
  };
}

async function reschedulePublication(input: {
  claimId: string;
  db: D1Database;
  error: unknown;
  nowMs: number;
  publication: CenterAgentWakePublicationRecord;
}): Promise<CenterAgentWakePublicationRecord> {
  return await rescheduleCenterAgentWakePublication({
    claimId: input.claimId,
    db: input.db,
    error: formatError(input.error),
    nextAttemptAtMs:
      input.nowMs + retryDelayMs(input.publication.attemptCount + 1),
    nowMs: input.nowMs,
    publicationId: input.publication.publicationId,
  });
}

async function rescheduleAsPending(input: {
  claimId: string;
  db: D1Database;
  error: unknown;
  nowMs: number;
  publication: CenterAgentWakePublicationRecord;
}): Promise<CenterAgentWakePublicationExecution> {
  try {
    return pendingExecution(await reschedulePublication(input), input.nowMs);
  } catch (error) {
    if (error instanceof CenterAgentWakePublicationClaimLostError) {
      return await resolveCurrentPublicationExecution({
        db: input.db,
        nowMs: input.nowMs,
        publicationId: input.publication.publicationId,
      });
    }
    throw error;
  }
}

async function resolveCurrentPublicationExecution(input: {
  db: D1Database;
  nowMs: number;
  publicationId: string;
}): Promise<CenterAgentWakePublicationExecution> {
  const current = await requirePublication(input);
  if (current.state === "accepted" || current.state === "completed") {
    return acceptedExecution(current);
  }
  if (current.state === "failed") {
    throw new Error(
      current.lastError ?? "Center Agent Wake publication already failed"
    );
  }
  return pendingExecution(current, input.nowMs);
}

function acceptedExecution(
  publication: CenterAgentWakePublicationRecord
): Extract<CenterAgentWakePublicationExecution, { status: "accepted" }> {
  if (!publication.signal) {
    throw new Error(
      "Accepted Center Agent Wake publication is missing its Space signal"
    );
  }
  return {
    attribution: publication.command.attribution,
    signal: publication.signal,
    status: "accepted",
  };
}

function pendingExecution(
  publication: CenterAgentWakePublicationRecord,
  nowMs: number
): Extract<CenterAgentWakePublicationExecution, { status: "pending" }> {
  const targetMs =
    publication.claimExpiresAtMs !== null &&
    publication.claimExpiresAtMs > nowMs
      ? publication.claimExpiresAtMs
      : publication.nextAttemptAtMs;
  return {
    attribution: publication.command.attribution,
    retryAfterSeconds: Math.min(
      300,
      Math.max(1, Math.ceil((targetMs - nowMs) / 1000))
    ),
    status: "pending",
  };
}

async function withPublicationAttemptDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new CenterAgentWakePublicationTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function normalizePublishTimeoutMs(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? PUBLICATION_ATTEMPT_TIMEOUT_MS;
  if (!(Number.isInteger(value) && value > 0)) {
    throw new Error("publishTimeoutMs must be a positive integer");
  }
  return Math.min(value, PUBLICATION_CLAIM_LEASE_MS - 1000);
}

function normalizeBatchBudgetMs(batchBudgetMs: number | undefined): number {
  const value = batchBudgetMs ?? PUBLICATION_REDRIVE_BATCH_BUDGET_MS;
  if (!(Number.isInteger(value) && value > 0)) {
    throw new Error("batchBudgetMs must be a positive integer");
  }
  return Math.min(value, 55_000);
}

class CenterAgentWakePublicationTimeoutError extends Error {
  readonly retryable = true;

  constructor(timeoutMs: number) {
    super(`Center Agent Wake publication timed out after ${timeoutMs} ms`);
    this.name = "CenterAgentWakePublicationTimeoutError";
  }
}

function isDefinitePublicationRejection(error: unknown): boolean {
  if (error instanceof CenterAgentDelegationPreparationError) {
    return true;
  }
  if (readBoolean(error, "retryable") || readBoolean(error, "overloaded")) {
    return false;
  }
  const status = readCoreRpcHttpStatus(error);
  return (
    status !== null &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 425 &&
    status !== 429
  );
}

function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(8, attemptCount - 1));
  return Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** exponent);
}

function buildAuditEntryId(publicationId: string): string {
  return `center-agent-wake:${publicationId}`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readBoolean(value: unknown, key: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[key] === true
  );
}
