import { describe, expect, it } from "vitest";
import {
  centerAgentActionSchema,
  listCenterAgentAuditJournalQuerySchema,
} from "../../src/schemas/http/center-agent";
import {
  centerAgentReadChannelFileBodySchema,
  centerAgentReadChannelFileResponseSchema,
  MESSAGE_CHANNEL_FILE_MAX_SIZE_BYTES,
} from "../../src/schemas/http/message-channel-files";

describe("current-message channel file contract", () => {
  it("accepts only current-conversation file identity, never credentials or download URLs", () => {
    const request = { conversationId: "conversation", fileKey: "file" };
    expect(
      centerAgentReadChannelFileBodySchema.safeParse(request).success
    ).toBe(true);
    expect(
      centerAgentReadChannelFileBodySchema.safeParse({
        ...request,
        url: "https://example.com/file",
      }).success
    ).toBe(false);
    expect(
      centerAgentReadChannelFileBodySchema.safeParse({
        ...request,
        appSecret: "secret",
      }).success
    ).toBe(false);
  });
  it("bounds internal byte responses and versions the new audit action", () => {
    const response = {
      contentBase64: "YQ==",
      fileKey: "file",
      fileName: "a.txt",
      mimeType: "text/plain",
      provider: "feishu",
      sizeBytes: 1,
    };
    expect(
      centerAgentReadChannelFileResponseSchema.safeParse(response).success
    ).toBe(true);
    expect(
      centerAgentReadChannelFileResponseSchema.safeParse({
        ...response,
        sizeBytes: MESSAGE_CHANNEL_FILE_MAX_SIZE_BYTES + 1,
      }).success
    ).toBe(false);
    expect(
      centerAgentReadChannelFileResponseSchema.safeParse({
        ...response,
        contentBase64: "invalid!",
      }).success
    ).toBe(false);
    expect(centerAgentActionSchema.parse("read_channel_file")).toBe(
      "read_channel_file"
    );
    expect(
      listCenterAgentAuditJournalQuerySchema.parse({ actionSet: "v22" })
    ).toEqual({ actionSet: "v22" });
  });
});
