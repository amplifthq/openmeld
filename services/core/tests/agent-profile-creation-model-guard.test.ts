import { describe, expect, it } from "vitest";
import { evaluateAgentProfileCreationModelGuard } from "../src/agent-profile-creation-request/agent-profile-creation-model-guard";

const localAgent = { agentControllerRef: "builtin:codex" };

const catalogControllers = {
  codex: {
    defaultModelId: "gpt-5.2",
    models: [
      {
        displayName: "GPT 5.2",
        id: "gpt-5.2",
        minCliVersion: "0.40.0",
        supportedReasoningLevels: ["medium"],
        unavailable: false,
      },
      {
        displayName: "Legacy Model",
        id: "legacy-model",
        minCliVersion: null,
        supportedReasoningLevels: [],
        unavailable: false,
      },
    ],
  },
};

describe("evaluateAgentProfileCreationModelGuard", () => {
  it("blocks an explicitly not-offered model", () => {
    expect(
      evaluateAgentProfileCreationModelGuard({
        ...localAgent,
        agentDisplayName: "Codex",
        catalogControllers,
        controllerId: "codex",
        controllerInterfaceVersion: "1.2.3",
        deviceDisplayName: "Felix MacBook Pro",
        modelId: "legacy-model",
        reportedModelIds: ["gpt-5.2"],
      })
    ).toMatchObject({
      code: "agent_profile_creation_request.model_not_offered",
    });
  });

  it("blocks a model that requires a newer controller version", () => {
    expect(
      evaluateAgentProfileCreationModelGuard({
        ...localAgent,
        agentDisplayName: "Codex",
        catalogControllers,
        controllerId: "codex",
        controllerInterfaceVersion: "0.39.9",
        deviceDisplayName: "Felix MacBook Pro",
        modelId: "gpt-5.2",
        reportedModelIds: null,
      })
    ).toMatchObject({
      code: "agent_profile_creation_request.model_requires_newer_controller",
    });
  });

  it("allows a supported model", () => {
    expect(
      evaluateAgentProfileCreationModelGuard({
        ...localAgent,
        agentDisplayName: "Codex",
        catalogControllers,
        controllerId: "codex",
        controllerInterfaceVersion: "0.40.0",
        deviceDisplayName: "Felix MacBook Pro",
        modelId: "gpt-5.2",
        reportedModelIds: null,
      })
    ).toBeNull();
  });

  it("allows when evidence is missing instead of treating unknown as incompatible", () => {
    for (const input of [
      {
        ...localAgent,
        agentDisplayName: "Codex",
        catalogControllers: null as typeof catalogControllers | null,
        controllerId: "codex",
        controllerInterfaceVersion: null as string | null,
        deviceDisplayName: "Felix MacBook Pro",
        modelId: "legacy-model",
        reportedModelIds: null,
      },
      {
        ...localAgent,
        agentDisplayName: "Codex",
        catalogControllers,
        controllerId: "codex",
        controllerInterfaceVersion: null,
        deviceDisplayName: "Felix MacBook Pro",
        modelId: "legacy-model",
        reportedModelIds: null,
      },
    ]) {
      expect(evaluateAgentProfileCreationModelGuard(input)).toBeNull();
    }
  });

  it.each([
    {
      modelId: "gpt-6",
      reasoningLevel: "medium",
      code: "agent_profile_binding.model_not_supported",
    },
    {
      modelId: "gpt-5.2",
      reasoningLevel: "high",
      code: "agent_profile_binding.reasoning_level_not_supported",
    },
  ])("rejects invalid catalog intent when device evidence is missing: $code", ({
    modelId,
    reasoningLevel,
    code,
  }) => {
    expect(
      evaluateAgentProfileCreationModelGuard({
        ...localAgent,
        agentDisplayName: "Codex",
        catalogControllers,
        controllerId: "codex",
        controllerInterfaceVersion: null,
        deviceDisplayName: "Test Computer",
        modelId,
        reasoningLevel,
        reportedModelIds: null,
      })
    ).toMatchObject({ code });
  });
});
