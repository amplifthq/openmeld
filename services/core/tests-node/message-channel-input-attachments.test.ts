import { buildSpaceAttachmentObjectKey } from "@openmeld/schemas";
import type { NormalizedMessageChannelEvent } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type {
  MessageChannelProviderAdapter,
  MessageChannelResourceDownloadResult,
} from "../src/remote-agent/application/message-channel-adapters";
import { prepareMessageChannelInputAttachments } from "../src/remote-agent/application/message-channel-input-attachments";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
]);

describe("Message Channel input attachments", () => {
  it("stores a magic-verified image under the exact authorized conversation key", async () => {
    const adapter = createAdapter({
      bytes: PNG_BYTES,
      contentType: "application/octet-stream",
      status: "downloaded",
    });
    const bucket = createBucket();
    const event = createImageEvent();

    const result = await prepareMessageChannelInputAttachments({
      adapter,
      bucket,
      connection: createConnection(),
      conversationId: "lark:connection_lark_1:oc_chat_1:om_image_1",
      event,
    });

    expect(result).toMatchObject({
      attachments: [
        {
          fileName: "message-channel-image.png",
          mimeType: "image/png",
          removeAfterAdmission: true,
          sizeBytes: PNG_BYTES.byteLength,
        },
      ],
      status: "ready",
    });
    if (result.status !== "ready" || !result.attachments[0]) {
      throw new Error("Expected one prepared image");
    }
    const objectKey = buildSpaceAttachmentObjectKey({
      id: result.attachments[0].id,
      organizationId: "org_1",
      spaceId: "lark:connection_lark_1:oc_chat_1:om_image_1",
    });
    expect(bucket.put).toHaveBeenCalledWith(objectKey, PNG_BYTES, {
      httpMetadata: { contentType: "image/png" },
    });
    expect(adapter.downloadResource).toHaveBeenCalledWith({
      connection: expect.objectContaining({
        connectionId: "connection_lark_1",
        organizationId: "org_1",
      }),
      locator: event.locator,
      maxBytes: 5_242_880,
      messageId: "om_image_1",
      resource: event.resources[0],
    });
  });

  it("admits a file for evidence-bound on-demand reading without image conversion", async () => {
    const adapter = createAdapter({
      bytes: PNG_BYTES,
      contentType: "image/png",
      status: "downloaded",
    });
    const event = createImageEvent();
    event.resources = [
      {
        fileKey: "file_v3_test",
        fileName: "launch.pdf",
        mimeType: "application/pdf",
        sizeBytes: null,
        type: "file",
      },
    ];

    await expect(
      prepareMessageChannelInputAttachments({
        adapter,
        bucket: createBucket(),
        connection: createConnection(),
        conversationId: "lark:connection_lark_1:oc_chat_1:om_image_1",
        event,
      })
    ).resolves.toEqual({
      attachments: [],
      status: "ready",
    });
    expect(adapter.downloadResource).not.toHaveBeenCalled();
  });

  it("does not store bytes whose declared image type fails magic inspection", async () => {
    const adapter = createAdapter({
      bytes: new TextEncoder().encode("<svg></svg>"),
      contentType: "image/png",
      status: "downloaded",
    });
    const bucket = createBucket();

    await expect(
      prepareMessageChannelInputAttachments({
        adapter,
        bucket,
        connection: createConnection(),
        conversationId: "lark:connection_lark_1:oc_chat_1:om_image_1",
        event: createImageEvent(),
      })
    ).resolves.toEqual({
      failureCode: "message_channel.input_attachment_format_unsupported",
      status: "failed",
      text: "Center Agent can currently review JPEG and PNG images up to 5 MB.",
    });
    expect(bucket.put).not.toHaveBeenCalled();
  });
});

function createAdapter(
  download: MessageChannelResourceDownloadResult
): MessageChannelProviderAdapter {
  return {
    createWorkingCard: vi.fn(),
    publishFile: vi.fn(),
    downloadResource: vi.fn(() => Promise.resolve(download)),
    finalizeWorkingCard: vi.fn(),
    provider: "lark",
    publishFailure: vi.fn(),
    publishIdentityLinkGuidance: vi.fn(),
    publishPrivateNavigationGuidance: vi.fn(),
    publishReply: vi.fn(),
    publishWorkingCard: vi.fn(),
    readChannelContext: vi.fn(),
    updateWorkingCard: vi.fn(),
  };
}

function createBucket(): Pick<R2Bucket, "delete" | "put"> {
  return {
    delete: vi.fn(() => Promise.resolve()),
    put: vi.fn(() => Promise.resolve({} as R2Object)),
  };
}

function createConnection() {
  return {
    appId: "cli_lark_1",
    botName: "Center Agent",
    botOpenId: "ou_bot_1",
    callbacksWebhookVerifiedAtMs: 1000,
    connectionGeneration: 1,
    connectionId: "connection_lark_1",
    createdAtMs: 1000,
    eventsWebhookVerifiedAtMs: 1000,
    failureReasonCode: null,
    grantedCapabilityGroups: ["channel.base"],
    installedByUserId: "user_1",
    lastVerifiedAtMs: 1000,
    organizationId: "org_1",
    permissionBundleVersion: "channel-preset-v1",
    provider: "lark" as const,
    status: "connected" as const,
    tenantKey: "tenant_lark_1",
    transport: "webhook" as const,
    updatedAtMs: 1000,
  };
}

function createImageEvent(): Extract<
  NormalizedMessageChannelEvent,
  { kind: "message" }
> {
  return {
    kind: "message" as const,
    locator: {
      appId: "cli_lark_1",
      chatId: "oc_chat_1",
      connectionId: "connection_lark_1",
      provider: "lark" as const,
      rootMessageId: "om_image_1",
      tenantKey: "tenant_lark_1",
      threadId: null,
    },
    mention: "direct_message" as const,
    messageId: "om_image_1",
    resources: [
      {
        fileKey: "img_v3_test",
        fileName: null,
        mimeType: null,
        sizeBytes: null,
        type: "image" as const,
      },
    ],
    senderId: "ou_member_1",
    sentAtMs: 1000,
    text: "Please review the attached image.",
  };
}
