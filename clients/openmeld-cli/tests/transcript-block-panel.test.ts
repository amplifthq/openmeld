import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { TranscriptBlockPanel } from "../src/space/shell/pi-tui/components/transcript-block-panel";

describe("TranscriptBlockPanel", () => {
  it("renders bubbles and clustered system activity together", () => {
    const panel = new TranscriptBlockPanel();
    panel.setBlocks([
      {
        kind: "plain_text_group",
        groupKey: "profile-id:hum_felix",
        speakerKind: "human",
        highlightKind: "self_human",
        speakerProfileId: "hum_felix",
        speakerProfileName: "Felix",
        messages: [
          {
            primaryLine: "- 👤 Felix 20260313 03:04: hello",
            headerLeading: "👤 Felix",
            headerTrailing: "20260313 03:04:00",
            relationLines: [],
            bodyLines: ["hello"],
            bodyDetailLines: [],
            metaLines: ["human · space creator · seen now"],
            detailLines: ["human · space creator · seen now"],
            rawLines: [
              "- 👤 Felix 20260313 03:04: hello",
              "human · space creator · seen now",
            ],
          },
        ],
      },
      {
        kind: "presence_trace_group",
        groupKey: "system",
        actorKey: "hum_felix",
        actorProfileId: "hum_felix",
        actorKind: "human",
        actorAvatar: "👤",
        actorLabel: "Felix",
        startTs: new Date(2026, 2, 14, 15, 42).getTime(),
        endTs: new Date(2026, 2, 14, 15, 47).getTime(),
        joinCount: 1,
        leftCount: 1,
        count: 2,
      },
      {
        kind: "system_group",
        groupKey: "system",
        lines: ['* 📣 system: Agent "ops-bot" is offline.'],
        purposes: [null],
        sourceNoticeCount: 1,
      },
      {
        kind: "plain_text_group",
        groupKey: "profile-id:agt_ops",
        speakerKind: "agent",
        highlightKind: "owned_agent",
        speakerProfileId: "agt_ops",
        speakerProfileName: "Ops Bot",
        messages: [
          {
            primaryLine: "- 🤖 Ops Bot 20260313 03:06: I’m here.",
            headerLeading: "🤖 Ops Bot",
            headerTrailing: "20260313 03:06:00",
            relationLines: [],
            bodyLines: ["I’m here."],
            bodyDetailLines: [],
            metaLines: ["agent via codex · owner: Felix"],
            detailLines: ["agent via codex · owner: Felix"],
            rawLines: [
              "- 🤖 Ops Bot 20260313 03:06: I’m here.",
              "agent via codex · owner: Felix",
            ],
          },
        ],
      },
    ]);

    const renderedLines = panel.render(80).map((line) => line.trimEnd());
    const strippedLines = renderedLines.map((line) =>
      stripVTControlCharacters(line)
    );
    const strippedOutput = strippedLines.join("\n");

    expect(renderedLines.some((line) => line.includes("\u001B[48;2;"))).toBe(
      true
    );
    expect(strippedOutput).not.toContain("📣 System");
    expect(strippedOutput).toContain("15:42–15:47 · 👤 Felix · join/left ×2");
    expect(strippedOutput).not.toContain(
      "* 📣 system: 👤 Felix joined the space."
    );
    expect(strippedOutput).toContain('Agent "ops-bot" is offline.');
    expect(
      strippedLines.some((line) => line.trimStart().startsWith("👤 Felix"))
    ).toBe(true);
    expect(strippedLines.some((line) => line.includes("- 👤 Felix"))).toBe(
      false
    );
    const centeredPresenceLine = strippedLines.find((line) =>
      line.includes("15:42–15:47 · 👤 Felix · join/left ×2")
    );
    expect(centeredPresenceLine).toBeDefined();
    expect(centeredPresenceLine?.startsWith(" ")).toBe(true);
  });
});
