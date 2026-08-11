import { stripVTControlCharacters } from "node:util";
import pc from "picocolors";
import { describe, expect, it } from "vitest";
import {
  buildPanelDisplayLines,
  buildPanelDisplaySections,
  formatPanelOverflowHintLine,
} from "../src/space/panel/space-panel-display";
import type { PanelViewState } from "../src/space/view/space-session-view-state";

describe("space panel display", () => {
  it("keeps Space Name and Space ID as full-width rows", () => {
    const lines = renderDisplayLines(96);

    expect(lines).toContain("Space Name  Ops Room");
    expect(lines).toContain(
      "Space ID  ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd"
    );
  });

  it("renders two-column facts when content width is wide enough", () => {
    const lines = renderDisplayLines(96);

    expect(lines.some((line) => line.includes("Space Created"))).toBe(true);
    expect(lines.some((line) => line.includes("Space Creator"))).toBe(true);
    expect(lines.some((line) => line.includes("    Space Creator"))).toBe(true);
    expect(
      lines.indexOf(
        "⚠ Public space: anyone with this Space ID can join. Only bring trusted agents."
      )
    ).toBeLessThan(lines.indexOf("Join command"));
    expect(lines).toContain("Join command");
    expect(lines).toContain(
      "⚠ Public space: anyone with this Space ID can join. Only bring trusted agents."
    );
  });

  it("renders a right-aligned header meta label when provided", () => {
    const lines = renderDisplayLines(96, "UpdatedAt 20260314 22:25");

    expect(lines[0]).toContain("🛰️ Space Info");
    expect(lines[0]).toContain("UpdatedAt 20260314 22:25");
  });

  it("falls back to stacked fact rows when the content width is narrow", () => {
    const lines = renderDisplayLines(72);
    const createdLabelIndex = lines.indexOf("Space Created");

    expect(createdLabelIndex).toBeGreaterThan(-1);
    expect(lines[createdLabelIndex + 1]).toBe("2026-03-13T00:00:00.000Z");
    expect(lines).toContain("Gateway URL");
    expect(lines).toContain("http://localhost:8080");
  });

  it("splits the panel into header, control, body, and footer sections", () => {
    const sections = buildPanelDisplaySections({
      contentWidth: 96,
      panel: createPanelViewState("UpdatedAt 20260314 22:25"),
    });

    expect(sections.headerLines).toHaveLength(1);
    expect(stripVTControlCharacters(sections.headerLines[0] ?? "")).toContain(
      "🛰️ Space Info"
    );
    expect(stripVTControlCharacters(sections.headerLines[0] ?? "")).toContain(
      "UpdatedAt 20260314 22:25"
    );
    expect(
      sections.bodyLines.some((line) =>
        stripVTControlCharacters(line).includes("Space Name  Ops Room")
      )
    ).toBe(true);
    expect(sections.controlLines).toEqual([]);
    expect(sections.footerLines).toEqual([
      `${pc.dim("Press ")}Esc${pc.dim(" to close.")}`,
    ]);
  });

  it("renders a searchable members panel with a fixed control row and active item anchor", () => {
    const sections = buildPanelDisplaySections({
      contentWidth: 96,
      panel: {
        body: {
          blocks: [],
        },
        contentAlign: "left",
        headerMetaText: "UpdatedAt 20260315 01:02",
        instructions: [
          {
            id: "close",
            keys: ["Esc"],
            label: "close",
          },
        ],
        kind: "members",
        layout: "centered_modal",
        mode: "searchable_list",
        searchableList: {
          activeItemId: "hum_casey",
          control: {
            label: "Type to search",
            placeholder: "Filter members by name, @wake, ID, or owner",
            query: "case",
          },
          emptyLines: [],
          sections: [
            {
              id: "humans",
              items: [
                {
                  id: "hum_casey",
                  lines: ["Casey · hum_casey", "member · seen now"],
                },
              ],
              title: "👤 Humans",
            },
          ],
        },
        surfaceVariant: "dark",
        title: "👥 Space Members",
        visible: true,
      },
    });

    expect(sections.headerLines).toHaveLength(1);
    expect(sections.controlLines).toEqual([
      `${pc.dim("Type to search")}  case█`,
    ]);
    expect(stripVTControlCharacters(sections.bodyLines[0] ?? "")).toBe(
      "👤 Humans"
    );
    expect(stripVTControlCharacters(sections.bodyLines[1] ?? "")).toContain(
      "❯ Casey · hum_casey"
    );
    expect(sections.bodyAnchorLineIndex).toBe(1);
    expect(sections.bodyItemAnchors).toEqual([
      {
        id: "hum_casey",
        lineIndex: 1,
      },
    ]);
    expect(sections.footerLines).toEqual([
      `${pc.dim("Press ")}Esc${pc.dim(" to close. Type to search.")}`,
    ]);
  });

  it("renders a stronger more-below affordance for overflow hints", () => {
    expect(
      stripVTControlCharacters(
        formatPanelOverflowHintLine({
          hiddenAfter: 3,
          hiddenBefore: 0,
        }) ?? ""
      )
    ).toBe("↓ 3 more");

    expect(
      stripVTControlCharacters(
        formatPanelOverflowHintLine({
          hiddenAfter: 3,
          hiddenBefore: 2,
        }) ?? ""
      )
    ).toBe("↑ 2 more · ↓ 3 more");

    expect(
      stripVTControlCharacters(
        formatPanelOverflowHintLine({
          hiddenAfter: 0,
          hiddenBefore: 2,
        }) ?? ""
      )
    ).toBe("↑ 2 more");
  });
});

function renderDisplayLines(
  contentWidth: number,
  headerMetaText: string | null = null
): string[] {
  return buildPanelDisplayLines({
    contentWidth,
    panel: createPanelViewState(headerMetaText),
  }).map((line) => stripVTControlCharacters(line));
}

function createPanelViewState(
  headerMetaText: string | null = null
): PanelViewState {
  return {
    body: {
      blocks: [
        {
          kind: "lines",
          lines: [
            pc.yellow(
              "⚠ Public space: anyone with this Space ID can join. Only bring trusted agents."
            ),
          ],
        },
        {
          kind: "facts",
          items: [
            { label: "Space Name", value: "Ops Room", span: "full" },
            {
              label: "Space ID",
              value:
                "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
              span: "full",
            },
            {
              label: "Space Created",
              value: "2026-03-13T00:00:00.000Z",
              span: "column",
            },
            { label: "Space Creator", value: "Felix", span: "column" },
            {
              label: "Space Creator Profile ID",
              value: "hum_felix",
              span: "column",
            },
            { label: "Security", value: "public", span: "column" },
            {
              label: "Gateway URL",
              value: "http://localhost:8080",
              span: "column",
            },
            { label: "Mode", value: "interactive chat", span: "column" },
          ],
        },
        {
          kind: "lines",
          lines: [
            "Join command",
            "openmeld space join ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
          ],
        },
      ],
    },
    contentAlign: "left",
    headerMetaText,
    instructions: [
      {
        id: "close",
        keys: ["Esc"],
        label: "close",
      },
    ],
    kind: "space",
    layout: "centered_modal",
    mode: "readonly",
    searchableList: null,
    surfaceVariant: "dark",
    title: "🛰️ Space Info",
    visible: true,
  };
}
