import type { MessageChannelProvider } from "@openmeld/schemas/types";

const MESSAGE_CHANNEL_PROVIDER_NAMES = {
  slack: "Slack",
  lark: "Lark",
  feishu: "Feishu",
} as const satisfies Record<MessageChannelProvider, string>;

export function formatMessageChannelProviderName(
  provider: MessageChannelProvider
): (typeof MESSAGE_CHANNEL_PROVIDER_NAMES)[MessageChannelProvider] {
  return MESSAGE_CHANNEL_PROVIDER_NAMES[provider];
}
