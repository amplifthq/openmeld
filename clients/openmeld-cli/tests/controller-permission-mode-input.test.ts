import { describe, expect, it } from "vitest";
import {
  assertAgentControllerPermissionModeSupported,
  formatAgentControllerPermissionModeForCli,
  formatAgentControllerPermissionModeHelp,
  normalizeAgentControllerPermissionModeCliInput,
  resolveAgentControllerPermissionModeInput,
} from "../src/profile/controller-permission-mode-input";

describe("Agent Controller Permission Mode CLI input", () => {
  it("normalizes controller-native permission mode slugs", () => {
    for (const [slug, mode] of [
      ["default", "antigravity:default"],
      ["accept-edits", "antigravity:acceptEdits"],
      ["plan", "antigravity:plan"],
      ["bypass-permissions", "antigravity:bypassPermissions"],
    ] as const) {
      expect(
        normalizeAgentControllerPermissionModeCliInput({
          agentControllerRef: "builtin:antigravity",
          flagName: "--agent-controller-permission-mode",
          value: slug,
        })
      ).toBe(mode);
      expect(formatAgentControllerPermissionModeForCli(mode)).toBe(slug);
    }
    expect(
      normalizeAgentControllerPermissionModeCliInput({
        agentControllerRef: "builtin:codex",
        flagName: "--agent-controller-permission-mode",
        value: "approve-for-me",
      })
    ).toBe("codex:approveForMe");
    expect(
      normalizeAgentControllerPermissionModeCliInput({
        agentControllerRef: "builtin:claude-code",
        flagName: "--agent-controller-permission-mode",
        value: "plan",
      })
    ).toBe("claude-code:plan");
    expect(formatAgentControllerPermissionModeForCli("codex:fullAccess")).toBe(
      "full-access"
    );
    expect(
      normalizeAgentControllerPermissionModeCliInput({
        agentControllerRef: "builtin:cursor",
        flagName: "--agent-controller-permission-mode",
        value: "plan",
      })
    ).toBe("cursor:plan");
    expect(
      normalizeAgentControllerPermissionModeCliInput({
        agentControllerRef: "builtin:cursor",
        flagName: "--agent-controller-permission-mode",
        value: "auto-review",
      })
    ).toBe("cursor:autoReview");
    expect(formatAgentControllerPermissionModeForCli("cursor:force")).toBe(
      "run-everything"
    );
    expect(
      normalizeAgentControllerPermissionModeCliInput({
        agentControllerRef: "builtin:grok-build",
        flagName: "--agent-controller-permission-mode",
        value: "bypass-permissions",
      })
    ).toBe("grok-build:bypassPermissions");
  });

  it("keeps command help aligned with every supported controller-native value", () => {
    expect(formatAgentControllerPermissionModeHelp()).toBe(
      "Agent Controller Permission Mode. Antigravity: default|accept-edits|plan|bypass-permissions. Claude Code: ask-permissions|accept-edits|plan|auto|dont-ask|bypass-permissions. Codex: ask-for-approval|approve-for-me|full-access|custom-config. Cursor: default|plan|ask|auto-review|run-everything. Grok Build: default|accept-edits|plan|auto|dont-ask|bypass-permissions."
    );
  });

  it("rejects permission mode values for controllers without a native catalog", async () => {
    expect(() =>
      assertAgentControllerPermissionModeSupported({
        agentControllerPermissionMode: "claude-code:default",
        agentControllerRef: "builtin:openclaw",
        flagName: "--agent-controller-permission-mode",
      })
    ).toThrow(
      "--agent-controller-permission-mode ask-permissions is not supported by builtin:openclaw. Supported values: none."
    );

    await expect(
      resolveAgentControllerPermissionModeInput({
        agentControllerRef: "builtin:openclaw",
        allowPrompt: false,
        agentControllerPermissionModeInput: "ask-for-approval",
        flagName: "--agent-controller-permission-mode",
      })
    ).rejects.toThrow(
      "--agent-controller-permission-mode ask-for-approval is not supported by builtin:openclaw. Supported values: none."
    );
  });

  it.each([
    ["builtin:codex", "full-access"],
    ["builtin:antigravity", "bypass-permissions"],
  ])("requires explicit confirmation for %s in non-interactive runs", async (agentControllerRef, mode) => {
    await expect(
      resolveAgentControllerPermissionModeInput({
        agentControllerRef,
        allowPrompt: false,
        agentControllerPermissionModeInput: mode,
        flagName: "--agent-controller-permission-mode",
      })
    ).rejects.toThrow(
      `--agent-controller-permission-mode ${mode} requires --confirm-dangerous-agent-controller-permission-mode.`
    );
  });
});
