import { describe, expect, it } from "vitest";
import {
  agentControllerPermissionModeRequiresExplicitConfirmation,
  listAgentControllerPermissionModeCatalog,
  listPermissionModeAdvisorSteps,
  MEMBER_AGENT_WELCOME_PERMISSION_MODE_LINE,
  resolveMemberAgentWelcomePermissionModeLine,
  resolvePermissionModeAdvisorSuggestion,
} from "../src";

const CONFIRMATION_MODE_PATTERN = /bypassPermissions|fullAccess/u;

describe("permission-mode advisor suggestions", () => {
  it.each([
    [
      "builtin:claude-code",
      null,
      "claude-code:default",
      "claude-code:acceptEdits",
    ],
    [
      "builtin:claude-code",
      "claude-code:default",
      "claude-code:default",
      "claude-code:acceptEdits",
    ],
    [
      "builtin:claude-code",
      "claude-code:acceptEdits",
      "claude-code:acceptEdits",
      "claude-code:auto",
    ],
    [
      "builtin:codex",
      "codex:askForApproval",
      "codex:askForApproval",
      "codex:approveForMe",
    ],
    ["builtin:codex", undefined, "codex:askForApproval", "codex:approveForMe"],
    [
      "builtin:grok-build",
      "grok-build:default",
      "grok-build:default",
      "grok-build:acceptEdits",
    ],
  ])("suggests the next less-interrupting mode for %s %s", (agentControllerRef, savedPermissionMode, current, suggested) => {
    expect(
      resolvePermissionModeAdvisorSuggestion({
        agentControllerRef,
        savedPermissionMode,
      })
    ).toMatchObject({
      currentPermissionMode: current,
      suggestedPermissionMode: suggested,
    });
  });

  it.each([
    ["builtin:claude-code", "claude-code:plan"],
    ["builtin:claude-code", "claude-code:auto"],
    ["builtin:claude-code", "claude-code:dontAsk"],
    ["builtin:claude-code", "claude-code:bypassPermissions"],
    ["builtin:codex", "codex:approveForMe"],
    ["builtin:codex", "codex:fullAccess"],
    ["builtin:codex", "codex:customConfig"],
    ["builtin:grok-build", "grok-build:acceptEdits"],
    ["builtin:cursor", "cursor:default"],
    ["builtin:opencode", null],
    ["custom:my-agent", null],
    // A mode from another controller is never trusted as the current mode.
    ["builtin:codex", "claude-code:default"],
  ])("suggests nothing for %s %s", (agentControllerRef, savedPermissionMode) => {
    expect(
      resolvePermissionModeAdvisorSuggestion({
        agentControllerRef,
        savedPermissionMode,
      })
    ).toBeNull();
  });

  it("never suggests a mode that needs explicit confirmation, from any current mode", () => {
    for (const {
      agentControllerRef,
      modes,
    } of listAgentControllerPermissionModeCatalog()) {
      for (const mode of [...modes.map((option) => option.value), null]) {
        const suggestion = resolvePermissionModeAdvisorSuggestion({
          agentControllerRef,
          savedPermissionMode: mode,
        });
        if (!suggestion) {
          continue;
        }
        expect(
          agentControllerPermissionModeRequiresExplicitConfirmation(
            suggestion.suggestedPermissionMode
          )
        ).toBe(false);
        expect(suggestion.suggestedPermissionMode).not.toMatch(
          CONFIRMATION_MODE_PATTERN
        );
        // One step only: the suggestion itself suggests at most one more step,
        // and never back to where it started.
        expect(suggestion.suggestedPermissionMode).not.toBe(
          suggestion.currentPermissionMode
        );
      }
    }
  });

  it("keeps every step inside one controller", () => {
    for (const step of listPermissionModeAdvisorSteps()) {
      expect(step.from.split(":")[0]).toBe(step.to.split(":")[0]);
      expect(
        agentControllerPermissionModeRequiresExplicitConfirmation(step.to)
      ).toBe(false);
    }
  });
});

describe("MemberAgent welcome permission line", () => {
  it.each([
    [
      "builtin:claude-code",
      "claude-code:default",
      MEMBER_AGENT_WELCOME_PERMISSION_MODE_LINE,
    ],
    [
      "builtin:codex",
      "codex:askForApproval",
      MEMBER_AGENT_WELCOME_PERMISSION_MODE_LINE,
    ],
    [
      "builtin:claude-code",
      "claude-code:acceptEdits",
      "Permission mode is Accept edits.",
    ],
    [
      "builtin:codex",
      "codex:approveForMe",
      "Permission mode is Approve for me.",
    ],
    ["builtin:claude-code", null, null],
  ])("describes %s %s", (agentControllerRef, agentControllerPermissionMode, line) => {
    expect(
      resolveMemberAgentWelcomePermissionModeLine({
        agentControllerPermissionMode,
        agentControllerRef,
      })
    ).toBe(line);
  });
});
