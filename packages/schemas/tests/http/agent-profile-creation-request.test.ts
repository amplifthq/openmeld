import { describe, expect, it } from "vitest";
import { agentProfileCreationConfigurationSchema } from "../../src";

describe("Agent Profile creation request HTTP schemas", () => {
  it("reads legacy creation requests without preserving retired Wake access", () => {
    const configuration = agentProfileCreationConfigurationSchema.parse({
      agentControllerPermissionMode: "codex:customConfig",
      agentControllerRef: "builtin:codex",
      authorizeForOrganization: true,
      defaultProjectId: "project_1",
      modelId: "gpt-5.6-sol",
      openCodePermission: null,
      reasoningLevel: "high",
      targetComputerId: "computer_1",
    });

    expect(configuration).toMatchObject({
      agentControllerCollaborationMode: null,
    });
    expect(configuration).not.toHaveProperty("authorizeForOrganization");
  });

  it("keeps legacy unbound requests valid when no candidate ID is present", () => {
    const configuration = agentProfileCreationConfigurationSchema.parse({
      agentControllerPermissionMode: null,
      agentControllerRef: null,
      authorizeForOrganization: true,
      defaultProjectId: null,
      modelId: null,
      openCodePermission: null,
      reasoningLevel: null,
      targetComputerId: null,
    });

    expect(configuration).toMatchObject({
      agentControllerCollaborationMode: null,
      agentControllerRef: null,
      targetComputerId: null,
    });
    expect(configuration).not.toHaveProperty("authorizeForOrganization");
  });
});
