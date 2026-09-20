import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
} from "../agent-core/callback-context";
import {
  getRemoteAgentOpenMeldToolDefinitions,
  type RemoteAgentOpenMeldToolName,
} from "../agent-core/tools";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const ACK = {
  accepted: true,
  createdAt: TEST_NOW_MS,
  idempotencyKey: "remote-agent:dispatch_123",
  requestId: "flue_submission_123",
  status: "pending",
  submissionId: "flue_submission_123",
} as const;

describe("Remote Agent Slack search tool", () => {
  it("is exposed only for a Slack turn with event-bound authorization", async () => {
    const authorizedRequest = createSlackSearchRequest();
    const authorizedTools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: {},
      storage: await createStorage(authorizedRequest),
      submissionId: ACK.submissionId,
      turnEnvelope: authorizedRequest.turnEnvelope,
    });
    const ordinaryRequest = createSubmitTurnRequest();
    const ordinaryTools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: {},
      storage: await createStorage(ordinaryRequest),
      submissionId: ACK.submissionId,
      turnEnvelope: ordinaryRequest.turnEnvelope,
    });

    expect(authorizedTools.map((tool) => tool.name)).toContain(
      "openmeld_search_slack_messages"
    );
    expect(ordinaryTools.map((tool) => tool.name)).not.toContain(
      "openmeld_search_slack_messages"
    );
  });

  it("supplies the encrypted authorization outside model-controlled input", async () => {
    const request = createSlackSearchRequest();
    const response = slackSearchResponse(request.organizationId);
    const centerAgentSearchSlackMessages = vi.fn(async () => response);
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: { centerAgentSearchSlackMessages },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
      turnEnvelope: request.turnEnvelope,
    });

    await expect(
      executeTool(tools, "openmeld_search_slack_messages", {
        includeBots: false,
        query: "project gizmo status",
      })
    ).resolves.toEqual(response);
    expect(centerAgentSearchSlackMessages).toHaveBeenCalledWith({
      context: {
        activeOrganizationId: request.organizationId,
        actorContext: {
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          callerPrincipalId: request.agentProfileId,
          profileKind: "agent",
          requestId:
            "remote-agent-tool:openmeld_search_slack_messages:flue_submission_123",
          openMeldProfileId: request.agentProfileId,
        },
        agentControllerConversationId: ACK.submissionId,
      },
      includeBots: false,
      query: "project gizmo status",
      searchAuthorization: {
        encryptedAuthorization: "aesgcm:v1:iv:ciphertext",
      },
      speakerMember: {
        memberId: "member_123",
        userId: "user_1",
      },
    });
  });

  it("rejects an acknowledgement without the current search result contract", async () => {
    const request = createSlackSearchRequest();
    const centerAgentSearchSlackMessages = vi.fn(async () => ({
      organizationId: request.organizationId,
      status: "presented" as const,
    })) as unknown as RemoteAgentCoreWorkerBinding["centerAgentSearchSlackMessages"];
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: { centerAgentSearchSlackMessages },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
      turnEnvelope: request.turnEnvelope,
    });

    await expect(
      executeTool(tools, "openmeld_search_slack_messages", {
        query: "project gizmo status",
      })
    ).rejects.toThrow();
  });

  it("lets the same Center Agent refine its Slack evidence in one turn", async () => {
    const request = createSlackSearchRequest();
    const response = slackSearchResponse(request.organizationId);
    const centerAgentSearchSlackMessages = vi.fn(async () => response);
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: { centerAgentSearchSlackMessages },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
      turnEnvelope: request.turnEnvelope,
    });

    for (const query of [
      "project gizmo status",
      "project gizmo blockers",
      "project gizmo owner",
    ]) {
      await expect(
        executeTool(tools, "openmeld_search_slack_messages", { query })
      ).resolves.toEqual(response);
    }
    expect(centerAgentSearchSlackMessages).toHaveBeenCalledTimes(3);
  });

  it("allows an exact thread reply only after Slack returned that target in this turn", async () => {
    const request = createSlackSearchRequest();
    const response = slackSearchResponse(request.organizationId);
    const centerAgentSearchSlackMessages = vi.fn(async () => response);
    const centerAgentPostSlackThreadMessage = vi.fn(async () => ({
      attribution: {
        actorProfileId: request.agentProfileId,
        onBehalfOf: {
          displayName: "Felix",
          profileId: "22222222-2222-4222-8222-222222222222",
          userId: request.agentProfileOwnerUserId,
        },
      },
      channelName: "release",
      joinedChannel: false,
      messageTs: "1710000001.001",
      organizationId: request.organizationId,
    }));
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: {
        centerAgentPostSlackThreadMessage,
        centerAgentSearchSlackMessages,
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
      turnEnvelope: request.turnEnvelope,
    });

    await executeTool(tools, "openmeld_search_slack_messages", {
      query: "project gizmo status",
    });
    await expect(
      executeTool(tools, "openmeld_post_slack_channel_message", {
        publicationSource: {
          kind: "current_turn",
          operationId: "slack-message-1",
        },
        text: "The release is ready.",
        threadPermalink: response.messages[0]?.permalink,
      })
    ).resolves.toMatchObject({ messageTs: "1710000001.001" });
    expect(centerAgentPostSlackThreadMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadPermalink: response.messages[0]?.permalink,
      })
    );
  });

  it("keeps concurrent search calls on the same structured evidence path", async () => {
    const request = createSlackSearchRequest();
    const response = slackSearchResponse(request.organizationId);
    const centerAgentSearchSlackMessages = vi.fn(async () => response);
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: { centerAgentSearchSlackMessages },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
      turnEnvelope: request.turnEnvelope,
    });

    const results = await Promise.allSettled(
      ["status", "blockers", "owner", "timeline"].map((query) =>
        executeTool(tools, "openmeld_search_slack_messages", { query })
      )
    );

    expect(results).toEqual([
      expect.objectContaining({ status: "fulfilled" }),
      expect.objectContaining({ status: "fulfilled" }),
      expect.objectContaining({ status: "fulfilled" }),
      expect.objectContaining({ status: "fulfilled" }),
    ]);
    expect(centerAgentSearchSlackMessages).toHaveBeenCalledTimes(4);
  });

  it("fails closed when Core returns text or malformed search protocol", async () => {
    const request = createSlackSearchRequest();
    const centerAgentSearchSlackMessages = vi.fn(async () => ({
      organizationId: request.organizationId,
      status: "found",
      text: "<0/search_slack_messages><query>from:@Fangyuan</query>",
    })) as unknown as RemoteAgentCoreWorkerBinding["centerAgentSearchSlackMessages"];
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: { centerAgentSearchSlackMessages },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
      turnEnvelope: request.turnEnvelope,
    });

    await expect(
      executeTool(tools, "openmeld_search_slack_messages", {
        query: "project gizmo status",
      })
    ).rejects.toThrow();
  });
});

function slackSearchResponse(organizationId: string) {
  return {
    messages: [
      {
        authorName: "Ava",
        authorUserId: "U_AVA",
        channelId: "C_RELEASE",
        channelName: "release",
        content: "The Gizmo release is ready.",
        contextMessages: [],
        isAuthorBot: false,
        messageTs: "1710000000.001",
        permalink:
          "https://example.slack.com/archives/C_RELEASE/p1710000000001",
      },
    ],
    moreResultsAvailable: false,
    organizationId,
    status: "found" as const,
  };
}

function createSlackSearchRequest() {
  const base = createSubmitTurnRequest();
  return createSubmitTurnRequest({
    turnEnvelope: {
      ...base.turnEnvelope,
      trigger: {
        channelId: "C0123456",
        conversationId: "slack:T0123456:C0123456:123456.7890",
        searchAuthorization: {
          encryptedAuthorization: "aesgcm:v1:iv:ciphertext",
        },
        source: "slack",
        teamId: "T0123456",
        threadTs: "123456.7890",
      },
    },
  });
}

async function createStorage(
  request: ReturnType<typeof createSubmitTurnRequest>
): Promise<InMemoryDurableObjectStorage> {
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(
    storage,
    createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    })
  );
  return storage;
}

async function executeTool(
  tools: ReturnType<typeof getRemoteAgentOpenMeldToolDefinitions>,
  name: RemoteAgentOpenMeldToolName,
  input: Record<string, unknown>
): Promise<unknown> {
  const tool = tools.find((definition) => definition.name === name);
  if (!tool) {
    throw new Error(`Missing remote-agent tool: ${name}`);
  }
  return await tool.execute(input);
}
