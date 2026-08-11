import { describe, expect, it } from "vitest";
import {
  buildDualViewGuideLines,
  buildDualViewGuideMessage,
} from "../src/runtime/dual-view-guide";

describe("dual view guide template", () => {
  it("renders human and agent sections in stable order", () => {
    const lines = buildDualViewGuideLines({
      summary: "sample summary",
      humanSteps: ["openmeld view human", "openmeld start"],
      agentRequiredArgs: ["--kind agent", "--profile-id <agent-profile-id>"],
      agentOptionalArgs: ["--agent-name <client>"],
      agentCommands: ["openmeld start --view agent --kind agent ..."],
      notes: ["skills source: ~/.openmeld/skills"],
    });

    expect(lines[0]).toBe("sample summary");
    expect(lines).toContain("[FOR HUMAN OPERATORS]");
    expect(lines).toContain("[FOR AGENTS]");
    expect(lines).toContain("required arguments:");
    expect(lines).toContain("optional arguments:");
    expect(lines).toContain("commands:");
    expect(lines).toContain("notes:");
    expect(lines).toContain("1) openmeld view human");
    expect(lines).toContain("2) openmeld start");
  });

  it("can serialize to multi-line message", () => {
    const message = buildDualViewGuideMessage({
      summary: "summary",
      humanSteps: ["openmeld view human", "openmeld start"],
      agentCommands: ["openmeld skills install --all"],
    });

    expect(message).toContain("summary");
    expect(message).toContain("[FOR HUMAN OPERATORS]");
    expect(message).toContain("[FOR AGENTS]");
    expect(message).toContain("openmeld skills install --all");
  });
});
