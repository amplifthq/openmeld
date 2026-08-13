import { describe, expect, it } from "vitest";
import {
  buildLocalAgentsGuideUrl,
  handleLocalAgentsGuidePromptKeypress,
  renderLocalAgentsGuidePromptLines,
} from "../src/guides/local-agents-guide-url";

describe("local agents guide URL", () => {
  it("maps the production gateway to the production web guide", () => {
    expect(buildLocalAgentsGuideUrl("https://gateway.openmeld.ai")).toBe(
      "https://openmeld.ai/guides/local-agents"
    );
  });

  it("maps the local gateway port to the local web guide", () => {
    expect(buildLocalAgentsGuideUrl("http://localhost:8080")).toBe(
      "http://localhost:3000/guides/local-agents"
    );
  });

  it("uses Enter as the default continue answer", () => {
    expect(
      handleLocalAgentsGuidePromptKeypress({
        state: { guideUrl: "https://openmeld.ai/guides/local-agents" },
        str: undefined,
        key: { name: "return" },
      })
    ).toMatchObject({
      type: "result",
      status: "submitted",
      result: "continue",
    });
  });

  it("accepts raw carriage return as the default continue answer", () => {
    expect(
      handleLocalAgentsGuidePromptKeypress({
        state: { guideUrl: "https://openmeld.ai/guides/local-agents" },
        str: "\r",
        key: { name: undefined, sequence: "\r" },
      })
    ).toMatchObject({
      type: "result",
      status: "submitted",
      result: "continue",
    });
  });

  it("lets the user decline continuing without local agents", () => {
    expect(
      handleLocalAgentsGuidePromptKeypress({
        state: { guideUrl: "https://openmeld.ai/guides/local-agents" },
        str: "n",
        key: { name: "n" },
      })
    ).toMatchObject({
      type: "result",
      status: "cancelled",
      result: "cancelled",
    });
  });

  it("renders the supported-agent names and guide URL in the prompt", () => {
    expect(
      renderLocalAgentsGuidePromptLines(
        { guideUrl: "https://openmeld.ai/guides/local-agents" },
        "active"
      ).join("\n")
    ).toContain("Codex, Claude Code, Grok Build, Cursor, or OpenCode");
    expect(
      renderLocalAgentsGuidePromptLines(
        { guideUrl: "https://openmeld.ai/guides/local-agents" },
        "active"
      ).join("\n")
    ).toContain("https://openmeld.ai/guides/local-agents");
  });
});
