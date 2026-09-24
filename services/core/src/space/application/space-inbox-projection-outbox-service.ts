import { inboxSourceCandidateSchema } from "@openmeld/schemas";
import type {
  AuthRpcResolveOrganizationAccountIdentityResult,
  InboxSourceCandidate,
} from "@openmeld/schemas/types";
import { ensureInboxItem } from "../../inbox/application/inbox-item-service";
import { normalizeLegacySpaceAwareness } from "../../inbox/application/inbox-legacy-space-awareness";
import {
  freezeSpaceInboxProjectionSelection,
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
      projectedUserIds: string[];
      status: "completed";
    }
  | {
      error: Error;
      failedAtMs: number;
      nextRetryAtMs: number;
      projectionId: string;
      projectedUserIds: string[];
      status: "failed";
    };

export async function attemptSpaceInboxProjectionOutboxRecord(input: {
  db: D1Database | undefined;
  ensureItem?: typeof ensureInboxItem;
  isRecipientEligible: (candidate: InboxSourceCandidate) => Promise<boolean>;
  canReceiveAgentActivity?: (
    candidate: InboxSourceCandidate
  ) => Promise<boolean>;
  nowMs?: number;
  prepareCandidate?: (
    candidate: InboxSourceCandidate
  ) => Promise<InboxSourceCandidate>;
  record: SpaceInboxProjectionOutboxRecord;
  sql: SqlStorage;
}): Promise<SpaceInboxProjectionAttemptResult> {
  const nowMs = input.nowMs ?? Date.now();
  const projectedUserIds: string[] = [];
  try {
    if (!input.db) {
      throw new Error("Inbox store is unavailable");
    }
    const ensureItem = input.ensureItem ?? ensureInboxItem;
    const failedCandidates: InboxSourceCandidate[] = [];
    const failures: Error[] = [];
    const candidates = await selectSpaceInboxRecipients(
      input.record.candidates,
      input.canReceiveAgentActivity
    );
    for (const candidate of candidates) {
      try {
        const compatibleCandidate =
          normalizeSpaceInboxProjectionCandidate(candidate);
        if (!(await input.isRecipientEligible(compatibleCandidate))) {
          continue;
        }
        const preparedCandidate = input.prepareCandidate
          ? await input.prepareCandidate(compatibleCandidate)
          : compatibleCandidate;
        const selectedCandidate = freezeSpaceInboxProjectionSelection(
          input.sql,
          {
            projectionId: input.record.projectionId,
            candidate: preparedCandidate,
          }
        );
        await ensureItem({ candidate: selectedCandidate, db: input.db, nowMs });
        projectedUserIds.push(candidate.recipientUserId);
      } catch (error) {
        // Preserve independent source relationships. A later ownership change
        // must not erase a valid Human mention during an outbox retry.
        failedCandidates.push(
          ...input.record.candidates.filter(
            (original) => original.recipientUserId === candidate.recipientUserId
          )
        );
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
      projectedUserIds,
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
      projectedUserIds,
      status: "failed",
    };
  }
}

export async function selectSpaceInboxRecipients(
  candidates: readonly InboxSourceCandidate[],
  canReceiveAgentActivity?: (
    candidate: InboxSourceCandidate
  ) => Promise<boolean>
): Promise<InboxSourceCandidate[]> {
  const byRecipient = new Map<string, InboxSourceCandidate>();
  for (const rawCandidate of candidates) {
    const candidate = normalizeSpaceInboxProjectionCandidate(rawCandidate);
    if (
      candidate.sourceTarget.kind === "space" &&
      candidate.sourceTarget.agentOwnerActivity === true
    ) {
      if (!canReceiveAgentActivity) {
        throw new Error("Agent owner activity eligibility is unavailable");
      }
      if (!(await canReceiveAgentActivity(candidate))) {
        continue;
      }
    }
    const previous = byRecipient.get(candidate.recipientUserId);
    byRecipient.set(
      candidate.recipientUserId,
      previous ? mergeSpaceInboxRecipient(previous, candidate) : candidate
    );
  }
  return [...byRecipient.values()];
}

function normalizeSpaceInboxProjectionCandidate(
  candidate: InboxSourceCandidate
): InboxSourceCandidate {
  // Receiver-first compatibility for the old owner-awareness writer/outbox.
  // Awareness never carried urgent-email or blocking-work authority.
  const compatible = normalizeLegacySpaceAwareness(candidate);
  if (compatible !== candidate) {
    return compatible;
  }
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

function mergeSpaceInboxRecipient(
  left: InboxSourceCandidate,
  right: InboxSourceCandidate
): InboxSourceCandidate {
  if (
    left.organizationId !== right.organizationId ||
    left.sourceKind !== right.sourceKind ||
    left.sourceKey !== right.sourceKey ||
    left.occurredAtMs !== right.occurredAtMs ||
    left.attention !== right.attention ||
    left.sourceTarget.kind !== "space" ||
    right.sourceTarget.kind !== "space" ||
    left.sourceTarget.spaceId !== right.sourceTarget.spaceId ||
    left.sourceTarget.signalId !== right.sourceTarget.signalId ||
    left.sourceTarget.threadRootSignalId !==
      right.sourceTarget.threadRootSignalId
  ) {
    throw new Error(
      "Cannot merge Inbox recipients across a different source identity"
    );
  }
  const preferred =
    recipientReasonRank(left) >= recipientReasonRank(right) ? left : right;
  const facts = [left.sourceFacts, right.sourceFacts].filter(
    (value) => value !== undefined
  );
  const union = (
    field:
      | "agentProfileIds"
      | "personalAgentProfileIds"
      | "mentionedAgentProfileIds"
      | "firstContactAgentProfileIds"
  ) => [...new Set(facts.flatMap((value) => value[field] ?? []))].sort();
  return inboxSourceCandidateSchema.parse({
    ...preferred,
    importance:
      left.importance === "urgent" || right.importance === "urgent"
        ? "urgent"
        : "normal",
    sourceTarget: {
      ...preferred.sourceTarget,
      ...(left.sourceTarget.directMessage || right.sourceTarget.directMessage
        ? { directMessage: true }
        : {}),
      ...(left.sourceTarget.agentOwnerActivity ||
      right.sourceTarget.agentOwnerActivity
        ? { agentOwnerActivity: true }
        : {}),
      ...(left.sourceTarget.replyToRecipient ||
      right.sourceTarget.replyToRecipient
        ? { replyToRecipient: true }
        : {}),
    },
    ...(facts.length > 0
      ? {
          sourceFacts: {
            version: 1,
            agentProfileIds: union("agentProfileIds"),
            personalAgentProfileIds: union("personalAgentProfileIds"),
            mentionedAgentProfileIds: union("mentionedAgentProfileIds"),
            firstContactAgentProfileIds: union("firstContactAgentProfileIds"),
            recipientReasons: [
              ...new Set(facts.flatMap((value) => value.recipientReasons)),
            ].sort(),
          },
        }
      : {}),
  });
}

function recipientReasonRank(candidate: InboxSourceCandidate): number {
  if (candidate.kind === "space_mention") {
    return 3;
  }
  if (candidate.sourceTarget.kind !== "space") {
    return 0;
  }
  if (candidate.sourceTarget.replyToRecipient) {
    return 2;
  }
  return candidate.sourceTarget.agentOwnerActivity ? 1 : 0;
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
