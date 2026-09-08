import { describe, expect, it, vi } from "vitest";
import { getPersonalRemoteAgentTools } from "../agent-core/personal-remote-agent-tools";
import { buildRemoteAgentSystemPrompt } from "../agent-core/prompt";

describe("personal Remote Agent capabilities", () => {
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
    });
    expect(tools.map((tool) => tool.name)).toEqual([
      "openmeld_read_space_board",
      "openmeld_read_space_updates",
      "openmeld_read_space_messages",
      "openmeld_read_space_members",
      "openmeld_wake_agent_in_space",
    ]);
    const [, , messages, members, wake] = tools;
    if (!(messages && members && wake)) {
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
  });

  it("does not include Center Agent private memory or Organization material in the personal prompt", () => {
    const prompt = buildRemoteAgentSystemPrompt({
      personalAgent: true,
      organizationBrief: "private-organization-brief",
      organizationDocumentTitles: ["private-document-title"],
      organizationProtectedInformation: "private-protected-value",
    });
    expect(prompt).not.toContain("private-organization-brief");
    expect(prompt).not.toContain("private-document-title");
    expect(prompt).not.toContain("private-protected-value");
    expect(prompt).toContain("A normal reply does not wake anyone");
  });
});
