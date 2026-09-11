import { MESSAGE_CHANNEL_FILE_MAX_SIZE_BYTES } from "@openmeld/schemas";
import { requestLarkPlatformTenantAccessToken } from "./lark-platform-openapi-client";
import type {
  LarkPlatformMessageChannelProvider,
  MessageChannelPublicationResult,
} from "./message-channel-adapters";

const PUBLICATION_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Uploading a resource is private; only the subsequent reply publishes it. */
export async function publishLarkPlatformFile(input: {
  appId: string;
  appSecret: string;
  bytes: Uint8Array;
  fileName: string;
  messageId: string;
  provider: LarkPlatformMessageChannelProvider;
  providerPublicationIdempotencyKey: string;
  replyInThread: boolean;
  fetchImpl?: typeof fetch;
}): Promise<MessageChannelPublicationResult> {
  if (
    !input.bytes.byteLength ||
    input.bytes.byteLength > MESSAGE_CHANNEL_FILE_MAX_SIZE_BYTES ||
    !input.fileName.trim() ||
    !input.messageId.trim() ||
    !PUBLICATION_UUID.test(input.providerPublicationIdempotencyKey)
  ) {
    return {
      status: "failed",
      reasonCode: `${input.provider}.file_input_invalid`,
    };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiHost =
    input.provider === "feishu"
      ? "https://open.feishu.cn"
      : "https://open.larksuite.com";
  const token = await requestLarkPlatformTenantAccessToken({
    ...input,
    apiHost,
    fetchImpl,
  });
  if (token.status !== "ready") {
    return token.result;
  }
  const headers = { Authorization: `Bearer ${token.tenantAccessToken}` };
  const form = new FormData();
  form.set("file_type", "stream");
  form.set("file_name", input.fileName);
  form.set(
    "file",
    new Blob([new Uint8Array(input.bytes)], {
      type: "application/octet-stream",
    }),
    input.fileName
  );
  let fileKey: string;
  try {
    const response = await fetchImpl(`${apiHost}/open-apis/im/v1/files`, {
      method: "POST",
      headers,
      body: form,
    });
    const body = (await response.json()) as {
      code?: number;
      data?: { file_key?: string };
    };
    if (
      !response.ok ||
      body.code !== 0 ||
      typeof body.data?.file_key !== "string" ||
      !body.data.file_key.trim()
    ) {
      return {
        status: "failed",
        reasonCode: `${input.provider}.file_upload_http_${response.status}_code_${typeof body.code === "number" ? body.code : "missing"}`,
      };
    }
    fileKey = body.data.file_key;
  } catch {
    return {
      status: "failed",
      reasonCode: `${input.provider}.file_upload_failed`,
    };
  }
  // A lost reply response must never be treated as permission to send again.
  try {
    const response = await fetchImpl(
      `${apiHost}/open-apis/im/v1/messages/${encodeURIComponent(input.messageId)}/reply`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          msg_type: "file",
          content: JSON.stringify({ file_key: fileKey }),
          reply_in_thread: input.replyInThread,
          uuid: input.providerPublicationIdempotencyKey,
        }),
      }
    );
    if (response.status >= 500) {
      return unknown(input.provider);
    }
    const body = (await response.json()) as {
      code?: number;
      data?: { message_id?: string };
    };
    if (!response.ok || (typeof body.code === "number" && body.code !== 0)) {
      return {
        status: "failed",
        reasonCode: `${input.provider}.file_reply_http_${response.status}_code_${typeof body.code === "number" ? body.code : "missing"}`,
      };
    }
    if (
      body.code !== 0 ||
      typeof body.data?.message_id !== "string" ||
      !body.data.message_id.trim()
    ) {
      return unknown(input.provider);
    }
    return { status: "published", resultId: body.data.message_id };
  } catch {
    return unknown(input.provider);
  }
}

function unknown(
  provider: LarkPlatformMessageChannelProvider
): MessageChannelPublicationResult {
  return {
    status: "outcome_unknown",
    reasonCode: `${provider}.file_reply_outcome_unknown`,
  };
}
