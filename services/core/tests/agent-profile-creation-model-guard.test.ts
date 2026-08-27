import { describe, expect, it } from "vitest";
import { evaluateCenterAgentCreationModelGuard } from "../src/agent-profile-creation-request/agent-profile-creation-model-guard";

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

describe("evaluateCenterAgentCreationModelGuard", () => {
  it("blocks an explicitly not-offered model", () => {
    expect(
      evaluateCenterAgentCreationModelGuard({
        catalogControllers,
        controllerId: "codex",
        controllerInterfaceVersion: "1.2.3",
        modelId: "legacy-model",
        reportedModelIds: ["gpt-5.2"],
      })
    ).toMatchObject({
      code: "agent_profile_creation_request.model_not_offered",
    });
  });

  it("blocks a model that requires a newer controller version", () => {
    expect(
      evaluateCenterAgentCreationModelGuard({
        catalogControllers,
        controllerId: "codex",
        controllerInterfaceVersion: "0.39.9",
        modelId: "gpt-5.2",
        reportedModelIds: null,
      })
    ).toMatchObject({
      code: "agent_profile_creation_request.model_requires_newer_controller",
    });
  });

  it("allows a supported model", () => {
    expect(
      evaluateCenterAgentCreationModelGuard({
        catalogControllers,
        controllerId: "codex",
        controllerInterfaceVersion: "0.40.0",
        modelId: "gpt-5.2",
        reportedModelIds: null,
      })
    ).toBeNull();
  });

  it("allows when evidence is missing instead of treating unknown as incompatible", () => {
    for (const input of [
      {
        catalogControllers: null as typeof catalogControllers | null,
        controllerId: "codex",
        controllerInterfaceVersion: null as string | null,
        modelId: "missing-model",
        reportedModelIds: null,
      },
      {
        catalogControllers,
        controllerId: "unknown-controller",
        controllerInterfaceVersion: "1.0.0",
        modelId: "anything",
        reportedModelIds: null,
      },
      {
        catalogControllers,
        controllerId: "codex",
        controllerInterfaceVersion: null,
        modelId: "missing-model",
        reportedModelIds: null,
      },
    ]) {
      expect(evaluateCenterAgentCreationModelGuard(input)).toBeNull();
    }
  });
});
