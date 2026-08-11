import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
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
    const response = {
      organizationId: request.organizationId,
      status: "presented" as const,
    };
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
          callerPrincipalId: request.agentProfileOwnerUserId,
          ownerUserId: request.agentProfileOwnerUserId,
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

  it("allows only one Slack search attempt per user-initiated turn", async () => {
    const request = createSlackSearchRequest();
    const response = {
      organizationId: request.organizationId,
      status: "presented" as const,
    };
    const centerAgentSearchSlackMessages = vi.fn(async () => response);
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
    ).resolves.toEqual(response);
    await expect(
      executeTool(tools, "openmeld_search_slack_messages", {
        query: "project gizmo blockers",
      })
    ).rejects.toThrow(
      "Slack search was already attempted for this user-initiated turn. Ask the user to send a new Slack message before searching again."
    );
    expect(centerAgentSearchSlackMessages).toHaveBeenCalledTimes(1);
  });
});

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
