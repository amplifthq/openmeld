import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  type CenterAgentReadChannelFileInput,
  rpcCenterAgentReadChannelFile,
} from "../src/remote-agent/application/message-channel-file-service";

const state = vi.hoisted(() => ({
  delivery: {} as Record<string, unknown>,
  connection: {} as Record<string, unknown>,
  download: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("../src/center-agent/current-designated-center-agent", () => ({
  requireCurrentDesignatedCenterAgentCaller: async () => ({
    activeOrganization: { organizationId: "org" },
    actorProfileId: "agent",
    actorProfile: { ownerUserId: "owner" },
    context: { agentControllerConversationId: "dispatch" },
  }),
}));
vi.mock("../src/center-agent/center-agent-audit", () => ({
  writeCenterAgentAuditEntry: state.audit,
}));
vi.mock(
  "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo",
  () => ({
    readRemoteAgentNativeDeliveryByDispatchAndConversation: async () =>
      state.delivery,
  })
);
vi.mock(
  "../src/remote-agent/infrastructure/d1/lark-platform-channel-connection-repo",
  () => ({
    readRemoteAgentLarkPlatformChannelConnection: async () => state.connection,
  })
);
vi.mock(
  "../src/remote-agent/application/lark-platform-message-channel-adapter",
  () => ({
    createLarkPlatformMessageChannelAdapter: () => ({
      downloadResource: state.download,
    }),
  })
);

const input = {
  context: { agentControllerConversationId: "dispatch" },
  conversationId: "conversation",
  fileKey: "file_1",
} as CenterAgentReadChannelFileInput;
const env = { OPENMELD_DB: {} } as CoreBindings;

describe("current-message file authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.connection = { organizationId: "org", status: "connected" };
    state.delivery = {
      deliveryId: "delivery",
      conversationKind: "message_channel",
      organizationId: "org",
      profileId: "agent",
      status: "accepted",
      triggerMessageId: "original_message",
      messageChannelLocator: {
        provider: "feishu",
        connectionId: "connection",
        chatId: "chat",
        rootMessageId: "root",
      },
      workerSubmitRequest: {
        agentProfileOwnerUserId: "owner",
        dispatchId: "dispatch",
        turnEnvelope: {
          trigger: {
            source: "message_channel",
            provider: "feishu",
            connectionId: "connection",
            conversationId: "conversation",
            resources: [
              { fileKey: "file_1", fileName: "report.csv", type: "file" },
            ],
          },
        },
      },
    };
    state.download.mockResolvedValue({
      status: "downloaded",
      bytes: new TextEncoder().encode("a,b\n1,2"),
      contentType: "application/octet-stream",
    });
  });

  it("downloads only the frozen original message resource and audits its delivery", async () => {
    const result = await rpcCenterAgentReadChannelFile(env, input);
    expect(result).toMatchObject({
      fileName: "report.csv",
      mimeType: "text/csv",
      contentBase64: "YSxiCjEsMg==",
    });
    expect(state.download).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "original_message",
        maxBytes: 5_242_880,
        resource: expect.objectContaining({ fileKey: "file_1" }),
      })
    );
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "read_channel_file",
        sourceNativeDeliveryId: "delivery",
      })
    );
  });

  it.each([
    ["organizationId", "other-org"],
    ["profileId", "other-agent"],
    ["status", "completed"],
    ["conversationKind", "slack"],
  ])("rejects mismatched %s before provider I/O", async (field, value) => {
    state.delivery[field] = value;
    await expect(rpcCenterAgentReadChannelFile(env, input)).rejects.toThrow();
    expect(state.download).not.toHaveBeenCalled();
  });

  it("rejects arbitrary file keys and disconnected connections", async () => {
    await expect(
      rpcCenterAgentReadChannelFile(env, { ...input, fileKey: "another_file" })
    ).rejects.toThrow();
    state.connection.status = "disconnected";
    await expect(rpcCenterAgentReadChannelFile(env, input)).rejects.toThrow();
    expect(state.download).not.toHaveBeenCalled();
  });

  it("preserves download failures without returning bytes or a success audit", async () => {
    state.download.mockResolvedValue({
      status: "failed",
      reasonCode: "feishu.message_resource_too_large",
    });
    await expect(rpcCenterAgentReadChannelFile(env, input)).rejects.toThrow(
      "5 MB"
    );
    expect(state.audit).not.toHaveBeenCalled();
  });
});
