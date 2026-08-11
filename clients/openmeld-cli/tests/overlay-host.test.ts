import { stripVTControlCharacters } from "node:util";
import pc from "picocolors";
import { describe, expect, it, vi } from "vitest";
import { ReadonlyOverlayPanel } from "../src/space/shell/pi-tui/components/overlay-host";
import type { PanelViewState } from "../src/space/view/space-session-view-state";

const DARK_SURFACE_OPEN = "\u001B[48;2;38;38;38m";
const LIGHT_TEXT_OPEN = "\u001B[38;2;245;245;245m";
const BORDER_OPEN = DARK_SURFACE_OPEN;

describe("ReadonlyOverlayPanel", () => {
  it("renders the panel surface as a box background instead of per-line restores", () => {
    const panel = new ReadonlyOverlayPanel({
      getMaxPanelRows: () => 24,
      onClose: vi.fn(),
      panel: createPanelViewState(),
    });

    const output = panel.render(60).join("\n");

    expect(output).toContain(DARK_SURFACE_OPEN);
    expect(output).not.toContain("\u001B[39m\u001B[48;2;38;38;38m");
  });

  it("renders a single shared border color on all four sides", () => {
    const panel = new ReadonlyOverlayPanel({
      getMaxPanelRows: () => 24,
      onClose: vi.fn(),
      panel: createPanelViewState(),
    });

    const lines = panel.render(60);
    const firstLine = lines[0] ?? "";
    const contentLine =
      lines.find((line) => line.includes("🛰️ Space Info")) ?? "";
    const lastLine = lines.at(-1) ?? "";

    expect(firstLine.startsWith(BORDER_OPEN)).toBe(true);
    expect(contentLine.startsWith(BORDER_OPEN)).toBe(true);
    expect(contentLine).toContain(BORDER_OPEN);
    expect(lastLine.startsWith(BORDER_OPEN)).toBe(true);
    expect(stripVTControlCharacters(lastLine).trim()).toBe("");
  });

  it("does not add extra vertical padding inside the panel surface", () => {
    const panel = new ReadonlyOverlayPanel({
      getMaxPanelRows: () => 24,
      onClose: vi.fn(),
      panel: createPanelViewState(),
    });

    const lines = panel.render(60);
    const plainLines = lines.map((line) => stripVTControlCharacters(line));
    const titleLineIndex = plainLines.findIndex((line) =>
      line.includes("🛰️ Space Info")
    );

    expect(titleLineIndex).toBe(1);
    expect(plainLines[0]?.trim()).toBe("");
    expect(plainLines[1]?.includes("🛰️ Space Info")).toBe(true);
  });

  it("keeps horizontal padding inside the panel surface", () => {
    const panel = new ReadonlyOverlayPanel({
      getMaxPanelRows: () => 24,
      onClose: vi.fn(),
      panel: createPanelViewState(),
    });

    const lines = panel.render(60);
    const titleLine = lines.find((line) => line.includes("🛰️ Space Info"));

    expect(titleLine).toBeDefined();
    expect(
      stripVTControlCharacters(titleLine ?? "").startsWith("   🛰️ Space Info")
    ).toBe(true);
  });

  it("keeps the title line on the accent tone without extra vertical padding", () => {
    const panel = new ReadonlyOverlayPanel({
      getMaxPanelRows: () => 24,
      onClose: vi.fn(),
      panel: createPanelViewState(),
    });

    const lines = panel.render(60);
    const titleLine = lines.find((line) => line.includes("🛰️ Space Info"));

    expect(titleLine).toBeDefined();
    expect(titleLine).toContain(LIGHT_TEXT_OPEN);
  });

  it("renders the status panel on a dark surface with light text", () => {
    const panel = new ReadonlyOverlayPanel({
      getMaxPanelRows: () => 24,
      onClose: vi.fn(),
      panel: createPanelViewState(),
    });

    const output = panel.render(60).join("\n");

    expect(output).toContain(DARK_SURFACE_OPEN);
    expect(output).toContain(LIGHT_TEXT_OPEN);
    expect(stripVTControlCharacters(output)).toContain("🛰️ Space Info");
    expect(output).not.toContain("\u001B[40mGateway  http://localhost:8080");
  });

  it("preserves inline brand coloring inside a dark status panel line", () => {
    const panel = new ReadonlyOverlayPanel({
      getMaxPanelRows: () => 24,
      onClose: vi.fn(),
      panel: {
        ...createPanelViewState(),
        body: {
          blocks: [
            {
              kind: "lines",
              lines: [pc.cyan("openmeld space join space-1")],
            },
          ],
        },
      },
    });

    const output = panel.render(60).join("\n");

    expect(output).toContain(pc.cyan("openmeld space join space-1"));
    expect(output).toContain(DARK_SURFACE_OPEN);
  });

  it("scrolls only the body while keeping the header and footer fixed", () => {
    const panel = new ReadonlyOverlayPanel({
      getMaxPanelRows: () => 10,
      onClose: vi.fn(),
      panel: createPanelViewState({
        bodyBlocks: [
          {
            kind: "lines",
            lines: Array.from({ length: 8 }, (_, index) => `Line ${index + 1}`),
          },
        ],
        headerMetaText: "UpdatedAt 20260315 10:15",
      }),
    });

    const initialOutput = stripVTControlCharacters(panel.render(60).join("\n"));
    expect(initialOutput).toContain("🛰️ Space Info");
    expect(initialOutput).toContain("UpdatedAt 20260315 10:15");
    expect(initialOutput).toContain("Line 1");
    expect(initialOutput).toContain("Line 2");
    expect(initialOutput).not.toContain("Line 3");
    expect(initialOutput).toContain(
      "↑↓ scroll · PgUp/PgDn page · Home/End jump"
    );
    expect(initialOutput).toContain("Press Esc to close.");

    panel.handleInput("\u001B[B");

    const scrolledOutput = stripVTControlCharacters(
      panel.render(60).join("\n")
    );
    expect(scrolledOutput).toContain("🛰️ Space Info");
    expect(scrolledOutput).toContain("UpdatedAt 20260315 10:15");
    expect(scrolledOutput).toContain("Line 2");
    expect(scrolledOutput).not.toContain("Line 1");
    expect(scrolledOutput).toContain("↑ 1 more · ↓ 5 more");
    expect(scrolledOutput).toContain("Press Esc to close.");
  });

  it("supports page and edge scrolling keys for long panel bodies", () => {
    const panel = new ReadonlyOverlayPanel({
      getMaxPanelRows: () => 12,
      onClose: vi.fn(),
      panel: createPanelViewState({
        bodyBlocks: [
          {
            kind: "lines",
            lines: Array.from(
              { length: 20 },
              (_, index) => `Entry ${index + 1}`
            ),
          },
        ],
      }),
    });

    panel.render(60);
    panel.handleInput("\u001B[6~");
    let output = stripVTControlCharacters(panel.render(60).join("\n"));
    expect(output).toContain("Entry 5");
    expect(output).not.toContain("Entry 1");

    panel.handleInput("\u001B[F");
    output = stripVTControlCharacters(panel.render(60).join("\n"));
    expect(output).toContain("Entry 20");
    expect(output).toContain("↑ 16 more");

    panel.handleInput("\u001B[H");
    output = stripVTControlCharacters(panel.render(60).join("\n"));
    expect(output).toContain("Entry 1");
  });

  it("keeps footer instructions visible when body lines wrap into multiple visual rows", () => {
    const panel = new ReadonlyOverlayPanel({
      getMaxPanelRows: () => 12,
      onClose: vi.fn(),
      panel: createPanelViewState({
        bodyBlocks: [
          {
            kind: "lines",
            lines: [
              "This is a very long body line that should wrap across multiple visual rows in the overlay viewport.",
              "This is another long body line that should still leave room for the footer instruction text.",
              "Final wrapped body line for scroll verification.",
            ],
          },
        ],
      }),
    });

    const output = stripVTControlCharacters(panel.render(40).join("\n"));

    expect(output).toContain("↑↓ scroll · PgUp/PgDn page ·");
    expect(output).toContain("Home/End");
    expect(output).toContain("jump");
    expect(output).toContain("Press Esc to");
    expect(output).toContain("close.");
  });

  it("uses the rendered viewport state for page scrolling while keeping header and footer fixed", () => {
    const panel = new ReadonlyOverlayPanel({
      getMaxPanelRows: () => 10,
      onClose: vi.fn(),
      panel: createPanelViewState({
        bodyBlocks: [
          {
            kind: "lines",
            lines: Array.from({ length: 8 }, (_, index) => `Line ${index + 1}`),
          },
        ],
        headerMetaText: "UpdatedAt 20260315 10:15",
      }),
    });

    panel.render(60);
    panel.handleInput("\u001B[6~");

    const output = stripVTControlCharacters(panel.render(60).join("\n"));
    expect(output).toContain("🛰️ Space Info");
    expect(output).toContain("UpdatedAt 20260315 10:15");
    expect(output).toContain("Line 3");
    expect(output).toContain("Line 4");
    expect(output).not.toContain("Line 1");
    expect(output).toContain("↑ 2 more · ↓ 4 more");
    expect(output).toContain("Press Esc to close.");
  });

  it("keeps the scroll position on same-kind updates and clamps when content shrinks", () => {
    const panel = new ReadonlyOverlayPanel({
      getMaxPanelRows: () => 12,
      onClose: vi.fn(),
      panel: createPanelViewState({
        bodyBlocks: [
          {
            kind: "lines",
            lines: Array.from({ length: 8 }, (_, index) => `Item ${index + 1}`),
          },
        ],
      }),
    });

    panel.render(60);
    panel.handleInput("\u001B[6~");
    let output = stripVTControlCharacters(panel.render(60).join("\n"));
    expect(output).toContain("Item 5");

    panel.setPanel(
      createPanelViewState({
        bodyBlocks: [
          {
            kind: "lines",
            lines: Array.from(
              { length: 10 },
              (_, index) => `Item ${index + 1}`
            ),
          },
        ],
      })
    );
    output = stripVTControlCharacters(panel.render(60).join("\n"));
    expect(output).toContain("Item 5");

    panel.setPanel(
      createPanelViewState({
        bodyBlocks: [
          {
            kind: "lines",
            lines: ["Item 1", "Item 2", "Item 3"],
          },
        ],
      })
    );
    output = stripVTControlCharacters(panel.render(60).join("\n"));
    expect(output).toContain("Item 1");
    expect(output).toContain("Item 3");
    expect(output).not.toContain("Item 5");
  });
});

function createPanelViewState(input?: {
  bodyBlocks?: PanelViewState["body"]["blocks"];
  headerMetaText?: string | null;
}): PanelViewState {
  return {
    contentAlign: "left",
    headerMetaText: input?.headerMetaText ?? null,
    instructions: [
      {
        id: "close",
        keys: ["Esc"],
        label: "close",
      },
    ],
    kind: "space",
    layout: "centered_modal",
    body: {
      blocks: input?.bodyBlocks ?? [
        {
          kind: "lines",
          lines: ["Gateway  http://localhost:8080"],
        },
      ],
    },
    mode: "readonly",
    searchableList: null,
    surfaceVariant: "dark",
    title: "🛰️ Space Info",
    visible: true,
  };
}
