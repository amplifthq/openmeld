import * as z from "zod/v4";

export const MESSAGE_CHANNEL_FILE_MAX_SIZE_BYTES = 5_242_880;
export const centerAgentReadChannelFileBodySchema = z.strictObject({
  conversationId: z.string().trim().min(1).max(2048),
  fileKey: z.string().trim().min(1).max(512),
});
export const centerAgentReadChannelFileResponseSchema = z.strictObject({
  contentBase64: z
    .string()
    .max(Math.ceil(MESSAGE_CHANNEL_FILE_MAX_SIZE_BYTES / 3) * 4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
  fileKey: z.string().trim().min(1).max(512),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  provider: z.enum(["feishu", "lark"]),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MESSAGE_CHANNEL_FILE_MAX_SIZE_BYTES),
});
