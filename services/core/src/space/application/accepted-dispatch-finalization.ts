import type { SignalEnvelope } from "@openmeld/protocol";
import {
  OPENMELD_DAEMON_DISPATCH_CONTRACT_VERSION,
  OPENMELD_DAEMON_DISPATCH_QUEUE_SCHEMA_VERSION,
  runtimeTransportModeSchema,
  sanitizeSignalTextPreview,
} from "@openmeld/schemas";
import type {
  MessageEnvelope,
  OpenMeldDaemonDispatchQueueMessage,
  SpaceThreadContext,
} from "@openmeld/schemas/types";
import type { DispatchResultInboxRecord } from "../../runtime-transport/infrastructure/d1/dispatch-result-inbox-repo";
import type { AcceptedDispatchFinalizationFact } from "../infrastructure/d1/accepted-dispatch-finalization-repo";

const FINALIZATION_RULE_SOURCE = "system" as const;
const FINALIZATION_RULE_ID = "durable_result.finalize";
const FINALIZATION_RULE_REASON = "durable accepted result finalization";

export const buildAcceptedDispatchFinalizationQueueMessage = (input: {
  fact: AcceptedDispatchFinalizationFact;
  inboxRecord: DispatchResultInboxRecord;
  sourceSignal: SignalEnvelope;
  // Resolved fallback for the source signal author's display name (for
  // example from a Space membership snapshot lookup). Used only when
  // sourceSignal.profile.profileName itself is absent -- see
  // buildOptionalReplyToSnapshot.
  sourceProfileNameSnapshot?: string | null;
  spaceContract: NonNullable<
    OpenMeldDaemonDispatchQueueMessage["spaceContractSnapshot"]
  >;
  threadContext: SpaceThreadContext | null;
}): OpenMeldDaemonDispatchQueueMessage | null => {
  if (
    input.inboxRecord.dispatchId !== input.fact.dispatchId ||
    input.inboxRecord.attemptId !== input.fact.attemptId ||
    input.inboxRecord.taskId !== input.fact.taskId ||
    input.inboxRecord.targetProfileId !== input.fact.targetProfileId
  ) {
    return null;
  }

  const sourceSignalSnapshot = buildSourceSignalSnapshot(input.sourceSignal);
  if (!sourceSignalSnapshot) {
    return null;
  }

  const dispatchPolicy: OpenMeldDaemonDispatchQueueMessage["dispatchPolicy"] =
    input.spaceContract.dispatchPolicy.mode === "listen_all"
      ? "listen_all"
      : "mention_only";
  const dispatchRulesSnapshot = {
    dispatchPolicy,
    ruleSource: FINALIZATION_RULE_SOURCE,
    ruleId: FINALIZATION_RULE_ID,
    ruleReason: FINALIZATION_RULE_REASON,
  };
  const controllerSnapshot = buildControllerSnapshot(input.inboxRecord);

  return {
    v: OPENMELD_DAEMON_DISPATCH_QUEUE_SCHEMA_VERSION,
    dispatchId: input.fact.dispatchId,
    spaceId: input.fact.spaceId,
    sourceEventId: input.fact.sourceEventId,
    ...(input.fact.sourceClientMessageId
      ? { sourceClientMessageId: input.fact.sourceClientMessageId }
      : {}),
    ...(input.fact.dispatchOwner
      ? { dispatchOwner: input.fact.dispatchOwner }
      : {}),
    targetProfileId: input.fact.targetProfileId,
    dispatchChainId: input.fact.dispatchId,
    autoRelayDepth: 0,
    visitedProfileIds: [],
    visitedProfileIdsHash: `dispatch:${input.fact.dispatchId}`,
    dispatchContractVersion: OPENMELD_DAEMON_DISPATCH_CONTRACT_VERSION,
    dispatchPolicy,
    ruleSource: FINALIZATION_RULE_SOURCE,
    ruleId: FINALIZATION_RULE_ID,
    ruleReason: FINALIZATION_RULE_REASON,
    taskId: input.fact.taskId,
    transportMode: readTransportMode(input.inboxRecord),
    controllerSnapshot,
    contextIdMappingSpec: null,
    dispatchRulesSnapshot,
    spaceContractSnapshot: input.spaceContract,
    sourceSignalSnapshot,
    ...buildOptionalSourceMessageEnvelope(input.sourceSignal),
    ...buildOptionalReplyToSnapshot(
      input.sourceSignal,
      input.sourceProfileNameSnapshot ?? null
    ),
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
    dispatchSnapshot: {
      ...dispatchRulesSnapshot,
      targetBindingEnabled: true,
      targetBindingState: "bound",
    },
    idempotencyKey: input.fact.idempotencyKey,
    enqueuedAtMs: input.fact.enqueuedAtMs,
  };
};

function readTransportMode(
  inboxRecord: DispatchResultInboxRecord
): OpenMeldDaemonDispatchQueueMessage["transportMode"] {
  const transportMode = (
    inboxRecord.taskResult.payload as {
      transportMode?: unknown;
    }
  ).transportMode;
  const parsed = runtimeTransportModeSchema.safeParse(transportMode);
  return parsed.success ? parsed.data : null;
}

function buildControllerSnapshot(
  inboxRecord: DispatchResultInboxRecord
): OpenMeldDaemonDispatchQueueMessage["controllerSnapshot"] {
  const agentControllerRef = normalizeOptionalText(
    (inboxRecord.taskResult.payload as { agentControllerRef?: unknown })
      .agentControllerRef
  );
  return {
    agentControllerRef,
    targetBindingEnabled: true,
    targetBindingState: "bound",
  };
}

function buildSourceSignalSnapshot(
  sourceSignal: SignalEnvelope
): OpenMeldDaemonDispatchQueueMessage["sourceSignalSnapshot"] | null {
  if (sourceSignal.type !== "signal.text") {
    return null;
  }
  const text = normalizeOptionalText(sourceSignal.data.text);
  if (!text) {
    return null;
  }
  return {
    ...(sourceSignal.data.meta?.centerAgentInteractionSource
      ? {
          centerAgentInteractionSource:
            sourceSignal.data.meta.centerAgentInteractionSource,
        }
      : {}),
    text,
    profileId: normalizeOptionalText(sourceSignal.profile.profileId),
    profileKind: normalizeProfileKind(sourceSignal.profile.kind),
  };
}

function buildOptionalSourceMessageEnvelope(
  sourceSignal: SignalEnvelope
): { sourceMessageEnvelope: MessageEnvelope } | Record<string, never> {
  if (sourceSignal.type !== "signal.text") {
    return {};
  }
  const messageEnvelope = sourceSignal.data.messageEnvelope;
  return messageEnvelope ? { sourceMessageEnvelope: messageEnvelope } : {};
}

function buildOptionalReplyToSnapshot(
  sourceSignal: SignalEnvelope,
  sourceProfileNameSnapshot: string | null
):
  | { replyToSnapshot: OpenMeldDaemonDispatchQueueMessage["replyToSnapshot"] }
  | Record<string, never> {
  if (sourceSignal.type !== "signal.text") {
    return {};
  }
  const profileId = normalizeOptionalText(sourceSignal.profile.profileId);
  const text = normalizeOptionalText(sourceSignal.data.text);
  if (!(profileId && text)) {
    return {};
  }
  // sourceSignal.profile.profileName can be absent for a service-authored
  // actor (for example a Center Agent tool call) whose request context never
  // carried a display name. Fall back to a resolved Space membership
  // snapshot, then ultimately the profile id, so a missing display name
  // never silently drops the whole reply-to contract -- matching
  // buildDispatchReplyToSnapshot's dispatch-time fallback chain in space.ts.
  const profileName =
    normalizeOptionalText(sourceSignal.profile.profileName) ??
    normalizeOptionalText(sourceProfileNameSnapshot) ??
    profileId;
  const previewText = sanitizeSignalTextPreview(text);
  if (!previewText) {
    return {};
  }
  return {
    replyToSnapshot: {
      signalId: sourceSignal.id,
      profileId,
      profileKind: normalizeProfileKind(sourceSignal.profile.kind),
      profileName,
      previewText,
    },
  };
}

function normalizeProfileKind(
  value: unknown
): "agent" | "human" | "system" | null {
  return value === "agent" || value === "human" || value === "system"
    ? value
    : null;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
