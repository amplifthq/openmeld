import {
  buildSpaceAttachmentObjectKey,
  detectSpaceAttachmentMimeType,
  remoteAgentWorkerInputAttachmentSchema,
  SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE,
  SPACE_ATTACHMENT_MAX_SIZE_BYTES,
} from "@openmeld/schemas";
import type {
  MessageChannelResourceDescriptor,
  NormalizedMessageChannelEvent,
  RemoteAgentWorkerInputAttachment,
} from "@openmeld/schemas/types";
import type { RemoteAgentLarkPlatformChannelConnectionRecord } from "../infrastructure/d1/lark-platform-channel-connection-repo";
import type { MessageChannelProviderAdapter } from "./message-channel-adapters";

type MessageEvent = Extract<NormalizedMessageChannelEvent, { kind: "message" }>;

export type MessageChannelInputAttachmentPreparationResult =
  | {
      attachments: RemoteAgentWorkerInputAttachment[];
      status: "ready";
    }
  | {
      failureCode: string;
      status: "failed";
      text: string;
    }
  | {
      reasonCode: string;
      status: "retryable";
    };

export async function cleanupMessageChannelInputAttachments(input: {
  attachments: readonly RemoteAgentWorkerInputAttachment[];
  bucket?: Pick<R2Bucket, "delete">;
  conversationId: string;
  organizationId: string;
}): Promise<void> {
  if (!input.bucket) {
    return;
  }
  await deletePreparedObjects({
    bucket: input.bucket,
    objectKeys: input.attachments
      .filter((attachment) => attachment.removeAfterAdmission)
      .map((attachment) =>
        buildSpaceAttachmentObjectKey({
          id: attachment.id,
          organizationId: input.organizationId,
          spaceId: input.conversationId,
        })
      ),
  });
}

export async function prepareMessageChannelInputAttachments(input: {
  adapter: MessageChannelProviderAdapter;
  bucket?: Pick<R2Bucket, "delete" | "put">;
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  conversationId: string;
  event: MessageEvent;
}): Promise<MessageChannelInputAttachmentPreparationResult> {
  if (input.event.resources.length === 0) {
    return { attachments: [], status: "ready" };
  }
  if (input.event.resources.length > SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE) {
    return {
      failureCode: "message_channel.input_attachment_count_exceeded",
      status: "failed",
      text: `Center Agent can review up to ${SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE} images in one message.`,
    };
  }
  const unsupportedResource = input.event.resources.find(
    (resource) => resource.type !== "image"
  );
  if (unsupportedResource) {
    return {
      failureCode: "message_channel.input_resource_type_unsupported",
      status: "failed",
      text: buildUnsupportedResourceMessage(unsupportedResource),
    };
  }
  if (!input.bucket) {
    return {
      failureCode: "message_channel.input_attachment_storage_unavailable",
      status: "failed",
      text: "Center Agent could not securely load the attached image. Please try again.",
    };
  }

  const storedObjectKeys: string[] = [];
  const attachments: RemoteAgentWorkerInputAttachment[] = [];
  for (const resource of input.event.resources) {
    const download = await input.adapter.downloadResource({
      connection: input.connection,
      locator: input.event.locator,
      maxBytes: SPACE_ATTACHMENT_MAX_SIZE_BYTES,
      messageId: input.event.messageId,
      resource,
    });
    if (download.status !== "downloaded") {
      await deletePreparedObjects({
        bucket: input.bucket,
        objectKeys: storedObjectKeys,
      });
      if (download.status === "retryable") {
        return { reasonCode: download.reasonCode, status: "retryable" };
      }
      return {
        failureCode: download.reasonCode,
        status: "failed",
        text: download.reasonCode.endsWith("message_resource_too_large")
          ? "That image is larger than the 5 MB limit. Please send a smaller JPEG or PNG."
          : "Center Agent could not securely load that image. Please send a JPEG or PNG and try again.",
      };
    }
    const mimeType = detectSpaceAttachmentMimeType(download.bytes);
    if (!mimeType) {
      await deletePreparedObjects({
        bucket: input.bucket,
        objectKeys: storedObjectKeys,
      });
      return {
        failureCode: "message_channel.input_attachment_format_unsupported",
        status: "failed",
        text: "Center Agent can currently review JPEG and PNG images up to 5 MB.",
      };
    }
    const attachmentId = await buildMessageChannelAttachmentId({
      connectionId: input.connection.connectionId,
      fileKey: resource.fileKey,
      messageId: input.event.messageId,
      provider: input.connection.provider,
    });
    const attachment = remoteAgentWorkerInputAttachmentSchema.parse({
      fileName:
        resource.fileName ??
        `message-channel-image.${mimeType === "image/png" ? "png" : "jpg"}`,
      id: attachmentId,
      mimeType,
      removeAfterAdmission: true,
      sizeBytes: download.bytes.byteLength,
    });
    const objectKey = buildSpaceAttachmentObjectKey({
      id: attachment.id,
      organizationId: input.connection.organizationId,
      spaceId: input.conversationId,
    });
    try {
      await input.bucket.put(objectKey, download.bytes, {
        httpMetadata: { contentType: attachment.mimeType },
      });
    } catch {
      await deletePreparedObjects({
        bucket: input.bucket,
        objectKeys: storedObjectKeys,
      });
      return {
        reasonCode: "message_channel.input_attachment_storage_failed",
        status: "retryable",
      };
    }
    storedObjectKeys.push(objectKey);
    attachments.push(attachment);
  }
  return { attachments, status: "ready" };
}

async function buildMessageChannelAttachmentId(input: {
  connectionId: string;
  fileKey: string;
  messageId: string;
  provider: "feishu" | "lark";
}): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      [
        "message-channel-input-attachment:v1",
        input.provider,
        input.connectionId,
        input.messageId,
        input.fileKey,
      ]
        .map((part) => `${part.length}:${part}`)
        .join("|")
    )
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `message-channel-${hex}`;
}

function buildUnsupportedResourceMessage(
  resource: MessageChannelResourceDescriptor
): string {
  if (resource.type === "file" && resource.fileName) {
    return `Center Agent cannot read the attached file "${resource.fileName}" yet. Please send its content as text or as JPEG or PNG images.`;
  }
  return "Center Agent can currently review text, JPEG images, and PNG images. Please resend this content in one of those formats.";
}

async function deletePreparedObjects(input: {
  bucket: Pick<R2Bucket, "delete">;
  objectKeys: readonly string[];
}): Promise<void> {
  const results = await Promise.allSettled(
    input.objectKeys.map((objectKey) => input.bucket.delete(objectKey))
  );
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      console.warn("[core.message_channel.input_attachment_cleanup_degraded]", {
        errorName:
          result.reason instanceof Error
            ? result.reason.name
            : typeof result.reason,
        objectKey: input.objectKeys[index],
        reasonCode: "message_channel.input_attachment_cleanup_degraded",
      });
    }
  }
}
