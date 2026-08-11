import { describe, expect, it } from "vitest";
import {
  agentControllerPermissionModeRequiresExplicitConfirmation,
  getAgentControllerPermissionModeDisplayMetadata,
  listAgentControllerPermissionModeOptions,
  resolveAgentControllerPermissionMode,
  resolveAgentControllerPermissionModeForController,
  resolveNativeAgentControllerPermissionModeForController,
} from "../src";

describe("Agent Controller Permission Mode", () => {
  it("fails closed to default for unset, unknown, and invalid policy values", () => {
    expect(resolveAgentControllerPermissionMode(undefined)).toBe(
      "claude-code:default"
    );
    expect(resolveAgentControllerPermissionMode(null)).toBe(
      "claude-code:default"
    );
    expect(resolveAgentControllerPermissionMode("unknown")).toBe(
      "claude-code:default"
    );
    expect(resolveAgentControllerPermissionMode("auto-edit")).toBe(
      "claude-code:default"
    );
    expect(
      resolveAgentControllerPermissionMode("claude-code:acceptEdits")
    ).toBe("claude-code:acceptEdits");
  });

  it("returns controller-native display metadata", () => {
    expect(
      getAgentControllerPermissionModeDisplayMetadata("claude-code:default", {
        agentControllerRef: "builtin:claude-code",
      })
    ).toMatchObject({
      fieldLabel: "Claude Code permissions mode",
      label: "Ask permissions",
      tone: "neutral",
    });

    expect(
      getAgentControllerPermissionModeDisplayMetadata("codex:askForApproval", {
        agentControllerRef: "builtin:codex",
      })
    ).toMatchObject({
      fieldLabel: "Codex permissions mode",
      label: "Ask for approval",
      tone: "neutral",
    });

    expect(
      getAgentControllerPermissionModeDisplayMetadata("claude-code:default", {
        agentControllerRef: "builtin:openclaw",
      })
    ).toMatchObject({
      fieldLabel: "Agent Controller permissions mode",
      label: "Ask permissions",
      tone: "neutral",
    });

    expect(
      getAgentControllerPermissionModeDisplayMetadata("cursor:autoReview", {
        agentControllerRef: "builtin:cursor",
      })
    ).toMatchObject({
      fieldLabel: "Cursor permissions mode",
      label: "Auto-review (Smart Auto)",
      tone: "neutral",
    });
  });

  it("marks bypass as a warning option that requires explicit confirmation", () => {
    expect(
      getAgentControllerPermissionModeDisplayMetadata("codex:fullAccess", {
        agentControllerRef: "builtin:codex",
      })
    ).toMatchObject({
      label: "Full access",
      requiresExplicitConfirmation: true,
      tone: "warning",
    });
    expect(
      agentControllerPermissionModeRequiresExplicitConfirmation(
        "claude-code:bypassPermissions"
      )
    ).toBe(true);
    expect(
      agentControllerPermissionModeRequiresExplicitConfirmation(
        "codex:approveForMe"
      )
    ).toBe(false);
    expect(
      agentControllerPermissionModeRequiresExplicitConfirmation("cursor:force")
    ).toBe(true);
  });

  it("lists controller-native options without changing machine values", () => {
    expect(
      listAgentControllerPermissionModeOptions({
        agentControllerRef: "builtin:codex",
      }).map((option) => [option.value, option.label])
    ).toEqual([
      ["codex:askForApproval", "Ask for approval"],
      ["codex:approveForMe", "Approve for me"],
      ["codex:fullAccess", "Full access"],
      ["codex:customConfig", "Custom (config.toml)"],
    ]);

    expect(
      listAgentControllerPermissionModeOptions({
        agentControllerRef: "builtin:cursor",
      }).map((option) => [option.value, option.label])
    ).toEqual([
      ["cursor:default", "Default"],
      ["cursor:plan", "Plan"],
      ["cursor:ask", "Ask"],
      ["cursor:autoReview", "Auto-review (Smart Auto)"],
      ["cursor:force", "Run Everything"],
    ]);
  });

  it("lists no options and omits native mode for unsupported controllers", () => {
    expect(resolveAgentControllerPermissionMode("codex:approveForMe")).toBe(
      "codex:approveForMe"
    );
    expect(
      resolveAgentControllerPermissionModeForController("codex:approveForMe", {
        agentControllerRef: "builtin:openclaw",
      })
    ).toBe("claude-code:default");
    expect(
      resolveNativeAgentControllerPermissionModeForController(
        "codex:approveForMe",
        {
          agentControllerRef: "builtin:openclaw",
        }
      )
    ).toBeUndefined();
    expect(
      resolveNativeAgentControllerPermissionModeForController(
        "codex:approveForMe",
        {
          agentControllerRef: "builtin:claude-code",
        }
      )
    ).toBeUndefined();
    expect(
      resolveNativeAgentControllerPermissionModeForController(
        "codex:approveForMe",
        {
          agentControllerRef: "builtin:codex",
        }
      )
    ).toBe("codex:approveForMe");
    expect(
      resolveNativeAgentControllerPermissionModeForController(undefined, {
        agentControllerRef: "builtin:codex",
      })
    ).toBe("codex:askForApproval");
    expect(
      resolveNativeAgentControllerPermissionModeForController("auto-edit", {
        agentControllerRef: "builtin:codex",
      })
    ).toBeUndefined();
    expect(
      getAgentControllerPermissionModeDisplayMetadata("codex:approveForMe", {
        agentControllerRef: "builtin:openclaw",
      })
    ).toMatchObject({
      label: "Ask permissions",
      tone: "neutral",
    });
    expect(
      listAgentControllerPermissionModeOptions({
        agentControllerRef: "builtin:openclaw",
      }).map((option) => [option.value, option.label])
    ).toEqual([]);
    expect(
      listAgentControllerPermissionModeOptions({
        agentControllerRef: "builtin:unknown-controller",
      }).map((option) => [option.value, option.label])
    ).toEqual([]);
  });
});
