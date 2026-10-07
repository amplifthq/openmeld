import {
  type PluginChannelSelection,
  pluginChannelContinueResponseSchema,
  pluginChannelContinueRpcInputSchema,
  pluginChannelRequestPreviewSchema,
} from "@openmeld/schemas";
import { digestCanonicalJson } from "@openmeld/utils";
import { listConnectorOperationReceiptsForContinuation } from "../center-agent/connector-action-operation-repository";
import type { CoreBindings } from "../lib/bindings";
import {
  discardFrozenContextScopeForNewTurn,
  parseCoreOwnedRemoteAgentTurnEnvelope,
} from "../remote-agent/application/center-agent-context-scope";
import { submitRemoteAgentMessageChannelNativeDelivery } from "../remote-agent/application/message-channel-native-delivery-service";
import { submitRemoteAgentSlackNativeDelivery } from "../remote-agent/application/native-delivery-service";
import { selectPluginChannelAccount } from "../remote-agent/infrastructure/postgresql/plugin-channel-metadata-repo";
import { selectActiveConnectorConnection } from "./connector-connection-repository";
import { requireRemotePluginConnection } from "./plugin-access";
import {
  channelContinuationDenied,
  type PluginChannelSource,
  readPluginChannelRequestSource,
  resolveCurrentPluginChannelTarget,
} from "./plugin-channel-source";

export async function previewPluginChannelConnection(
  env: CoreBindings,
  raw: unknown
) {
  const source = await readPluginChannelRequestSource(env, raw);
  const current = await resolveCurrentPluginChannelTarget(env, source);
  return pluginChannelRequestPreviewSchema.parse({
    requestId: source.delivery.deliveryId,
    service: source.intent.service,
    scope: source.intent.scope,
    provider: source.identity.provider,
    targetProfileName:
      current.kind === "slack"
        ? current.target.profileName
        : current.target.centerAgent.profileName,
    expiresAtMs: source.intent.expiresAtMs,
    selection: source.metadata.selection?.scope ?? null,
  });
}

export async function continuePluginChannelConnection(
  env: CoreBindings,
  raw: unknown
) {
  const input = pluginChannelContinueRpcInputSchema.parse(raw);
  const { scope: _scope, ...lookup } = input;
  const source = await readPluginChannelRequestSource(env, lookup);
  if (source.intent.scope !== "choose" && source.intent.scope !== input.scope) {
    throw channelContinuationDenied(
      "Personal and Organization accounts are not interchangeable for this request."
    );
  }
  const current = await resolveCurrentPluginChannelTarget(env, source);
  const selected = await requireSelectedConnection(source, input.scope);
  const receipts = await listConnectorOperationReceiptsForContinuation({
    db: source.identities,
    organizationId: source.member.organizationId,
    actorProfileId: source.delivery.profileId,
    representedUserId: source.member.userId,
    sourceSpaceId: source.delivery.spaceId,
    fromMs: source.delivery.createdAtMs,
    throughMs: source.delivery.completedAtMs ?? 0,
  });
  if (
    receipts.some(
      (receipt) =>
        receipt.status === "pending" || receipt.status === "outcome_unknown"
    )
  ) {
    throw channelContinuationDenied(
      "An earlier operation needs reconciliation. Do not repeat its write under a new operation ID."
    );
  }
  const selection: PluginChannelSelection = {
    sourceDeliveryId: source.delivery.deliveryId,
    organizationId: source.member.organizationId,
    requesterUserId: source.member.userId,
    requesterProfileId: input.context.actorContext.openMeldProfileId,
    targetProfileId: source.delivery.profileId,
    service: source.intent.service,
    scope: input.scope,
    connectionName: selected.connectionName,
    connectionUpdatedAtMs: selected.updatedAtMs,
    continuationTriggerId: `plugin-channel-continue:${await digestCanonicalJson([source.member.organizationId, source.delivery.deliveryId, source.member.userId])}`,
  };
  // Read the full current original from the provider immediately before accepting
  // a new continuation. This is not a cross-provider atomic transaction.
  await current.readProof();
  await selectPluginChannelAccount(
    source.db,
    source.delivery.deliveryId,
    selection
  );
  const text = [
    "Continue only the remaining work from my original request after Plugin setup.",
    `Use the ${selection.scope === "shared" ? "Organization" : "personal"} ${selection.service} connection I explicitly selected.`,
    "Keep completed results. Do not repeat completed writes; reconcile unknown outcomes with the original operation ID.",
    ...receipts.map((receipt) => JSON.stringify(receipt)),
    "Original request:",
    ...source.request.messages.map((message) => message.content),
  ].join("\n");
  const result = await submitContinuation(
    env,
    source,
    current,
    selection,
    text
  );
  if (result.status !== "submitted") {
    throw channelContinuationDenied(
      "The continuation was not confirmed as submitted. Retry this same request to inspect its existing delivery; do not start another write.",
      503
    );
  }
  return pluginChannelContinueResponseSchema.parse({
    status: "requested",
    requestId: source.delivery.deliveryId,
    targetProfileId: source.delivery.profileId,
    provider: source.identity.provider,
  });
}

async function requireSelectedConnection(
  source: PluginChannelSource,
  scope: "member" | "shared"
) {
  const selected = await selectActiveConnectorConnection({
    db: source.identities,
    organizationId: source.member.organizationId,
    preference: scope === "member" ? "requester" : "shared",
    requesterUserId: source.member.userId,
    service: source.intent.service,
  });
  if (!selected) {
    throw channelContinuationDenied(
      "The selected Plugin is not connected yet."
    );
  }
  const locked = source.metadata.selection;
  if (
    locked &&
    (locked.scope !== scope ||
      locked.connectionName !== selected.connection.connectionName ||
      locked.connectionUpdatedAtMs !== selected.connection.updatedAtMs)
  ) {
    throw channelContinuationDenied(
      "This continuation is already bound to a different connection or version."
    );
  }
  await requireRemotePluginConnection({
    db: source.identities,
    organizationId: source.member.organizationId,
    requesterUserId: source.member.userId,
    service: source.intent.service,
    connectionName: selected.connection.connectionName,
    effect: "read",
  });
  return selected.connection;
}

async function submitContinuation(
  env: CoreBindings,
  source: PluginChannelSource,
  current: Awaited<ReturnType<typeof resolveCurrentPluginChannelTarget>>,
  selection: PluginChannelSelection,
  sourceText: string
) {
  const original = source.request;
  const originalEnvelope = discardFrozenContextScopeForNewTurn(
    original.turnEnvelope
  );
  const baseEnvelope = {
    ...originalEnvelope,
    interactionEnvironment:
      original.turnEnvelope.interactionEnvironment ??
      original.turnEnvelope.contextScopePlan?.interactionEnvironment,
  };
  if (current.kind === "slack") {
    const turnEnvelope = parseCoreOwnedRemoteAgentTurnEnvelope({
      ...baseEnvelope,
      sender: {
        ...source.sender,
        id: source.member.memberId,
        profileId: selection.requesterProfileId,
        role: source.member.role,
        verified: true,
      },
    });
    return await submitRemoteAgentSlackNativeDelivery({
      db: source.db,
      env,
      nowMs: Date.now(),
      request: {
        agentProfileId: source.delivery.profileId,
        agentProfileOwnerUserId: current.target.ownerUserId,
        author: {
          profileId: selection.requesterProfileId,
          profileKind: "human",
          displayName: source.sender.displayName,
        },
        bindingId: source.delivery.bindingId,
        conversationId: source.delivery.spaceId,
        dispatchId: selection.continuationTriggerId,
        idempotencyKey: selection.continuationTriggerId,
        modelRoute: current.target.modelRoute,
        organizationId: source.member.organizationId,
        slackTeamId: current.slackTeamId,
        slackChannelId: current.slackChannelId,
        slackThreadTs: current.slackThreadTs,
        triggerMessageId: source.metadata.proof.messageId,
        triggerText: source.delivery.triggerText ?? sourceText,
        sourceText,
        speakerMember: {
          memberId: source.member.memberId,
          userId: source.member.userId,
        },
        turnEnvelope,
        pluginSelection: selection,
        pluginSourceProof: source.metadata.proof,
      },
    });
  }
  if (current.target.participant.kind !== "member") {
    throw channelContinuationDenied("The original member is unavailable.");
  }
  const member = current.target.participant.member;
  const turnEnvelope = parseCoreOwnedRemoteAgentTurnEnvelope({
    ...baseEnvelope,
    organization: {
      ...originalEnvelope.organization,
      memberCount: member.memberCount,
      name: member.organizationName,
      personal: member.organizationPersonal,
    },
    centerAgent: {
      ...originalEnvelope.centerAgent,
      profileHandle: current.target.centerAgent.profileHandle,
      profileName: current.target.centerAgent.profileName,
    },
    sender: {
      ...source.sender,
      id: member.memberId,
      displayName: member.userDisplayName,
      ownerUserId: member.userId,
      profileId: member.humanProfileId ?? undefined,
      role: member.role ?? undefined,
      verified: true,
    },
    channelContext: {
      ...originalEnvelope.channelContext,
      currentMessageId: selection.continuationTriggerId,
    },
  });
  return await submitRemoteAgentMessageChannelNativeDelivery({
    db: source.db,
    env,
    nowMs: Date.now(),
    registry: current.registry,
    request: {
      locator: current.locator,
      sourceText,
      target: current.target,
      triggerMessageId: selection.continuationTriggerId,
      turnEnvelope,
      pluginSelection: selection,
      pluginSourceProof: source.metadata.proof,
    },
  });
}
