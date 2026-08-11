import type { Profile, SignalEnvelope } from "@openmeld/protocol";
import {
  AGENT_REPLY_FINAL_PURPOSE,
  CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
} from "@openmeld/schemas";
import type {
  AgentControllerConversationRef,
  MessageEnvelope,
  OpenMeldDaemonDispatchQueueMessage,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { emitSpaceTextSignal } from "../../rpc/space-signal-emitter";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";
import type { FinalOutcomeWriteAuthority } from "../../space/application/types";
import {
  claimFinalReplyEmission,
  rollbackFinalReplyEmissionClaim,
  writeOpenMeldDaemonOpsDecision,
} from "../infrastructure/d1/dispatch-ledger-d1";
import type { DispatchExecutionContext } from "./dispatch-execution-service";
import {
  buildDispatchContinuationSpaceAccess,
  isDispatchMessageProtectedSpace,
} from "./dispatch-space-access";

const DISPATCH_REPLY_DUPLICATE_BLOCKED_DECISION_CODE =
  "dispatch.reply.duplicate_blocked";
const DISPATCH_REPLY_CLAIM_MISSING_LEDGER_DECISION_CODE =
  "dispatch.reply.claim_missing_ledger";
const DISPATCH_REPLY_PERSISTED_DECISION_CODE = "dispatch.reply.persisted";

export const DISPATCH_REPLY_SIGNAL_ID_MISMATCH_ERROR =
  "dispatch reply messageEnvelope.replyToSignalId must match dispatchMessage.replyToSnapshot.signalId";

export async function emitDispatchTextReplySignal(input: {
  agentControllerConversationId: string | null;
  attemptId: string;
  agentControllerRef: string;
  db: D1Database;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionContext: DispatchExecutionContext;
  executionLogBase: Record<string, string>;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  messageEnvelope?: MessageEnvelope | null;
  replyText: string;
  targetOwnerUserId: string;
  profileHandle: string | null;
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
  agentControllerConversation: AgentControllerConversationRef | null;
  workingDirectory: string | null;
}): Promise<SignalEnvelope | null> {
  const replyClaimedAtMs = Date.now();
  const replyDecisionLogContext = {
    attemptId: input.attemptId,
    dispatchId: input.dispatchMessage.dispatchId,
    spaceId: input.dispatchMessage.spaceId,
    targetProfileId: input.dispatchMessage.targetProfileId,
  };
  const replyClaimState = await claimFinalReplyEmission({
    db: input.db,
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    nowMs: replyClaimedAtMs,
  });

  if (replyClaimState === "already_claimed") {
    await writeReplyOpsDecisionSafely({
      ...replyDecisionLogContext,
      db: input.db,
      decisionCode: DISPATCH_REPLY_DUPLICATE_BLOCKED_DECISION_CODE,
      decisionPayload: {
        ...replyDecisionLogContext,
        replyClaimState,
      },
    });
    return null;
  }

  if (replyClaimState === "missing_ledger_row") {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.reply_claim_missing_ledger]",
      {
        ...input.executionLogBase,
        daemonSessionId: input.executionContext.daemonSessionId,
        leaseEpoch: input.executionContext.leaseEpoch,
      }
    );
    await writeReplyOpsDecisionSafely({
      ...replyDecisionLogContext,
      db: input.db,
      decisionCode: DISPATCH_REPLY_CLAIM_MISSING_LEDGER_DECISION_CODE,
      decisionPayload: {
        ...replyDecisionLogContext,
        replyClaimState,
      },
    });
  }

  const shouldRollbackReplyClaim = replyClaimState === "claimed";
  let emittedSignal: SignalEnvelope | null = null;

  try {
    const publishedProfile = await buildDispatchPublishedAgentProfile({
      agentControllerConversationId: input.agentControllerConversationId,
      agentControllerRef: input.agentControllerRef,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      targetOwnerUserId: input.targetOwnerUserId,
      profileHandle: input.profileHandle,
      targetProfileName: input.targetProfileName,
      agentControllerConversation: input.agentControllerConversation,
      workingDirectory: input.workingDirectory,
    });
    const canonicalMessageEnvelope = buildCanonicalDispatchReplyMessageEnvelope(
      {
        dispatchMessage: input.dispatchMessage,
        messageEnvelope: input.messageEnvelope ?? null,
        replyText: input.replyText,
      }
    );

    const requestContext = buildDispatchReplyContext({
      message: input.dispatchMessage,
      targetProfileName: input.targetProfileName,
      ownerUserId: input.targetOwnerUserId,
      agentControllerRef: input.agentControllerRef,
      agentControllerConversationId: input.agentControllerConversationId,
    });
    emittedSignal = await emitSpaceTextSignal({
      env: input.env,
      spaceId: input.dispatchMessage.spaceId,
      profile: publishedProfile,
      authoringPolicy: "system_emitted",
      finalOutcomeAuthority: input.finalOutcomeAuthority,
      messageEnvelope: canonicalMessageEnvelope,
      meta: {
        coreReadinessFactsChanged: {
          agentProfileId: input.dispatchMessage.targetProfileId,
          kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
        },
        dispatchId: input.dispatchMessage.dispatchId,
        purpose: AGENT_REPLY_FINAL_PURPOSE,
        targetProfileId: input.dispatchMessage.targetProfileId,
        ...(input.targetProfileName
          ? { targetProfileName: input.targetProfileName }
          : {}),
        ...(input.targetProfileMentionLabel
          ? { targetMentionLabel: input.targetProfileMentionLabel }
          : {}),
      },
      ...(input.dispatchMessage.replyToSnapshot
        ? { replyTo: input.dispatchMessage.replyToSnapshot }
        : {}),
      text: input.replyText,
      spaceAccess: buildDispatchContinuationSpaceAccess({
        attemptId: input.attemptId,
        message: input.dispatchMessage,
        requestContext,
      }),
      ...(input.dispatchMessage.threadContext
        ? { threadContext: input.dispatchMessage.threadContext }
        : {}),
      context: requestContext,
    });
  } catch (error) {
    if (shouldRollbackReplyClaim) {
      await rollbackFinalReplyEmissionClaim({
        db: input.db,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        claimedAtMs: replyClaimedAtMs,
      }).catch(() => undefined);
    }
    throw error;
  }

  await writeReplyOpsDecisionSafely({
    ...replyDecisionLogContext,
    db: input.db,
    decisionCode: DISPATCH_REPLY_PERSISTED_DECISION_CODE,
    decisionPayload: {
      attemptId: input.attemptId,
      dispatchId: input.dispatchMessage.dispatchId,
      spaceId: input.dispatchMessage.spaceId,
      protectedSpace: isDispatchMessageProtectedSpace(input.dispatchMessage),
    },
  });
  return emittedSignal;
}

export function buildCanonicalDispatchReplyMessageEnvelope(input: {
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  messageEnvelope?: MessageEnvelope | null;
  replyText: string;
}): MessageEnvelope {
  const dispatchReplyToSignalId = normalizeOptionalText(
    input.dispatchMessage.replyToSnapshot?.signalId
  );
  const envelopeReplyToSignalId = normalizeOptionalText(
    input.messageEnvelope?.replyToSignalId
  );

  if (
    dispatchReplyToSignalId &&
    envelopeReplyToSignalId &&
    dispatchReplyToSignalId !== envelopeReplyToSignalId
  ) {
    throw new Error(DISPATCH_REPLY_SIGNAL_ID_MISMATCH_ERROR);
  }

  const resolvedReplyToSignalId =
    dispatchReplyToSignalId ?? envelopeReplyToSignalId;

  return {
    activationTargets: [...(input.messageEnvelope?.activationTargets ?? [])],
    referenceTargets: [...(input.messageEnvelope?.referenceTargets ?? [])],
    ...(resolvedReplyToSignalId
      ? { replyToSignalId: resolvedReplyToSignalId }
      : {}),
    text: input.replyText,
  };
}

async function writeReplyOpsDecisionSafely(input: {
  attemptId: string;
  db: D1Database;
  decisionCode: string;
  decisionPayload: Record<string, unknown>;
  dispatchId: string;
  spaceId: string;
  targetProfileId: string;
}): Promise<void> {
  try {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: input.decisionCode,
      decisionPayload: input.decisionPayload,
      decidedBy: "dispatch-execution-service",
      decidedAtMs: Date.now(),
      source: "dispatch_execution",
      correlationId: input.dispatchId,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_execution.reply_ops_decision_write_failed]",
      {
        event: CORE_LOG_EVENTS.opsDecisionWriteFailed,
        decisionCode: input.decisionCode,
        dispatchId: input.dispatchId,
        attemptId: input.attemptId,
        spaceId: input.spaceId,
        targetProfileId: input.targetProfileId,
        decisionContext: input.decisionPayload,
        error: toErrorMessage(error),
      }
    );
  }
}

export function buildDispatchReplyTargetProfile(input: {
  targetProfileId: string;
  profileHandle: string | null;
  targetProfileName: string | null;
  ownerUserId: string | null;
  agentControllerRef: string | null;
  agentControllerConversationId: string | null;
  workingDirectory?: string | null;
}): Profile {
  const profileHandle = normalizeOptionalText(input.profileHandle);
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  const targetProfile = {
    kind: "agent" as const,
    profileId: input.targetProfileId,
    ...(profileHandle ? { profileHandle } : {}),
    ...(ownerUserId ? { owner: ownerUserId } : {}),
    ...(input.agentControllerRef
      ? { agentControllerRef: input.agentControllerRef }
      : {}),
    ...(input.agentControllerConversationId
      ? { agentControllerConversationId: input.agentControllerConversationId }
      : {}),
    ...(input.workingDirectory
      ? { workingDirectory: input.workingDirectory }
      : {}),
  };
  const profileName = normalizeOptionalText(input.targetProfileName);
  if (!profileName) {
    return targetProfile;
  }
  return {
    ...targetProfile,
    profileName,
  };
}

export function buildDispatchPublishedAgentProfile(input: {
  agentControllerConversationId: string | null;
  agentControllerRef: string | null;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  targetOwnerUserId: string | null;
  profileHandle: string | null;
  targetProfileName: string | null;
  agentControllerConversation: AgentControllerConversationRef | null;
  workingDirectory: string | null;
}): Profile {
  const agentControllerConversationId =
    resolvePublishedAgentControllerConversationId({
      agentControllerConversationId: input.agentControllerConversationId,
      agentControllerConversation: input.agentControllerConversation,
    });
  return buildDispatchReplyTargetProfile({
    targetProfileId: input.dispatchMessage.targetProfileId,
    profileHandle: input.profileHandle,
    targetProfileName: input.targetProfileName,
    ownerUserId: input.targetOwnerUserId,
    agentControllerRef: input.agentControllerRef,
    agentControllerConversationId,
    workingDirectory: input.workingDirectory,
  });
}

export function buildDispatchReplyContext(input: {
  message: OpenMeldDaemonDispatchQueueMessage;
  targetProfileName: string | null;
  ownerUserId: string | null;
  agentControllerRef: string | null;
  agentControllerConversationId: string | null;
}): OpenMeldRequestContext {
  const targetProfileName = normalizeOptionalText(input.targetProfileName);
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  return {
    actorContext: {
      requestId: `openMeldDaemon-dispatch-${input.message.dispatchId}`,
      openMeldProfileId: input.message.targetProfileId,
      profileKind: "agent",
      ...(targetProfileName ? { profileName: targetProfileName } : {}),
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(input.agentControllerRef
        ? { agentControllerRef: input.agentControllerRef }
        : {}),
      dispatchChainId: input.message.dispatchChainId,
      autoRelayDepth: input.message.autoRelayDepth,
      visitedProfileIds: input.message.visitedProfileIds,
      visitedProfileIdsHash: input.message.visitedProfileIdsHash,
    },
    ...(input.agentControllerConversationId
      ? { agentControllerConversationId: input.agentControllerConversationId }
      : {}),
  };
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function resolvePublishedAgentControllerConversationId(input: {
  agentControllerConversationId: string | null;
  agentControllerConversation: AgentControllerConversationRef | null;
}): string | null {
  return (
    normalizeOptionalText(input.agentControllerConversationId) ??
    normalizeOptionalText(
      input.agentControllerConversation?.agentControllerConversationId
    )
  );
}
