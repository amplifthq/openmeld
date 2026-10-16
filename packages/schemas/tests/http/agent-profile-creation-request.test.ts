import { describe, expect, it } from "vitest";
import {
  agentProfileCreationConfigurationSchema,
  createAgentProfileCreationRequestBodySchema,
  DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
} from "../../src";

describe("Agent Profile creation request HTTP schemas", () => {
  it("requires an acknowledged existing shared conversation and rejects provider-owned settings", () => {
    const configuration = {
      ...DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
      agentControllerRef: "builtin:grok-bot",
      targetComputerId: "computer_1",
      sharedConversation: { conversationId: "123", acknowledged: true },
    };
    expect(
      agentProfileCreationConfigurationSchema.safeParse(configuration).success
    ).toBe(true);
    for (const patch of [
      { sharedConversation: undefined },
      { sharedConversation: { conversationId: "123", acknowledged: false } },
      { modelId: "model" },
      { defaultProjectId: "project" },
      { agentControllerPermissionMode: "codex:customConfig" },
    ]) {
      expect(
        agentProfileCreationConfigurationSchema.safeParse({
          ...configuration,
          ...patch,
        }).success
      ).toBe(false);
    }
    expect(
      createAgentProfileCreationRequestBodySchema.safeParse({
        configuration,
        idempotencyKey: "request",
        profileName: "Bot",
        sessionStrategy: "fork",
        nativeSessionId: "123",
        source: "cli",
        targetOwnerUserId: "owner",
      }).success
    ).toBe(false);
  });
  it("preserves the retired field only as a rolling compatibility boolean", () => {
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
      authorizeForOrganization: true,
    });
  });

  it("fills the compatibility boolean for new writers that omit it", () => {
    const configuration = agentProfileCreationConfigurationSchema.parse({
      agentControllerPermissionMode: null,
      agentControllerRef: null,
      defaultProjectId: null,
      modelId: null,
      openCodePermission: null,
      reasoningLevel: null,
      targetComputerId: null,
    });

    expect(configuration).toMatchObject({
      agentControllerCollaborationMode: null,
      agentControllerRef: null,
      authorizeForOrganization: true,
      targetComputerId: null,
    });
  });

  it("accepts a Remote Agent model and reasoning selection without local settings", () => {
    const configuration = {
      agentControllerPermissionMode: null,
      agentControllerRef: "hosted:remote-agent",
      defaultProjectId: null,
      modelId: "openai/gpt-6-sol",
      openCodePermission: null,
      reasoningLevel: "medium",
      targetComputerId: null,
    };
    expect(
      agentProfileCreationConfigurationSchema.parse(configuration)
    ).toMatchObject(configuration);
    expect(
      agentProfileCreationConfigurationSchema.safeParse({
        ...configuration,
        modelId: null,
      }).success
    ).toBe(false);
    expect(
      agentProfileCreationConfigurationSchema.safeParse({
        ...configuration,
        targetComputerId: "computer_1",
      }).success
    ).toBe(false);
  });
});
