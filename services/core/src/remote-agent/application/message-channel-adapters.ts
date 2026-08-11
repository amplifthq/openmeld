import type { NavigationAction } from "@openmeld/schemas";
import type {
  ChannelContext,
  MessageChannelConversationLocator,
  MessageChannelProvider,
  MessageChannelResourceDescriptor,
  NormalizedMessageChannelEvent,
  SpaceMessageAttachment,
} from "@openmeld/schemas/types";
import type { RemoteAgentLarkPlatformChannelConnectionRecord } from "../infrastructure/d1/lark-platform-channel-connection-repo";

export type LarkPlatformMessageChannelProvider = Extract<
  MessageChannelProvider,
  "feishu" | "lark"
>;

export type MessageChannelPublicationResult =
  | {
      resultId: string;
      status: "published";
    }
  | {
      reasonCode: string;
      status: "outcome_unknown";
    }
  | {
      reasonCode: string;
      retryAfterMs?: number;
      status: "failed";
    };

export type MessageChannelCardCreationResult =
  | {
      cardId: string;
      status: "created";
    }
  | {
      reasonCode: string;
      status: "outcome_unknown";
    }
  | {
      reasonCode: string;
      retryAfterMs?: number;
      status: "failed";
    };

export type MessageChannelCardMutationResult =
  | {
      status: "published";
    }
  | {
      reasonCode: string;
      status: "outcome_unknown";
    }
  | {
      reasonCode: string;
      retryAfterMs?: number;
      status: "failed";
    };

export type MessageChannelResourceDownloadResult =
  | {
      bytes: Uint8Array;
      contentType: string | null;
      status: "downloaded";
    }
  | {
      reasonCode: string;
      status: "failed" | "retryable";
    };

type MessageChannelAdapterTarget = {
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  locator: MessageChannelConversationLocator;
  providerPublicationIdempotencyKey: string;
};

export type MessageChannelProviderAdapter = {
  provider: LarkPlatformMessageChannelProvider;
  createWorkingCard(input: {
    connection: RemoteAgentLarkPlatformChannelConnectionRecord;
    initialText: string;
    locator: MessageChannelConversationLocator;
  }): Promise<MessageChannelCardCreationResult>;
  downloadResource(input: {
    connection: RemoteAgentLarkPlatformChannelConnectionRecord;
    locator: MessageChannelConversationLocator;
    maxBytes: number;
    messageId: string;
    resource: MessageChannelResourceDescriptor;
  }): Promise<MessageChannelResourceDownloadResult>;
  publishIdentityLinkGuidance(input: {
    connection: RemoteAgentLarkPlatformChannelConnectionRecord;
    linkUrl: string;
    organizationName?: string;
    purpose?: "continue_request" | "optional_setup";
    providerPublicationIdempotencyKey: string;
    providerUserId: string;
    requestedAction?: string;
  }): Promise<MessageChannelPublicationResult>;
  publishPrivateNavigationGuidance(input: {
    action: NavigationAction;
    connection: RemoteAgentLarkPlatformChannelConnectionRecord;
    providerPublicationIdempotencyKey: string;
    providerUserId: string;
    text: string;
  }): Promise<MessageChannelPublicationResult>;
  publishFailure(
    input: MessageChannelAdapterTarget & {
      failureCode: string;
      text: string;
    }
  ): Promise<MessageChannelPublicationResult>;
  publishReply(
    input: MessageChannelAdapterTarget & {
      attachments: readonly SpaceMessageAttachment[];
      text: string;
    }
  ): Promise<MessageChannelPublicationResult>;
  publishWorkingCard(
    input: MessageChannelAdapterTarget & {
      cardId: string;
    }
  ): Promise<MessageChannelPublicationResult>;
  readChannelContext(input: {
    connection: RemoteAgentLarkPlatformChannelConnectionRecord;
    conversationId: string;
    event: NormalizedMessageChannelEvent;
  }): Promise<ChannelContext>;
  updateWorkingCard(input: {
    cardId: string;
    connection: RemoteAgentLarkPlatformChannelConnectionRecord;
    locator: MessageChannelConversationLocator;
    providerPublicationIdempotencyKey: string;
    sequence: number;
    text: string;
  }): Promise<MessageChannelCardMutationResult>;
  finalizeWorkingCard(input: {
    cardId: string;
    connection: RemoteAgentLarkPlatformChannelConnectionRecord;
    locator: MessageChannelConversationLocator;
    providerPublicationIdempotencyKey: string;
    sequence: number;
    text: string;
  }): Promise<MessageChannelCardMutationResult>;
};

export type MessageChannelProviderRegistry = {
  require(
    provider: LarkPlatformMessageChannelProvider
  ): MessageChannelProviderAdapter;
};

export function createMessageChannelProviderRegistry(
  adapters: readonly MessageChannelProviderAdapter[]
): MessageChannelProviderRegistry {
  const byProvider = new Map<
    LarkPlatformMessageChannelProvider,
    MessageChannelProviderAdapter
  >();
  for (const adapter of adapters) {
    if (byProvider.has(adapter.provider)) {
      throw new Error(
        `Message Channel provider ${adapter.provider} is registered more than once`
      );
    }
    byProvider.set(adapter.provider, adapter);
  }
  return {
    require(provider) {
      const adapter = byProvider.get(provider);
      if (!adapter) {
        throw new Error(
          `Message Channel provider ${provider} is not registered`
        );
      }
      return adapter;
    },
  };
}
