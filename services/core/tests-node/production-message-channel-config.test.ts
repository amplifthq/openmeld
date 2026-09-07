import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeUrl } from "node:url";
import { describe, expect, it } from "vitest";
import { parseJsoncObject } from "../../../packages/db/src/tooling/parse-jsonc";
import { listLarkPlatformProvidersEnabledForOrganization } from "../src/remote-agent/application/lark-platform-provider-policy";
import { REMOTE_AGENT_MESSAGE_CHANNEL_EVENT_MAX_QUEUE_ATTEMPTS } from "../src/remote-agent/application/message-channel-event-service";

type QueueConsumerConfig = {
  max_retries?: number;
  queue?: string;
};

type CoreWranglerConfig = {
  env?: {
    prod?: {
      queues?: { consumers?: QueueConsumerConfig[] };
      vars?: Record<string, string>;
    };
  };
  queues?: { consumers?: QueueConsumerConfig[] };
  vars?: Record<string, string>;
};

const config = parseJsoncObject<CoreWranglerConfig>(
  readFileSync(
    fileURLToPath(new NodeUrl("../wrangler.jsonc", import.meta.url)),
    "utf8"
  )
);

describe("production Message Channel configuration", () => {
  it("makes Lark and Feishu available to every local and production Organization", () => {
    expect(config.env?.prod?.vars).toMatchObject({
      OPENMELD_FEISHU_CHANNEL_ENABLED: "true",
      OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS: "*",
      OPENMELD_LARK_CHANNEL_ENABLED: "true",
      OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS: "*",
    });
    expect(config.vars).toMatchObject({
      OPENMELD_FEISHU_CHANNEL_ENABLED: "true",
      OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS: "*",
      OPENMELD_LARK_CHANNEL_ENABLED: "true",
      OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS: "*",
    });
    for (const vars of [config.vars, config.env?.prod?.vars]) {
      expect(
        listLarkPlatformProvidersEnabledForOrganization({
          env: vars ?? {},
          organizationId: "any-organization",
        })
      ).toEqual(["lark", "feishu"]);
    }
  });

  it("keeps Cloudflare delivery retries aligned with the terminal ingress budget", () => {
    const expectedMaxRetries =
      REMOTE_AGENT_MESSAGE_CHANNEL_EVENT_MAX_QUEUE_ATTEMPTS - 1;

    expect(
      readMessageChannelMaxRetries(
        config.queues?.consumers,
        "openmeld-message-channel-events"
      )
    ).toBe(expectedMaxRetries);
    expect(
      readMessageChannelMaxRetries(
        config.env?.prod?.queues?.consumers,
        "openmeld-message-channel-events-prod"
      )
    ).toBe(expectedMaxRetries);
  });
});

function readMessageChannelMaxRetries(
  consumers: QueueConsumerConfig[] | undefined,
  queueName: string
): number | undefined {
  return consumers?.find((consumer) => consumer.queue === queueName)
    ?.max_retries;
}
