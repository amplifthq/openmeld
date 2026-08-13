import { describe, expect, it } from "vitest";
import {
  type LocalAgentCandidate,
  resolveSelectableCandidates,
} from "../src/profile-setup";

type TestCandidate = LocalAgentCandidate & {
  displayName: string;
  launchStatus: "ready" | "needs_choice" | "needs_repair" | "not_available";
};

function candidate(overrides: Partial<TestCandidate>): TestCandidate {
  return {
    agentId: "codex",
    displayName: "Codex",
    enabled: true,
    launchStatus: "ready",
    registered: true,
    selectable: true,
    targetKind: "builtin",
    ...overrides,
  };
}

describe("profile setup candidate selection", () => {
  it("keeps selectable builtin candidates even when launchStatus is not ready", () => {
    const candidates = resolveSelectableCandidates([
      candidate({
        agentId: "claude-code",
        displayName: "Claude Code",
        launchStatus: "needs_choice",
      }),
      candidate({
        agentId: "codex",
        displayName: "Codex",
        launchStatus: "ready",
      }),
    ]);

    expect(candidates.map((item) => item.agentId)).toEqual([
      "codex",
      "claude-code",
    ]);
  });

  it("uses the shared product display priority for profile choices", () => {
    const candidates = resolveSelectableCandidates([
      candidate({ agentId: "cursor", displayName: "Cursor" }),
      candidate({ agentId: "custom-z", displayName: "Custom Z" }),
      candidate({ agentId: "grok-build", displayName: "Grok Build" }),
      candidate({ agentId: "claude-code", displayName: "Claude Code" }),
      candidate({ agentId: "codex", displayName: "Codex" }),
      candidate({ agentId: "opencode", displayName: "OpenCode" }),
    ]);

    expect(candidates.map((item) => item.agentId)).toEqual([
      "codex",
      "claude-code",
      "grok-build",
      "cursor",
      "opencode",
      "custom-z",
    ]);
  });

  it("excludes candidates that are not builtin, registered, enabled, and selectable", () => {
    const candidates = resolveSelectableCandidates([
      candidate({ agentId: "custom-agent", targetKind: "custom" }),
      candidate({ agentId: "not-registered", registered: false }),
      candidate({ agentId: "disabled", enabled: false }),
      candidate({ agentId: "not-selectable", selectable: false }),
      candidate({ agentId: "codex" }),
    ]);

    expect(candidates.map((item) => item.agentId)).toEqual(["codex"]);
  });

  it("excludes suspended candidates from new profile setup", () => {
    const candidates = resolveSelectableCandidates([
      candidate({
        agentId: "openclaw",
        displayName: "OpenClaw",
        lifecycleStatus: "suspended",
      }),
      candidate({ agentId: "codex" }),
    ]);

    expect(candidates.map((item) => item.agentId)).toEqual(["codex"]);
  });
});
