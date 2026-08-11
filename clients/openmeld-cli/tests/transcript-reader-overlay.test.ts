import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TranscriptReaderOverlay } from "../src/space/shell/pi-tui/components/transcript-reader-overlay";
import type { TranscriptBlockViewState } from "../src/space/transcript/transcript-render";

describe("TranscriptReaderOverlay", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts at the latest content", () => {
    const overlay = new TranscriptReaderOverlay({
      blocks: createSystemBlocks(12),
      getMaxPanelRows: () => 12,
      onClose: vi.fn(),
    });

    const output = stripVTControlCharacters(overlay.render(72).join("\n"));

    expect(output).toContain("📜 Transcript History");
    expect(output).toContain("Entry 12");
    expect(output).not.toContain("Entry 8");
  });

  it("keeps the current viewport and shows a new-updates hint while scrolled up", () => {
    const overlay = new TranscriptReaderOverlay({
      blocks: createSystemBlocks(12),
      getMaxPanelRows: () => 12,
      onClose: vi.fn(),
    });

    overlay.render(72);
    overlay.handleInput("\u001B[5~");

    let output = stripVTControlCharacters(overlay.render(72).join("\n"));
    expect(output).toContain("Entry 9");
    expect(output).not.toContain("Entry 12");

    overlay.setBlocks(createSystemBlocks(14));
    output = stripVTControlCharacters(overlay.render(72).join("\n"));

    expect(output).toContain("Entry 9");
    expect(output).not.toContain("Entry 14");
    expect(output).toContain("New updates below · End to jump");
  });

  it("jumps back to latest on End and clears the update hint", () => {
    const overlay = new TranscriptReaderOverlay({
      blocks: createSystemBlocks(12),
      getMaxPanelRows: () => 12,
      onClose: vi.fn(),
    });

    overlay.render(72);
    overlay.handleInput("\u001B[5~");
    overlay.setBlocks(createSystemBlocks(14));
    overlay.handleInput("\u001B[F");

    const output = stripVTControlCharacters(overlay.render(72).join("\n"));

    expect(output).toContain("Entry 14");
    expect(output).not.toContain("New updates below · End to jump");
  });

  it("preserves transcript bubble rendering and ANSI styling", () => {
    const overlay = new TranscriptReaderOverlay({
      blocks: createBubbleBlocks(),
      getMaxPanelRows: () => 14,
      onClose: vi.fn(),
    });

    const output = overlay.render(60).join("\n");
    const plainOutput = stripVTControlCharacters(output);

    expect(output).toContain("\u001B[48;2;");
    expect(plainOutput).toContain("👤 Felix");
    expect(plainOutput).toContain("hello");
    expect(plainOutput).toContain("human · space creator · seen now");
  });

  it("reuses the initial render result when no footer or scroll input changes", async () => {
    const readonlyOverlaySurface = await import(
      "../src/space/shell/pi-tui/components/readonly-overlay-surface"
    );
    const renderSpy = vi.spyOn(
      readonlyOverlaySurface,
      "buildReadonlyOverlayRenderResult"
    );
    const overlay = new TranscriptReaderOverlay({
      blocks: createSystemBlocks(12),
      getMaxPanelRows: () => 12,
      onClose: vi.fn(),
    });

    renderSpy.mockClear();
    overlay.render(72);

    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it("rebuilds once when new updates change the footer hint state", async () => {
    const readonlyOverlaySurface = await import(
      "../src/space/shell/pi-tui/components/readonly-overlay-surface"
    );
    const renderSpy = vi.spyOn(
      readonlyOverlaySurface,
      "buildReadonlyOverlayRenderResult"
    );
    const overlay = new TranscriptReaderOverlay({
      blocks: createSystemBlocks(12),
      getMaxPanelRows: () => 12,
      onClose: vi.fn(),
    });

    overlay.render(72);
    overlay.handleInput("\u001B[5~");
    renderSpy.mockClear();
    overlay.setBlocks(createSystemBlocks(14));

    expect(renderSpy).toHaveBeenCalledTimes(2);
  });
});

function createSystemBlocks(count: number): TranscriptBlockViewState[] {
  return Array.from({ length: count }, (_, index) => ({
    groupKey: `system-${index + 1}`,
    kind: "system_group" as const,
    lines: [`Entry ${index + 1}`],
    purposes: [null],
    sourceNoticeCount: 1,
  }));
}

function createBubbleBlocks(): TranscriptBlockViewState[] {
  return [
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
  ];
}
