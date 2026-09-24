import type { ModelCatalog } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveConversationPolicyFromModelSelection } from "../src/model-selection";

const CATALOG: ModelCatalog = {
  schemaVersion: 1,
  updatedAt: "2026-06-18T00:00:00.000Z",
  agentControllers: {
    "claude-code": {
      defaultModelId: "claude-opus-4-8",
      models: [
        {
          id: "claude-opus-4-8",
          displayName: "Claude Opus 4.8",
          unavailable: false,
          supportedReasoningLevels: ["low", "medium", "high"],
          minCliVersion: null,
        },
      ],
    },
    codex: {
      defaultModelId: "gpt-5.5",
      models: [
        {
          id: "gpt-5.5",
          displayName: "GPT-5.5",
          unavailable: false,
          supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
          minCliVersion: null,
        },
        {
          id: "gpt-5.4",
          displayName: "GPT-5.4",
          unavailable: false,
          supportedReasoningLevels: ["low", "medium", "high"],
          minCliVersion: null,
        },
        {
          id: "gpt-retired",
          displayName: "GPT Retired",
          unavailable: true,
          supportedReasoningLevels: ["high"],
          minCliVersion: null,
        },
      ],
    },
    opencode: {
      defaultModelId: "opencode/north-mini-code-free",
      models: [
        {
          id: "opencode/north-mini-code-free",
          displayName: "North Mini Code Free",
          unavailable: false,
          supportedReasoningLevels: ["none", "high"],
          minCliVersion: null,
        },
        {
          id: "opencode/deepseek-v4-flash-free",
          displayName: "DeepSeek V4 Flash Free",
          unavailable: false,
          supportedReasoningLevels: ["low", "medium", "high", "max"],
          minCliVersion: null,
        },
      ],
    },
  },
};

describe("resolveConversationPolicyFromModelSelection", () => {
  it.each([
    ["announced", "chatgpt", "on", "accepted"],
    ["announced", "chatgpt", "not_before", "accepted"],
    ["withdrawn", "chatgpt", "on", "rejected"],
    ["withdrawn", "apiKey", "on", "accepted"],
    ["withdrawn", null, "on", "accepted"],
  ] as const)("resolves %s for %s with %s date without a time-triggered shutdown", (status, authType, kind, expected) => {
    const catalog = structuredClone(CATALOG);
    const model = catalog.agentControllers.codex?.models.find(
      (entry) => entry.id === "gpt-5.4"
    );
    if (!model) {
      throw new Error("Test catalog is missing GPT-5.4");
    }
    model.retirement = {
      status,
      date: { value: "2000-01-01", kind },
      scope: { controllerRef: "builtin:codex", authType: "chatgpt" },
      sourceUrl: "https://example.com/official-notice",
      verifiedAt: "2026-09-23T00:00:00Z",
    };
    const result = resolveConversationPolicyFromModelSelection({
      agentControllerRef: "builtin:codex",
      authType,
      catalog,
      modelSelection: { modelId: model.id },
    });
    expect(result.status).toBe(expected);
    if (expected === "rejected") {
      expect(result).toMatchObject({ reasonCode: "model.retired" });
      expect(result).not.toHaveProperty("conversationPolicy");
    } else {
      expect(result).toMatchObject({ conversationPolicy: { model: model.id } });
    }
    // The provider and controller scope cannot leak to another execution surface.
    expect(
      resolveConversationPolicyFromModelSelection({
        agentControllerRef: "custom:codex",
        authType: "chatgpt",
        catalog,
        modelSelection: { modelId: model.id },
      }).status
    ).toBe("accepted");
  });

  it("late-binds unset selections to the controller default", () => {
    expect(
      resolveConversationPolicyFromModelSelection({
        agentControllerRef: "builtin:codex",
        catalog: CATALOG,
      })
    ).toEqual({
      status: "accepted",
      conversationPolicy: {
        fallbackModel: "gpt-5.5",
        model: "gpt-5.5",
      },
    });
  });

  it("preserves an existing Codex thread when the Binding has no explicit selection", () => {
    expect(
      resolveConversationPolicyFromModelSelection({
        agentControllerConversationId: "codex-thread",
        agentControllerRef: "builtin:codex",
        catalog: CATALOG,
      })
    ).toEqual({
      status: "accepted",
      conversationPolicy: {},
    });
  });

  it("keeps late-binding the catalog default for an existing non-Codex session", () => {
    expect(
      resolveConversationPolicyFromModelSelection({
        agentControllerConversationId: "claude-session",
        agentControllerRef: "builtin:claude-code",
        catalog: CATALOG,
      })
    ).toEqual({
      status: "accepted",
      conversationPolicy: {
        fallbackModel: "claude-opus-4-8",
        model: "claude-opus-4-8",
      },
    });
  });

  it("does not apply builtin Codex resume semantics to a custom controller", () => {
    expect(
      resolveConversationPolicyFromModelSelection({
        agentControllerConversationId: "custom-session",
        agentControllerRef: "custom:codex",
        catalog: CATALOG,
      })
    ).toEqual({
      status: "accepted",
      conversationPolicy: {
        fallbackModel: "gpt-5.5",
        model: "gpt-5.5",
      },
    });
  });

  it("uses selected model and reasoning when the catalog supports them", () => {
    expect(
      resolveConversationPolicyFromModelSelection({
        agentControllerConversationId: "codex-thread",
        agentControllerRef: "builtin:codex",
        catalog: CATALOG,
        modelSelection: {
          modelId: "gpt-5.4",
          reasoningLevel: "medium",
        },
      })
    ).toEqual({
      status: "accepted",
      conversationPolicy: {
        model: "gpt-5.4",
        reasoningLevel: "medium",
      },
    });
  });

  it.each([
    "gpt-retired",
    "gpt-missing",
  ])("rejects unavailable explicit model %s without a replacement or policy", (modelId) => {
    const selection = { modelId, reasoningLevel: "high" };
    const result = resolveConversationPolicyFromModelSelection({
      agentControllerRef: "builtin:codex",
      catalog: CATALOG,
      modelSelection: selection,
    });
    expect(result).toMatchObject({
      status: "rejected",
      reasonCode: "model.unavailable",
    });
    expect(result).not.toHaveProperty("conversationPolicy");
    expect(selection).toEqual({ modelId, reasoningLevel: "high" });
  });

  it("drops stale unsupported reasoning without changing route eligibility", () => {
    expect(
      resolveConversationPolicyFromModelSelection({
        agentControllerRef: "builtin:codex",
        catalog: CATALOG,
        modelSelection: {
          modelId: "gpt-5.4",
          reasoningLevel: "xhigh",
        },
      })
    ).toEqual({
      status: "accepted",
      conversationPolicy: {
        model: "gpt-5.4",
      },
    });
  });

  it("keeps OpenCode model variants in the shared conversation policy", () => {
    expect(
      resolveConversationPolicyFromModelSelection({
        agentControllerRef: "builtin:opencode",
        catalog: CATALOG,
        modelSelection: {
          modelId: "opencode/deepseek-v4-flash-free",
          reasoningLevel: "max",
        },
      })
    ).toEqual({
      status: "accepted",
      conversationPolicy: {
        model: "opencode/deepseek-v4-flash-free",
        reasoningLevel: "max",
      },
    });
  });
});
