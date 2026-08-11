import type { CoreBindings } from "../../lib/bindings";
import { createLarkPlatformMessageChannelAdapter } from "./lark-platform-message-channel-adapter";
import {
  createMessageChannelProviderRegistry,
  type MessageChannelProviderAdapter,
  type MessageChannelProviderRegistry,
} from "./message-channel-adapters";

export function createConfiguredMessageChannelProviderRegistry(input: {
  db: D1Database;
  env: Pick<
    CoreBindings,
    | "OPENMELD_FEISHU_CHANNEL_ENABLED"
    | "OPENMELD_LARK_CHANNEL_ENABLED"
    | "LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY"
  >;
  fetchImpl?: typeof fetch;
}): MessageChannelProviderRegistry | undefined {
  const adapters: MessageChannelProviderAdapter[] = [];
  if (isEnabled(input.env.OPENMELD_LARK_CHANNEL_ENABLED)) {
    adapters.push(
      createLarkPlatformMessageChannelAdapter({
        cryptoKey: input.env.LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY,
        db: input.db,
        fetchImpl: input.fetchImpl,
        provider: "lark",
      })
    );
  }
  if (isEnabled(input.env.OPENMELD_FEISHU_CHANNEL_ENABLED)) {
    adapters.push(
      createLarkPlatformMessageChannelAdapter({
        cryptoKey: input.env.LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY,
        db: input.db,
        fetchImpl: input.fetchImpl,
        provider: "feishu",
      })
    );
  }
  return adapters.length > 0
    ? createMessageChannelProviderRegistry(adapters)
    : undefined;
}

function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}
