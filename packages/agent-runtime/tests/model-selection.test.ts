import type { ModelCatalog } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveConversationPolicyFromModelSelection } from "../src/model-selection";

const CATALOG: ModelCatalog = {
  schemaVersion: 1,
  updatedAt: "2026-06-18T00:00:00.000Z",
  agentControllers: {
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

  it("uses selected model and reasoning when the catalog supports them", () => {
    expect(
      resolveConversationPolicyFromModelSelection({
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
        fallbackModel: "gpt-5.5",
        model: "gpt-5.4",
        reasoningLevel: "medium",
      },
    });
  });

  it("late-binds an unavailable explicit model to the controller default", () => {
    expect(
      resolveConversationPolicyFromModelSelection({
        agentControllerRef: "builtin:codex",
        catalog: CATALOG,
        modelSelection: {
          modelId: "gpt-retired",
          reasoningLevel: "high",
        },
      })
    ).toEqual({
      status: "accepted",
      conversationPolicy: {
        fallbackModel: "gpt-5.5",
        model: "gpt-5.5",
      },
    });
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
        fallbackModel: "gpt-5.5",
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
        fallbackModel: "opencode/north-mini-code-free",
        model: "opencode/deepseek-v4-flash-free",
        reasoningLevel: "max",
      },
    });
  });
});
