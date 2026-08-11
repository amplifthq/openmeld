import {
  AppType,
  Client,
  createLarkChannel,
  Domain,
  normalize,
  normalizeCardAction,
} from "@larksuiteoapi/node-sdk";

const SAMPLE_MESSAGE_EVENT = {
  message: {
    chat_id: "oc_worker_spike",
    chat_type: "p2p" as const,
    content: JSON.stringify({ text: "Worker compatibility probe" }),
    create_time: "1784358000000",
    message_id: "om_worker_spike",
    message_type: "text",
  },
  sender: {
    sender_id: {
      open_id: "ou_worker_spike",
    },
    sender_type: "user",
  },
};

export default {
  async fetch(): Promise<Response> {
    const normalizedMessage = await normalize(SAMPLE_MESSAGE_EVENT, {
      botIdentity: {
        name: "OpenMeld Center Agent Dev",
        openId: "ou_bot_worker_spike",
      },
    });
    const normalizedCardAction = normalizeCardAction({
      action: {
        tag: "button",
        value: { action: "continue" },
      },
      context: {
        open_chat_id: "oc_worker_spike",
        open_message_id: "om_worker_spike",
      },
      operator: {
        open_id: "ou_worker_spike",
      },
    });

    const client = new Client({
      appId: "cli_worker_spike",
      appSecret: "not-a-real-secret",
      appType: AppType.SelfBuild,
      domain: Domain.Lark,
    });
    const channel = createLarkChannel({
      appId: "cli_worker_spike",
      appSecret: "not-a-real-secret",
      domain: Domain.Lark,
      transport: "webhook",
    });

    return Response.json({
      cardActionNormalized: normalizedCardAction !== null,
      clientHasMediaDownload:
        typeof client.im.v1.messageResource.get === "function",
      clientHasMediaUpload: typeof client.im.v1.image.create === "function",
      messageNormalized: normalizedMessage.messageId === "om_worker_spike",
      streamHelperAvailable: typeof channel.stream === "function",
    });
  },
};
