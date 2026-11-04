import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type {
  ChannelContext,
  MessageChannelConversationLocator,
} from "@openmeld/schemas/types";
import { enabledFeishuHistoryGroups } from "../infrastructure/postgresql/feishu-group-history-settings";
import {
  type RemoteAgentLarkPlatformChannelConnectionRecord,
  readRemoteAgentLarkPlatformChannelCredentials,
} from "../infrastructure/postgresql/lark-platform-channel-connection-repo";
import {
  decryptLarkPlatformCredential,
  LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION,
} from "./lark-platform-credential-crypto";
import { publishLarkPlatformFile } from "./lark-platform-file-publication";
import {
  createLarkPlatformStreamingCard,
  downloadLarkPlatformMessageResource,
  finalizeLarkPlatformStreamingCard,
  listFeishuHistoryGroups,
  notifyFeishuHistoryGroup,
  publishLarkPlatformCardReference,
  publishLarkPlatformIdentityLinkCard,
  publishLarkPlatformNavigationActionCard,
  publishLarkPlatformReply,
  readFeishuRequesterHistory,
  readLarkPlatformChannelContext,
  readLarkPlatformPluginSourceProof,
  updateLarkPlatformStreamingCardContent,
} from "./lark-platform-openapi-client";
import type {
  LarkPlatformMessageChannelProvider,
  MessageChannelProviderAdapter,
  MessageChannelPublicationResult,
} from "./message-channel-adapters";
import { buildMessageChannelProviderPublicationUuid } from "./provider-publication-uuid";

type LarkPlatformConversationLocator = Extract<
  MessageChannelConversationLocator,
  {
    provider: "feishu" | "lark";
  }
>;
export function createLarkPlatformMessageChannelAdapter(input: {
  cryptoKey?: string;
  db: PostgresDatabase;
  fetchImpl?: typeof fetch;
  provider: LarkPlatformMessageChannelProvider;
}): MessageChannelProviderAdapter {
  const readAppSecret = async (
    connection: RemoteAgentLarkPlatformChannelConnectionRecord
  ): Promise<string | null> => {
    const credentials = await readRemoteAgentLarkPlatformChannelCredentials({
      connectionId: connection.connectionId,
      db: input.db,
    });
    if (
      !credentials ||
      credentials.connectionId !== connection.connectionId ||
      credentials.credentialFormatVersion !==
        LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION ||
      !input.cryptoKey?.trim()
    ) {
      return null;
    }
    try {
      return await decryptLarkPlatformCredential({
        credentialName: "app secret",
        cryptoKey: input.cryptoKey,
        encryptedCredential: credentials.encryptedAppSecret,
      });
    } catch (error) {
      console.error(
        "[core.message_channel.connection_credential_decryption_failed]",
        {
          connectionId: connection.connectionId,
          error: toErrorMessage(error),
          provider: input.provider,
        }
      );
      return null;
    }
  };
  const publishText = async (publication: {
    connection: RemoteAgentLarkPlatformChannelConnectionRecord;
    locator: MessageChannelConversationLocator;
    providerPublicationIdempotencyKey: string;
    text: string;
  }): Promise<MessageChannelPublicationResult> => {
    const locator = requireMatchingLocator({
      connection: publication.connection,
      locator: publication.locator,
      provider: input.provider,
    });
    if (!locator) {
      return {
        reasonCode: `${input.provider}.publication_target_mismatch`,
        status: "failed",
      };
    }
    const appSecret = await readAppSecret(publication.connection);
    if (!appSecret) {
      return {
        reasonCode: `${input.provider}.connection_credentials_unavailable`,
        status: "failed",
      };
    }
    return await publishLarkPlatformReply({
      appId: publication.connection.appId,
      appSecret,
      fetchImpl: input.fetchImpl,
      messageId: locator.rootMessageId,
      provider: input.provider,
      providerPublicationIdempotencyKey:
        publication.providerPublicationIdempotencyKey,
      replyInThread: locator.threadId !== null,
      text: publication.text,
    });
  };
  return {
    provider: input.provider,
    async readPluginSourceProof(request) {
      const locator = requireMatchingLocator({
        ...request,
        provider: input.provider,
      });
      if (!locator) {
        return null;
      }
      const appSecret = await readAppSecret(request.connection);
      if (!appSecret) {
        throw new Error("plugin.channel.provider_access_unavailable");
      }
      return await readLarkPlatformPluginSourceProof({
        appId: request.connection.appId,
        appSecret,
        botOpenId: request.connection.botOpenId,
        provider: input.provider,
        messageId: request.messageId,
        chatId: locator.chatId,
        rootMessageId: locator.rootMessageId,
        fetchImpl: input.fetchImpl,
      });
    },
    async createWorkingCard(publication) {
      const locator = requireMatchingLocator({
        connection: publication.connection,
        locator: publication.locator,
        provider: input.provider,
      });
      if (!locator) {
        return {
          reasonCode: `${input.provider}.card_create_target_mismatch`,
          status: "failed",
        };
      }
      const appSecret = await readAppSecret(publication.connection);
      if (!appSecret) {
        return {
          reasonCode: `${input.provider}.connection_credentials_unavailable`,
          status: "failed",
        };
      }
      return await createLarkPlatformStreamingCard({
        stopDeliveryId: publication.stopDeliveryId,
        appId: publication.connection.appId,
        appSecret,
        fetchImpl: input.fetchImpl,
        initialText: publication.initialText,
        provider: input.provider,
      });
    },
    async downloadResource(download) {
      const locator = requireMatchingLocator({
        connection: download.connection,
        locator: download.locator,
        provider: input.provider,
      });
      if (
        !locator ||
        (download.resource.type !== "image" &&
          download.resource.type !== "file")
      ) {
        return {
          reasonCode: `${input.provider}.message_resource_unsupported`,
          status: "failed",
        };
      }
      const appSecret = await readAppSecret(download.connection);
      if (!appSecret) {
        return {
          reasonCode: `${input.provider}.connection_credentials_unavailable`,
          status: "failed",
        };
      }
      return await downloadLarkPlatformMessageResource({
        appId: download.connection.appId,
        appSecret,
        fetchImpl: input.fetchImpl,
        fileKey: download.resource.fileKey,
        maxBytes: download.maxBytes,
        messageId: download.messageId,
        provider: input.provider,
        resourceType: download.resource.type,
      });
    },
    async publishIdentityLinkGuidance(publication) {
      if (
        publication.connection.provider !== input.provider ||
        publication.connection.status !== "connected"
      ) {
        return {
          reasonCode: `${input.provider}.identity_link_target_mismatch`,
          status: "failed",
        };
      }
      const appSecret = await readAppSecret(publication.connection);
      if (!appSecret) {
        return {
          reasonCode: `${input.provider}.connection_credentials_unavailable`,
          status: "failed",
        };
      }
      return await publishLarkPlatformIdentityLinkCard({
        appId: publication.connection.appId,
        appSecret,
        fetchImpl: input.fetchImpl,
        linkUrl: publication.linkUrl,
        organizationName: publication.organizationName,
        provider: input.provider,
        purpose: publication.purpose,
        providerPublicationIdempotencyKey:
          publication.providerPublicationIdempotencyKey,
        providerUserId: publication.providerUserId,
        ...(publication.requestedAction
          ? { requestedAction: publication.requestedAction }
          : {}),
      });
    },
    async publishPrivateNavigationGuidance(publication) {
      if (
        publication.connection.provider !== input.provider ||
        publication.connection.status !== "connected"
      ) {
        return {
          reasonCode: `${input.provider}.navigation_action_target_mismatch`,
          status: "failed",
        };
      }
      const appSecret = await readAppSecret(publication.connection);
      if (!appSecret) {
        return {
          reasonCode: `${input.provider}.connection_credentials_unavailable`,
          status: "failed",
        };
      }
      return await publishLarkPlatformNavigationActionCard({
        action: publication.action,
        appId: publication.connection.appId,
        appSecret,
        fetchImpl: input.fetchImpl,
        provider: input.provider,
        providerPublicationIdempotencyKey:
          publication.providerPublicationIdempotencyKey,
        providerUserId: publication.providerUserId,
        text: publication.text,
      });
    },
    async publishFailure(publication) {
      return await publishText(publication);
    },
    async publishReply(publication) {
      if (publication.attachments.length > 0) {
        return {
          reasonCode: `${input.provider}.message_reply_attachments_not_supported`,
          status: "failed",
        };
      }
      return await publishText(publication);
    },
    async publishFile(publication) {
      const locator = requireMatchingLocator({
        connection: publication.connection,
        locator: publication.locator,
        provider: input.provider,
      });
      if (!locator) {
        return {
          status: "failed",
          reasonCode: `${input.provider}.publication_target_mismatch`,
        };
      }
      const appSecret = await readAppSecret(publication.connection);
      if (!appSecret) {
        return {
          status: "failed",
          reasonCode: `${input.provider}.connection_credentials_unavailable`,
        };
      }
      return publishLarkPlatformFile({
        appId: publication.connection.appId,
        appSecret,
        bytes: publication.bytes,
        fileName: publication.fileName,
        messageId: locator.rootMessageId,
        provider: input.provider,
        providerPublicationIdempotencyKey:
          publication.providerPublicationIdempotencyKey,
        replyInThread: locator.threadId !== null,
        fetchImpl: input.fetchImpl,
      });
    },
    async publishWorkingCard(publication) {
      const locator = requireMatchingLocator({
        connection: publication.connection,
        locator: publication.locator,
        provider: input.provider,
      });
      if (!locator) {
        return {
          reasonCode: `${input.provider}.card_send_target_mismatch`,
          status: "failed",
        };
      }
      const appSecret = await readAppSecret(publication.connection);
      if (!appSecret) {
        return {
          reasonCode: `${input.provider}.connection_credentials_unavailable`,
          status: "failed",
        };
      }
      return await publishLarkPlatformCardReference({
        appId: publication.connection.appId,
        appSecret,
        cardId: publication.cardId,
        fetchImpl: input.fetchImpl,
        messageId: locator.rootMessageId,
        provider: input.provider,
        providerPublicationIdempotencyKey:
          publication.providerPublicationIdempotencyKey,
        replyInThread: locator.threadId !== null,
      });
    },
    async notifyFeishuHistoryGroup(connection, chatId) {
      const secret = await readAppSecret(connection);
      if (
        input.provider !== "feishu" ||
        connection.provider !== "feishu" ||
        !secret
      ) {
        throw new Error("Feishu group is unavailable.");
      }
      const uuid = await buildMessageChannelProviderPublicationUuid({
        provider: "feishu",
        publicationKind: "group-history-notice",
        deliveryId: JSON.stringify([
          connection.connectionId,
          connection.connectionGeneration,
          chatId,
        ]),
      });
      await notifyFeishuHistoryGroup(
        {
          appId: connection.appId,
          appSecret: secret,
          fetchImpl: input.fetchImpl,
        },
        chatId,
        uuid
      );
    },
    async listFeishuHistoryGroups(connection, pageToken) {
      if (
        input.provider !== "feishu" ||
        connection.provider !== "feishu" ||
        connection.status !== "connected"
      ) {
        throw new Error("Feishu is not connected.");
      }
      const appSecret = await readAppSecret(connection);
      if (!appSecret) {
        throw new Error("Feishu app credentials are unavailable.");
      }
      return listFeishuHistoryGroups(
        { appId: connection.appId, appSecret, fetchImpl: input.fetchImpl },
        pageToken
      );
    },
    async readFeishuRequesterHistory({ connection, locator, ...request }) {
      if (
        input.provider !== "feishu" ||
        !requireMatchingLocator({ connection, locator, provider: "feishu" })
      ) {
        return { status: "forbidden" };
      }
      const appSecret = await readAppSecret(connection);
      if (!appSecret) {
        return { status: "unavailable" };
      }
      return readFeishuRequesterHistory({
        ...request,
        appId: connection.appId,
        appSecret,
        chatId: locator.chatId,
        rootMessageId: locator.rootMessageId,
        fetchImpl: input.fetchImpl,
      });
    },
    async readChannelContext(contextInput): Promise<ChannelContext> {
      if (contextInput.event.kind !== "message") {
        throw new Error(
          `${input.provider} Message Channel context requires a message event`
        );
      }
      const locator = requireMatchingLocator({
        connection: contextInput.connection,
        locator: contextInput.event.locator,
        provider: input.provider,
      });
      if (!locator) {
        throw new Error(
          `${input.provider} Message Channel context target does not match its connection`
        );
      }
      if (
        input.provider === "feishu" &&
        contextInput.event.mention === "group_mention"
      ) {
        const enabled = await enabledFeishuHistoryGroups(
          input.db,
          contextInput.connection,
          [locator.chatId]
        );
        if (!enabled.has(locator.chatId)) {
          return {
            provider: "feishu",
            conversationId: contextInput.conversationId,
            currentMessageId: contextInput.event.messageId,
            messages: [],
            sync: { mode: "snapshot", status: "forbidden" },
          };
        }
      }
      const appSecret = await readAppSecret(contextInput.connection);
      if (!appSecret) {
        throw new Error(
          `${input.provider} Message Channel context credentials are unavailable`
        );
      }
      return await readLarkPlatformChannelContext({
        appId: contextInput.connection.appId,
        appSecret,
        conversationId: contextInput.conversationId,
        currentEvent: { ...contextInput.event, locator },
        fetchImpl: input.fetchImpl,
        provider: input.provider,
      });
    },
    async updateWorkingCard(publication) {
      const locator = requireMatchingLocator({
        connection: publication.connection,
        locator: publication.locator,
        provider: input.provider,
      });
      if (!locator) {
        return {
          reasonCode: `${input.provider}.card_update_target_mismatch`,
          status: "failed",
        };
      }
      const appSecret = await readAppSecret(publication.connection);
      if (!appSecret) {
        return {
          reasonCode: `${input.provider}.connection_credentials_unavailable`,
          status: "failed",
        };
      }
      return await updateLarkPlatformStreamingCardContent({
        appId: publication.connection.appId,
        appSecret,
        cardId: publication.cardId,
        fetchImpl: input.fetchImpl,
        provider: input.provider,
        providerPublicationIdempotencyKey:
          publication.providerPublicationIdempotencyKey,
        sequence: publication.sequence,
        text: publication.text,
      });
    },
    async finalizeWorkingCard(publication) {
      const locator = requireMatchingLocator({
        connection: publication.connection,
        locator: publication.locator,
        provider: input.provider,
      });
      if (!locator) {
        return {
          reasonCode: `${input.provider}.card_finalize_target_mismatch`,
          status: "failed",
        };
      }
      const appSecret = await readAppSecret(publication.connection);
      if (!appSecret) {
        return {
          reasonCode: `${input.provider}.connection_credentials_unavailable`,
          status: "failed",
        };
      }
      return await finalizeLarkPlatformStreamingCard({
        replyDeliveryId: publication.replyDeliveryId,
        appId: publication.connection.appId,
        appSecret,
        cardId: publication.cardId,
        fetchImpl: input.fetchImpl,
        provider: input.provider,
        providerPublicationIdempotencyKey:
          publication.providerPublicationIdempotencyKey,
        sequence: publication.sequence,
        outcome: publication.outcome,
        text: publication.text,
      });
    },
  };
}
function toErrorMessage(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}
function requireMatchingLocator(input: {
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  locator: MessageChannelConversationLocator;
  provider: LarkPlatformMessageChannelProvider;
}): LarkPlatformConversationLocator | null {
  const locator = input.locator;
  if (
    (locator.provider !== "lark" && locator.provider !== "feishu") ||
    locator.provider !== input.provider ||
    input.connection.provider !== input.provider ||
    input.connection.status !== "connected" ||
    locator.connectionId !== input.connection.connectionId ||
    locator.appId !== input.connection.appId ||
    locator.tenantKey !== input.connection.tenantKey
  ) {
    return null;
  }
  return locator;
}
