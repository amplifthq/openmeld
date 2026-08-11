import { describe, expect, it } from "vitest";
import {
  listAgentControllerCollaborationModeOptions,
  resolveNativeAgentControllerCollaborationModeForController,
} from "../src";

describe("Agent Controller Collaboration Mode", () => {
  it("lists the controller-native Codex collaboration modes", () => {
    expect(
      listAgentControllerCollaborationModeOptions({
        agentControllerRef: "builtin:codex",
      })
    ).toEqual([
      {
        description:
          "Work directly on tasks. Codex may ask for approval when an action needs it.",
        label: "Default",
        value: "codex:default",
      },
      {
        description:
          "Plan before implementation. Codex can ask structured questions in the Space and will not make changes until you switch back to Default.",
        label: "Plan",
        value: "codex:plan",
      },
    ]);
  });

  it("defaults Codex to Default and fails closed for unsupported controllers or values", () => {
    expect(
      resolveNativeAgentControllerCollaborationModeForController(undefined, {
        agentControllerRef: "builtin:codex",
      })
    ).toBe("codex:default");
    expect(
      resolveNativeAgentControllerCollaborationModeForController("codex:plan", {
        agentControllerRef: "builtin:codex",
      })
    ).toBe("codex:plan");
    expect(
      resolveNativeAgentControllerCollaborationModeForController("plan", {
        agentControllerRef: "builtin:codex",
      })
    ).toBeUndefined();
    expect(
      resolveNativeAgentControllerCollaborationModeForController("codex:plan", {
        agentControllerRef: "builtin:claude-code",
      })
    ).toBeUndefined();
    expect(
      listAgentControllerCollaborationModeOptions({
        agentControllerRef: "builtin:claude-code",
      })
    ).toEqual([]);
  });
});
