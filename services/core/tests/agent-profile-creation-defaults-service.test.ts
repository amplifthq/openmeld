import { describe, expect, it } from "vitest";
import { resolveFirstUseAgentProfileCreationDefaults } from "../src/agent-profile-binding/application/agent-profile-creation-defaults-service";
import { readModelCatalog } from "../src/config/model-catalog";

describe("first-use Agent Profile creation defaults", () => {
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
