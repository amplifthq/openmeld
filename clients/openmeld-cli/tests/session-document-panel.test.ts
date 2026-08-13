import { stripVTControlCharacters } from "node:util";
import pc from "picocolors";
import { describe, expect, it } from "vitest";
import { getCliVersionInfo } from "../src/runtime/cli-version";
import { SessionDocumentPanel } from "../src/space/shell/pi-tui/components/session-document-panel";
import { renderOpenMeldLogo } from "../src/ui/brand";
import { buildSpaceInfoCardLines } from "../src/ui/output";
import { renderPositiveAccentText } from "../src/ui/positive-accent";

describe("SessionDocumentPanel", () => {
  it("renders original card lines without adding a leading indent", () => {
    const panel = new SessionDocumentPanel();
    const lines = buildSpaceInfoCardLines({
      gatewayUrl: "http://localhost:8080",
      modeLabel: "interactive chat",
      passwordProtected: false,
      spaceCreatedAt: "2026-03-13T10:38:52.684Z",
      spaceCreatorId: "823a46d4-b711-45b2-933e-722ef5b3a8ee",
      spaceCreatorName: "OpenMeld Dev Local Test",
      spaceId:
        "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
      spaceName: "pi-tui-ref",
    });

    panel.setBlocks([
      {
        kind: "space_info_card",
        lines,
      },
    ]);

    const renderedLines = panel
      .render(120)
      .slice(0, lines.length)
      .map((line) => line.trimEnd());
    expect(renderedLines).toEqual(lines);
  });

  it("renders the session header with aligned copy, centered logo, summary, and separator", () => {
    const panel = new SessionDocumentPanel();
    const spaceId =
      "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd";

    panel.setBlocks([
      {
        kind: "session_header",
        productLabel: "OPENMELD • https://openmeld.ai",
        tagline: "Connect with any agents and humans in real time",
        versionLabel: `v ${getCliVersionInfo().version}`,
        logoLines: renderOpenMeldLogo().split("\n"),
        summaryHintText: "type /members to check",
        summaryFacts: {
          spaceId,
          spaceName: "pi-tui-ref",
          accessLabel: "anyone with the link",
          membersCount: 5,
          liveHumanCount: 2,
          liveAgentCount: 3,
          storageUsedBytes: null,
          storageSoftLimitBytes: null,
          storageUsagePercent: null,
        },
      },
    ]);

    const rawRenderedLines = panel.render(120);
    const renderedLines = panel
      .render(120)
      .map((line) => stripVTControlCharacters(line).trimEnd());

    expect(renderedLines[0]).toContain("OPENMELD • https://openmeld.ai");
    expect(renderedLines[0]).toContain(
      "Connect with any agents and humans in real time"
    );
    expect(
      renderedLines.some(
        (line) =>
          line.startsWith("Current Space › pi-tui-ref") &&
          line.endsWith(spaceId)
      )
    ).toBe(true);
    expect(
      rawRenderedLines.some((line) => line.includes(pc.dim(spaceId)))
    ).toBe(true);
    expect(
      rawRenderedLines.some((line) => line.includes(pc.dim("Current Space › ")))
    ).toBe(true);
    expect(
      rawRenderedLines.some((line) =>
        line.includes(pc.yellow("⚠️ Anyone with the link"))
      )
    ).toBe(true);
    expect(
      rawRenderedLines.some((line) =>
        line.includes(pc.dim(" · type /members to check"))
      )
    ).toBe(true);
    expect(renderedLines).toContain("─".repeat(120));
    expect(renderedLines.join("\n")).toContain(
      "👥 5 · 2 live humans · type /members to check"
    );
    expect(renderedLines.join("\n")).toContain("⚠️ Anyone with the link");
    expect(renderedLines.join("\n")).toContain(
      "Anyone with this Space link can read what is shared here and join."
    );
    expect(renderedLines.join("\n")).toContain(
      `v ${getCliVersionInfo().version}`
    );
  });

  it("adds extra separation between the header and the first transcript line", () => {
    const panel = new SessionDocumentPanel();

    panel.setBlocks([
      {
        kind: "session_header",
        productLabel: "OPENMELD • https://openmeld.ai",
        tagline: "Connect with any agents and humans in real time",
        versionLabel: `v ${getCliVersionInfo().version}`,
        logoLines: renderOpenMeldLogo().split("\n"),
        summaryHintText: "type /members to check",
        summaryFacts: {
          spaceId: "space-1",
          spaceName: "Ops Room",
          accessLabel: "anyone with the link",
          membersCount: 13,
          liveHumanCount: 1,
          liveAgentCount: 0,
          storageUsedBytes: null,
          storageSoftLimitBytes: null,
          storageUsagePercent: null,
        },
      },
      {
        kind: "transcript",
        blocks: [
          {
            kind: "system_group",
            groupKey: "system",
            lines: ["23:58 · 👤 OpenMeld Dev Local Test · first joined"],
            purposes: [null],
            sourceNoticeCount: 1,
          },
        ],
      },
    ]);

    const renderedLines = panel
      .render(120)
      .map((line) => stripVTControlCharacters(line).trimEnd());
    const firstTranscriptIndex = renderedLines.findIndex((line) =>
      line.includes("23:58 · 👤 OpenMeld Dev Local Test · first joined")
    );

    expect(firstTranscriptIndex).toBeGreaterThan(1);
    expect(renderedLines[firstTranscriptIndex - 1]).toBe("");
    expect(renderedLines[firstTranscriptIndex - 2]).toBe("");
  });

  it("uses the live-now green accent for members-only access", () => {
    const panel = new SessionDocumentPanel();

    panel.setBlocks([
      {
        kind: "session_header",
        productLabel: "OPENMELD • https://openmeld.ai",
        tagline: "Connect with any agents and humans in real time",
        versionLabel: `v ${getCliVersionInfo().version}`,
        logoLines: renderOpenMeldLogo().split("\n"),
        summaryHintText: "type /members to check",
        summaryFacts: {
          spaceId: "space-1",
          spaceName: "Secure Room",
          accessLabel: "members only",
          membersCount: 2,
          liveHumanCount: 1,
          liveAgentCount: 0,
          storageUsedBytes: null,
          storageSoftLimitBytes: null,
          storageUsagePercent: null,
        },
      },
    ]);

    const rawRenderedLines = panel.render(120);
    const renderedLines = rawRenderedLines.map((line) =>
      stripVTControlCharacters(line).trimEnd()
    );

    expect(
      rawRenderedLines.some((line) =>
        line.includes(renderPositiveAccentText("🔒 Members only"))
      )
    ).toBe(true);
    expect(renderedLines.join("\n")).toContain("🔒 Members only");
    expect(renderedLines.join("\n")).toContain(
      "Only current members can open this Space."
    );
  });
});
