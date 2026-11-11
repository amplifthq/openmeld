import type {
  PluginConnectionContinuationBinding,
  PluginConnectionExecutionSource,
} from "@openmeld/schemas";
import { normalizeMessageEnvelope } from "@openmeld/schemas";
import type {
  SignalEnvelope,
  SpaceThreadContext,
} from "@openmeld/schemas/types";
import { stringifyCanonicalJson } from "@openmeld/utils";
import {
  pluginConnectionSourceEnvelopeDigest,
  pluginContinuationTextDigest,
} from "../../connectors/plugin-connection-source-fingerprint";
import type { RemoteAgentNativeDeliveryRecord } from "../../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { createCoreRpcHttpError } from "../../rpc/errors";

export const PLUGIN_CONTINUATION_CLIENT_PREFIX = "plugin-continue:";

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
  nativeSource?: RemoteAgentNativeDeliveryRecord;
  localSource?: PluginConnectionExecutionSource;
  sourceThread: SpaceThreadContext | null;
  replyThread: SpaceThreadContext | null;
}) {
  const { binding: b, source, reply } = input;
  if (
    !(
      source?.type === "signal.text" &&
      reply?.type === "signal.text" &&
      (input.localSource || input.nativeSource)
    )
  ) {
    throw pluginContinuationConflict();
  }
  if (
    source.id !== b.source.signalId ||
    source.spaceId !== b.spaceId ||
    source.profile.kind !== "human" ||
    source.profile.profileId !== b.requesterProfileId ||
    source.data.meta?.recalledAt ||
    reply.id !== b.reply.signalId ||
    reply.spaceId !== b.spaceId ||
    reply.profile.kind !== "agent" ||
    reply.profile.profileId !== b.targetProfileId ||
    reply.data.meta?.recalledAt ||
    reply.data.meta?.editedAt ||
    reply.data.meta?.dispatchId !== b.sourceDispatchId ||
    (source.data.meta?.messageRevision ?? 0) !== b.source.revision ||
    pluginContinuationMessageFingerprint(source) !== b.source.fingerprint ||
    (reply.data.meta?.messageRevision ?? 0) !== b.reply.revision ||
    pluginContinuationMessageFingerprint(reply) !== b.reply.fingerprint
  ) {
    throw pluginContinuationConflict();
  }
  if (input.nativeSource) {
    assertNativePluginContinuationSource({
      binding: b,
      source,
      reply,
      delivery: input.nativeSource,
      sourceThread: input.sourceThread,
      replyThread: input.replyThread,
    });
    return;
  }
  const local = input.localSource;
  if (!local) {
    throw pluginContinuationConflict();
  }
  // RuntimeCoordinator retains admission after the conveyor is retired. This
  // narrow read contains no credential and is never accepted from a browser.
  if (
    local.spaceId !== b.spaceId ||
    local.dispatchId !== b.sourceDispatchId ||
    local.targetProfileId !== b.targetProfileId ||
    local.sourceSignalId !== source.id ||
    local.requesterProfileId !== b.requesterProfileId ||
    !source.data.messageEnvelope ||
    source.data.messageEnvelope.text !== source.data.text ||
    pluginConnectionSourceEnvelopeDigest(source.data.messageEnvelope) !==
      local.sourceEnvelopeDigest ||
    source.data.meta?.editedAt ||
    (source.data.meta?.messageRevision ?? 0) !== 0
  ) {
    throw pluginContinuationConflict();
  }
  if (
    !(
      sameThread(input.sourceThread, local.threadContext) &&
      sameThread(input.replyThread, b.threadContext)
    )
  ) {
    throw pluginContinuationConflict();
  }
}

function assertNativePluginContinuationSource(input: {
  binding: PluginConnectionContinuationBinding;
  source: Extract<SignalEnvelope, { type: "signal.text" }>;
  reply: Extract<SignalEnvelope, { type: "signal.text" }>;
  delivery: RemoteAgentNativeDeliveryRecord;
  sourceThread: SpaceThreadContext | null;
  replyThread: SpaceThreadContext | null;
}) {
  const { binding: b, source, reply, delivery } = input;
  const request = delivery.executionRecoverySubmitRequest;
  const sender = request?.turnEnvelope.sender;
  // Native admission retires the Space conveyor. Its retained execution
  // request owns accepted identity; do not reconstruct a dispatch payload.
  // Older native requests do not retain the raw message envelope, so an
  // edited original must be sent again rather than guessed from rendered text.
  if (
    !request ||
    delivery.organizationId !== b.organizationId ||
    delivery.spaceId !== b.spaceId ||
    delivery.dispatchId !== b.sourceDispatchId ||
    delivery.profileId !== b.targetProfileId ||
    delivery.triggerMessageId !== source.id ||
    delivery.publishedSignalId !== reply.id ||
    delivery.status !== "completed" ||
    delivery.failureCode !== null ||
    delivery.completedAtMs === null ||
    delivery.conversationKind !== "space" ||
    delivery.routineRunId ||
    request.organizationId !== b.organizationId ||
    request.spaceId !== b.spaceId ||
    request.dispatchId !== b.sourceDispatchId ||
    request.triggerMessageId !== source.id ||
    request.agentProfileId !== b.targetProfileId ||
    request.bindingId !== delivery.bindingId ||
    request.author.profileKind !== "human" ||
    request.author.profileId !== b.requesterProfileId ||
    sender?.kind !== "member" ||
    !sender.verified ||
    sender.ownerUserId !== b.requesterUserId ||
    sender.profileId !== b.requesterProfileId ||
    source.data.meta?.editedAt ||
    (source.data.meta?.messageRevision ?? 0) !== 0 ||
    source.ts > delivery.createdAtMs ||
    !sameThread(input.sourceThread, delivery.threadContext) ||
    !sameThread(input.replyThread, b.threadContext)
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
      value.approvedActionRequestId ?? null,
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
