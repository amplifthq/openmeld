import { pluginChannelRequestRpcInputSchema } from "@openmeld/schemas";
import {
  type CoreBindings,
  identityDb,
  localStateDb,
  wakeEvidenceDb,
} from "../lib/bindings";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { createConfiguredMessageChannelProviderRegistry } from "../remote-agent/application/message-channel-provider-runtime";
import {
  resolveMessageChannelCenterAgentTarget,
  resolveMessageChannelTurnTarget,
} from "../remote-agent/application/message-channel-turn-resolution";
import {
  assertPluginChannelSourceUnchanged,
  buildPluginChannelSourceProof,
} from "../remote-agent/application/plugin-channel-source-proof";
import { resolveSlackBotToken } from "../remote-agent/application/slack-bot-token";
import {
  isSlackFullWorkspaceMember,
  readSlackMessageByTimestamp,
  readSlackUserIdentity,
} from "../remote-agent/application/slack-client";
import { readRemoteAgentNativeDeliveryByDeliveryId } from "../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { readPluginChannelMetadata } from "../remote-agent/infrastructure/d1/plugin-channel-metadata-repo";
import { readSlackUserIdentityLink } from "../remote-agent/infrastructure/d1/slack-user-identity-link-repo";
import { readRemoteAgentSlackWorkspaceBinding } from "../remote-agent/infrastructure/d1/slack-workspace-binding-repo";
import { createCoreRpcHttpError } from "../rpc/errors";

export function channelContinuationDenied(reason: string, status = 409) {
  return createCoreRpcHttpError({
    status,
    code: "plugin.channel.continuation_unavailable",
    reason,
  });
}

/** Authenticated human-only projection over the existing native delivery. A
 * shared/copyable request ID never grants access to another person's task. */
export async function readPluginChannelRequestSource(
  env: CoreBindings,
  raw: unknown
) {
  const input = pluginChannelRequestRpcInputSchema.parse(raw);
  const context = input.context;
  if (context.actorContext.profileKind !== "human") {
    throw channelContinuationDenied(
      "Continue from the account that made the original request.",
      403
    );
  }
  const member = await resolveActiveOrganizationMembership({ env, context });
  if (!member.ok || member.organizationId !== input.expectedOrganizationId) {
    throw channelContinuationDenied(
      "The current Organization membership does not match this request.",
      403
    );
  }
  const db = wakeEvidenceDb(env);
  const identities = identityDb(env);
  const state = localStateDb(env);
  if (!(db && identities && state)) {
    throw channelContinuationDenied(
      "The original task cannot be checked right now.",
      503
    );
  }
  const delivery = await readRemoteAgentNativeDeliveryByDeliveryId({
    db,
    deliveryId: input.requestId,
  });
  if (
    !delivery ||
    delivery.organizationId !== member.organizationId ||
    delivery.status !== "completed" ||
    delivery.failureCode ||
    delivery.routineRunId ||
    delivery.completedAtMs === null ||
    delivery.conversationKind === "space"
  ) {
    throw channelContinuationDenied(
      "This is not a completed, eligible channel request."
    );
  }
  const request =
    delivery.executionRecoverySubmitRequest ?? delivery.workerSubmitRequest;
  const sender = request?.turnEnvelope.sender;
  if (
    !request ||
    sender?.kind !== "member" ||
    !sender.verified ||
    sender.ownerUserId !== member.userId ||
    request.author.profileId !== context.actorContext.openMeldProfileId ||
    !sender.messageChannelIdentity
  ) {
    throw channelContinuationDenied(
      "Only the original requester can continue this task. Connect the matching provider account first.",
      403
    );
  }
  const metadata = await readPluginChannelMetadata(db, delivery.deliveryId);
  if (
    !metadata?.intent ||
    metadata.proof.provider !== sender.messageChannelIdentity.provider ||
    metadata.proof.providerUserId !==
      sender.messageChannelIdentity.providerUserId
  ) {
    throw channelContinuationDenied(
      "This reply has no bound Plugin setup request. Send a new request in the original conversation."
    );
  }
  if (metadata.intent.expiresAtMs <= Date.now()) {
    throw channelContinuationDenied(
      "This setup request has expired. Send a new request in the original conversation."
    );
  }
  return {
    input,
    member,
    db,
    identities,
    state,
    delivery,
    request,
    sender,
    metadata,
    intent: metadata.intent,
    identity: sender.messageChannelIdentity,
  };
}
export type PluginChannelSource = Awaited<
  ReturnType<typeof readPluginChannelRequestSource>
>;

export async function resolveCurrentPluginChannelTarget(
  env: CoreBindings,
  source: PluginChannelSource
) {
  if (source.identity.provider === "slack") {
    return await resolveSlackTarget(env, source);
  }
  const locator = source.delivery.messageChannelLocator;
  if (
    !locator ||
    locator.provider === "slack" ||
    locator.connectionId !== source.identity.connectionId ||
    locator.provider !== source.identity.provider
  ) {
    throw channelContinuationDenied("The original channel is unavailable.");
  }
  const resolution = await resolveMessageChannelTurnTarget({
    authWorker: env.OPENMELD_AUTH_WORKER,
    connectionId: locator.connectionId,
    identityDb: source.identities,
    stateDb: source.state,
    provider: locator.provider,
    providerUserId: source.identity.providerUserId,
    providerUserTenantKey: locator.tenantKey,
  });
  if (
    resolution.status !== "resolved" ||
    resolution.target.participant.kind !== "member" ||
    resolution.target.participant.member.userId !== source.member.userId ||
    resolution.target.participant.member.humanProfileId !==
      source.request.author.profileId ||
    resolution.target.connection.organizationId !==
      source.member.organizationId ||
    resolution.target.connection.appId !== locator.appId ||
    resolution.target.connection.tenantKey !== locator.tenantKey
  ) {
    throw channelContinuationDenied(
      "This provider account or channel is no longer connected to this member.",
      403
    );
  }
  assertSameAgent(source, resolution.target.centerAgent);
  const registry = createConfiguredMessageChannelProviderRegistry({
    db: source.state,
    env,
  });
  if (!registry) {
    throw channelContinuationDenied(
      "This Message Channel is not enabled.",
      503
    );
  }
  const adapter = registry.require(locator.provider);
  return {
    kind: "lark" as const,
    target: resolution.target,
    locator,
    registry,
    readProof: async () => {
      if (!adapter.readPluginSourceProof) {
        throw channelContinuationDenied(
          "The channel adapter cannot verify the original request yet.",
          503
        );
      }
      const proof = await adapter.readPluginSourceProof({
        connection: resolution.target.connection,
        locator,
        messageId: source.metadata.proof.messageId,
      });
      assertPluginChannelSourceUnchanged(source.metadata.proof, proof);
    },
  };
}

async function resolveSlackTarget(
  env: CoreBindings,
  source: PluginChannelSource
) {
  const { slackTeamId, slackChannelId, slackThreadTs } = source.delivery;
  if (
    !(slackTeamId && slackChannelId && slackThreadTs) ||
    source.identity.connectionId !== slackTeamId
  ) {
    throw channelContinuationDenied(
      "The original Slack conversation is unavailable."
    );
  }
  const workspace = await readRemoteAgentSlackWorkspaceBinding({
    db: source.state,
    slackTeamId,
  });
  const link = await readSlackUserIdentityLink({
    db: source.identities,
    slackTeamId,
    slackUserId: source.identity.providerUserId,
  });
  if (
    workspace?.organizationId !== source.member.organizationId ||
    link?.organizationId !== source.member.organizationId ||
    link.openmeldUserId !== source.member.userId
  ) {
    throw channelContinuationDenied(
      "This Slack account is no longer linked to the original requester.",
      403
    );
  }
  const resolved = await resolveMessageChannelCenterAgentTarget({
    db: source.identities,
    organizationId: source.member.organizationId,
  });
  if (!resolved.target) {
    throw channelContinuationDenied("The original Agent is unavailable.");
  }
  const target = resolved.target;
  assertSameAgent(source, target);
  const botToken = await resolveSlackBotToken({
    db: source.state,
    cryptoKey: env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    expectedOrganizationId: source.member.organizationId,
    slackTeamId,
  });
  const slackUser = await readSlackUserIdentity({
    botToken,
    userId: source.identity.providerUserId,
  });
  if (!isSlackFullWorkspaceMember({ identity: slackUser, slackTeamId })) {
    throw channelContinuationDenied(
      "The original Slack member no longer has workspace access.",
      403
    );
  }
  return {
    kind: "slack" as const,
    target,
    slackTeamId,
    slackChannelId,
    slackThreadTs,
    readProof: async () => {
      const { message } = await readSlackMessageByTimestamp({
        botToken,
        channelId: slackChannelId,
        messageTs: source.metadata.proof.messageId,
        threadTs: slackThreadTs,
      });
      const proof = message?.userId
        ? await buildPluginChannelSourceProof({
            provider: "slack",
            messageId: message.ts,
            providerUserId: message.userId,
            text: message.text ?? "",
            resourceIds: message.files.map((file) => file.fileId),
            revision: message.editedTs ?? null,
          })
        : null;
      assertPluginChannelSourceUnchanged(source.metadata.proof, proof);
    },
  };
}
function assertSameAgent(
  source: PluginChannelSource,
  target: { agentProfileId: string; bindingId: string }
) {
  if (
    target.agentProfileId !== source.delivery.profileId ||
    target.bindingId !== source.delivery.bindingId
  ) {
    throw channelContinuationDenied(
      "The original Agent or its execution connection changed. Send a new request instead."
    );
  }
}
