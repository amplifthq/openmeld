import { describe, expect, it } from "vitest";
import {
  formatAgentControllerRefDisplayValue,
  matchesAgentControllerRefAgentId,
  resolveLocalRegistryAgentIdFromAgentControllerRef,
} from "../src/agents/controller-identity";

describe("controller identity helpers", () => {
  it("maps builtin controller refs to local registry agent ids", () => {
    expect(
      resolveLocalRegistryAgentIdFromAgentControllerRef({
        agentControllerRef: "builtin:codex",
      })
    ).toBe("codex");
    expect(
      resolveLocalRegistryAgentIdFromAgentControllerRef({
        agentControllerRef: "codex",
      })
    ).toBeNull();
  });

  it("keeps custom controller refs as local registry ids", () => {
    expect(
      resolveLocalRegistryAgentIdFromAgentControllerRef({
        agentControllerRef: "custom:ops-bot",
      })
    ).toBe("ops-bot");
  });

  it("matches builtin controller bindings against bare local agent ids", () => {
    expect(
      matchesAgentControllerRefAgentId({
        agentId: "codex",
        agentControllerRef: "builtin:codex",
      })
    ).toBe(true);
    expect(
      matchesAgentControllerRefAgentId({
        agentId: "codex",
        agentControllerRef: "custom:codex",
      })
    ).toBe(true);
  });

  it("formats builtin controller bindings without duplicating the prefix", () => {
    expect(
      formatAgentControllerRefDisplayValue({
        agentControllerRef: "builtin:codex",
      })
    ).toBe("builtin:codex");
    expect(
      formatAgentControllerRefDisplayValue({
        agentControllerRef: "custom:ops-bot",
      })
    ).toBe("custom:ops-bot");
  });
});
