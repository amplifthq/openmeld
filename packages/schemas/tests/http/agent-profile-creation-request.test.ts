import { describe, expect, it } from "vitest";
import { agentProfileCreationConfigurationSchema } from "../../src";

describe("Agent Profile creation request HTTP schemas", () => {
  it("reads creation requests written before collaboration mode was introduced", () => {
    expect(
      agentProfileCreationConfigurationSchema.parse({
        agentControllerPermissionMode: "codex:customConfig",
        agentControllerRef: "builtin:codex",
        authorizeForOrganization: true,
        defaultProjectId: "project_1",
        modelId: "gpt-5.6-sol",
        openCodePermission: null,
        reasoningLevel: "high",
        targetComputerId: "computer_1",
      })
    ).toMatchObject({ agentControllerCollaborationMode: null });
  });
});
