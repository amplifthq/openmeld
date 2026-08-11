import { describe, expect, it } from "vitest";
import { resolveRetiredCliCommandMessage } from "../src/runtime/retired-command-argv";

describe("resolveRetiredCliCommandMessage", () => {
  it("rejects removed space conversation commands before help parsing", () => {
    expect(
      resolveRetiredCliCommandMessage([
        "node",
        "openmeld",
        "space",
        "conversation",
        "bind",
        "--help",
      ])
    ).toContain("unknown command: space conversation");
  });

  it("handles global flags and the spaces alias", () => {
    expect(
      resolveRetiredCliCommandMessage([
        "node",
        "openmeld",
        "--view",
        "agent",
        "spaces",
        "conversation",
        "status",
      ])
    ).toContain("--agent-controller-conversation-id");
  });

  it("leaves current space commands alone", () => {
    expect(
      resolveRetiredCliCommandMessage([
        "node",
        "openmeld",
        "space",
        "history",
        "--help",
      ])
    ).toBeNull();
  });
});
