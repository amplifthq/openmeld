import { resolveAgentControllerRefFromAgentTarget } from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import {
  formatAgentControllerRefDisplayValue,
  resolveLocalRegistryAgentIdFromAgentControllerRef,
} from "../src/agents/controller-identity";

describe("agent controller identity bridge", () => {
  it("maps builtin controller refs to the bare agent ids used by the local registry", () => {
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
    expect(
      formatAgentControllerRefDisplayValue({
        agentControllerRef: "builtin:codex",
      })
    ).toBe("builtin:codex");
  });

  it("keeps custom controller refs as stable local custom target ids", () => {
    expect(
      resolveLocalRegistryAgentIdFromAgentControllerRef({
        agentControllerRef: "custom:custom-target-001",
      })
    ).toBe("custom-target-001");
    expect(
      formatAgentControllerRefDisplayValue({
        agentControllerRef: "custom:custom-target-001",
      })
    ).toBe("custom:custom-target-001");
  });

  it("keeps shared Agent Controller refs aligned with local controller identity normalization", () => {
    const builtinAgentId = resolveLocalRegistryAgentIdFromAgentControllerRef({
      agentControllerRef: "builtin:codex",
    });
    expect(builtinAgentId).toBe("codex");
    expect(
      resolveAgentControllerRefFromAgentTarget({
        targetKind: "builtin",
        agentId: builtinAgentId ?? "",
      })
    ).toBe("builtin:codex");

    const customAgentId = resolveLocalRegistryAgentIdFromAgentControllerRef({
      agentControllerRef: "custom:custom-target-001",
    });
    expect(customAgentId).toBe("custom-target-001");
    expect(
      resolveAgentControllerRefFromAgentTarget({
        targetKind: "custom",
        agentId: customAgentId ?? "",
      })
    ).toBe("custom:custom-target-001");
  });

  it("does not infer a registry agent id from missing or incomplete controller identity", () => {
    expect(
      resolveLocalRegistryAgentIdFromAgentControllerRef({
        agentControllerRef: "builtin:codex",
      })
    ).toBe("codex");
    expect(
      resolveLocalRegistryAgentIdFromAgentControllerRef({
        agentControllerRef: "   ",
      })
    ).toBeNull();
  });
});
