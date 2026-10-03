import { describe, expect, it, vi } from "vitest";
import { getPersonalRemoteAgentTools } from "../agent-core/personal-remote-agent-tools";
import { buildRemoteAgentSystemPrompt } from "../agent-core/prompt";
import { createSubmitTurnRequest } from "./fixtures";

describe("personal Remote Agent capabilities", () => {
  it("keeps baseline collaboration tools and exposes bounded evidence reads", () => {
    const tools = getPersonalRemoteAgentTools({
      coreWorker: {},
      submissionId: "older-submission",
    });
    expect(tools.map((tool) => tool.name)).toEqual([
      "openmeld_read_space_messages",
      "openmeld_read_space_evidence",
      "openmeld_read_space_file_evidence",
      "openmeld_read_space_thread",
      "openmeld_read_space_members",
      "openmeld_wake_agent_in_space",
      "openmeld_set_reply_placement",
    ]);
  });
  it("exposes only current conversation reading and explicit same-Space handoffs", async () => {
    const call = vi.fn(
      async (_request: unknown): Promise<unknown> => ({
        kind: "members",
        members: [],
      })
    );
    const tools = getPersonalRemoteAgentTools({
      coreWorker: { personalRemoteAgentSpaceTool: call },
      submissionId: "accepted-submission",
      sharedSpaceContextEnabled: true,
    });
    expect(tools.map((tool) => tool.name)).toEqual([
      "openmeld_read_space_board",
      "openmeld_read_space_updates",
      "openmeld_read_space_messages",
      "openmeld_read_space_evidence",
      "openmeld_read_space_file_evidence",
      "openmeld_read_space_thread",
      "openmeld_read_space_members",
      "openmeld_wake_agent_in_space",
      "openmeld_set_reply_placement",
    ]);
    const messages = tools.find(
      (tool) => tool.name === "openmeld_read_space_messages"
    );
    const members = tools.find(
      (tool) => tool.name === "openmeld_read_space_members"
    );
    const wake = tools.find(
      (tool) => tool.name === "openmeld_wake_agent_in_space"
    );
    const placement = tools.find(
      (tool) => tool.name === "openmeld_set_reply_placement"
    );
    if (!(messages && members && wake && placement)) {
      throw new Error("expected personal collaboration tools");
    }
    await members.execute({});
    expect(call).toHaveBeenCalledWith({
      submissionId: "accepted-submission",
      operation: { kind: "members" },
    });
    call.mockResolvedValueOnce({
      kind: "messages",
      messages: [],
      truncated: false,
    });
    await messages.execute({});
    expect(call).toHaveBeenLastCalledWith({
      submissionId: "accepted-submission",
      operation: { kind: "messages" },
    });
    await expect(
      wake.execute({
        agentProfileId: "another-agent",
        text: "Review this draft",
        spaceId: "private-space",
      })
    ).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(2);
    call.mockResolvedValueOnce({
      kind: "reply_placement",
      placement: {
        dispatchId: "dispatch-1",
        sourceSignalId: "source-1",
        profileId: "agent-1",
        locked: true,
        threadContext: null,
      },
    });
    await placement.execute({ placement: "conversation" });
    expect(call).toHaveBeenLastCalledWith({
      submissionId: "accepted-submission",
      operation: { kind: "reply_placement", placement: "conversation" },
    });
  });

  it("does not include Center Agent private memory or Organization material in the personal prompt", () => {
    const prompt = buildRemoteAgentSystemPrompt({
      personalAgent: true,
      turnEnvelope: createSubmitTurnRequest().turnEnvelope,
      organizationBrief: "private-organization-brief",
      organizationDocumentTitles: ["private-document-title"],
      organizationProtectedInformation: "private-protected-value",
    });
    expect(prompt).not.toContain("private-organization-brief");
    expect(prompt).not.toContain("private-document-title");
    expect(prompt).not.toContain("private-protected-value");
    expect(prompt).toContain("A normal reply does not wake anyone");
    expect(prompt).toContain("openmeld_set_reply_placement");
  });
});
