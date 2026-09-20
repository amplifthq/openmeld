import { describe, expect, it, vi } from "vitest";
import {
  createLarkPlatformStreamingCard,
  downloadLarkPlatformMessageResource,
  finalizeLarkPlatformStreamingCard,
  publishLarkPlatformCardReference,
  publishLarkPlatformIdentityLinkCard,
  publishLarkPlatformReply,
  readLarkPlatformChannelContext,
  requestLarkPlatformTenantAccessToken,
  updateLarkPlatformStreamingCardContent,
} from "../src/remote-agent/application/lark-platform-openapi-client";

describe("Lark-platform OpenAPI publication", () => {
  it("invokes the provider transport without an object receiver", async () => {
    const fetchImpl = vi.fn<typeof fetch>(function (this: unknown) {
      if (this !== undefined) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      );
    });

    await expect(
      requestLarkPlatformTenantAccessToken({
        apiHost: "https://open.larksuite.com",
        appId: "cli_test",
        appSecret: "app-secret",
        fetchImpl,
        provider: "lark",
      })
    ).resolves.toMatchObject({
      tenantAccessToken: "tenant-token",
    });
  });

  it("reuses a tenant token only inside its provider lifetime", async () => {
    let nowMs = 1000;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 10,
          tenant_access_token: "tenant-token-1",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 10,
          tenant_access_token: "tenant-token-2",
        })
      );
    const input = {
      apiHost: "https://open.larksuite.com",
      appId: "cli_test_cache",
      appSecret: "app-secret-cache",
      clock: () => nowMs,
      fetchImpl,
      provider: "lark" as const,
    };

    await expect(
      requestLarkPlatformTenantAccessToken(input)
    ).resolves.toMatchObject({
      tenantAccessToken: "tenant-token-1",
    });
    nowMs = 8999;
    await expect(
      requestLarkPlatformTenantAccessToken(input)
    ).resolves.toMatchObject({
      tenantAccessToken: "tenant-token-1",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();

    nowMs = 10_000;
    await expect(
      requestLarkPlatformTenantAccessToken(input)
    ).resolves.toMatchObject({
      tenantAccessToken: "tenant-token-2",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["lark" as const, "https://open.larksuite.com"],
    ["feishu" as const, "https://open.feishu.cn"],
  ])("downloads a bounded user-sent %s message image through the message resource endpoint", async (provider, apiHost) => {
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(
        new Response(imageBytes, {
          headers: {
            "Content-Length": String(imageBytes.byteLength),
            "Content-Type": "image/png; charset=binary",
          },
        })
      );

    await expect(
      downloadLarkPlatformMessageResource({
        appId: "cli_test",
        appSecret: "app-secret",
        fetchImpl,
        fileKey: "img_v3_image/key",
        maxBytes: 100,
        messageId: "om_message/id",
        provider,
        resourceType: "image",
      })
    ).resolves.toEqual({
      bytes: imageBytes,
      contentType: "image/png",
      status: "downloaded",
    });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      `${apiHost}/open-apis/im/v1/messages/om_message%2Fid/resources/img_v3_image%2Fkey?type=image`
    );
    expect(fetchImpl.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: { Authorization: "Bearer tenant-token" },
        method: "GET",
      })
    );
  });

  it("rejects a declared message resource size before reading its body", async () => {
    const cancel = vi.fn(async () => undefined);
    const body = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(
        new Response(body, {
          headers: { "Content-Length": "101" },
        })
      );

    await expect(
      downloadLarkPlatformMessageResource({
        appId: "cli_test",
        appSecret: "app-secret",
        fetchImpl,
        fileKey: "img_v3_large",
        maxBytes: 100,
        messageId: "om_large",
        provider: "lark",
        resourceType: "image",
      })
    ).resolves.toEqual({
      reasonCode: "lark.message_resource_too_large",
      status: "failed",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("stops a chunked resource response as soon as it crosses the byte limit", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(60));
              controller.enqueue(new Uint8Array(41));
              controller.close();
            },
          })
        )
      );

    await expect(
      downloadLarkPlatformMessageResource({
        appId: "cli_test",
        appSecret: "app-secret",
        fetchImpl,
        fileKey: "img_v3_chunked",
        maxBytes: 100,
        messageId: "om_chunked",
        provider: "lark",
        resourceType: "image",
      })
    ).resolves.toEqual({
      reasonCode: "lark.message_resource_too_large",
      status: "failed",
    });
  });

  it.each([
    ["lark" as const, "https://open.larksuite.com"],
    ["feishu" as const, "https://open.feishu.cn"],
  ])("sends a private %s identity-link card to the exact external user", async (provider, apiHost) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: { message_id: `identity-link-${provider}` },
          msg: "success",
        })
      );

    await expect(
      publishLarkPlatformIdentityLinkCard({
        appId: "cli_test",
        appSecret: "app-secret",
        fetchImpl,
        linkUrl:
          "https://openmeld.ai/link-message-channel?token=messagechannellink_test",
        organizationName: "OpenMeld Labs",
        provider,
        providerPublicationIdempotencyKey:
          "e86df165-338e-562b-8e35-b9b29b1c239b",
        providerUserId: "ou_external_user",
      })
    ).resolves.toEqual({
      resultId: `identity-link-${provider}`,
      status: "published",
    });
    const request = fetchImpl.mock.calls[1];
    expect(String(request?.[0])).toBe(
      `${apiHost}/open-apis/im/v1/messages?receive_id_type=open_id`
    );
    const body = JSON.parse(
      String((request?.[1] as RequestInit | undefined)?.body)
    ) as {
      content: string;
      msg_type: string;
      receive_id: string;
      uuid: string;
    };
    expect(body).toMatchObject({
      msg_type: "interactive",
      receive_id: "ou_external_user",
      uuid: "e86df165-338e-562b-8e35-b9b29b1c239b",
    });
    expect(JSON.parse(body.content)).toEqual(
      expect.objectContaining({
        header: expect.objectContaining({
          title: expect.objectContaining({
            content: "Connect my account and continue",
          }),
        }),
        elements: expect.arrayContaining([
          expect.objectContaining({
            text: expect.objectContaining({
              content: expect.stringContaining(
                "This request needs your personal OpenMeld access"
              ),
            }),
          }),
          expect.objectContaining({
            actions: [
              expect.objectContaining({
                text: expect.objectContaining({
                  content: "Connect my account and continue",
                }),
                url: "https://openmeld.ai/link-message-channel?token=messagechannellink_test",
              }),
            ],
          }),
        ]),
      })
    );
  });

  it.each([
    ["lark" as const, "https://open.larksuite.com"],
    ["feishu" as const, "https://open.feishu.cn"],
  ])("publishes a provider-deduplicated %s thread reply through the correct host", async (provider, apiHost) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: { message_id: `provider-message-${provider}` },
          msg: "success",
        })
      );

    await expect(
      publishLarkPlatformReply({
        appId: "cli_test",
        appSecret: "app-secret",
        fetchImpl,
        messageId: "om_root_message",
        provider,
        providerPublicationIdempotencyKey:
          "e86df165-338e-562b-8e35-b9b29b1c239b",
        replyInThread: true,
        text: "The launch plan is ready.",
      })
    ).resolves.toEqual({
      resultId: `provider-message-${provider}`,
      status: "published",
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `${apiHost}/open-apis/auth/v3/tenant_access_token/internal`,
      expect.objectContaining({
        body: JSON.stringify({
          app_id: "cli_test",
          app_secret: "app-secret",
        }),
        method: "POST",
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `${apiHost}/open-apis/im/v1/messages/om_root_message/reply`,
      expect.objectContaining({
        body: JSON.stringify({
          content: JSON.stringify({
            text: "The launch plan is ready.",
          }),
          msg_type: "text",
          reply_in_thread: true,
          uuid: "e86df165-338e-562b-8e35-b9b29b1c239b",
        }),
        headers: expect.objectContaining({
          Authorization: "Bearer tenant-token",
        }),
        method: "POST",
      })
    );
  });

  it.each([
    ["lark" as const, "https://open.larksuite.com"],
    ["feishu" as const, "https://open.feishu.cn"],
  ])("creates a native streaming card instance on the %s host", async (provider, apiHost) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: { card_id: `card-${provider}` },
          msg: "success",
        })
      );

    await expect(
      createLarkPlatformStreamingCard({
        appId: "cli_test",
        appSecret: "app-secret",
        fetchImpl,
        initialText: "Continued answer",
        provider,
      })
    ).resolves.toEqual({
      cardId: `card-${provider}`,
      status: "created",
    });
    const request = fetchImpl.mock.calls[1];
    expect(String(request?.[0])).toBe(`${apiHost}/open-apis/cardkit/v1/cards`);
    const body = JSON.parse(
      String((request?.[1] as RequestInit | undefined)?.body)
    ) as { data: string; type: string };
    expect(body.type).toBe("card_json");
    expect(JSON.parse(body.data)).toMatchObject({
      body: {
        elements: [
          {
            content: "Continued answer",
            element_id: "stream_md",
            tag: "markdown",
          },
        ],
      },
      config: {
        streaming_mode: true,
      },
      schema: "2.0",
    });
  });

  it("sends a provider-deduplicated reference to the durable card", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: { message_id: "om_working_card" },
          msg: "success",
        })
      );
    await expect(
      publishLarkPlatformCardReference({
        appId: "cli_test",
        appSecret: "app-secret",
        cardId: "card_1",
        fetchImpl,
        messageId: "om_root_message",
        provider: "lark",
        providerPublicationIdempotencyKey:
          "e86df165-338e-562b-8e35-b9b29b1c239b",
        replyInThread: true,
      })
    ).resolves.toEqual({
      resultId: "om_working_card",
      status: "published",
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://open.larksuite.com/open-apis/im/v1/messages/om_root_message/reply",
      expect.objectContaining({
        body: JSON.stringify({
          content: JSON.stringify({
            data: { card_id: "card_1" },
            type: "card",
          }),
          msg_type: "interactive",
          reply_in_thread: true,
          uuid: "e86df165-338e-562b-8e35-b9b29b1c239b",
        }),
        method: "POST",
      })
    );
  });

  it("updates and terminally replaces a card with monotonic provider sequences", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(Response.json({ code: 0, data: {} }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: {} }));
    await expect(
      updateLarkPlatformStreamingCardContent({
        appId: "cli_test",
        appSecret: "app-secret",
        cardId: "card_1",
        fetchImpl,
        provider: "lark",
        providerPublicationIdempotencyKey:
          "e86df165-338e-562b-8e35-b9b29b1c239b",
        sequence: 3,
        text: "A partial answer",
      })
    ).resolves.toEqual({ status: "published" });
    await expect(
      finalizeLarkPlatformStreamingCard({
        appId: "cli_test",
        appSecret: "app-secret",
        cardId: "card_1",
        fetchImpl,
        provider: "lark",
        providerPublicationIdempotencyKey:
          "8d4fb872-a1b1-5f1c-b192-b9dbadcc6869",
        sequence: 4,
        outcome: "completed",
        text: "The final answer",
      })
    ).resolves.toEqual({ status: "published" });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://open.larksuite.com/open-apis/cardkit/v1/cards/card_1/elements/stream_md/content",
      expect.objectContaining({
        body: JSON.stringify({
          content: "A partial answer",
          sequence: 3,
          uuid: "e86df165-338e-562b-8e35-b9b29b1c239b",
        }),
        method: "PUT",
      })
    );
    const tokenRequests = fetchImpl.mock.calls.filter(([request]) =>
      String(request).endsWith(
        "/open-apis/auth/v3/tenant_access_token/internal"
      )
    );
    expect(tokenRequests).toHaveLength(1);
    const terminalRequest = fetchImpl.mock.calls[2];
    const terminalBody = JSON.parse(
      String((terminalRequest?.[1] as RequestInit | undefined)?.body)
    ) as {
      card: { data: string; type: string };
      sequence: number;
      uuid: string;
    };
    expect(String(terminalRequest?.[0])).toBe(
      "https://open.larksuite.com/open-apis/cardkit/v1/cards/card_1"
    );
    expect(terminalBody).toMatchObject({
      card: { type: "card_json" },
      sequence: 4,
      uuid: "8d4fb872-a1b1-5f1c-b192-b9dbadcc6869",
    });
    expect(JSON.parse(terminalBody.card.data)).toMatchObject({
      header: { title: { content: "Response complete" } },
      body: {
        elements: [{ content: "The final answer" }],
      },
      config: {
        streaming_mode: false,
        summary: { content: "The final answer" },
      },
    });
  });

  it.each([
    ["failed", "Could not complete this request"],
    ["stopped", "Stopped"],
    ["continued", "Response continues below"],
  ] as const)("closes a %s card without a success label", async (outcome, label) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(Response.json({ code: 0, data: {} }));
    await expect(
      finalizeLarkPlatformStreamingCard({
        appId: "cli_test",
        appSecret: "app-secret",
        cardId: "card_1",
        fetchImpl,
        provider: "feishu",
        providerPublicationIdempotencyKey:
          "8d4fb872-a1b1-5f1c-b192-b9dbadcc6869",
        sequence: 4,
        outcome,
        text: "Details",
      })
    ).resolves.toEqual({ status: "published" });
    const body = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(JSON.parse(body.card.data)).toMatchObject({
      header: { title: { tag: "plain_text", content: label } },
      config: {
        streaming_mode: false,
        summary: { content: `${label}: Details` },
      },
    });
  });

  it("preserves provider Retry-After on a rate-limited card update", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(
        Response.json(
          { msg: "rate limited" },
          {
            headers: { "Retry-After": "7" },
            status: 429,
          }
        )
      );

    await expect(
      updateLarkPlatformStreamingCardContent({
        appId: "cli_test",
        appSecret: "app-secret",
        cardId: "card_1",
        fetchImpl,
        provider: "lark",
        providerPublicationIdempotencyKey:
          "e86df165-338e-562b-8e35-b9b29b1c239b",
        sequence: 3,
        text: "A partial answer",
      })
    ).resolves.toEqual({
      reasonCode: "lark.card_update_http_429",
      retryAfterMs: 7000,
      status: "failed",
    });
  });

  it("classifies an ambiguous CardKit write without issuing an unsafe fallback", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockRejectedValueOnce(new TypeError("socket closed after write"));
    await expect(
      updateLarkPlatformStreamingCardContent({
        appId: "cli_test",
        appSecret: "app-secret",
        cardId: "card_1",
        fetchImpl,
        provider: "feishu",
        providerPublicationIdempotencyKey:
          "e86df165-338e-562b-8e35-b9b29b1c239b",
        sequence: 1,
        text: "Do not double apply this update.",
      })
    ).resolves.toEqual({
      reasonCode: "feishu.card_update_outcome_unknown",
      status: "outcome_unknown",
    });
  });

  it("classifies a token transport failure as safely retryable", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("network unavailable"));

    await expect(
      publishLarkPlatformReply({
        appId: "cli_test",
        appSecret: "app-secret",
        fetchImpl,
        messageId: "om_root_message",
        provider: "lark",
        providerPublicationIdempotencyKey:
          "e86df165-338e-562b-8e35-b9b29b1c239b",
        replyInThread: false,
        text: "Retry me.",
      })
    ).resolves.toEqual({
      reasonCode: "lark.tenant_token_transport_failed",
      status: "failed",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies a reply transport failure as outcome unknown", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockRejectedValueOnce(new TypeError("socket closed after write"));

    await expect(
      publishLarkPlatformReply({
        appId: "cli_test",
        appSecret: "app-secret",
        fetchImpl,
        messageId: "om_root_message",
        provider: "lark",
        providerPublicationIdempotencyKey:
          "e86df165-338e-562b-8e35-b9b29b1c239b",
        replyInThread: false,
        text: "Do not duplicate me.",
      })
    ).resolves.toEqual({
      reasonCode: "lark.message_reply_outcome_unknown",
      status: "outcome_unknown",
    });
  });

  it("preserves an explicit provider rejection as a retryable failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            code: 23_099_201,
            msg: "Bot is not in the chat",
          },
          { status: 400 }
        )
      );

    await expect(
      publishLarkPlatformReply({
        appId: "cli_test",
        appSecret: "app-secret",
        fetchImpl,
        messageId: "om_root_message",
        provider: "feishu",
        providerPublicationIdempotencyKey:
          "e86df165-338e-562b-8e35-b9b29b1c239b",
        replyInThread: false,
        text: "This cannot be delivered.",
      })
    ).resolves.toEqual({
      reasonCode: "feishu.message_reply_provider_error_23099201",
      status: "failed",
    });
  });

  it("treats a success-shaped reply without a provider message id as ambiguous", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: {},
          msg: "success",
        })
      );

    await expect(
      publishLarkPlatformReply({
        appId: "cli_test",
        appSecret: "app-secret",
        fetchImpl,
        messageId: "om_root_message",
        provider: "lark",
        providerPublicationIdempotencyKey:
          "e86df165-338e-562b-8e35-b9b29b1c239b",
        replyInThread: false,
        text: "Ambiguous provider response.",
      })
    ).resolves.toEqual({
      reasonCode: "lark.message_reply_result_missing",
      status: "outcome_unknown",
    });
  });

  it.each([
    "feishu",
    "lark",
  ] as const)("reads exact %s thread context without current, future or other-thread messages", async (provider) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: {
            has_more: true,
            items: [
              {
                body: {
                  content: JSON.stringify({ text: "Later concurrent reply" }),
                },
                chat_id: "oc_chat_test",
                create_time: "1710000004000",
                message_id: "om_later",
                msg_type: "text",
                root_id: "om_root",
                sender: { id: "ou_member", sender_type: "user" },
              },
              {
                body: { content: JSON.stringify({ text: "Current request" }) },
                chat_id: "oc_chat_test",
                create_time: "1710000003000",
                message_id: "om_current",
                msg_type: "text",
                root_id: "om_root",
                sender: {
                  id: "ou_current",
                  sender_name: "Felix",
                  sender_type: "user",
                },
              },
              {
                body: {
                  content: JSON.stringify({ text: "@_user_1 Earlier answer" }),
                },
                chat_id: "oc_chat_test",
                create_time: "1710000002000",
                mentions: [{ key: "@_user_1", name: "Center Agent" }],
                message_id: "om_earlier_2",
                msg_type: "text",
                root_id: "om_root",
                sender: {
                  id: "ou_bot",
                  sender_name: "Center Agent",
                  sender_type: "app",
                },
              },
              {
                body: {
                  content: JSON.stringify({
                    title: "Earlier question",
                    content: [[{ tag: "text", text: "Details" }]],
                  }),
                },
                chat_id: "oc_chat_test",
                create_time: "1710000001000",
                message_id: "om_earlier_1",
                msg_type: "post",
                root_id: "om_root",
                sender: {
                  id: "ou_member",
                  sender_name: "Ada",
                  sender_type: "user",
                },
              },
              {
                body: { content: JSON.stringify({ text: "Another thread" }) },
                chat_id: "oc_chat_test",
                create_time: "1710000000000",
                message_id: "om_other",
                msg_type: "text",
                root_id: "om_other_root",
                sender: {
                  id: "ou_other",
                  sender_type: "user",
                },
              },
            ],
          },
          msg: "success",
        })
      );

    await expect(
      readLarkPlatformChannelContext({
        appId: "cli_test",
        appSecret: "app-secret",
        conversationId: "lark:connection:oc_chat_test:om_root",
        currentEvent: {
          kind: "message",
          locator: {
            appId: "cli_test",
            chatId: "oc_chat_test",
            connectionId: "connection",
            provider,
            rootMessageId: "om_root",
            tenantKey: "tenant",
            threadId: "omt_thread",
          },
          mention: "group_mention",
          messageId: "om_current",
          resources: [],
          senderId: "ou_current",
          sentAtMs: 1_710_000_003_000,
          text: "Current request",
        },
        fetchImpl,
        provider,
      })
    ).resolves.toEqual({
      conversationId: "lark:connection:oc_chat_test:om_root",
      currentMessageId: "om_current",
      messages: [
        {
          author: {
            displayName: "Ada",
            id: "ou_member",
            kind: "human",
          },
          id: "om_earlier_1",
          sentAtMs: 1_710_000_001_000,
          text: "Earlier question\nDetails",
        },
        {
          author: {
            displayName: "Center Agent",
            id: "ou_bot",
            kind: "bot",
          },
          id: "om_earlier_2",
          sentAtMs: 1_710_000_002_000,
          text: "Center Agent Earlier answer",
        },
      ],
      provider,
      sync: { mode: "snapshot", status: "truncated" },
    });

    const contextUrl = new URL(String(fetchImpl.mock.calls[1]?.[0]));
    expect(contextUrl.origin).toBe(
      provider === "lark"
        ? "https://open.larksuite.com"
        : "https://open.feishu.cn"
    );
    expect(contextUrl.pathname).toBe("/open-apis/im/v1/messages");
    expect(contextUrl.searchParams.get("container_id_type")).toBe("thread");
    expect(contextUrl.searchParams.get("container_id")).toBe("omt_thread");
    expect(contextUrl.searchParams.has("end_time")).toBe(false);
    expect(contextUrl.searchParams.get("page_size")).toBe("20");
  });
});
