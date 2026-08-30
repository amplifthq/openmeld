import { normalizeMessageEnvelope } from "@openmeld/schemas";
import type {
  MessageEnvelopeTargetField,
  OpenMeldSpacePostMessageAction,
  SpaceMemberDirectoryEntry,
} from "@openmeld/schemas/types";

export type DispatchPostMessageInputKind =
  | "direct_payload"
  | "fenced_block"
  | "trailing_json";

export type DispatchSendTargetProjectionEntry = SpaceMemberDirectoryEntry;

export type DispatchSendTargetReferenceLoadResult =
  | {
      status: "loaded";
      projection: DispatchSendTargetProjectionEntry[];
      referenceLines: string[];
    }
  | {
      status: "failed";
      errorMessage: string;
      projection: null;
      referenceLines: [];
    };

type TargetValidationRule = {
  fieldName: MessageEnvelopeTargetField;
  relationName: "wake" | "reference" | "mention";
};

const TARGET_VALIDATION_RULES: TargetValidationRule[] = [
  {
    fieldName: "activationTargets",
    relationName: "wake",
  },
  {
    fieldName: "referenceTargets",
    relationName: "reference",
  },
  {
    fieldName: "mentionTargets",
    relationName: "mention",
  },
];

export function normalizeDispatchPostMessageAction(input: {
  action: OpenMeldSpacePostMessageAction;
  currentReplyToSignalId: string | null;
  inputKind: DispatchPostMessageInputKind;
  sendTargetReference: DispatchSendTargetReferenceLoadResult;
}): {
  action: OpenMeldSpacePostMessageAction;
  tracePayload: {
    activationTargetsCount: number;
    inputKind: DispatchPostMessageInputKind;
    memberDirectoryLoaded: boolean;
    mentionTargetsCount: number;
    referenceTargetsCount: number;
    replyToSignalIdResolved: boolean;
  };
} {
  const normalizedEnvelope = normalizeMessageEnvelope(
    input.action.messageEnvelope
  );
  const replyToSignalId = normalizeReplyToSignalId({
    currentReplyToSignalId: input.currentReplyToSignalId,
    envelopeReplyToSignalId: normalizedEnvelope.replyToSignalId ?? null,
  });

  const canonicalAction: OpenMeldSpacePostMessageAction = {
    ...input.action,
    messageEnvelope: {
      ...normalizedEnvelope,
      ...(replyToSignalId ? { replyToSignalId } : {}),
    },
  };

  validateDispatchPostMessageTargets({
    action: canonicalAction,
    sendTargetReference: input.sendTargetReference,
  });

  return {
    action: canonicalAction,
    tracePayload: {
      activationTargetsCount:
        canonicalAction.messageEnvelope.activationTargets.length,
      inputKind: input.inputKind,
      memberDirectoryLoaded: input.sendTargetReference.status === "loaded",
      mentionTargetsCount:
        canonicalAction.messageEnvelope.mentionTargets?.length ?? 0,
      referenceTargetsCount:
        canonicalAction.messageEnvelope.referenceTargets.length,
      replyToSignalIdResolved: Boolean(
        canonicalAction.messageEnvelope.replyToSignalId
      ),
    },
  };
}

function normalizeReplyToSignalId(input: {
  currentReplyToSignalId: string | null;
  envelopeReplyToSignalId: string | null;
}): string | null {
  if (!input.currentReplyToSignalId) {
    if (input.envelopeReplyToSignalId) {
      throw new Error(
        "post_message.messageEnvelope.replyToSignalId must match the current dispatch reply target"
      );
    }
    return null;
  }

  if (
    input.envelopeReplyToSignalId &&
    input.envelopeReplyToSignalId !== input.currentReplyToSignalId
  ) {
    throw new Error(
      "post_message.messageEnvelope.replyToSignalId must match the current dispatch reply target"
    );
  }

  return input.currentReplyToSignalId;
}

function validateDispatchPostMessageTargets(input: {
  action: OpenMeldSpacePostMessageAction;
  sendTargetReference: DispatchSendTargetReferenceLoadResult;
}): void {
  const { activationTargets, referenceTargets } = input.action.messageEnvelope;
  const mentionTargets = input.action.messageEnvelope.mentionTargets ?? [];
  if (
    activationTargets.length === 0 &&
    referenceTargets.length === 0 &&
    mentionTargets.length === 0
  ) {
    return;
  }

  if (input.sendTargetReference.status !== "loaded") {
    throw new Error(
      "post_message.messageEnvelope targets require a current Space member directory"
    );
  }

  const targetByProfileId = new Map(
    input.sendTargetReference.projection.map((target) => [
      target.profileId,
      target,
    ])
  );
  for (const rule of TARGET_VALIDATION_RULES) {
    const targets = input.action.messageEnvelope[rule.fieldName] ?? [];
    for (const [index, targetProfileId] of targets.entries()) {
      validateDispatchTargetProfileId({
        fieldName: rule.fieldName,
        index,
        relationName: rule.relationName,
        targetByProfileId,
        targetProfileId,
      });
    }
  }
}

function validateDispatchTargetProfileId(input: {
  fieldName: MessageEnvelopeTargetField;
  index: number;
  relationName: "wake" | "reference" | "mention";
  targetByProfileId: ReadonlyMap<string, DispatchSendTargetProjectionEntry>;
  targetProfileId: string;
}): void {
  const target = input.targetByProfileId.get(input.targetProfileId);
  const fieldPath = `post_message.messageEnvelope.${input.fieldName}[${String(
    input.index
  )}]`;

  if (!target) {
    throw new Error(
      `${fieldPath} must reference an active profile in this space`
    );
  }

  if (input.relationName === "wake" && !target.allowedRelations.wake) {
    throw new Error(
      `${fieldPath} must reference an agent profile in this space`
    );
  }
  if (
    input.relationName === "reference" &&
    !target.allowedRelations.reference
  ) {
    throw new Error(
      `${fieldPath} must reference an active profile in this space`
    );
  }
  if (input.relationName === "mention" && !target.allowedRelations.mention) {
    throw new Error(
      `${fieldPath} must reference a human profile in this space`
    );
  }
}
