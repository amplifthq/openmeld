import { describe, expect, it } from "vitest";
import { buildMessageChannelProviderPublicationUuid } from "../src/remote-agent/application/provider-publication-uuid";

const RFC_4122_VERSION_5_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe("Message Channel provider publication UUID", () => {
  it("is stable, bounded, and RFC 4122 version 5", async () => {
    const input = {
      deliveryId: "remote-agent-message-channel-delivery:v1|4:lark|7:event_1",
      provider: "lark" as const,
      publicationKind: "final" as const,
    };

    const first = await buildMessageChannelProviderPublicationUuid(input);
    const second = await buildMessageChannelProviderPublicationUuid(input);

    expect(first).toBe(second);
    expect(first).toMatch(RFC_4122_VERSION_5_UUID);
    expect(first).toHaveLength(36);
  });

  it("isolates the same delivery identity across providers", async () => {
    const deliveryId =
      "remote-agent-message-channel-delivery:v1|17:connection_shared";
    const lark = await buildMessageChannelProviderPublicationUuid({
      deliveryId,
      provider: "lark",
      publicationKind: "final",
    });
    const feishu = await buildMessageChannelProviderPublicationUuid({
      deliveryId,
      provider: "feishu",
      publicationKind: "final",
    });

    expect(lark).not.toBe(feishu);
    expect(lark).toMatch(RFC_4122_VERSION_5_UUID);
    expect(feishu).toMatch(RFC_4122_VERSION_5_UUID);
  });

  it("isolates identity-link guidance from final reply publication", async () => {
    const deliveryId = "event_lark_1";
    const finalReply = await buildMessageChannelProviderPublicationUuid({
      deliveryId,
      provider: "lark",
      publicationKind: "final",
    });
    const identityLink = await buildMessageChannelProviderPublicationUuid({
      deliveryId,
      provider: "lark",
      publicationKind: "identity_link",
    });

    expect(identityLink).not.toBe(finalReply);
    expect(identityLink).toMatch(RFC_4122_VERSION_5_UUID);
  });

  it("gives working, stream, and final card writes separate stable identities", async () => {
    const deliveryId = "delivery_card_1";
    const publicationKinds = [
      "working",
      "stream:1",
      "stream:2",
      "final",
    ] as const;
    const publicationIds = await Promise.all(
      publicationKinds.map((publicationKind) =>
        buildMessageChannelProviderPublicationUuid({
          deliveryId,
          provider: "lark",
          publicationKind,
        })
      )
    );

    expect(new Set(publicationIds).size).toBe(publicationKinds.length);
    for (const publicationId of publicationIds) {
      expect(publicationId).toMatch(RFC_4122_VERSION_5_UUID);
    }
  });
});
