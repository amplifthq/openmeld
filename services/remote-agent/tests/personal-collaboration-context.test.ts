import { buildPersonalRemoteAgentConversationId } from "@openmeld/schemas";
import type { RemoteAgentWorkerSubmitTurnRequest } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { renderPersonalRemoteAgentCollaborationContext } from "../agent-core/prompt/space-collaboration";
import { buildRemoteAgentPromptMessage } from "../agent-core/submission";
import { createSubmitTurnRequestV2 } from "./fixtures";

const HOME_PATH = /\/(Users|home)\//u;

function personalRequest(): RemoteAgentWorkerSubmitTurnRequest {
  const base = createSubmitTurnRequestV2();
  const conversationId = buildPersonalRemoteAgentConversationId(base);
  return {
    ...base,
    v: 4,
    conversationId,
    runtimeConversation: { generation: 0, id: conversationId },
    conversationIdentity: {
      kind: "personal_agent",
      agentProfileId: base.agentProfileId,
    },
    spaceDispatchContext: {
      dispatchChainId: "chain",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "hash",
    },
    sourceMessageEnvelope: {
      text: "Work together",
      activationTargets: [base.agentProfileId, "agt_teammate"],
      referenceTargets: ["agt_reference_only"],
      mentionTargets: [],
    },
  };
}

describe("personal Remote Agent shared Space context", () => {
  it.each([
    "personal_agent",
    "center_agent",
  ] as const)("identifies exact activated participants for %s without treating references as workers", (kind) => {
    const request = personalRequest();
    if (request.v !== 4) {
      throw new Error("expected v4");
    }
    if (kind === "center_agent") {
      request.conversationIdentity = undefined;
    }
    const context = buildRemoteAgentPromptMessage(request);
    expect(context).toContain(`Profile ID: ${request.agentProfileId}`);
    expect(context).toContain("2 Agent Profiles were activated");
    expect(context).toContain("agt_teammate");
    expect(context).not.toContain("agt_reference_only");
    expect(context?.toLowerCase()).toContain("activation is not evidence");
    expect(context).toContain("openmeld_read_space_updates");
    expect(context).not.toContain("local OpenMeld Service");
  });

  it("leaves Center Agent context and native delivery untouched", () => {
    expect(
      renderPersonalRemoteAgentCollaborationContext(createSubmitTurnRequestV2())
    ).toBeNull();
  });

  it("does not inject Center memory handling into a personal Agent's admitted turn", () => {
    const prompt = buildRemoteAgentPromptMessage(personalRequest());
    expect(prompt).toContain("Space Entry Brief");
    expect(prompt).not.toContain("[Context handling]");
    expect(prompt).not.toContain("Use personal memory silently");
  });

  it("does not invent participants for older admitted requests", () => {
    const request = personalRequest();
    if (request.v !== 4) {
      throw new Error("expected v4");
    }
    request.sourceMessageEnvelope = undefined;
    expect(
      renderPersonalRemoteAgentCollaborationContext(request)
    ).not.toContain("were activated");
  });

  it("tells the Agent about a wider audience only when someone else asked", () => {
    const owned = renderPersonalRemoteAgentCollaborationContext(
      personalRequest()
    );
    expect(owned).not.toContain("Visible audience");
    const request = personalRequest();
    request.turnEnvelope = {
      ...request.turnEnvelope,
      sender: {
        kind: "member",
        id: "member_456",
        displayName: "Tali",
        ownerUserId: "user_2",
        profileId: "33333333-3333-4333-8333-333333333333",
        role: "member",
        verified: true,
      },
    };
    const colleague = renderPersonalRemoteAgentCollaborationContext(request);
    expect(colleague).toContain("Visible audience");
    expect(colleague).toContain("Do not reveal absolute local paths");
    expect(colleague).not.toMatch(HOME_PATH);
  });
});
