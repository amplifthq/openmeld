import type {
  AuthRpcResolveOrganizationAccountIdentityResult,
  InboxSourceCandidate,
} from "@openmeld/schemas/types";
import { ensureInboxItem } from "../../inbox/application/inbox-item-service";
import {
  markSpaceInboxProjectionOutboxCompleted,
  markSpaceInboxProjectionOutboxFailed,
  type SpaceInboxProjectionOutboxRecord,
} from "../infrastructure/sql/space-inbox-projection-outbox-repo";

const RETRY_DELAYS_MS = [2000, 5000, 15_000, 60_000] as const;
const MAX_RETRY_DELAY_MS = 60_000;
const PROJECTION_FAILED_ERROR_CODE = "space_inbox_projection_failed";

export type SpaceInboxProjectionAttemptResult =
  | {
      completedAtMs: number;
      projectionId: string;
      status: "completed";
    }
  | {
      error: Error;
      failedAtMs: number;
      nextRetryAtMs: number;
      projectionId: string;
      status: "failed";
    };

export async function attemptSpaceInboxProjectionOutboxRecord(input: {
  db: D1Database | undefined;
  ensureItem?: typeof ensureInboxItem;
  isRecipientEligible: (candidate: InboxSourceCandidate) => Promise<boolean>;
  nowMs?: number;
  prepareCandidate?: (
    candidate: InboxSourceCandidate
  ) => Promise<InboxSourceCandidate>;
  record: SpaceInboxProjectionOutboxRecord;
  sql: SqlStorage;
}): Promise<SpaceInboxProjectionAttemptResult> {
  const nowMs = input.nowMs ?? Date.now();
  try {
    if (!input.db) {
      throw new Error("Inbox store is unavailable");
    }
    const ensureItem = input.ensureItem ?? ensureInboxItem;
    const failedCandidates: InboxSourceCandidate[] = [];
    const failures: Error[] = [];
    for (const candidate of input.record.candidates) {
      try {
        const compatibleCandidate =
          normalizeSpaceInboxProjectionCandidate(candidate);
        if (!(await input.isRecipientEligible(compatibleCandidate))) {
          continue;
        }
        const preparedCandidate = input.prepareCandidate
          ? await input.prepareCandidate(compatibleCandidate)
          : compatibleCandidate;
        await ensureItem({ candidate: preparedCandidate, db: input.db, nowMs });
      } catch (error) {
        failedCandidates.push(candidate);
        failures.push(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
    if (failedCandidates.length > 0) {
      throw new SpaceInboxRecipientProjectionError({
        candidates: failedCandidates,
        cause: failures[0],
      });
    }
    markSpaceInboxProjectionOutboxCompleted(input.sql, {
      completedAtMs: nowMs,
      projectionId: input.record.projectionId,
    });
    return {
      completedAtMs: nowMs,
      projectionId: input.record.projectionId,
      status: "completed",
    };
  } catch (error) {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));
    const nextRetryAtMs = nowMs + resolveRetryDelayMs(input.record);
    markSpaceInboxProjectionOutboxFailed(input.sql, {
      candidates:
        error instanceof SpaceInboxRecipientProjectionError
          ? error.candidates
          : input.record.candidates,
      errorCode: PROJECTION_FAILED_ERROR_CODE,
      failedAtMs: nowMs,
      nextRetryAtMs,
      projectionId: input.record.projectionId,
    });
    return {
      error: normalizedError,
      failedAtMs: nowMs,
      nextRetryAtMs,
      projectionId: input.record.projectionId,
      status: "failed",
    };
  }
}

function normalizeSpaceInboxProjectionCandidate(
  candidate: InboxSourceCandidate
): InboxSourceCandidate {
  if (
    candidate.sourceKind === "space_signal" &&
    candidate.kind === "wake_outcome" &&
    candidate.attention === "action_required"
  ) {
    const sourceTarget =
      candidate.sourceTarget.kind === "space"
        ? {
            kind: "space" as const,
            spaceId: candidate.sourceTarget.spaceId,
            ...(candidate.sourceTarget.threadRootSignalId
              ? {
                  threadRootSignalId: candidate.sourceTarget.threadRootSignalId,
                }
              : {}),
          }
        : candidate.sourceTarget;
    return { ...candidate, attention: "update", sourceTarget };
  }
  return candidate;
}

class SpaceInboxRecipientProjectionError extends Error {
  readonly candidates: readonly InboxSourceCandidate[];

  constructor(input: {
    candidates: readonly InboxSourceCandidate[];
    cause: Error | undefined;
  }) {
    super(
      input.cause?.message ??
        `Inbox projection failed for ${input.candidates.length} recipient(s)`,
      { cause: input.cause }
    );
    this.name = "SpaceInboxRecipientProjectionError";
    this.candidates = input.candidates;
  }
}

export async function resolveSpaceInboxRecipientEligibility(input: {
  candidate: InboxSourceCandidate;
  hasActiveSpaceMembership: boolean;
  readAccountIdentity: () => Promise<AuthRpcResolveOrganizationAccountIdentityResult | null>;
}): Promise<boolean> {
  if (!input.hasActiveSpaceMembership) {
    return false;
  }

  const identity = await input.readAccountIdentity();
  if (!identity) {
    throw new Error("Inbox recipient identity projection is unavailable");
  }
  if (!identity.ok) {
    throw new Error(
      `Inbox recipient identity projection failed: ${identity.code}`
    );
  }

  return Boolean(
    identity.account?.userId === input.candidate.recipientUserId &&
      identity.account.membership
  );
}

function resolveRetryDelayMs(record: SpaceInboxProjectionOutboxRecord): number {
  return (
    RETRY_DELAYS_MS[Math.max(0, record.attemptCount)] ?? MAX_RETRY_DELAY_MS
  );
}
