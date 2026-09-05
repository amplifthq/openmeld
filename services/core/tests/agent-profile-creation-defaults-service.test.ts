import { describe, expect, it } from "vitest";
import { resolveFirstUseAgentProfileCreationDefaults } from "../src/agent-profile-binding/application/agent-profile-creation-defaults-service";
import { readAuthoredModelCatalog as readModelCatalog } from "../src/config/model-catalog";

describe("first-use Agent Profile creation defaults", () => {
  it("uses a creation recommendation independently of the runtime default", () => {
    const catalog = readModelCatalog();
    const controller = catalog.agentControllers.codex;
    if (!controller) {
      throw new Error("Missing fixture controller");
    }
    controller.creationDefaults = {
      modelId: "gpt-5.5",
      reasoningLevel: "medium",
    };
    expect(
      resolveFirstUseAgentProfileCreationDefaults({
        agentControllerRef: "builtin:codex",
        modelCatalog: catalog,
      })
    ).toEqual(controller.creationDefaults);
    expect(controller.defaultModelId).toBe("gpt-5.6-sol");
  });

  it("supports an explicit model-default reasoning preference", () => {
    const catalog = readModelCatalog();
    const controller = catalog.agentControllers.codex;
    if (!controller) {
      throw new Error("Missing fixture controller");
    }
    controller.creationDefaults = {
      modelId: "gpt-5.5",
      reasoningLevel: null,
    };
    expect(
      resolveFirstUseAgentProfileCreationDefaults({
        agentControllerRef: "builtin:codex",
        modelCatalog: catalog,
      })
    ).toEqual({ modelId: "gpt-5.5", reasoningLevel: null });
  });
  it("starts Codex on the catalog default model with High reasoning", () => {
    expect(
      resolveFirstUseAgentProfileCreationDefaults({
        agentControllerRef: "builtin:codex",
        modelCatalog: readModelCatalog(),
      })
    ).toEqual({
      modelId: "gpt-5.6-sol",
      reasoningLevel: "high",
    });
  });

  it("uses the concrete catalog default without inventing reasoning", () => {
    expect(
      resolveFirstUseAgentProfileCreationDefaults({
        agentControllerRef: "builtin:claude-code",
        modelCatalog: readModelCatalog(),
      })
    ).toEqual({
      modelId: "claude-opus-4-8",
      reasoningLevel: null,
    });
  });

  it("fails closed for an unknown controller", () => {
    expect(
      resolveFirstUseAgentProfileCreationDefaults({
        agentControllerRef: "builtin:missing",
        modelCatalog: readModelCatalog(),
      })
    ).toEqual({ modelId: null, reasoningLevel: null });
  });
});
