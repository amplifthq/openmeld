import { createHash } from "node:crypto";
import type { PluginConnectionContinuationBinding } from "@openmeld/schemas";
import { normalizeMessageEnvelope } from "@openmeld/schemas";
import type {
  SignalEnvelope,
  SpaceThreadContext,
} from "@openmeld/schemas/types";
import { stringifyCanonicalJson } from "@openmeld/utils";
import { createCoreRpcHttpError } from "../../rpc/errors";
import type { OpenMeldDaemonDispatchOutboxRecoveryCandidate } from "../infrastructure/outbox/dispatch-outbox-repo";

export const PLUGIN_CONTINUATION_CLIENT_PREFIX = "plugin-continue:";
export function pluginContinuationTextDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Both the previewing Core caller and the accepting Space use this exact
 * projection. Revision catches edit-and-revert; content catches stale snapshots. */
export function pluginContinuationMessageFingerprint(
  signal: SignalEnvelope | null
): string {
  return pluginContinuationTextDigest(
    stringifyCanonicalJson(
      signal?.type === "signal.text"
        ? {
            id: signal.id,
            spaceId: signal.spaceId,
            profileId: signal.profile.profileId,
            profileKind: signal.profile.kind,
            text: signal.data.text,
            envelope: signal.data.messageEnvelope
              ? normalizeMessageEnvelope(signal.data.messageEnvelope)
              : null,
            files: signal.data.files ?? [],
            attachments: signal.data.attachments ?? [],
            revision: signal.data.meta?.messageRevision ?? 0,
            editedAt: signal.data.meta?.editedAt ?? null,
            recalledAt: signal.data.meta?.recalledAt ?? null,
            dispatchId: signal.data.meta?.dispatchId ?? null,
          }
        : null
    )
  );
}

export function pluginContinuationConflict(): Error {
  return createCoreRpcHttpError({
    status: 409,
    code: "plugin.continue.source_changed",
    reason:
      "The original request or connection choice changed, or its accepted evidence is unavailable. Send a new request rather than resuming stale work.",
  });
}

export function assertPluginContinuationSource(input: {
  binding: PluginConnectionContinuationBinding;
  source: SignalEnvelope | null;
  reply: SignalEnvelope | null;
  dispatch: OpenMeldDaemonDispatchOutboxRecoveryCandidate | null;
  sourceThread: SpaceThreadContext | null;
  replyThread: SpaceThreadContext | null;
}) {
  const { binding: b, source, reply, dispatch } = input;
  if (
    !(
      source?.type === "signal.text" &&
      reply?.type === "signal.text" &&
      dispatch
    )
  ) {
    throw pluginContinuationConflict();
  }
  if (
    source.id !== b.source.signalId ||
    source.spaceId !== b.spaceId ||
    source.profile.kind !== "human" ||
    source.profile.profileId !== b.requesterProfileId ||
    source.data.meta?.recalledAt
  ) {
    throw pluginContinuationConflict();
  }
  if (
    reply.id !== b.reply.signalId ||
    reply.spaceId !== b.spaceId ||
    reply.profile.kind !== "agent" ||
    reply.profile.profileId !== b.targetProfileId ||
    reply.data.meta?.recalledAt ||
    reply.data.meta?.editedAt ||
    reply.data.meta?.dispatchId !== b.sourceDispatchId
  ) {
    throw pluginContinuationConflict();
  }
  if (
    (source.data.meta?.messageRevision ?? 0) !== b.source.revision ||
    pluginContinuationMessageFingerprint(source) !== b.source.fingerprint ||
    (reply.data.meta?.messageRevision ?? 0) !== b.reply.revision ||
    pluginContinuationMessageFingerprint(reply) !== b.reply.fingerprint
  ) {
    throw pluginContinuationConflict();
  }
  // The outbox is the original admitted message snapshot, not a fresh client
  // assertion. No post-dispatch edit may be accepted merely because Core saw it.
  if (
    dispatch.dispatchId !== b.sourceDispatchId ||
    dispatch.spaceId !== b.spaceId ||
    dispatch.organizationId !== b.organizationId ||
    dispatch.sourceEventId !== source.id ||
    dispatch.targetProfileId !== b.targetProfileId ||
    dispatch.sourceSignalSnapshot?.profileId !== b.requesterProfileId ||
    dispatch.outboxStatus === "cancelled"
  ) {
    throw pluginContinuationConflict();
  }
  if (
    !dispatch.sourceMessageEnvelope ||
    dispatch.sourceMessageEnvelope.text !== source.data.text ||
    (source.data.meta?.editedAt !== undefined &&
      source.data.meta.editedAt >= dispatch.createdAtMs)
  ) {
    throw pluginContinuationConflict();
  }
  if (
    !(
      sameThread(input.sourceThread, dispatch.threadContext ?? null) &&
      sameThread(input.replyThread, b.threadContext)
    )
  ) {
    throw pluginContinuationConflict();
  }
}

export function samePluginContinuationIntent(
  a: PluginConnectionContinuationBinding,
  b: PluginConnectionContinuationBinding
): boolean {
  const intent = (value: PluginConnectionContinuationBinding) =>
    JSON.stringify([
      value.organizationId,
      value.spaceId,
      value.sourceDispatchId,
      value.source.signalId,
      value.reply.signalId,
      value.requesterUserId,
      value.requesterProfileId,
      value.targetProfileId,
      value.service,
      value.scope,
      value.connectionName,
      value.connectionUpdatedAtMs,
      value.threadContext?.threadId ?? null,
      value.threadContext?.rootSignalId ?? null,
    ]);
  return intent(a) === intent(b);
}

export function assertPluginContinuationMessage(
  signal: SignalEnvelope,
  binding: PluginConnectionContinuationBinding,
  threadContext: SpaceThreadContext | null
) {
  if (
    signal.type !== "signal.text" ||
    signal.profile.kind !== "human" ||
    signal.profile.profileId !== binding.requesterProfileId ||
    signal.spaceId !== binding.spaceId ||
    pluginContinuationTextDigest(signal.data.text) !==
      binding.continuationTextDigest ||
    signal.data.meta?.editedAt ||
    signal.data.meta?.recalledAt ||
    !sameThread(threadContext, binding.threadContext)
  ) {
    throw pluginContinuationConflict();
  }
  const targets = signal.data.messageEnvelope?.activationTargets ?? [];
  if (
    targets.length !== 1 ||
    targets[0] !== binding.targetProfileId ||
    signal.data.messageEnvelope?.replyToSignalId !== binding.source.signalId
  ) {
    throw pluginContinuationConflict();
  }
}

function sameThread(
  a: SpaceThreadContext | null,
  b: SpaceThreadContext | null
) {
  return (
    (a?.threadId ?? null) === (b?.threadId ?? null) &&
    (a?.rootSignalId ?? null) === (b?.rootSignalId ?? null)
  );
}
